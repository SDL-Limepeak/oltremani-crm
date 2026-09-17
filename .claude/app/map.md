# Code map

`src/` — 4.5k lines total. Everything not listed is generated or trivial.

## Server functions — `src/lib/*.functions.ts`

The whole backend surface. Each export is a `createServerFn` guarded by
`requireSupabaseAuth` with a zod validator.

| File | Exports | Access path |
|---|---|---|
| `partners.functions.ts` | `listPartners` `getPartner` `listPartnerRoles` `upsertPartner` `validatePartner` `partnerDeletionImpact` `deletePartner` `recordConsent` | `context.supabase` (RLS). `upsertPartner` also deactivates the cards when a contact moves to `old`; `deletePartner` checks the role in TS as well as in the policy, so the user gets a sentence instead of an empty result |
| `users.functions.ts` | `listUsers` `upsertUser` `deleteUser` `setUserStatus` `updateProfile` | **`supabaseAdmin`** for writes → hand-written checks. Holds the TypeScript copy of the profile hierarchy (`ROLE_RANK` / `canManage`), which mirrors `role_rank` / `can_manage_user` in the database |
| `cities.functions.ts` | `searchCities` `setCityCategory` `upsertCity` `deleteCityById` | **`supabaseAdmin`** for writes → hand-written checks. **This file is the model to copy** |
| `categories.functions.ts` | `listCategories` `upsertCategory` `categoryDeletionImpact` `deleteCategory` | `context.supabase` (RLS). `deleteCategory` refuses a group with members unless told where to move them, and moves them **before** the delete |
| `subscriptions.functions.ts` | `listSubscriptions` `upsertSubscription` `revokeSubscription` `membershipNumberUsage` | `context.supabase` (RLS). `membershipNumberUsage` returns both the numbers in use and the duplicated ones — the dialog warns on the first, the record flags the second |
| `exports.functions.ts` | `exportContacts` | `context.supabase`, paged, writes a `data_export` audit row |
| `dashboard.functions.ts` | `getDashboardStats` | `context.supabase` |
| `audit.functions.ts` | `listAudit` | `context.supabase` (admin-only by policy) |

Non-function libs: `utils.ts` (cn), `error-capture.ts`, `error-page.ts`,
`lovable-error-reporting.ts`, `partner-filters.ts` (pure filters + `hasActiveCard`, shared
by the list, the export and the table's Tesserato column so they cannot disagree).

**A warning about `contact-form.tsx`:** it is used by exactly one route,
`contacts/new.tsx`. An existing contact is edited by the inline form in
`contacts/$id.tsx`, which is a separate implementation. Anything that only makes sense for
a contact that already exists — its cards, its consents, its history — belongs in `$id`,
and putting it in `ContactForm` produces code that compiles, tests green and never runs.
That happened on 2026-09-17 with the "sto per disattivare le tessere" warning.

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
| a contact field | `contact-form.tsx` (new) **and** `contacts/$id.tsx` (existing — it has its own form) + `partners.functions.ts` + schema |
| who can do what | policies first ([../db/rls.md](../db/rls.md)), then the server function |
| the public form contract | `api/public/contact.tsx` + `submit_public_contact` + `public/test-form.html` |
| profiles / user management | `users.functions.ts` + `user-dialog.tsx` + `_authenticated/users.tsx`. The hierarchy also lives in a policy and in `protect_admin_users` — change all three |
| the operational roles of a contact | `res_partner_role` (a table, not code) + `public/test-form.html` for the public form's copy of the codes |
| contact statuses or their order | `selections.ts` only. `STATUS_ORDER` in the contacts list derives from it |
| CSV export columns | `exports.functions.ts` (`COLUMNS` + the row mapper, keep them aligned) |
| branding, colours, fonts | `src/styles.css` + [../ui/branding.md](../ui/branding.md) |
