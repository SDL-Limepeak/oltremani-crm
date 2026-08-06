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
};

/** True when at least one filter has to run in JS, forcing the full-scan path. */
export function needsFullScan(f: PartnerFilterInput): boolean {
  return Boolean(f.category_id || f.province_code || f.year || f.has_active_sub !== undefined);
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
    out = out.filter((r) => {
      const has = r.membership_subscription?.some(
        (s: any) => s.year === y && s.status === "active",
      );
      return f.has_active_sub ? Boolean(has) : !has;
    });
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
