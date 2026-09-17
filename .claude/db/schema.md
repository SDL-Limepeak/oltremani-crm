# Schema

11 tables in `public`, RLS enabled on all of them (none `FORCE`). Full DDL for the first
nine: `.tmp/backup/2026-08-06/01_tables.sql` — the two role tables came later, see
`supabase/migrations/20260806140000`. Permissions: [rls.md](rls.md).

## Tables

| Table | Rows (2026-08-06) | Key columns |
|---|---:|---|
| `res_partner` | 8 | contacts/members. `status` new\|active\|rejected\|old · `partner_type` **dead since 2026-09-17**, see below · `city_id`→res_city · `raw_city`/`raw_province` as submitted · `created_by`/`updated_by` |
| `res_partner_category` | 10 | "groups". 9 territorial + 1 `system` (`Validation`). self-FK `parent_id` **ON DELETE SET NULL** — deleting a parent orphans its children, it does not delete them · `created_by` · president/fiscal/IBAN fields |
| `res_partner_category_rel` | 8 | M:N partner↔category, composite PK |
| `res_city` | 107 | **province capitals only** — deliberate test dataset, not the ~8000 ISTAT comuni. `category_id`→category |
| `res_users` | 2 + 5 test | app users. `id` = `auth.users.id` **with no FK** · `role` admin\|superuser\|coordinator\|volunteer · `status` active\|inactive |
| `res_user_category_rel` | 2 | user perimeter. Composite PK |
| `membership_subscription` | 8 | `status` active\|inactive\|expired\|revoked · `year` · `start_date`/`end_date` · `membership_number` **no longer UNIQUE** (2026-09-17), typed by hand, generator format `YYNNNNN` |
| `privacy_consent` | 35 | `consent_type` privacy_policy\|marketing\|newsletter in the CHECK, but **only `privacy_policy` is collected** since 2026-09-17 · `channel` (`web` for everything from the public form) · `operator_id`→res_users · ip/user_agent |
| `audit_log` | 85 | single log. `log_type` inbound_form\|record_change\|subscription_change\|permission_change\|user_change\|data_export · `action` create\|update\|merge\|validate\|delete\|api_call |
| `res_partner_role` | 5 | operational-role picklist, **redefined 2026-09-17**: attivista, socio_aps, membro_comunita, famiglia_ospitante, specialista_diritti. `code` = API name (what the public form sends), `name` = label. A table, not a CHECK, because the client adds entries from the UI |
| `res_partner_role_rel` | 1 | M:N partner↔role, composite PK. Multiple by design: a contact can be an activist *and* a host family. (The "abitare e/o migrazione" split it was originally built for was merged into one entry on 2026-09-17.) |

`partner_type` deserves a note: **nothing reads it any more.** The client dropped "Tipo"
from the product on 2026-09-17 and replaced it with the operational roles, which say the
same thing with more precision and are multiple. The column, its CHECK and its eight
existing values (`individual`/`activist`/`citizen`) were left in place — dropping it would
throw away the only record of how those contacts were classified, and it costs nothing to
keep. It is gone from `PARTNER_COLUMNS`, from the forms, from the filters, from the
dashboard and from `src/lib/selections.ts`.

## Constraints worth knowing

- `res_partner.email` UNIQUE (case-sensitive) **plus** `idx_partner_email_lower` UNIQUE on
  `lower(email)`. The second is the one that actually prevents `Mario@x.it` / `mario@x.it`.
- `membership_subscription`: partial UNIQUE `idx_sub_partner_year_active` on
  `(partner_id, year) WHERE status='active'`. Not a full `UNIQUE(partner_id, year)` — and
  that is right: it keeps the history of `inactive`/`revoked` rows while allowing only one
  active card per year. The `enforce_single_active_subscription_per_year()` trigger the
  build plan called for does not exist and is not needed.
  **This index is why the "due tessere attive" warning in the contact record cannot
  actually fire.** It was asked for on 2026-09-17 and built, as a net; the rule is
  *enforced*, not merely flagged, which is the stronger outcome. If the client ever wants
  the warning to be reachable, this index is the thing to drop — and that is a decision,
  not a tidy-up.
- `membership_subscription.membership_number` **is no longer UNIQUE** (dropped 2026-09-17).
  The cards are physical and numbered by hand, so a duplicate is a mistake to flag, not a
  write to refuse. `idx_sub_membership_number` (non-unique) still backs the lookups.
- `res_city` UNIQUE `(name, province_code)`.
- CHECK constraints exist on every enum-like column, including `res_partner.partner_type`
  (added 2026-07-25; before that any string passed) and
  `membership_subscription.status`, which gained `expired` on 2026-09-17.
- FKs cascade on delete from `res_partner` → subscriptions, consents, category rels.
  `res_city.category_id` and `privacy_consent.operator_id` are `ON DELETE SET NULL`.

## Rules that live in the application, not in the database

The database would happily allow all three of these. They are enforced in
`src/lib/*.functions.ts` and covered by `tests/server-functions.test.ts`, which calls the
real HTTP endpoint rather than trusting the TypeScript.

- **A group with members cannot be deleted without saying where they go.** `deleteCategory`
  refuses, and moves the members into the chosen group *before* the delete — the cascade on
  `res_partner_category_rel` would otherwise already have erased the record of who was in
  there. An empty group deletes with no question.
- **`consent_type` is narrowed to `privacy_policy` by `submit_public_contact`,** not by the
  CHECK. Narrowing the CHECK would need `NOT VALID` to get past the 22 existing
  marketing/newsletter rows, and a constraint that does not hold for its own table is worse
  than none. Those rows are kept: they are evidence a consent was given.
- **A contact moved to `old` has its active cards deactivated,** in `upsertPartner`, and
  only on the transition — so a card someone reactivated on purpose is not undone by the
  next edit.

## Referential facts that are not enforced

- `res_users.id` ↔ `auth.users.id`: **no FK**. Deleting a user is application code's job
  (`deleteUser` removes the auth account, the rel rows and the profile, in that order).
- `created_by` / `updated_by` / `changed_by_user_id` are bare uuids, **no FK**. There is
  already one dangling value in production: `b7c03c55-025a-41ef-aa0b-3bd160d29573`, a
  superuser deleted on 2026-07-12, still referenced by `res_partner.updated_by` and
  `membership_subscription.created_by`. Any join on those columns must tolerate a miss —
  `audit.functions.ts` does this correctly with a manual lookup map.

## Divergences from the original build plan

| Plan | Reality |
|---|---|
| `res_city` = ~8000 ISTAT comuni | 107 province capitals. Intended for now. Consequence: any non-capital (Modica, Gela…) fails to match and the contact lands in `Validation`. Expected, not a bug |
| 8 territorial categories | 9 — `1 - GRUPPI INFORMALI (NON APS/ODV)` was added later |
| `source='website'` in audit | `source='public_form'` |
| subscription status active\|inactive | also `revoked` — filter accordingly |

`res_user_category_rel` holds only the two test-profile rows. **The real users are both
admin/superuser and bypass perimeters**, so the perimeter machinery is barely exercised in
production data. The first real `coordinator` or `volunteer` created will see nothing until
a group is assigned; the Users page shows a warning badge for exactly this.
