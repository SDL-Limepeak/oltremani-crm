# Keeping the demo out of search engines

Until the project goes public, everything must stay out of search engines and out of AI
training crawlers. There are **four** layers and all four are needed, because each covers a
gap in the others.

| Layer | File | Covers |
|---|---|---|
| `<meta name="robots">` | `src/routes/__root.tsx` | router-rendered pages, for crawlers that read HTML |
| `<meta name="robots">` | `public/test-form.html` | its own: a static file that **does not go through the worker** |
| `X-Robots-Tag` header | `src/server.ts` | **every** dynamic response, HTML or not: pages, API, 404, 500. Works on crawlers that ignore meta tags |
| `Disallow` | `public/robots.txt` | wildcard plus the explicit AI crawler list (GPTBot, ClaudeBot, CCBot, Google-Extended, PerplexityBot, Bytespider…) |

Verified in production after the 2026-07-25 deploy:

| Resource | `X-Robots-Tag` | `<meta robots>` |
|---|---|---|
| `/` and `/auth` | ✅ | ✅ |
| `POST /api/public/contact` | ✅ | — |
| `/test-form.html` | ❌ | ✅ |
| `/robots.txt` | ❌ | — (irrelevant: instructions, not indexable content) |

`public/_headers` is **not** one of the working layers — see
[../knowissues.md](../knowissues.md) KI-12.

The only other uncovered case is the `OPTIONS` preflight, where it is meaningless: crawlers
do not send preflights.

> `Disallow: /` prevents *crawling*, so a crawler never gets far enough to read the
> `noindex`. If an URL is linked from elsewhere, Google can still show it as a bare URL with
> no content. That is exactly why `X-Robots-Tag` exists as well: it travels with the
> response and does not depend on the page being read.

None of this restricts **access** — anyone with the link gets in. Real confidentiality
would mean `set_project_visibility` on the Lovable side, which would also break the link
for the client, so it has not been touched.

**When going public, remove the points marked `DEMO:`** in all five files.
