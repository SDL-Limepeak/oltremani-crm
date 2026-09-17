/**
 * Selection fields — Odoo's term for a picklist whose values are fixed in the schema.
 *
 * The pattern, and the reason this file exists: **the stored value is an API name, the
 * label is presentation.** They change on different schedules. Renaming "Attivista" to
 * "Dà supporto" is a wording decision the client can revisit next week; renaming
 * `activist` to `gives_support` is a migration that touches a CHECK constraint, every
 * historical `audit_log` snapshot, the export CSV and any WordPress form already sending
 * the old value.
 *
 * So the codes stay as they are and only the labels move. Nothing here is ever shown to
 * the user raw, and nothing here is ever stored.
 *
 * Picklists the client will want to extend themselves (operational roles) are not here —
 * those live in a table, `res_partner_role`, with the same code/name split.
 */

export type Selection = { value: string; label: string };

/**
 * "Tipo" (res_partner.partner_type) was removed from the product on 2026-09-17 and
 * replaced by the operational roles, which say the same thing with more precision and are
 * multiple. The column still exists and still holds individual/activist/citizen for the
 * eight contacts created before that date — dropping it would throw away the only record
 * of what those contacts were marked as, and nothing reads it any more.
 */

/**
 * Order is the client's, set 2026-09-17: Nuovo → Attivo → Inattivo → Rifiutato. It is the
 * lifecycle of someone who joins and later leaves, with "rifiutato" last because it is the
 * one that never entered. It drives the dropdowns *and* the sort of the contacts list, so
 * changing this array moves both.
 */
export const PARTNER_STATUS: Selection[] = [
  { value: "new", label: "Nuovo" },
  { value: "active", label: "Attivo" },
  { value: "old", label: "Inattivo" },
  { value: "rejected", label: "Rifiutato" },
];

/**
 * `expired` is not set by hand: the nightly `expire_memberships()` job flips an active
 * card whose end_date has passed. It reads as an ending rather than a decision, which is
 * why it shares the muted treatment with `revoked` instead of looking like a live card.
 */
export const SUBSCRIPTION_STATUS: Selection[] = [
  { value: "active", label: "Attiva" },
  { value: "inactive", label: "Non attiva" },
  { value: "expired", label: "Scaduta" },
  { value: "revoked", label: "Revocata" },
];

function toMap(sel: Selection[]): Record<string, string> {
  return Object.fromEntries(sel.map((s) => [s.value, s.label]));
}

export const PARTNER_STATUS_LABEL = toMap(PARTNER_STATUS);
export const SUBSCRIPTION_STATUS_LABEL = toMap(SUBSCRIPTION_STATUS);

/** Falls back to the raw value, so an unmapped code shows up instead of rendering blank. */
export function labelFor(sel: Selection[], value: string | null | undefined): string {
  if (!value) return "—";
  return toMap(sel)[value] ?? value;
}
