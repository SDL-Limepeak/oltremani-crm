/**
 * Contact filters that PostgREST cannot express.
 *
 * `category_id`, `province_code`, `year` and `has_active_sub` all read through a nested
 * relation. Pushing them into the query would need inner joins, and an inner join also
 * filters the *embedded* rows — the list needs every group badge and every card, not just
 * the matching ones. So these run in JS.
 *
 * They live in their own module for two reasons: `listPartners` and `exportContacts` must
 * agree to the row (a filtered export that disagreed with the on-screen list would be
 * worse than either), and pure functions can be unit-tested without a database.
 *
 * The rule that goes with them: **filter before you paginate.** Applying these to one page
 * silently drops matches and leaves the total counting rows the user cannot see.
 */

export type PartnerFilterInput = {
  category_id?: string;
  province_code?: string;
  year?: number;
  has_active_sub?: boolean;
  role_ids?: string[];
};

/** True when at least one filter has to run in JS, forcing the full-scan path. */
export function needsFullScan(f: PartnerFilterInput): boolean {
  return Boolean(
    f.category_id ||
      f.province_code ||
      f.year ||
      f.has_active_sub !== undefined ||
      f.role_ids?.length,
  );
}

/**
 * "Tesserato": holds a card that is active *in the given year*. Both the contacts table
 * and the CSV read the answer from here rather than each deciding for itself — a contact
 * shown with a green tick and exported as "No" would be the kind of discrepancy nobody
 * reports as a bug, they just stop trusting the file.
 *
 * A contact can hold several cards for the same year (a revoked one and its replacement:
 * 2600001 and 2600002 both belong to Diego), so this asks whether *any* of them is active,
 * not whether the latest one is.
 */
export function hasActiveCard(
  r: { membership_subscription?: any[] | null },
  year: number = new Date().getFullYear(),
): boolean {
  return Boolean(
    r.membership_subscription?.some((s: any) => s.year === year && s.status === "active"),
  );
}

export function applyPartnerFilters<T extends Record<string, any>>(
  rows: T[],
  f: PartnerFilterInput,
  currentYear: number = new Date().getFullYear(),
): T[] {
  let out = rows;

  if (f.category_id) {
    out = out.filter((r) =>
      r.res_partner_category_rel?.some((rel: any) => rel.category_id === f.category_id),
    );
  }

  if (f.province_code) {
    // res_city wins when the contact was matched to a real city; raw_province is what the
    // public form submitted and is all there is for a contact still in Validation.
    out = out.filter(
      (r) => r.res_city?.province_code === f.province_code || r.raw_province === f.province_code,
    );
  }

  if (f.year) {
    out = out.filter((r) => r.membership_subscription?.some((s: any) => s.year === f.year));
  }

  if (f.has_active_sub !== undefined) {
    const y = f.year ?? currentYear;
    out = out.filter((r) => (f.has_active_sub ? hasActiveCard(r, y) : !hasActiveCard(r, y)));
  }

  // Roles replaced "Tipo" as the filter on this list. The selection is multiple and reads
  // as OR: picking "Attivista" and "Socio APS" means "either", which is what someone
  // narrowing a list expects. AND would return almost nothing, since roles are rarely
  // combined.
  if (f.role_ids?.length) {
    const wanted = new Set(f.role_ids);
    out = out.filter((r) =>
      (r as any).res_partner_role_rel?.some((rel: any) => wanted.has(rel.role_id)),
    );
  }

  return out;
}

/**
 * A contact needs triage when it has no group at all, or when every group it has is a
 * system one — meaning it is parked in `Validation` because the public form could not
 * match its city against res_city.
 */
export function needsTriage(r: { res_partner_category_rel?: any[] | null }): boolean {
  const rels = r.res_partner_category_rel ?? [];
  return !rels.some((rel) => rel.res_partner_category?.category_type !== "system");
}
