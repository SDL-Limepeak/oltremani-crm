import { describe, expect, test } from "bun:test";
import {
  applyPartnerFilters,
  needsFullScan,
  needsTriage,
} from "../src/lib/partner-filters";

/**
 * Unit tests for the filters that cannot run in SQL (KI-05) and the triage predicate
 * that drives the validation entry point (KI-15). No database: these are pure functions,
 * extracted precisely so the logic shared by listPartners, exportContacts and the
 * contacts table can be pinned down without HTTP.
 *
 * The bug these guard against was never in the predicates themselves — it was in *when*
 * they ran. listPartners applied them after `.range()`, so they only ever filtered the
 * current page: matches beyond row 100 vanished and `total` reported the unfiltered
 * count. The order is asserted in the "filter before paginate" block at the bottom.
 */

const VARESE = "31e3f71f-9f96-4383-b772-dbc1d6df52ad";
const NAPOLI = "4b99ee4f-54f6-4285-9028-49e57bb13f5b";

function partner(over: Record<string, any> = {}) {
  return {
    id: crypto.randomUUID(),
    res_city: null,
    raw_province: null,
    res_partner_category_rel: [],
    membership_subscription: [],
    ...over,
  };
}

const inVarese = partner({
  res_partner_category_rel: [
    { category_id: VARESE, res_partner_category: { name: "Varese", category_type: "territorial" } },
  ],
  res_city: { province_code: "VA" },
  membership_subscription: [{ year: 2026, status: "active" }],
});

const inNapoli = partner({
  res_partner_category_rel: [
    { category_id: NAPOLI, res_partner_category: { name: "Napoli", category_type: "territorial" } },
  ],
  res_city: { province_code: "NA" },
  membership_subscription: [{ year: 2025, status: "revoked" }],
});

const parked = partner({
  res_partner_category_rel: [
    { category_id: "sys", res_partner_category: { name: "Validation", category_type: "system" } },
  ],
  raw_province: "AP",
});

const orphan = partner({ raw_province: "VA" });

const ALL = [inVarese, inNapoli, parked, orphan];

describe("needsFullScan decides which query strategy listPartners takes", () => {
  test("SQL-expressible filters keep the fast path", () => {
    expect(needsFullScan({})).toBe(false);
    // status / partner_type / city_id / search are not in the input type at all:
    // they never force a scan.
  });

  test("every nested-relation filter forces the scan", () => {
    expect(needsFullScan({ category_id: VARESE })).toBe(true);
    expect(needsFullScan({ province_code: "VA" })).toBe(true);
    expect(needsFullScan({ year: 2026 })).toBe(true);
    expect(needsFullScan({ has_active_sub: true })).toBe(true);
    // false is a filter too — the classic `if (x)` bug would drop it.
    expect(needsFullScan({ has_active_sub: false })).toBe(true);
  });
});

describe("applyPartnerFilters", () => {
  test("category_id matches on the relation, not on the name", () => {
    expect(applyPartnerFilters(ALL, { category_id: VARESE })).toEqual([inVarese]);
    expect(applyPartnerFilters(ALL, { category_id: NAPOLI })).toEqual([inNapoli]);
  });

  test("province matches either the resolved city or the raw submission", () => {
    // A contact still in Validation has no res_city, so raw_province is all there is.
    expect(applyPartnerFilters(ALL, { province_code: "VA" })).toEqual([inVarese, orphan]);
    expect(applyPartnerFilters(ALL, { province_code: "AP" })).toEqual([parked]);
  });

  test("year matches any card of that year, whatever its status", () => {
    expect(applyPartnerFilters(ALL, { year: 2025 })).toEqual([inNapoli]);
    expect(applyPartnerFilters(ALL, { year: 2026 })).toEqual([inVarese]);
  });

  test("has_active_sub uses the explicit year when given, otherwise the current one", () => {
    expect(applyPartnerFilters(ALL, { has_active_sub: true }, 2026)).toEqual([inVarese]);
    // 2025 has a card, but it is revoked — not active.
    expect(applyPartnerFilters(ALL, { has_active_sub: true, year: 2025 })).toEqual([]);
    expect(applyPartnerFilters(ALL, { has_active_sub: false }, 2026)).toEqual([
      inNapoli,
      parked,
      orphan,
    ]);
  });

  test("filters compose", () => {
    expect(
      applyPartnerFilters(ALL, { category_id: VARESE, has_active_sub: true }, 2026),
    ).toEqual([inVarese]);
    expect(
      applyPartnerFilters(ALL, { category_id: NAPOLI, has_active_sub: true }, 2026),
    ).toEqual([]);
  });

  test("no filters is a pass-through, not an empty result", () => {
    expect(applyPartnerFilters(ALL, {})).toEqual(ALL);
  });
});

describe("filter before paginate — the actual KI-05 bug", () => {
  // 250 contacts, only the last one in Napoli. The old code sliced to 100 rows first,
  // so filtering by Napoli returned nothing and the total said 250.
  const many = [
    ...Array.from({ length: 249 }, () =>
      partner({
        res_partner_category_rel: [
          { category_id: VARESE, res_partner_category: { name: "Varese", category_type: "territorial" } },
        ],
      }),
    ),
    inNapoli,
  ];

  test("the match beyond the first page is found", () => {
    const filtered = applyPartnerFilters(many, { category_id: NAPOLI });
    expect(filtered).toEqual([inNapoli]);
  });

  test("paginating the filtered set gives an honest total", () => {
    const filtered = applyPartnerFilters(many, { category_id: NAPOLI });
    const page = filtered.slice(0, 100);
    expect(page).toHaveLength(1);
    expect(filtered.length).toBe(1); // not 250
  });

  test("paginating first would have lost it — this is what regressing looks like", () => {
    const wrong = applyPartnerFilters(many.slice(0, 100), { category_id: NAPOLI });
    expect(wrong).toHaveLength(0);
  });
});

describe("needsTriage drives the validation entry point", () => {
  test("a contact with a territorial group is filed", () => {
    expect(needsTriage(inVarese)).toBe(false);
  });

  test("a contact parked in Validation needs triage", () => {
    // It has a category, so the old "no groups at all" check missed it entirely.
    expect(needsTriage(parked)).toBe(true);
  });

  test("a contact with no group at all needs triage", () => {
    expect(needsTriage(orphan)).toBe(true);
    expect(needsTriage({ res_partner_category_rel: null })).toBe(true);
    expect(needsTriage({})).toBe(true);
  });

  test("Validation plus a real group counts as filed", () => {
    expect(
      needsTriage({
        res_partner_category_rel: [
          { res_partner_category: { category_type: "system" } },
          { res_partner_category: { category_type: "territorial" } },
        ],
      }),
    ).toBe(false);
  });
});
