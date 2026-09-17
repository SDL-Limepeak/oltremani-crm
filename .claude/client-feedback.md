# Client feedback

Two rounds: 2026-07-25 (12 points, closed) and **2026-09-17** (8 points, built but not
published — jump to the second half).

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

## Sent to the client 2026-08-06

Diego emailed Dario the same day: what shipped, the four test logins (admin excluded —
Diego is the only admin), the form link, and the three open points. Draft kept at
`.tmp/email-dario-2026-08-06.md`, out of git because it carries working passwords.

The three items below are therefore **waiting on the client**, not on us. Nothing is
blocked on our side.

**The 22 marketing/newsletter consents already recorded are kept.** Asked as "togliamo le
due finalità aggiuntive", which is about what the form collects. Deleting the existing rows
would destroy the evidence that those consents were given — the record that the processing
was lawful — and cannot be undone. They are out of the form, out of the UI and out of
`submit_public_contact`; the history stays.

**Status order drives the list, not only the dropdown.** `STATUS_ORDER` in the contacts
page is now derived from `PARTNER_STATUS` rather than repeated, so the two cannot drift.

**Deleting a group moves its members before the delete, not after.** The cascade on
`res_partner_category_rel` erases the record of who was in the group, so doing it in the
other order would leave nothing to move. Contacts already in the destination are filtered
out by hand — PostgREST has no `ON CONFLICT`, and one duplicate would fail the whole batch
on the composite primary key, taking the other members with it.

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


---

# Round two — 2026-09-17

Given in chat while the 2026-08-06 build was live. The client approved writing to the
production database directly. All of it is applied, committed (`ee46f54`) and **published**.

| # | Request | Status |
|---|---|---|
| 1 | Five new operational roles, on the form and internally | ✅ applied + code |
| 2 | Filter contacts by role (multi-select) instead of by "Tipo"; Tipo disappears | ✅ code |
| 3 | "Tesserato" column in the contacts table: green tick / red cross for the current year | ✅ code |
| 4 | Warn before making a contact inactive, then deactivate its cards too | ✅ code |
| 5 | Superuser can delete contacts physically, with a warning listing the child records | ✅ applied + code |
| 6 | Every user sees — and edits — every contact | ✅ applied |
| 7 | User management is hierarchical; "ruolo" becomes "profilo"; delete becomes disable | ✅ applied + code |
| 8 | Card numbers typed by hand · duplicates warned not blocked · expiry from end_date, nightly job · export button for admin/superuser/coordinator with every column | ✅ applied + code |
| 9 | Drop the two secondary privacy purposes; a consent arriving from the web always has channel "Web" | ✅ applied + code |
| 10 | Contact statuses ordered Nuovo → Attivo → Inattivo → Rifiutato | ✅ code |
| 11 | Deleting a group must ask where its members go; an empty group deletes freely | ✅ code |

## Decisions taken inside these points

**The five roles.** ATTIVISTA · SOCIO APS · MEMBRO DELLA COMUNITÀ · FAMIGLIA OSPITANTE ·
SPECIALISTA DI DIRITTI SULLE MIGRAZIONI E/O ABITARE. Written in sentence case in the UI
("Attivista", "Socio APS", …) to match every other label in the product; the client wrote
them in capitals in a list, which reads as emphasis rather than as house style.

The last one merges the two entries created on 2026-08-06 — `specialista_abitare` and
`specialista_migrazione` — which had been split *precisely* so that "e/o" was
representable through a multiple selection. The client preferred one line on the form.
`bussola` was dropped. Safe only because `res_partner_role_rel` was empty at the time.

**"Tipo" is gone from the product, not from the database.** `res_partner.partner_type`
still holds `individual`/`activist`/`citizen` for the eight existing contacts. Nothing
reads it. Dropping the column would destroy the only record of how those contacts were
classified and would gain nothing.

**Delete means contacts, not users.** Asked as "eliminare gli utenti", but the child
records named — tessere, privacy — hang off `res_partner`, not `res_users`. Confirmed with
the client: it is the contacts. Physical delete, admin/superuser, with a dialog that counts
the cards (by number), consents, groups and roles that go with it.

**Two tessere attive per year cannot happen, so that warning cannot fire.** The client
asked for a yellow triangle when a contact has two active cards for the current year. The
partial unique index `idx_sub_partner_year_active` already makes that state impossible. The
warning was built anyway, as a net, and the constraint was kept: a rule enforced beats a
rule flagged. Reversible in one line if they would rather be warned than blocked — see
[db/schema.md](db/schema.md).

**The duplicate-number warning required removing a constraint.** `membership_number` was
UNIQUE; a duplicate was refused, not flagged. The client chose "togli UNIQUE, avvisa e
basta". Consequence carried forward: `submit_public_contact` identifies a declared card by
number, and that lookup now resolves to whichever duplicate it finds first. It still never
moves a card between contacts, so the worst case is still "sent to validation".

**Expiry follows `end_date`, applied nightly.** Not derived from `year`: a card issued in
December with a twelve-month end date is not expired on 1 January. `pg_cron` runs
`expire_memberships()` at `2 0 * * *`. The database is UTC and pg_cron 1.6 has no per-job
timezone, so that is 02:02 Italian time in summer, 01:02 in winter.

**The 22 marketing/newsletter consents already recorded are kept.** Asked as "togliamo le
due finalità aggiuntive", which is about what the form collects. Deleting the existing rows
would destroy the evidence that those consents were given — the record that the processing
was lawful — and cannot be undone. They are out of the form, out of the UI and out of
`submit_public_contact`; the history stays.

**Status order drives the list, not only the dropdown.** `STATUS_ORDER` in the contacts
page is now derived from `PARTNER_STATUS` rather than repeated, so the two cannot drift.

**Deleting a group moves its members before the delete, not after.** The cascade on
`res_partner_category_rel` erases the record of who was in the group, so doing it in the
other order would leave nothing to move. Contacts already in the destination are filtered
out by hand — PostgREST has no `ON CONFLICT`, and one duplicate would fail the whole batch
on the composite primary key, taking the other members with it.

## Still open

- The **WordPress form** is maintained by someone else and is very likely still posting
  the old role codes (`bussola`, `membro_semplice`, `specialista_abitare`,
  `specialista_migrazione`). `submit_public_contact` drops unknown codes silently and on
  purpose, so those answers are lost with no error anywhere. Somebody has to update it.
- **King Pin** is `status='old'` and holds an active 2026 card (2600004). Pre-existing: the
  cascade built in point 4 only runs on the transition, and this contact was made inactive
  from the published build, which does not have it. One manual revoke fixes it.
