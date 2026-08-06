# Migrations

## The important thing about this folder

`supabase/migrations/*.sql` is **documentation, not a migration runner**. Nothing replays
it. The files were applied by hand through `query_database` on 2026-07-25 and committed so
the repo keeps the record and the reasoning.

`supabase_migrations.schema_migrations` — the table Supabase actually tracks — holds only
the three original Lovable migrations from 2026-06-27
(`20260627182451`, `…2510`, `…2634`). **None of the nine 2026-07-25 files are registered
there.** Lovable does not know they exist, which is why a schema regeneration by the agent
can silently undo them, and why `bun test` must be re-run afterwards.

## Applied status — verified against the live DB, 2026-08-06

| File | Applied | Verified by |
|---|---|---|
| `20260725120000_security_rls_hardening` | ✅ full | `res_partner_partner_type_check` present · `idx_partner_email_lower` unique present · `rpcr_mod`/`consent_mod`/`audit_insert` all carry `WITH CHECK` |
| `20260725130000_fix_self_created_partner_visibility` | ✅ | `can_see_partner` body contains `created_by = _uid` |
| `20260725140000_partner_policies_created_by` | ✅ | `partner_select`/`partner_update` qual contains `created_by` |
| `20260725150000_audit_data_export` | ✅ | `audit_log_log_type_check` includes `data_export` |
| `20260725160000_public_form_phone_and_notes` | ✅ | `submit_public_contact` has `p_notes`; exactly 1 overload |
| `20260725170000_admin_cannot_demote_itself` | ✅ | `protect_admin_users` contains the self-demotion branch |
| `20260725180000_category_created_by` | ✅ | `res_partner_category.created_by` exists; `rpc_select` uses it |
| `20260725190000_default_created_by_trigger` | ✅ | `trg_partner_created_by` + `trg_category_created_by` present |
| `20260725200000_security_scan_fixes` | ⚠️ **partial** | rate limit ✅ · `audit_no_update`/`audit_no_delete` RESTRICTIVE ✅ · `users_update WITH CHECK` ✅ · `_uid` guards in helpers ✅ · its 7 `REVOKE`s never took effect — superseded by `20260806120000` |
| `20260806120000_close_authz_holes` | ✅ full | `anon` executes only `submit_public_contact` (checked in `pg_proc.proacl`) · `rucr_mod` and `sub_mod` `WITH CHECK` carry the perimeter · `trg_sub_membership_number` present. All three exploits re-run against production and refused |
| `20260806140000_partner_roles_and_membership_claim` | ✅ full | `res_partner_role` (5 seeded) + `res_partner_role_rel` with perimeter-scoped RLS · `submit_public_contact` has `p_role_codes` and `p_membership_number`, exactly 1 overload · all four membership branches proved in a cancelled transaction |

## Can the files be deleted?

**No.** All ten are applied, but deleting them would throw away the only record that these
changes exist — Lovable's changelog does not have them, and `schema_migrations` does not
either. They are the recovery script for the day an agent regenerates the schema.

`20260725200000` stays even though `20260806120000` supersedes its revoke section: the
rest of it (rate limit, RESTRICTIVE audit policies, `_uid` guards) is still the only
record of those changes.

Keep them. Add new ones with the same convention: timestamped filename, a header comment
saying what was applied, when, by which route, and why.

## Before writing a new one

Read [access.md](access.md) rules 2, 3, 5 and 7 first. Rule 7 in particular: the
`REVOKE … FROM anon` in migration `2000*` looked applied and was not, because `PUBLIC` still
held `EXECUTE`. Verify every DDL with a follow-up `SELECT` against the catalog, not by
reading the migration back.
