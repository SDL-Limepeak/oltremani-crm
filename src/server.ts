import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!body.includes('"unhandled":true') || !body.includes('"message":"HTTPError"')) {
    return response;
  }

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

// DEMO: keep this project out of search engines entirely.
//
// The <meta name="robots"> in __root.tsx only reaches crawlers that parse HTML, and only
// for pages rendered through the router. This header covers everything the worker serves,
// HTML or not — API responses included — and is honoured by crawlers that ignore meta
// tags. Static files under public/ are served by the platform before reaching the worker,
// so they are covered by public/_headers and by their own meta tag instead.
//
// Remove all three when the project goes public.
const ROBOTS_TAG = "noindex, nofollow, noarchive, nosnippet, noimageindex, notranslate";

function withNoIndex(response: Response): Response {
  // Response headers can be immutable depending on where the response came from.
  // Re-wrapping gives a mutable copy and keeps the streaming body intact.
  const out = new Response(response.body, response);
  out.headers.set("x-robots-tag", ROBOTS_TAG);
  return out;
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return withNoIndex(await normalizeCatastrophicSsrResponse(response));
    } catch (error) {
      console.error(error);
      return withNoIndex(
        new Response(renderErrorPage(), {
          status: 500,
          headers: { "content-type": "text/html; charset=utf-8" },
        }),
      );
    }
  },
};
