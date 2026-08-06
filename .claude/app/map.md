# Code map

`src/` — 4.5k lines total. Everything not listed is generated or trivial.

## Server functions — `src/lib/*.functions.ts`

The whole backend surface. Each export is a `createServerFn` guarded by
`requireSupabaseAuth` with a zod validator.

| File | Exports | Access path |
|---|---|---|
| `partners.functions.ts` | `listPartners` `getPartner` `upsertPartner` `validatePartner` `deletePartner` `recordConsent` | `context.supabase` (RLS) |
| `users.functions.ts` | `listUsers` `upsertUser` `deleteUser` `updateProfile` | **`supabaseAdmin`** for writes → hand-written checks |
| `cities.functions.ts` | `searchCities` `setCityCategory` `upsertCity` `deleteCityById` | **`supabaseAdmin`** for writes → hand-written checks. **This file is the model to copy** |
| `categories.functions.ts` | `listCategories` `upsertCategory` `deleteCategory` | `context.supabase` (RLS) |
| `subscriptions.functions.ts` | `listSubscriptions` `upsertSubscription` `revokeSubscription` | `context.supabase` (RLS) |
| `exports.functions.ts` | `exportContacts` | `context.supabase`, paged, writes a `data_export` audit row |
| `dashboard.functions.ts` | `getDashboardStats` | `context.supabase` |
| `audit.functions.ts` | `listAudit` | `context.supabase` (admin-only by policy) |

Non-function libs: `utils.ts` (cn), `error-capture.ts`, `error-page.ts`,
`lovable-error-reporting.ts`.

## Supabase integration — `src/integrations/supabase/`

| File | Role |
|---|---|
| `client.ts` | browser client, anon key, session in localStorage |
| `client.server.ts` | `supabaseAdmin` — **RLS bypassed**. Privileged only on Lovable; not locally |
| `auth-middleware.ts` | `requireSupabaseAuth`. Reads the `Authorization: Bearer`, validates via `getClaims`, injects `{supabase, userId, claims}`. **Marked auto-generated — do not hand-edit** |
| `auth-attacher.ts` | attaches the session token to server-function calls from the client |
| `types.ts` | generated DB types, **hand-patched** — see knowissues KI-08 |

## Routes — `src/routes/`

| Path | File |
|---|---|
| `/` | `index.tsx` — redirects |
| `/auth` | `auth.tsx` — login + password reset |
| `/api/public/contact` | `api/public/contact.tsx` — **the only unauthenticated endpoint** |
| `/app` `/dashboard` `/contacts` `/contacts/$id` `/contacts/new` `/groups` `/cities` `/subscriptions` `/users` `/audit` `/profile` `/guida` | `_authenticated/*` behind `_authenticated/route.tsx` |

`__root.tsx` holds the html shell, meta robots and error boundaries. `server.ts` is the
nitro entry and sets `X-Robots-Tag` on every dynamic response. `routeTree.gen.ts` is
generated.

## Components — `src/components/`

`app-shell.tsx` · `app-sidebar.tsx` · `contact-form.tsx` (227 ln, the biggest) ·
`category-dialog.tsx` · `city-dialog.tsx` · `user-dialog.tsx` · `subscription-dialog.tsx` ·
`consent-dialog.tsx` · `validation-dialog.tsx` · `ui/` (17 shadcn primitives).

## Where to look for a given change

| Change | Files |
|---|---|
| a contact field | `contact-form.tsx` + `partners.functions.ts` + schema |
| who can do what | policies first ([../db/rls.md](../db/rls.md)), then the server function |
| the public form contract | `api/public/contact.tsx` + `submit_public_contact` + `public/test-form.html` |
| roles / user management | `users.functions.ts` + `user-dialog.tsx` + `_authenticated/users.tsx` |
| CSV export columns | `exports.functions.ts` (`COLUMNS` + the row mapper, keep them aligned) |
| branding, colours, fonts | `src/styles.css` + [../ui/branding.md](../ui/branding.md) |
