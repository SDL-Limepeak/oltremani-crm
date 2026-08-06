# Why it is like this

## 2026-08-06, closing — handed to the client

Label direction confirmed by the client (activist gives, citizen receives) and pinned in
`tests/selections.test.ts`, which also cross-checks the codes against the live CHECK
constraints so a rename fails in tests instead of in production. 91 tests.

The public form was still dressed as a dev harness — "Test di integrazione DEV" over a
panel called "Risposta API" and a raw JSON dump — which is fine for us and wrong for the
person being asked to try it. Renamed, province table collapsed, JSON moved behind a
disclosure. No structural change: the readable summary was always the useful part.

Emailed to Dario with four test logins (admin excluded, Diego is the only one). The three
remaining feedback points are now waiting on him, not on us.

## 2026-08-06, later — feedback points 5, 7, 10, then deploy

Shipped as `7f7d92f` and published. Details in
[client-feedback.md](client-feedback.md); two things worth remembering here.

**A schema change broke production before the code caught up.** Revoking
`generate_membership_number` (KI-01) and moving generation into a trigger (KI-10) is
correct, but the deployed build still called the RPC — so "create card" failed in
production from the moment the migration landed until the deploy. The DB and the app are
two deploy targets with one schedule between them, and `query_database` changes the first
instantly. **When a migration removes something the running code uses, either ship the code
first or keep the old surface until the deploy lands.**

**Labels are not values.** Point 5 asked to rename "Attivista"/"Cittadino" to
"Dà supporto"/"Cerca supporto". The stored codes did not move: renaming them would have
meant a CHECK migration, every historical `audit_log` snapshot, the export CSV and whatever
the WordPress form already sends — to change a word on screen. `src/lib/selections.ts` is
where that line lives now, and every surface reads from it.

Condensed record of decisions and fixes. Read it when something looks wrong and you want to
know whether it was already considered. Current defects are in
[knowissues.md](knowissues.md), not here.

## 2026-08-06 — audit, KB rebuild, test suite, and the fixes

Verified repo ↔ GitHub ↔ Lovable all at `c22af7a`. Took the first full DB backup
(`.tmp/oltremani-db-backup-2026-08-06.zip`, `SELECT`-based since there is no `pg_dump`).
Rewrote this KB in English as a hierarchy with a router index. Replaced the PowerShell E2E
harness with `tests/`, driven by five persistent role accounts.

Three live holes found, all reproduced against production, then fixed and re-checked:
KI-01, KI-02, KI-03. One suspected hole withdrawn as a false positive (KI-04) — the probe
returned HTTP 204 while changing nothing. Twelve of the fifteen findings are closed;
the three that remain are a maintenance note, a hosting limitation and a product decision.

### The one that nearly became a false finding

`rpc_update` on `res_partner_category` is role-only: read as text, a coordinator can patch
any group. The probe returned **HTTP 204** — and changed nothing. PostgREST locates the row
before updating it, and that read goes through `rpc_select`, which *is* perimeter-scoped.

A denial and a permission are indistinguishable by status code. This is now enforced
structurally: `tests/helpers/pgrest.ts` sends `Prefer: return=representation` on every
write and `didAffectRows()` requires a returned row, with two tests pinning the trap itself
so the false positive cannot be re-derived.

### Why a migration that read as applied was not

`20260725200000` revoked `EXECUTE` from `anon` on seven SECURITY DEFINER functions. The
catalog said otherwise. **Postgres grants `EXECUTE` on every new function to `PUBLIC`**, and
`anon` is covered by `PUBLIC`, so revoking the role-specific grant removed something it was
never using. The five helper functions did not carry the `PUBLIC` entry, so half the
migration did work — which is what made it look done.

Verify DDL against the catalog, never by re-reading the migration.

### The same `WITH CHECK` mistake, twice more

KI-02 and KI-03 were both a `WITH CHECK` that validated the caller's **role** and never the
**target's perimeter**. `USING` does not run for an INSERT, so a correctly scoped `USING`
proves nothing about creates — and on `membership_subscription` that is exactly what hid
the bug: UPDATE and DELETE were scoped, only INSERT was open, and only with
`Prefer: return=minimal`, which the UI never sends.

KI-02 was the serious one: a coordinator could `POST` its own id plus any category to
`res_user_category_rel` and immediately read every contact in that group. The check in
`users.functions.ts` was real but irrelevant — PostgREST is publicly reachable, so the
application is not a boundary for anything RLS permits.

### Membership numbers

`generate_membership_number` read `MAX + 1` in one HTTP request and the INSERT went in
another; no lock can span two round-trips. Moved into a `BEFORE INSERT` trigger holding
`pg_advisory_xact_lock` on the year. Side benefit: nothing calls it from the client any
more, so it could be revoked from every API role.

### Application-side fixes

`listPartners` filtered after paginating, so any filter that runs in JS only ever saw the
first page — matches beyond row 100 vanished and the total counted rows the user could not
see. Those predicates now live in `src/lib/partner-filters.ts`, shared with
`exportContacts` so list and export cannot disagree, and unit-tested including a case that
asserts the old order loses the match.

The validation workflow (KI-15) turned out to be finished code with no button: the dialog
and `validatePartner` were unreachable. Worth noting *why* nobody spotted it — the "Da
assegnare" badge tested for "no groups at all", but a parked contact **has** a group,
`Validation`, so it rendered a normal grey badge. `needsTriage()` now tests for "every
group is a system one".

Also closed: `upsertSubscription` resetting status and dates on partial updates,
`upsertUser` leaving the login and profile email out of step, the dashboard's silent empty
audit panels and its unbounded stat queries, and the missing audit rows on deletions.

## 2026-07-25 — RLS hardening

Six holes, all proved exploitable on the real DB inside cancelled transactions, then
re-proved closed. Root cause of four of them was identical: `FOR ALL` / `UPDATE` policies
with a correct `USING` and an absent or `true` `WITH CHECK`. See
[db/rls.md](db/rls.md#the-using--with-check-rule).

| Was | Migration |
|---|---|
| a volunteer could promote itself to superuser | `20260725120000` |
| any authenticated user could insert an arbitrary `(partner_id, category_id)` and make a forbidden contact visible to itself | `20260725120000` |
| `consent_mod WITH CHECK (true)` — GDPR consents forgeable for any partner | `20260725120000` |
| `audit_insert WITH CHECK (true)` — audit trail writable in someone else's name | `20260725120000` |
| `partner_type` had no CHECK | `20260725120000` |
| `email` UNIQUE but case-sensitive | `20260725120000` |

### Two bugs that only a real end-to-end run could find

**An admin could demote itself, irreversibly.** `protect_admin_users` guarded admin rows
only when `NEW.id <> auth.uid()`, so an admin editing its *own* profile could drop the
role — and the next rule, "Cannot promote to admin from UI", made it permanent. Reproduced
for real; restoring the test user required disabling the trigger from a privileged session,
because it fires there too. With `diego@limepeak.it` the only admin, one bad save on the
profile page would have locked the project out forever. `20260725170000`; emergency
procedure in [app/flows.md](app/flows.md#authentication).

**A coordinator could not create groups.** `upsertCategory` does `.insert().select()`, and
`rpc_select` only showed a non-elevated user the categories already inside its perimeter —
a brand-new category is in nobody's perimeter, so the readback was refused and the whole
insert failed with 403. Broken against the plan, which gives coordinators category
management. `20260725180000` + `20260725190000`.

Making a policy depend on `created_by` works but is fragile: every insert path has to
remember to set the column. A `BEFORE INSERT` trigger fills it from `auth.uid()` instead.

### The pre-existing bug those tests uncovered: `INSERT … RETURNING`

Not caused by the hardening, found by its regression tests, and severe: **no non-admin
could create a contact from the app.**

`upsertPartner` does `.insert(payload).select().single()` — `INSERT … RETURNING` in SQL.
Postgres applies the **SELECT** policy to the returned rows too, and `partner_select` was
category-only. A just-created contact has no categories, so the readback was refused and
the insert failed as a whole. Nobody had noticed because the only two users were admin and
superuser, who short-circuit through `is_admin_or_super()`.

The fix took two steps and **the first alone did nothing**: adding `created_by` inside
`can_see_partner` is useless here, because the row being inserted is not visible to
subqueries in the same statement. The check has to be **in the policy expression**, where
`created_by` is a column of the row under evaluation:

```sql
ALTER POLICY partner_select ON res_partner
  USING (can_see_partner(auth.uid(), id) OR created_by = auth.uid());
```

`20260725130000` (helper, useful for consents and cards) and `20260725140000` (the policies
— this is the one that actually fixes it).

### Lovable security scan — five findings

| Level | Finding | Outcome |
|---|---|---|
| Critical | public endpoint, no auth, no rate limit | **rate limit added**; stays unauthenticated by decision |
| Critical | a user can promote itself | **already closed** by the trigger; a second layer added in the policy |
| Warning | `audit_log` alterable or deletable | **closed** with `RESTRICTIVE` policies |
| Warning | SECURITY DEFINER executable by `anon` | intended to be reduced to `submit_public_contact` only — **but see KI-01, it did not take** |
| Warning | SECURITY DEFINER executable by signed-in users | **not fixable as advised**, see below |

**Two of the suggested remediations would have broken the app**, which is why each was
tested in a cancelled transaction first. Revoking `EXECUTE` on `can_see_partner` from
`authenticated` makes every `SELECT` on `res_partner` fail — policy expressions run with
the querying user's privileges, so those grants are load-bearing.

What was possible instead: trigger functions do not need `EXECUTE` from the caller; `anon`
only ever needs `submit_public_contact`; and the helpers, which must keep `authenticated`,
had their surface closed by refusing any `_uid` other than `auth.uid()` — before that, a
signed-in user could ask `has_role(<someone else>, 'admin')` and map other people's
permissions.

**Findings 4 and 5 will keep appearing.** The linter flags any SECURITY DEFINER function in
an exposed schema that `authenticated` can execute, and these have to stay that way for RLS
to work. Actually clearing them means moving the helpers into a schema PostgREST does not
expose and rewriting the fifteen-odd policies that call them. Deliberately not done: the
blast radius is the entire authorization layer, and an agent regenerating the schema would
point back at `public.*` and break everything.

### Authorization holes in `users.functions.ts`

Found by re-reading every server function. Not an RLS problem: **all user writes go through
`supabaseAdmin`**, which bypasses RLS by definition, so the `res_users` policies were never
consulted and the code checks were the only defence — and they were missing.

| Was | Who could use it |
|---|---|
| `deleteUser` checked nothing about the caller, only the target's role | any authenticated user, volunteer included, could delete any non-admin account |
| `upsertUser` accepted `coordinator` as caller and `superuser` as an assignable role | a coordinator could mint a superuser, or promote a volunteer |
| `upsertUser` did not bound the coordinator's scope | it could edit any non-admin user and assign groups outside its own |

**General rule, still binding:** every server function that touches `supabaseAdmin` must
carry hand-written authorization. `cities.functions.ts` does it right and is the model.
Anything on `context.supabase` is covered by RLS.

### UI bugs fixed the same day

- **Could not create more than one group** (`category-dialog.tsx`). The reset effect did
  `setF({ ...f, ...initial })`, merging onto the **previous** state. For a new group
  `initial` has no `id`, so the `id` of a group opened earlier for editing survived in the
  form and `upsertCategory` took the UPDATE branch — overwriting that group instead of
  creating one. Fixed by merging onto a constant `EMPTY`.
- **Users with no groups** now carry a warning badge: without a perimeter a coordinator or
  volunteer sees an empty contact list, and nothing said so.

### Housekeeping

- `src/components/ui/` pruned 46 → 17 by transitive reachability. The other 29 are in
  `.tmp/old/components-ui/`.
- The prettier `Delete ␍` errors were a Windows working-tree artifact; git stores LF.
  Closed with `.gitattributes` (`eol=lf`). **Never run `prettier --write` to "fix" them.**
- `PUBLIC_API_KEY` removed from the route, the test form and `.env`.

## 2026-06-27 — build

Generated by the Lovable agent from the plan in `.lovable/plan.md`. That file is the
*intent*; where it and this KB disagree, the KB wins — the divergences are listed in
[db/schema.md](db/schema.md#divergences-from-the-original-build-plan).
