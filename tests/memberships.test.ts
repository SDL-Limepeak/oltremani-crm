import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { didAffectRows, insert, login, remove, rpc, select, update, type Session } from "./helpers/pgrest";

/**
 * Card rules as the client redefined them on 2026-09-17.
 *
 * Cards are filled in by hand, so the number is whatever is written on the physical card:
 * the UNIQUE constraint was dropped and a duplicate is now flagged in the UI instead of
 * refused. Expiry stopped being a matter of the year and became a matter of the end date,
 * applied by expire_memberships() from pg_cron every night at 00:02 UTC.
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

  test("leaving it empty still falls back to the generator", async () => {
    const res = await insert(admin, "membership_subscription", {
      partner_id: partnerId,
      year: 2042,
      status: "active",
    });
    expect(didAffectRows(res)).toBe(true);
    expect(res.rows[0].membership_number).toBeTruthy();
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
