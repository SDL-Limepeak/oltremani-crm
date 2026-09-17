# Known issues

Updated 2026-09-17. Everything reproduced against production, fixed, and re-checked against
production. `tests/regressions.test.ts` asserts the **fixed** behaviour, so a regression
turns the suite red.

KI-16 to KI-19 came out of the 2026-09-17 round and are a different kind of entry: none of
them is a defect. They are places where the product does something a reader would plausibly
report as a bug, written down so the answer is "known, and here is why" instead of a
half-hour of digging.

Closed entries move to [history.md](history.md) once they have been through a deploy; they
are kept here for one cycle so a reader who remembers the finding can see how it ended.

| # | Severity | Where | Status |
|---|---|---|---|
| [KI-01](#ki-01) | medium | DB grants | ✅ **fixed** `20260806120000` |
| [KI-02](#ki-02) | high | RLS `res_user_category_rel` | ✅ **fixed** `20260806120000` |
| [KI-03](#ki-03) | medium | RLS `membership_subscription` | ✅ **fixed** `20260806120000` |
| [KI-04](#ki-04) | — | — | withdrawn, false positive — **guard kept** |
| [KI-05](#ki-05) | medium | `listPartners` | ✅ **fixed** |
| [KI-06](#ki-06) | medium | `upsertSubscription` | ✅ **fixed** |
| [KI-07](#ki-07) | low | dashboard UI | ✅ **fixed** |
| [KI-08](#ki-08) | low | `types.ts` | ⚠️ maintenance note, nothing to fix |
| [KI-09](#ki-09) | low | `upsertUser` | ✅ **fixed** |
| [KI-10](#ki-10) | low | membership numbers | ✅ **fixed** `20260806120000` |
| [KI-11](#ki-11) | low | audit coverage | ✅ **fixed** |
| [KI-12](#ki-12) | low | `public/_headers` | ❌ **won't fix** — not fixable on this host |
| [KI-13](#ki-13) | low | `getDashboardStats` | ✅ **fixed** |
| [KI-14](#ki-14) | info | public endpoint | ⏸ **open by decision** — not mine to close |
| [KI-15](#ki-15) | medium | validation workflow | ✅ **fixed** |
| [KI-16](#ki-16) | info | membership cards UI | ⏸ **open by decision** — warning cannot fire |
| [KI-17](#ki-17) | medium | WordPress form | ⏸ **open** — not in this repo |
| [KI-18](#ki-18) | low | production data | ⏸ **open** — one manual revoke |
| [KI-19](#ki-19) | info | `submit_public_contact` | ⏸ **accepted consequence** |

**Still open: KI-08, KI-12, KI-14, KI-16, KI-17, KI-18, KI-19.** Only KI-17 and KI-18 are
actionable, and neither is actionable from this repo alone: one needs whoever maintains the
WordPress form, the other needs somebody to click Revoca. Details below.

---

## KI-01
### `anon` could execute seven SECURITY DEFINER functions ✅

Migration `20260725200000` revoked `EXECUTE` from `anon` and changed nothing.

**Root cause, worth keeping:** Postgres grants `EXECUTE` on every new function to `PUBLIC`.
`anon` and `authenticated` are covered by `PUBLIC`, so revoking their role-specific grant
removes something they were never using. The ACLs still carried `=X/postgres` — that entry
*is* PUBLIC. The five helper functions did not have it, which is why the same migration's
other half worked and made the whole thing look applied.

**Fix** (`20260806120000`): name `PUBLIC` in the revoke, then grant back explicitly.

Final state, verified in `pg_proc.proacl`:

| Function | anon | authenticated |
|---|:--:|:--:|
| `submit_public_contact` | ✅ | ✅ |
| `can_see_partner` `current_role_name` `has_role` `is_admin_or_super` `visible_category_ids` `partner_created_by` | ✗ | ✅ (load-bearing — policies call them) |
| `generate_membership_number` | ✗ | ✗ (the trigger calls it as owner now — KI-10) |
| `handle_new_user` `protect_admin_users` `set_updated_at` `set_created_by` `sub_default_end_date` | ✗ | ✗ |

Revoking the trigger functions from everyone is safe because **PostgreSQL checks `EXECUTE`
on a trigger function at `CREATE TRIGGER` time, not on each fire.** Asserted on live data
by the last test in `regressions.test.ts`, which inserts a contact as a volunteer and
checks `set_created_by` still populated `created_by`.

---

## KI-02
### A coordinator could grant itself any group ✅

`rucr_mod` validated the caller's **role** and never looked at which `(user_id,
category_id)` pair was being written. `users.functions.ts` did guard it, but PostgREST is
publicly reachable and skips the application entirely.

Reproduced before the fix: the coordinator's visible contacts went 1 → 2 after a single
`POST /rest/v1/res_user_category_rel`.

**Fix:** the policy now mirrors what `upsertUser` enforces in TypeScript — a coordinator
may only hand out groups inside its own perimeter, and only to volunteers or coordinators.

```sql
is_admin_or_super(auth.uid())
OR (current_role_name() = 'coordinator'
    AND category_id IN (SELECT visible_category_ids(auth.uid()))
    AND EXISTS (SELECT 1 FROM res_users u
                 WHERE u.id = res_user_category_rel.user_id
                   AND u.role IN ('volunteer','coordinator')))
```

`visible_category_ids()` is evaluated during the statement, so a coordinator cannot
bootstrap itself into a group it does not already hold. Post-fix: the self-grant returns
`403 new row violates row-level security policy`, and the legitimate case — assigning
Varese, which the coordinator does hold, to a volunteer — still works.

---

## KI-03
### A coordinator could create cards for contacts it cannot see ✅

Same mistake one table over. `sub_mod`'s `USING` checked `can_see_partner`, so UPDATE and
DELETE were already scoped; its `WITH CHECK` did not, and **INSERT consults only
`WITH CHECK`**. The row was created and then invisible to its own author. Only reachable
with `Prefer: return=minimal` — with `return=representation` the readback tripped
`sub_select` and it looked like an ordinary error, which is why it never surfaced through
the UI.

Reproduced: subscriptions 6 → 7, row visible to the superuser, invisible to the coordinator
that wrote it.

**Fix:** `WITH CHECK` now carries the same `can_see_partner(auth.uid(), partner_id)` as the
`USING`.

---

## KI-04
### ~~A coordinator can modify any group~~ — withdrawn, and the guard stays

Reading `rpc_update` (role-only `USING`, no perimeter) suggests a coordinator can PATCH any
category. **It cannot.** PostgREST has to locate the row before updating it, and that read
goes through `rpc_select`, which *is* perimeter-scoped:

```
coordinator PATCH res_partner_category?id=eq.<Napoli>  → HTTP 204
value afterwards                                        → unchanged
```

**204 with zero rows changed.** This is the most dangerous testing trap in the project: a
denial and a permission are indistinguishable by status code. Every write assertion goes
through `didAffectRows()`, which requires 2xx **and** at least one returned row. Two tests
in `regressions.test.ts` keep the trap itself pinned down, so nobody re-derives the false
positive.

---

## KI-05
### `listPartners` filtered after paginating ✅

`category_id`, `province_code`, `year` and `has_active_sub` read through a nested relation
and cannot be pushed into PostgREST without an inner join — and an inner join also filters
the *embedded* rows, which the list needs in full for its badges. So they ran in JS, after
`.range()`, i.e. on one page: matches past row 100 vanished and `total` counted the
unfiltered set.

**Fix:** two strategies, chosen by `needsFullScan()`.

- No JS-side filter → unchanged fast path, Postgres pages and counts.
- Otherwise → page through every candidate (500 at a time, ceiling 10 000), filter, *then*
  slice. `total` is the filtered length, and a new `truncated` flag tells the caller when
  the ceiling was hit instead of quietly presenting a partial list.

The predicates moved to `src/lib/partner-filters.ts`, shared with `exportContacts` — a
filtered export that disagreed with the on-screen list would be worse than either being
wrong alone — and unit-tested in `tests/partner-filters.test.ts`, including a case that
asserts the old paginate-then-filter order loses the match.

---

## KI-06
### `upsertSubscription` reset status and dates on update ✅

`status: data.status ?? "active"` and the same pattern for the dates are right for a create
and wrong for an update: a partial update that omitted `status` **reactivated a revoked
card**, and one that omitted `start_date` moved it to today.

**Fix:** the update branch builds its patch only from keys the caller actually sent, and
never touches `partner_id` — moving a card between contacts is not an edit. The create
branch keeps the defaults, where they belong.

Was unreachable (only the create path had a caller), so this was pre-emptive. The first
"edit card" button would have hit it, and the failure mode was silent data corruption.

---

## KI-07
### Non-admins saw two empty panels with no explanation ✅

`getDashboardStats` reads `audit_log` for both "recent activity" panels, and `audit_select`
is `has_role(auth.uid(), 'admin')` — superusers included in the exclusion. The query
returns `[]`, not an error, so the panels read as "nothing has happened".

**Fix:** the server function resolves the caller's role, skips the two audit queries when
they would be pointless, and returns `canReadAudit`. The dashboard prints *"Visibile solo
agli amministratori."* instead of an empty state.

Deliberately not widened: who may read the full change history is a privacy decision, not
a UI fix.

---

## KI-08
### `types.ts` is generated but hand-patched ⚠️ open by nature

`src/integrations/supabase/types.ts` was edited by hand on 2026-07-25 to add
`membership_subscription.membership_number`, a real column the generator missed and the UI
uses throughout. There is nothing to fix — it is a note for whoever regenerates the file:
check the field survived. The `revoked` status value was never a problem, the type is
`status: string`.

---

## KI-09
### `upsertUser` changed the profile email but not the login ✅

The two would diverge: the user keeps signing in with the old address while the CRM shows
the new one.

**Fix:** when the address changes, `supabaseAdmin.auth.admin.updateUserById` runs **first**
with `email_confirm: true`; if it fails the profile row is left untouched, so the displayed
address always matches the one that works.

Not reachable from the UI today — `user-dialog.tsx` disables the field when editing — but
the server function accepted it.

---

## KI-10
### Membership numbers could collide ✅

`generate_membership_number` computed `MAX + 1` over HTTP and the INSERT went in a *second*
request. Two cards created in the same window got the same number and the second lost on
the UNIQUE constraint. No lock can span two round-trips.

**Fix:** a `BEFORE INSERT` trigger (`trg_sub_membership_number`) fills the column when it
is NULL, taking `pg_advisory_xact_lock` on the year first — transaction-scoped, so it is
held across the read and the write. The client no longer calls the RPC at all, which is
what let `generate_membership_number` be revoked from every API role in KI-01: the trigger
function is `SECURITY DEFINER` and calls it as the owner.

Covered by a test that creates five cards concurrently and asserts five distinct numbers.

---

## KI-11
### Deletions were not audited ✅

`deleteCategory` wrote no `audit_log` row while `upsertCategory` wrote one for create and
update. Same across all of `cities.functions.ts`. Deleting a group is the more consequential
action — it cascades to `res_partner_category_rel` and drops every contact in it out of
somebody's perimeter — and it was the one that left no trace.

**Fix:** `deleteCategory` reads the row first, deletes with `.select()`, **throws when zero
rows come back** (the 204 trap again: RLS filtering the delete is not "already gone"), and
writes the audit row with the old values. `cities.functions.ts` gets a shared `auditCity()`
covering create, update and `setCityCategory` — re-pointing a city changes which group
future public-form submissions land in, which is worth a record of its own.

> Residual fragility, accepted: these audit rows still depend on the application
> remembering to write them. A trigger would make it enforceable. Not done now because it
> would double-log against every existing app-level write.

---

## KI-12
### `public/_headers` does nothing on Lovable hosting ❌ won't fix

`_headers` is a Cloudflare Pages convention. Lovable serves static assets another way and
the header is absent in production on `/robots.txt` and the static HTML. Verified after the
2026-07-25 deploy.

**Not fixable from this repo.** The only real remedy is serving the three static images
through a route instead of as assets, which on a Cloudflare worker means bundling them —
disproportionate for a demo, and it would trade a documented gap for a fragile one.

The file stays because it works on a host that supports it, but **do not assume it protects
anything**. Locally nitro merges it into its own `_headers`, so the build looks correct,
which is exactly what makes this easy to miss.

Real exposure: `favicon.png` and `logo-*.png` carry no `X-Robots-Tag` and cannot carry a
meta tag. Still covered by `robots.txt` and by `noimageindex` on the pages referencing them.

---

## KI-13
### Dashboard statistics truncated past 1000 contacts ✅

Two unbounded selects fed the charts. PostgREST caps a response at its configured maximum
(1000 on Supabase) and says nothing, so the charts would have described a subset while the
headline counters — `count: 'exact', head: true` — stayed right. The two would disagree
with no explanation.

**Fix:** a `selectAll()` helper pages until a short page comes back, used for both.

---

## KI-14
### The public endpoint is open ⏸ open by decision — not mine to close

No key, no signature; the rate limit is the only control. This is a **deliberate product
decision** taken on 2026-07-25 so the demo form works with no setup, after a missing secret
had already blocked a client demo once. Closing it now would break the WordPress form
before its replacement exists.

It must be closed before oltremani.it goes live, and the choice belongs with whoever builds
the WordPress form. The ordered options are in [app/flows.md](app/flows.md) — the first one
(does WordPress call from PHP or from the browser?) decides whether any of the others are
worth doing.

---

## KI-15
### The validation workflow was built and never connected ✅

`validation-dialog.tsx` was imported by nothing, and it was the only caller of
`validatePartner`. Both were unreachable — the other half of the public form was missing
its button. A submission whose city is not in `res_city` parks in the `Validation` group,
and the operator had to do by hand what `validatePartner` does in one call: set `city_id`,
remove `Validation`, add the city's territorial group, flip `status`. Forgetting the middle
two left the contact parked forever while looking correctly filed.

**Fix:** the contacts list now opens `ValidationDialog` from the badge itself.

The detection also had to change. The old badge fired on "no groups at all", which is the
wrong test — a parked contact *has* a group, `Validation`, so it showed a normal grey
badge and no warning. `needsTriage()` now returns true when every group a contact has is a
`system` one, covering both the parked case (*"Da validare"*) and the orphan case
(*"Da assegnare"*). Unit-tested in `tests/partner-filters.test.ts`.


---

## KI-16
### The "due tessere attive" warning cannot fire ⏸

The client asked (2026-09-17) for a yellow triangle when a contact holds two active cards
for the current year. It was built, in `contacts/$id.tsx`, next to the card status.

It can never appear. `idx_sub_partner_year_active` is a partial UNIQUE index on
`(partner_id, year) WHERE status='active'`, so the second active card is refused by the
database before anyone can see a warning about it.

**Not a bug, and deliberately left as it is.** The rule the client wanted is *enforced*,
which is strictly stronger than *flagged* — and they did not ask to be able to create the
situation, they asked to be told about it. The warning stays as a net: if the index is ever
dropped, the UI already copes.

**If the client would rather be warned than blocked**, the change is to drop that index —
and that is a decision, not a tidy-up. It is the same trade they explicitly made for
`membership_number` the same day, so the answer is not obvious in either direction.

---

## KI-17
### The WordPress form is probably still posting the old role codes ⏸

The five operational roles were redefined on 2026-09-17. `submit_public_contact` ignores
role codes it does not recognise, silently and on purpose — the form is maintained by
somebody else and must not start failing when this list moves.

The flip side is that a form still sending `bussola`, `membro_semplice`,
`specialista_abitare` or `specialista_migrazione` **loses those answers with no error
anywhere**: not in the response, not in the audit log's `role_codes`, which records what
was sent rather than what was stored. The contact is created correctly and simply arrives
with no roles.

`public/test-form.html` in this repo is updated. The real form on the WordPress site is
not this file. Pinned by the "known codes are attached, unknown ones are ignored" test in
`roles-and-membership.test.ts`, which deliberately sends a retired code.

**To close:** whoever maintains the WordPress form updates the five values. The current
codes are in `res_partner_role.code`.

---

## KI-18
### King Pin is inactive and still holds an active card ⏸

`res_partner` "King Pin" is `status='old'` with membership `2600004` still `active` for
2026. It is the exact state the 2026-09-17 cascade exists to prevent: an inactive member
who still counts as paid-up everywhere the card is what gets checked.

**Pre-existing, not a regression.** The cascade in `upsertPartner` fires on the *transition*
into `old`, by design — so that a card someone reactivated on purpose is not undone by the
next unrelated edit. This contact was made inactive from the published August build, which
did not have the cascade at all.

**To close:** open the contact, Tesseramento, Revoca on 2600004. No code involved.

---

## KI-19
### With duplicate card numbers, the form's mismatch message can name the wrong holder ⏸

`membership_number` stopped being UNIQUE on 2026-09-17: cards are numbered by hand, so a
duplicate is flagged rather than refused (the client's explicit choice).

`submit_public_contact` identifies a declared card with `WHERE membership_number = ... LIMIT
1`. With a number on two cards that resolves to whichever row Postgres returns first, so
the `mismatch` note in the contact's notes can name the wrong socio.

**Accepted, and the reason it is only cosmetic:** the card is never reassigned in any
branch. Whatever the lookup finds, the outcome is the same — the contact goes to Validation
and a human resolves it. The note is a hint for that human, not a decision.

Stated because someone will eventually read that note, find it names the wrong person, and
go looking for a bug in the matching logic. The bug is the duplicate number, and the
contact record already flags it with a triangle.
