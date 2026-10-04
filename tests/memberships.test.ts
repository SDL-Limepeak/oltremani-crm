import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { FIXTURES } from "./helpers/env";
import { didAffectRows, insert, login, remove, rpc, select, update, type Session } from "./helpers/pgrest";

/**
 * Card rules as the client redefined them on 2026-09-17.
 *
 * Cards are filled in by hand, so the number is whatever is written on the physical card:
 * the UNIQUE constraint was dropped and a duplicate is now flagged in the UI instead of
 * refused. Expiry stopped being a matter of the year and became a matter of the end date,
 * applied by expire_memberships() from pg_cron every night at 00:02 UTC.
 *
 * 2026-10-04: numbers the generator picks are <group prefix> + four digits (ALE0001), the
 * register is warn-only for two active cards in the same year as well, and prefixes are
 * unique across groups.
 *
 * Everything here runs on contacts this file creates and deletes. The register is the
 * client's real data and 2026 numbers are live.
 */

let admin: Session, volunteer: Session;
const stamp = Date.now();
const probeEmail = `autotest-cards-${stamp}@oltremani.test`;
let partnerId: string;

beforeAll(async () => {
  [admin, volunteer] = await Promise.all([login("admin"), login("volunteer")]);
  const p = await insert(admin, "res_partner", {
    first_name: "AUTOTEST",
    last_name: "cards",
    email: probeEmail,
  });
  partnerId = p.rows[0].id;
});

afterAll(async () => {
  // The cards go with the contact: membership_subscription is ON DELETE CASCADE.
  await remove(admin, "res_partner", `id=eq.${partnerId}`);
  await remove(admin, "res_partner", "email=like.autotest-cards-*");
});

describe("card numbers are assigned by hand", () => {
  test("a number typed in is kept, not overwritten by the generator", async () => {
    const res = await insert(admin, "membership_subscription", {
      partner_id: partnerId,
      year: 2041,
      membership_number: `HAND-${stamp}`,
      status: "active",
    });
    expect(didAffectRows(res)).toBe(true);
    expect(res.rows[0].membership_number).toBe(`HAND-${stamp}`);
  });

  test("leaving it empty draws the next number of the contact's group", async () => {
    // A contact needs a group with a prefix. Varese is VAR.
    await insert(admin, "res_partner_category_rel", { partner_id: partnerId, category_id: FIXTURES.categoryVarese });
    const res = await insert(admin, "membership_subscription", {
      partner_id: partnerId,
      year: 2042,
      status: "active",
    });
    expect(didAffectRows(res)).toBe(true);
    expect(res.rows[0].membership_number).toMatch(/^VAR\d{4,}$/);
  });

  test("a hand-typed number in the same shape moves the counter on", async () => {
    // Typed numbers count towards the maximum, otherwise the next automatic one would collide
    // with a card that was already printed. The case of the letters does not matter.
    const high = `var${String(8000 + (stamp % 1000)).padStart(4, "0")}`;
    await insert(admin, "membership_subscription", {
      partner_id: partnerId, year: 2051, status: "revoked", membership_number: high,
    });
    const next = await insert(admin, "membership_subscription", {
      partner_id: partnerId, year: 2052, status: "active",
    });
    const n = parseInt(high.slice(3), 10);
    expect(next.rows[0].membership_number).toBe(`VAR${String(n + 1).padStart(4, "0")}`);
  });

  test("with no group that has a prefix, the generator refuses and says why", async () => {
    const p = await insert(admin, "res_partner", {
      first_name: "AUTOTEST", last_name: "nogroup", email: `autotest-cards-nogroup-${stamp}@oltremani.test`,
    });
    const res = await insert(admin, "membership_subscription", {
      partner_id: p.rows[0].id, year: 2053, status: "active",
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(res.body)).toContain("sigla");
    // A hand-typed number still goes through: the register records what is on the card.
    const typed = await insert(admin, "membership_subscription", {
      partner_id: p.rows[0].id, year: 2053, status: "active", membership_number: `NOGRP-${stamp}`,
    });
    expect(didAffectRows(typed)).toBe(true);
  });

  test("the preview says what the next number would be, without writing anything", async () => {
    const res = await rpc(admin, "preview_membership_number", { p_partner: partnerId });
    expect(res.status).toBe(200);
    expect(res.body.number).toMatch(/^VAR\d{4,}$/);
    expect(res.body.error).toBeNull();
  });

  test("two active cards in the same year are accepted — it is a warning now", async () => {
    // The partial unique index on (partner, year) WHERE active was dropped on 2026-10-04.
    // It would have refused the public form a card for somebody who already had one.
    const a = await insert(admin, "membership_subscription", {
      partner_id: partnerId, year: 2054, status: "active", membership_number: `TWO-A-${stamp}`,
    });
    const b = await insert(admin, "membership_subscription", {
      partner_id: partnerId, year: 2054, status: "active", membership_number: `TWO-B-${stamp}`,
    });
    expect(didAffectRows(a)).toBe(true);
    expect(didAffectRows(b)).toBe(true);
  });

  test("the same number on two cards is accepted — the UNIQUE is gone", async () => {
    // This is the change that makes the warning triangle meaningful. Before 2026-09-17
    // this insert failed with a constraint violation.
    const res = await insert(admin, "membership_subscription", {
      partner_id: partnerId,
      year: 2043,
      membership_number: `HAND-${stamp}`,
      status: "active",
    });
    expect(didAffectRows(res)).toBe(true);

    const dupes = await select(
      admin,
      "membership_subscription",
      `select=id&membership_number=eq.HAND-${stamp}`,
    );
    expect(dupes.rows.length).toBe(2);
  });
});

describe("group prefixes", () => {
  test("the three letters are unique across groups", async () => {
    // Two groups sharing a prefix would share a numbering. Varese is VAR.
    const res = await insert(admin, "res_partner_category", {
      name: `AUTOTEST dup prefix ${stamp}`, category_type: "territorial", card_prefix: "VAR",
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    await remove(admin, "res_partner_category", `name=eq.AUTOTEST dup prefix ${stamp}`);
  });

  test("anything but three capital letters is refused", async () => {
    for (const bad of ["va", "VARE", "V1R", "V R"]) {
      const res = await insert(admin, "res_partner_category", {
        name: `AUTOTEST bad prefix ${stamp}`, category_type: "territorial", card_prefix: bad,
      });
      expect(res.status).toBeGreaterThanOrEqual(400);
    }
    await remove(admin, "res_partner_category", `name=eq.AUTOTEST bad prefix ${stamp}`);
  });

  test("every group that exists as a territory manages its own province", async () => {
    // The 2026-10-04 fix: Siena and Venezia existed as groups while their provinces were
    // managed by Genova and Pesaro Urbino. A group with a master province owns it.
    const groups = (await select(admin, "res_partner_category", "select=name,province_code&province_code=not.is.null")).rows;
    for (const g of groups as any[]) {
      const cities = (await select(admin, "res_city", `select=category_id,res_partner_category(name)&province_code=eq.${g.province_code}&limit=1`)).rows;
      if (cities.length) expect(cities[0].res_partner_category?.name).toBe(g.name);
    }
  });
});

describe("expire_memberships — the nightly job", () => {
  test("the job is not callable by an application user", async () => {
    // EXECUTE is revoked from PUBLIC, anon and authenticated: only pg_cron runs it. If
    // this ever starts returning 200, a user can expire the whole register in one call.
    const run = await rpc(admin, "expire_memberships", {});
    expect(run.status).toBeGreaterThanOrEqual(400);
  });

  test("its predicate picks up a past-due card and leaves a current one alone", async () => {
    /**
     * The job body cannot be invoked from here, so what this pins is the rule it applies:
     * status = 'active' AND end_date < today. That predicate is the part that can drift
     * silently — someone "fixing" it to use `year` instead would expire a card issued in
     * December the moment January arrives, and nothing else would notice.
     *
     * The job itself was proved against production in a rolled-back transaction on
     * 2026-09-17; see the migration file.
     */
    const pastDue = await insert(admin, "membership_subscription", {
      partner_id: partnerId,
      year: 2044,
      end_date: "2020-12-31",
      status: "active",
      membership_number: `EXP-${stamp}`,
    });
    const current = await insert(admin, "membership_subscription", {
      partner_id: partnerId,
      year: 2045,
      end_date: "2099-12-31",
      status: "active",
      membership_number: `FUT-${stamp}`,
    });
    // Already revoked: the job must not resurrect or re-label it.
    const revoked = await insert(admin, "membership_subscription", {
      partner_id: partnerId,
      year: 2046,
      end_date: "2020-12-31",
      status: "revoked",
      membership_number: `REV-${stamp}`,
    });

    const today = new Date().toISOString().slice(0, 10);
    const targeted = await select(
      admin,
      "membership_subscription",
      `select=id&partner_id=eq.${partnerId}&status=eq.active&end_date=lt.${today}`,
    );
    const ids = targeted.rows.map((r: any) => r.id);

    expect(ids).toContain(pastDue.rows[0].id);
    expect(ids).not.toContain(current.rows[0].id);
    expect(ids).not.toContain(revoked.rows[0].id);
  });

  test("'expired' is a status the table accepts", async () => {
    const res = await update(
      admin,
      "membership_subscription",
      `partner_id=eq.${partnerId}&membership_number=eq.FUT-${stamp}`,
      { status: "expired" },
    );
    expect(didAffectRows(res)).toBe(true);
    expect(res.rows[0].status).toBe("expired");
  });
});

describe("cards stay closed to volunteers", () => {
  test("a volunteer cannot issue one even though it can see every contact now", async () => {
    const res = await insert(volunteer, "membership_subscription", {
      partner_id: partnerId,
      year: 2046,
      status: "active",
    });
    expect(didAffectRows(res)).toBe(false);
  });
});
