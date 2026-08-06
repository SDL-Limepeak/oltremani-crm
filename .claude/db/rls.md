# RLS, roles, permissions

Full policy text as of the first backup: `.tmp/backup/2026-08-06/04_policies_grants.sql`
— note it predates migration `20260806120000`, which changed `rucr_mod`, `sub_mod` and
every function grant. Current state: [../knowissues.md](../knowissues.md).

## Function grants

`anon` can execute exactly one function: `submit_public_contact`. Everything else is
revoked from `PUBLIC` **and** from the role — revoking only the role is a no-op while
`PUBLIC` holds the grant, which is how KI-01 survived a migration that looked applied.
The five helpers plus `partner_created_by` keep `authenticated` because policy expressions
call them; `generate_membership_number` and all five trigger functions are closed to both
API roles.

## Roles

`admin` > `superuser` > `coordinator` > `volunteer`. Stored in `res_users.role`; only
counted when `res_users.status='active'`.

**Visibility of contacts is derived entirely from categories.** A partner with no row in
`res_partner_category_rel` is invisible to anyone who is not admin/superuser. This is why
`submit_public_contact` always attaches at least `Validation`.

## SECURITY DEFINER helpers

All 13 functions have `search_path=public` set. The five below are the authorization layer.

| Function | Returns |
|---|---|
| `current_role_name()` | caller's role, **only if `status='active'`** |
| `has_role(uid, role)` | has that role and is active |
| `is_admin_or_super(uid)` | admin or superuser, active |
| `visible_category_ids(uid)` | assigned categories **+ all descendants** (recursive CTE). admin/superuser → all |
| `can_see_partner(uid, pid)` | admin/superuser, OR `created_by = uid`, OR partner has a category ∈ `visible_category_ids` |

Each of the five refuses a `_uid` different from `auth.uid()` (added 2026-07-25: a signed-in
user could otherwise probe *other people's* permission structure via RPC). `auth.uid() IS
NULL` — i.e. `service_role` or a SECURITY DEFINER context — stays unrestricted, which is
required for the policies to work.

**Do not "revoke EXECUTE" on these to satisfy a linter.** Policy expressions are evaluated
with the querying user's privileges: revoking `can_see_partner` from `authenticated` makes
every `SELECT` on `res_partner` die with `permission denied for function can_see_partner`.
Those grants are load-bearing. Tested, twice.

## Triggers

| Trigger | On | Does |
|---|---|---|
| `set_updated_at` | 4 tables | touches `updated_at` |
| `sub_default_end_date` | membership_subscription | `end_date := 31 Dec of year` when null |
| `set_created_by` | res_partner, res_partner_category BEFORE INSERT | fills `created_by` from `auth.uid()` when empty |
| `set_membership_number` | membership_subscription BEFORE INSERT | fills `membership_number` under `pg_advisory_xact_lock`, so concurrent creates cannot collide |
| `protect_admin_users` | res_users BEFORE UPDATE/DELETE | see below |
| `handle_new_user` | auth.users AFTER INSERT | creates the `res_users` row, role from `raw_user_meta_data->>'role'`, default `volunteer` |

`protect_admin_users` blocks: modifying an admin row that is not your own, changing an
admin's role at all (**self-demotion included**), promoting anyone to admin, and — for
non-elevated callers — any change to `role` or `status`.

`set_created_by` exists because making a policy depend on `created_by` is fragile: it
requires *every* insert path to remember to set the column. The trigger removes the
requirement.

## Policy matrix (what the DB actually enforces)

`✓` allowed · `∩` limited to the caller's perimeter · `✗` denied

| Table / op | admin | superuser | coordinator | volunteer |
|---|:--:|:--:|:--:|:--:|
| res_partner SELECT | ✓ | ✓ | ∩ | ∩ |
| res_partner INSERT | ✓ | ✓ | ✓ | ✓ |
| res_partner UPDATE | ✓ | ✓ | ∩ | ∩ |
| res_partner DELETE | ✓ | ✓ | ✗ | ✗ |
| res_partner_category SELECT | ✓ | ✓ | ∩ +own | ∩ +own |
| res_partner_category INSERT | ✓ | ✓ | ✓ | ✗ |
| res_partner_category UPDATE | ✓ | ✓ | ∩ (via `rpc_select`, see KI-04) | ✗ |
| res_partner_category DELETE | ✓ non-system | ✓ non-system | ✗ | ✗ |
| res_partner_category_rel | ∩ | ∩ | ∩ | ∩ |
| res_user_category_rel | ✓ | ✓ | ∩, targets limited to volunteer/coordinator | ✗ |
| res_users SELECT | ✓ | ✓ | ✓ | self |
| res_users UPDATE | ✓ non-admin +self | ✓ non-admin +self | self | self |
| res_users DELETE | ✓ non-admin | ✓ non-admin | ✗ | ✗ |
| membership_subscription SELECT | ✓ | ✓ | ∩ | ∩ |
| membership_subscription write | ✓ | ✓ | ∩ (INSERT included since KI-03) | ✗ |
| privacy_consent | ∩ | ∩ | ∩ | ∩ |
| res_city SELECT | ✓ | ✓ | ✓ | ✓ |
| res_city write | ✓ | ✓ | ✓ (RLS) — but server fns require admin/superuser | ✗ |
| res_partner_role SELECT | ✓ | ✓ | ✓ | ✓ |
| res_partner_role write | ✓ | ✓ | ✗ | ✗ |
| res_partner_role_rel | ∩ | ∩ | ∩ | ∩ |
| audit_log SELECT | ✓ | **✗** | ✗ | ✗ |
| audit_log INSERT | own uid or null | own uid or null | own uid or null | own uid or null |
| audit_log UPDATE/DELETE | ✗ | ✗ | ✗ | ✗ |

Two entries above are easy to misread and both are intentional:

- **audit_log is admin-only**, not admin+superuser: the policy is `has_role(uid,'admin')`.
  A superuser therefore sees an empty "recent activity" panel on the dashboard. Confusing,
  but the policy, not a bug — see KI-07 for the UI consequence.
- **`audit_no_update` / `audit_no_delete` are `RESTRICTIVE`**, meaning they AND with the
  permissive policies rather than OR. `USING (false)` holds even if someone later adds a
  broad `FOR ALL` policy. `postgres` and `service_role` bypass RLS, so maintenance still
  works.

## The `USING` / `WITH CHECK` rule

The root cause of four of the six holes closed on 2026-07-25 was the same: a `FOR ALL` or
`UPDATE` policy with a correct `USING` and an absent or `true` `WITH CHECK`.

> `USING` filters **existing** rows. `WITH CHECK` validates **new or modified** ones.
> Without the second, a row can be moved out of the perimeter.

And a `WITH CHECK` alone cannot compare OLD against NEW — that needs a trigger. This is
why self-promotion had to be fixed in `protect_admin_users` and not in a policy.

The mistake recurred on 2026-08-06 in two more places (KI-02, KI-03): a `WITH CHECK` that
validated only the caller's **role** and never the **target's perimeter**. Both are closed.
**When reviewing any `FOR ALL` policy, read the `WITH CHECK` on its own and ask what an
INSERT can put there** — `USING` does not run for an INSERT, so a correct `USING` proves
nothing about creates.

## PostgREST is directly reachable

`https://rbabjbggrqgadcyzplxh.supabase.co/rest/v1/...` accepts the anon key plus any user's
JWT. **Everything RLS allows, a user can do with curl** — the app's TypeScript checks are
not a boundary for anything that goes through `context.supabase`. That is exactly how KI-02
is exploited. Server-function checks only bind the `supabaseAdmin` paths, which PostgREST
cannot reach.
