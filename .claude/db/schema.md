# Schema

11 tables in `public`, RLS enabled on all of them (none `FORCE`). Full DDL for the first
nine: `.tmp/backup/2026-08-06/01_tables.sql` — the two role tables came later, see
`supabase/migrations/20260806140000`. Permissions: [rls.md](rls.md).

## Tables

| Table | Rows (2026-08-06) | Key columns |
|---|---:|---|
| `res_partner` | 8 | contacts/members. `status` new\|active\|rejected\|old · `partner_type` individual\|activist\|citizen (default individual) · `city_id`→res_city · `raw_city`/`raw_province` as submitted · `created_by`/`updated_by` |
| `res_partner_category` | 10 | "groups". 9 territorial + 1 `system` (`Validation`). self-FK `parent_id` · `created_by` · president/fiscal/IBAN fields |
| `res_partner_category_rel` | 8 | M:N partner↔category, composite PK |
| `res_city` | 107 | **province capitals only** — deliberate test dataset, not the ~8000 ISTAT comuni. `category_id`→category |
| `res_users` | 2 + 5 test | app users. `id` = `auth.users.id` **with no FK** · `role` admin\|superuser\|coordinator\|volunteer · `status` active\|inactive |
| `res_user_category_rel` | 2 | user perimeter. Composite PK |
| `membership_subscription` | 6 | `status` active\|inactive\|revoked · `year` · `membership_number` UNIQUE, format `YYNNNNN` |
| `privacy_consent` | 34 | `consent_type` privacy_policy\|marketing\|newsletter · `operator_id`→res_users · ip/user_agent |
| `audit_log` | 85 | single log. `log_type` inbound_form\|record_change\|subscription_change\|permission_change\|user_change\|data_export · `action` create\|update\|merge\|validate\|delete\|api_call |
| `res_partner_role` | 5 | operational-role picklist. `code` = API name (what the public form sends), `name` = label. A table, not a CHECK, because the client adds entries from the UI |
| `res_partner_role_rel` | 0 | M:N partner↔role, composite PK. Multiple by design — "specialista dell'abitare **e/o** della migrazione" is two entries |

`partner_type` deserves a note: the stored values are still `individual`/`activist`/`citizen`,
but since 2026-08-06 the UI labels them *Non specificato* / **Dà supporto** / **Cerca
supporto**. Labels live in `src/lib/selections.ts` and never touch the database — see
[../client-feedback.md](../client-feedback.md) point 5.

## Constraints worth knowing

- `res_partner.email` UNIQUE (case-sensitive) **plus** `idx_partner_email_lower` UNIQUE on
  `lower(email)`. The second is the one that actually prevents `Mario@x.it` / `mario@x.it`.
- `membership_subscription`: partial UNIQUE `idx_sub_partner_year_active` on
  `(partner_id, year) WHERE status='active'`. Not a full `UNIQUE(partner_id, year)` — and
  that is right: it keeps the history of `inactive`/`revoked` rows while allowing only one
  active card per year. The `enforce_single_active_subscription_per_year()` trigger the
  build plan called for does not exist and is not needed.
- `res_city` UNIQUE `(name, province_code)`.
- CHECK constraints exist on every enum-like column, including `res_partner.partner_type`
  (added 2026-07-25; before that any string passed).
- FKs cascade on delete from `res_partner` → subscriptions, consents, category rels.
  `res_city.category_id` and `privacy_consent.operator_id` are `ON DELETE SET NULL`.

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
