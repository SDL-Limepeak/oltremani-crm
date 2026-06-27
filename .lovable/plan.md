
# Oltremani CRM — Build Plan

A lightweight CRM + tesseramento backend for oltremani.it. Italian UI, English DB names, Odoo 19/20-aligned schema, role + category-based visibility, public intake API for the website form.

## 1. Stack & setup

- Enable **Lovable Cloud** (Supabase) for DB, Auth, RLS.
- TanStack Start (existing template) with left-sidebar admin shell.
- Tailwind v4 + shadcn (already configured).
- Italian copy throughout UI; English in code/DB.
- Secrets stored via Lovable Cloud:
  - `PUBLIC_API_KEY` (shared secret for `POST /api/public/contact`, sent as `X-API-Key`).
  - `SUPABASE_SERVICE_ROLE_KEY` (auto, used only in server fns for admin ops like seeding Diego).

## 2. Database schema (migration)

All tables under `public`, English names, `timestamptz`, enums via CHECK constraints, indexes as listed. Grants per Lovable rules (`authenticated`, `service_role`; no `anon` except where needed by public API server fn — which uses service role anyway).

Tables exactly as specified:

- `res_partner` — contacts. Status CHECK: `new|active|rejected|old`. Indexes: `email`, `status`, `city_id`.
- `res_partner_category` — tags/groups, self-FK `parent_id` for infinite hierarchy. CHECKs on `category_type` (`territorial|system`) and `status` (`active|inactive`).
- `res_partner_category_rel` — M:N partners↔categories, UNIQUE(partner_id,category_id), indexes both sides.
- `res_city` — comuni, FK→`res_partner_category`. Indexes on `name`, `province_code`, `category_id`.
- `membership_subscription` — UNIQUE(partner_id, year). CHECK status `active|inactive`. Indexes on `year`, `status`, `partner_id`.
- `privacy_consent` — CHECK consent_type `privacy_policy|marketing|newsletter`. Index `partner_id`.
- `res_users` — app users (separate from `res_partner`), id = `auth.users.id`. CHECKs on `role` and `status`. Created via `handle_new_user()` trigger on `auth.users` insert.
- `res_user_category_rel` — M:N users↔categories.
- `audit_log` — single log table. CHECKs on `log_type` and `action`. Indexes on `created_at desc`, `(model_name, record_id)`, `changed_by_user_id`.
- `app_role` enum NOT used — roles live as text + CHECK on `res_users.role` (spec uses text). Helper SECURITY DEFINER fn `public.has_role(_uid uuid, _role text)`.

### Security-definer helpers (avoid RLS recursion)

- `has_role(uid, role text) → bool`
- `is_admin_or_superuser(uid) → bool`
- `visible_category_ids(uid) → setof uuid` — returns the user's assigned categories plus all descendants (recursive CTE). Admin/Superuser short-circuits to all.
- `can_see_partner(uid, partner_id) → bool` — true if any of partner's categories ∈ `visible_category_ids(uid)`, or admin/superuser, with the Validation rule applied (Validation visible only to admin/superuser or users explicitly in Validation).

### RLS policies (high level)

- `res_partner`, `*_rel`, `privacy_consent`, `membership_subscription`: SELECT/UPDATE via `can_see_partner`; INSERT allowed for any authenticated user with role ≥ volunteer (volunteer can only insert partners they will be able to see).
- `res_partner_category`: SELECT — admin/superuser all, others only visible categories; INSERT/UPDATE/DELETE — admin/superuser/coordinator; nobody can delete `system` categories from UI.
- `res_users` & `res_user_category_rel`: managed by admin/superuser (and coordinators within visible categories); **no policy permits modifying admin rows** — enforced by trigger that blocks UPDATE/DELETE when target row's `role = 'admin'` unless caller is the same admin editing own profile.
- `audit_log`: SELECT — admin only; INSERT — service role + authenticated (via server fns).

### Triggers

- `updated_at` auto-touch on all relevant tables.
- `handle_new_user()` on `auth.users` → inserts into `res_users` with name/email and default role `volunteer` (admin/diego seeded separately).
- `audit_partner_changes()` / `audit_subscription_changes()` / `audit_category_assignment()` write to `audit_log` with old/new JSON.
- `prevent_admin_mutation()` on `res_users`.
- `enforce_single_active_subscription_per_year()` (UNIQUE handles it; trigger also forbids 2nd active).

## 3. Seed data

- **Categories**: 8 territorial (Alessandria, Ascoli Piceno, Catania, Genova, Napoli, Pesaro Urbino, Ragusa, Varese) with CF / address / IBAN as provided; one system category `Validation`.
- **Cities**: full Italian comuni list (~8000) imported from a public ISTAT JSON shipped as a bundled asset; the 8 cities matching the territorial categories get their `category_id` set.
- **Admin user**: created in migration via `auth.admin.create_user` SQL helper (service role): email `diego@limepeak.it`, password `Ragusa.26`, `email_confirm = true`; corresponding `res_users` row with role `admin`, name `Diego Cammerinesi`. UI flag prevents this row from being edited/disabled/deleted.

## 4. Server functions & API

`src/lib/*.functions.ts` (createServerFn, RLS-respecting where possible, service role only when needed):

- `auth/profile.functions.ts` — get/update own `res_users` profile.
- `partners.functions.ts` — list (with filters: status, category, city, province, year, has-active-sub), get, create, update, merge, assign categories, validate (city assignment flow). Writes audit_log.
- `subscriptions.functions.ts` — create/update with defaults (year=current, start=today, end=Dec 31). Audited.
- `categories.functions.ts` — tree CRUD, membership listing. Audited.
- `cities.functions.ts` — search/autocomplete by name+province; admin import.
- `users.functions.ts` — list/create/update users (admin/superuser/coordinator within scope). Admin role protected.
- `audit.functions.ts` — list (admin only).
- `dashboard.functions.ts` — aggregated counts.
- `exports.functions.ts` — CSV export of current contact filter; logs `api_call` with `source='export'` to `audit_log`.

### Public API

`src/routes/api/public/contact.ts` — `POST /api/public/contact`.

1. Require `X-API-Key === process.env.PUBLIC_API_KEY` (timing-safe). 401 otherwise.
2. Zod validate body.
3. Always write `audit_log{ log_type:'inbound_form', action:'api_call', source:'website', new_values_json:<payload> }`.
4. Lookup partner by email:
   - Not found → create with `status='new'`, store `raw_city`, `raw_province`.
   - Found → merge only empty fields (never overwrite populated).
5. Normalize city/province → query `res_city`. If hit: set `city_id`, link city's category, remove `Validation`. If miss: link `Validation`.
6. Insert `privacy_consent` rows from `privacy_consents[]` with IP + user_agent.
7. Returns `{ ok: true, partner_id }`.

Uses `supabaseAdmin` loaded inside handler (per import-graph rules).

## 5. UI

Italian labels everywhere. Layout: `_authenticated` route group with Sidebar (shadcn `sidebar`) + topbar (user menu, logout).

Pages:

- **/auth** — login (email+password), public.
- **/_authenticated/dashboard** — cards: total / nuovi / attivi / in validazione / tesseramenti attivi anno corrente / ultimi inbound / ultimi audit.
- **/_authenticated/contacts** — list w/ filters, detail page with tabs: Anagrafica, Note, Categorie, Privacy, Tesseramenti, Storico. Button **"Abilita socio"** when no active sub for current year → modal pre-filled with defaults.
- **/_authenticated/contacts/$id** — detail; validation flow surface (when in Validation, city selector → "Valida e salva" triggers validate fn).
- **/_authenticated/subscriptions** — list + create/edit.
- **/_authenticated/groups** — tree view (recursive). CRUD per role.
- **/_authenticated/cities** — searchable list, category mapping.
- **/_authenticated/users** — visible only to admin/superuser/coordinator. Admin rows shown read-only with lock badge.
- **/_authenticated/audit** — admin only.
- **/_authenticated/profile** — name + change password (Supabase `updateUser`), logout.

Visual: warm cream background (#FAF6EF), terracotta accent (#C45A3D), olive secondary (#6B7A4B), rounded-2xl cards, generous spacing, Inter (already loaded) for body + a soft serif (Fraunces) for headings to mirror oltremani.it warmth. Mobile: sidebar becomes drawer (shadcn `sidebar` collapsible offcanvas).

## 6. Permissions matrix (enforced in RLS + UI gating)

| Action | Admin | Superuser | Coordinator | Volunteer |
|---|---|---|---|---|
| See all contacts | ✓ | ✓ | only visible categories | only visible categories |
| Edit contacts | ✓ | ✓ | visible | visible |
| Manage subscriptions | ✓ | ✓ | visible | — |
| Manage users (non-admin) | ✓ | ✓ | visible scope | — |
| Manage admin users | ✗ (locked in UI) | ✗ | ✗ | ✗ |
| Manage categories | ✓ | ✓ | ✓ | — |
| Audit log | ✓ | ✗ | ✗ | ✗ |

## 7. Technical notes

- All timestamps `timestamptz`.
- Indexes per spec; plus `created_at desc` on `audit_log`.
- Validation: Zod schemas in `src/lib/schemas/*`; reused client + server.
- Toast feedback via `sonner`.
- No business logic in components — hooks (`useContacts`, `useCategoryTree`, etc.) wrap server fns + TanStack Query.

## 8. Build order

1. Enable Lovable Cloud.
2. Set secrets `PUBLIC_API_KEY`.
3. Migration: tables, enums (CHECKs), indexes, helpers, RLS, triggers.
4. Seed: categories, cities (ISTAT JSON), admin user.
5. Auth + layout shell + sidebar.
6. Dashboard + Contacts (list, detail, validation, "Abilita socio").
7. Subscriptions, Groups (tree), Cities, Users, Audit, Profile.
8. Public API route + CSV export.
9. QA pass with Playwright login → contact creation → public POST → validation flow.

