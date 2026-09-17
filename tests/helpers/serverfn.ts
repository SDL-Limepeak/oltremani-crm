import { toJSONAsync } from "seroval";
import { APP_URL } from "./env";
import type { Session } from "./pgrest";

/**
 * Driver for TanStack Start server functions.
 *
 * `helpers/pgrest.ts` covers the boundary an attacker has. This one covers the other
 * boundary — the rules that live in `src/lib/*.functions.ts` and never reach a policy,
 * because those functions either go through `supabaseAdmin` (which bypasses RLS) or
 * enforce something the database has no opinion about: who may pull a CSV, what happens
 * to a group's members when the group is deleted, whether a contact going inactive drags
 * its cards with it.
 *
 * Neither file replaces the other. A rule that exists only here is a rule a user can walk
 * around with curl; a rule that exists only in RLS gives the user an empty result instead
 * of a sentence. Several rules are deliberately in both.
 *
 * Three things about the wire format, all found the hard way:
 *
 *  1. The endpoint is `/_serverFn/<id>`, where the id is base64url of `{file, export}`.
 *     It is read out of the module Vite serves rather than recomputed, because the
 *     encoding is TanStack's business and not a contract.
 *  2. The dev server only registers an id once that module has been requested. A cold
 *     call answers "Invalid server function ID". Fetching the module first is what
 *     `resolveServerFn` does, and the result is cached per module.
 *  3. The body is seroval's cross-JSON of `{ data }`, not plain JSON, and the request
 *     needs `x-tsr-serverFn: true` — without it the router hands the request to the app
 *     and the answer is the HTML error page.
 */

const idCache = new Map<string, string>();

/** True when a dev server is answering; every caller here skips itself otherwise. */
export async function serverUp(): Promise<boolean> {
  try {
    const res = await fetch(`${APP_URL}/api/public/contact`, { method: "OPTIONS" });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * @param modulePath e.g. "src/lib/categories.functions.ts"
 * @param exportName e.g. "deleteCategory"
 */
async function resolveServerFn(modulePath: string, exportName: string): Promise<string> {
  const key = `${modulePath}#${exportName}`;
  const cached = idCache.get(key);
  if (cached) return cached;

  // Also warms the dev server's registry — see (2) above.
  const res = await fetch(`${APP_URL}/${modulePath}`);
  const text = await res.text();

  // Each server function in the module appears as `<name> = createServerFn(...)...
  // .handler(createClientRpc("<id>"))`. Match the id that follows this export's name.
  const re = new RegExp(`${exportName}\\s*=[\\s\\S]*?createClientRpc\\("([^"]+)"\\)`);
  const m = text.match(re);
  if (!m) {
    throw new Error(
      `Could not find the server function id for ${exportName} in ${modulePath}. ` +
        "Either the export was renamed or TanStack changed how it emits the client stub.",
    );
  }
  idCache.set(key, m[1]);
  return m[1];
}

export type ServerFnResult = { status: number; text: string; denied: boolean };

/** Calls a server function as `session`. `denied` is true when it threw, whatever the reason. */
export async function callServerFn(
  session: Session,
  modulePath: string,
  exportName: string,
  data: unknown = {},
): Promise<ServerFnResult> {
  const id = await resolveServerFn(modulePath, exportName);
  const res = await fetch(`${APP_URL}/_serverFn/${id}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session.token}`,
      "content-type": "application/json",
      "x-tsr-serverFn": "true",
      accept: "application/json",
    },
    body: JSON.stringify(await toJSONAsync({ data })),
  });
  const text = await res.text();
  // A thrown server function still answers 200 with the error serialised into the body,
  // which is the same trap as PostgREST's 204: never assert on the status alone.
  const denied = res.status >= 400 || /"\$TSR\/Error"|Error\b/.test(text);
  return { status: res.status, text, denied };
}

/** True when the call failed with a message containing `fragment`. */
export function failedWith(res: ServerFnResult, fragment: string): boolean {
  return res.denied && res.text.includes(fragment);
}
