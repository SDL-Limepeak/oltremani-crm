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
 * Direction of the relationship with the association.
 *
 * Relabelled 2026-08-06 at the client's request; direction confirmed by them the same day
 * — "activist gives support, citizen receives it". Stored values unchanged:
 *   activist → "Dà supporto"
 *   citizen  → "Cerca supporto"
 *
 * The original email listed "cerca supporto e da supporto" straight after "attivista e
 * cittadino", which read positionally would have paired them the other way round. It was
 * worth asking: the swap is one word on screen and reverses the meaning of every contact
 * already in the database. Pinned by tests/selections.test.ts.
 */
export const PARTNER_TYPE: Selection[] = [
  { value: "individual", label: "Non specificato" },
  { value: "activist", label: "Dà supporto" },
  { value: "citizen", label: "Cerca supporto" },
];

export const PARTNER_STATUS: Selection[] = [
  { value: "new", label: "Nuovo" },
  { value: "active", label: "Attivo" },
  { value: "rejected", label: "Rifiutato" },
  { value: "old", label: "Inattivo" },
];

export const SUBSCRIPTION_STATUS: Selection[] = [
  { value: "active", label: "Attiva" },
  { value: "inactive", label: "Non attiva" },
  { value: "revoked", label: "Revocata" },
];

function toMap(sel: Selection[]): Record<string, string> {
  return Object.fromEntries(sel.map((s) => [s.value, s.label]));
}

export const PARTNER_TYPE_LABEL = toMap(PARTNER_TYPE);
export const PARTNER_STATUS_LABEL = toMap(PARTNER_STATUS);
export const SUBSCRIPTION_STATUS_LABEL = toMap(SUBSCRIPTION_STATUS);

/** Falls back to the raw value, so an unmapped code shows up instead of rendering blank. */
export function labelFor(sel: Selection[], value: string | null | undefined): string {
  if (!value) return "—";
  return toMap(sel)[value] ?? value;
}
