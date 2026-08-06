# Client feedback — status of the 12 points

Source: client email after the 2026-07-25 demo. The client asked explicitly **not to
change anything yet** and to review the schema together on a call with screen sharing.
Points 5, 7 and 10 were then greenlit and implemented on 2026-08-06.

Superseded plan (kept for the reasoning): `.tmp/old/claude-kb-2026-07-25/feedback-2026-07-25.md`.

| # | Request | Status |
|---|---|---|
| 0 | "Il form mi dà chiave API non valida" | ✅ fixed 2026-07-25, re-verified in production 2026-08-06 |
| 1 | Group hierarchy: APS/ODV as parents, antenne + gruppi informali as children | ⏸ **open — needs the call** |
| 2 | "Non riesco a creare più di un gruppo" | ✅ bug fixed · ⏸ the data still has to be created |
| 3 | Extract emails / names / phones | ✅ done |
| 4 | Privacy consent from the form ticks in the profile | ✅ already automatic |
| 5 | activist/citizen → "Cerca supporto" / "Dà supporto" | ✅ **done 2026-08-06** (labels only) |
| 6 | "Tesseramento soci APS/ODV locali" | ⚠️ page yes, sidebar shortened to "Tesseramento soci" |
| 7 | "Ruolo" field, multiple, also on the form | ✅ **done 2026-08-06** |
| 8 | Only coordinators needed, keep volunteer | ✅ no work — all four roles stay |
| 9 | Phone mandatory on the form | ✅ done |
| 10 | Existing card number declarable on the form | ✅ **done 2026-08-06** |
| 11 | Notes/message on the form | ✅ done |
| 12 | Does new → active happen on a timer? | ✅ answered: no, and it should not |

---

## 5 — Labels, not values

The client asked for a **wording** change. The stored values stay `activist` / `citizen` /
`individual`; only the labels moved, in `src/lib/selections.ts`:

| Stored | Label |
|---|---|
| `activist` | Dà supporto |
| `citizen` | Cerca supporto |
| `individual` | Non specificato |

Renaming the codes would have meant a CHECK migration, every historical `audit_log`
snapshot, the export CSV, and whatever the WordPress form is already sending — to change a
word on screen. `selections.ts` is where that line is drawn, and every screen now reads
labels from it (dropdowns, filters, the type icons' tooltips, the dashboard chart), so a
relabel cannot leave one surface saying "Attivista" while another says "Dà supporto".

**Direction confirmed by the client on 2026-08-06:** activist gives support, citizen
receives it. Worth having asked — the original email listed "cerca supporto e da supporto"
straight after "attivista e cittadino", which read positionally would have paired them the
other way round, reversing the meaning of every contact already in the database.
`tests/selections.test.ts` now pins both the codes and the direction.

## 7 — Roles

Two tables, same shape as the groups, Odoo naming:

```
res_partner_role       code (API name) · name (label) · sort_order · status
res_partner_role_rel   partner_id · role_id            (composite PK)
```

A table rather than a CHECK constraint because the client will add entries — this way they
do it from the UI instead of asking for a migration. `code` is what the public form sends
and never changes; `name` is what people read and can change freely.

Seeded: `famiglia_ospitante`, `specialista_abitare`, `specialista_migrazione`,
`membro_semplice`, `bussola`.

Two deliberate choices to confirm:

- **"Specialista di diritti sull'abitare e/o sulla migrazione" is two entries.** The
  selection is multiple, so the "e/o" becomes representable instead of being a single
  ambiguous option.
- **"Persona che cerca supporto" is not a role.** It is `partner_type = 'citizen'`,
  labelled "Cerca supporto" (point 5). Having it in both places would create two sources of
  truth for the same fact.

RLS: `res_partner_role` is reference data — everyone reads, admin/superuser edits.
`res_partner_role_rel` follows `privacy_consent` after its 2026-07-25 fix, with
`can_see_partner` in **both** `USING` and `WITH CHECK`, plus `partner_created_by` in the
check so `INSERT … RETURNING` works on a contact nobody's perimeter covers yet.

## 10 — Declaring an existing card

`membership_number` is UNIQUE, so a code identifies exactly one card and that card already
belongs to somebody. Honouring the claim would let anyone take over another member's card
by typing their number. **The card is never moved.**

| Situation | `membership_status` | Effect |
|---|---|---|
| no number given | `not_provided` | nothing |
| number unknown | `not_found` | contact created, note added, sent to Validation |
| number belongs to this contact | `confirmed` | nothing to do |
| number belongs to someone else | `mismatch` | **not reassigned**, note added, sent to Validation |

The last two cases also cover the legitimate one: an existing member submitting from a
different email address creates a new contact, and a human merges the two — better than
silently moving the card.

---

## Still open

### 1 + 2 — the hierarchy, and an ambiguity worth resolving first

Everything needed is already there: `parent_id` is a self-FK, `visible_category_ids()`
descends recursively, and `groups.tsx` already renders the tree with an "add child" action.
`res_city.category_id` points at a category, so a municipality is attached by pointing it at
the right subgroup — cities never become categories themselves.

What is missing is data, plus one column: `category_type` only distinguishes `territorial`
from `system`, so there is no way to say "this is an APS/ODV, that is an antenna".

**The two points contradict each other, and the difference is not cosmetic.**

- Point 1 — "i figli delle APS/ODV diventano antenne e gruppi informali" → 16 subgroups,
  two under each APS/ODV. A coordinator assigned to Alessandria automatically sees its
  antenne, for free, because visibility already descends.
- Point 2 — "8 APS/ODV, **un** gruppo antenne e **un** gruppo gruppi informali" → two global
  groups beside the eight. A coordinator would *not* see their own antenne: separate branch.

The existing ninth category, `1 - GRUPPI INFORMALI (NON APS/ODV)`, looks like an experiment
in the second reading and needs a decision either way: reparent it or archive it.

### 6 — the sidebar

Page title and `<title>` say "Tesseramento soci APS/ODV locali". The sidebar entry says
"Tesseramento soci", presumably shortened for width. Client to confirm.

### 12 — no timer, and here is why

The transition happens on validation (assigning city and group), in `validatePartner`.
Putting it on a timer would make "active" a measure of elapsed time rather than a real
state — a contact nobody ever looked at would become active on its own. If an automatism is
wanted, tie it to an event: card activated, or validation completed.
