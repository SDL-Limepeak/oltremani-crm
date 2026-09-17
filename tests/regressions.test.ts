import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { FIXTURES } from "./helpers/env";
import {
  count,
  didAffectRows,
  insert,
  insertBlind,
  login,
  remove,
  rpc,
  select,
  update,
  wasDenied,
  type Session,
} from "./helpers/pgrest";

/**
 * Regression tests for .claude/knowissues.md.
 *
 * KI-01, KI-02, KI-03 and KI-10 were closed on 2026-08-06 by migration
 * 20260806120000_close_authz_holes.sql. These tests assert the fixed behaviour, and
 * each one also checks that the legitimate path it constrains still works — a policy
 * that denies everything would pass a security assertion and break the product.
 */

let admin: Session, coordinator: Session, volunteer: Session;

beforeAll(async () => {
  [admin, coordinator, volunteer] = await Promise.all([
    login("admin"),
    login("coordinator"),
    login("volunteer"),
  ]);
});

afterAll(async () => {
  await remove(admin, "membership_subscription", "notes=like.KI*PROBE");
  await remove(
    admin,
    "res_user_category_rel",
    `user_id=eq.${coordinator.userId}&category_id=eq.${FIXTURES.categoryNapoli}`,
  );
  await remove(admin, "res_partner", "email=like.autotest-*");
});

describe("KI-01 — SECURITY DEFINER functions are closed to anon (FIXED)", () => {
  // Migration 20260725200000 revoked EXECUTE from anon and nothing happened, because
  // Postgres grants EXECUTE on every new function to PUBLIC and anon inherits from it.
  // The fix names PUBLIC in the REVOKE.
  test("generate_membership_number refuses an unauthenticated caller", async () => {
    const res = await rpc(null, "generate_membership_number", { p_year: 2026 });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.body?.message ?? "").toContain("permission denied");
  });

  test("partner_created_by refuses an unauthenticated caller", async () => {
    const res = await rpc(null, "partner_created_by", {
      _uid: admin.userId,
      _partner_id: FIXTURES.partnerInScope,
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  test("the authorization helpers refuse an unauthenticated caller", async () => {
    for (const fn of ["current_role_name", "is_admin_or_super", "visible_category_ids", "can_see_partner"]) {
      const res = await rpc(null, fn, { _uid: admin.userId, _partner_id: FIXTURES.partnerInScope });
      expect(res.status).toBeGreaterThanOrEqual(400);
    }
  });

  test("submit_public_contact stays open — it is the whole point of the public form", async () => {
    // Called with no arguments it must fail on validation, never on permissions.
    const res = await rpc(null, "submit_public_contact", {});
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
    expect(res.body?.message ?? "").not.toContain("permission denied");
  });

  test("the helpers still work for signed-in users — the policies depend on them", async () => {
    // Revoking these from `authenticated` would take down every SELECT on res_partner:
    // policy expressions are evaluated with the querying user's privileges.
    expect((await select(volunteer, "res_partner", "select=id")).status).toBe(200);
    expect((await rpc(volunteer, "is_admin_or_super", { _uid: volunteer.userId })).body).toBe(false);
  });
});

describe("KI-02 — a coordinator can no longer widen its own perimeter (FIXED)", () => {
  test("self-granting a group outside the perimeter is refused", async () => {
    const before = await count(coordinator, "res_partner");

    const grant = await insert(coordinator, "res_user_category_rel", {
      user_id: coordinator.userId,
      category_id: FIXTURES.categoryNapoli,
    });
    expect(wasDenied(grant)).toBe(true);
    expect(await count(coordinator, "res_partner")).toBe(before);
  });

  test("a coordinator can still assign a group it does hold to a volunteer", async () => {
    // The point of the policy is scope, not paralysis: this is what the Users page does.
    const grant = await insert(coordinator, "res_user_category_rel", {
      user_id: volunteer.userId,
      category_id: FIXTURES.categoryVarese,
    });
    // Already assigned in the fixtures, so a duplicate key here is also a pass: what
    // must not happen is a 403.
    expect(grant.status === 201 || grant.status === 409).toBe(true);
    if (grant.status === 201) {
      await remove(
        admin,
        "res_user_category_rel",
        `user_id=eq.${volunteer.userId}&category_id=eq.${FIXTURES.categoryVarese}`,
      );
    }
  });

  test("a volunteer is still refused outright", async () => {
    const res = await insert(volunteer, "res_user_category_rel", {
      user_id: volunteer.userId,
      category_id: FIXTURES.categoryNapoli,
    });
    expect(wasDenied(res)).toBe(true);
  });

  test("an admin is unaffected", async () => {
    const res = await insert(admin, "res_user_category_rel", {
      user_id: volunteer.userId,
      category_id: FIXTURES.categoryNapoli,
    });
    expect(didAffectRows(res)).toBe(true);
    await remove(
      admin,
      "res_user_category_rel",
      `user_id=eq.${volunteer.userId}&category_id=eq.${FIXTURES.categoryNapoli}`,
    );
  });
});

describe("KI-03 — membership cards are role-gated on INSERT too (FIXED)", () => {
  /**
   * The original finding was that sub_mod carried the perimeter in USING but not in
   * WITH CHECK, so a coordinator could issue a card to a contact outside its groups.
   *
   * The perimeter itself was removed on 2026-09-17 — a coordinator legitimately reaches
   * every contact now — so the half of sub_mod that still bites is the role list:
   * admin, superuser and coordinator may touch cards, a volunteer may not. That is what
   * these tests hold, and the shape of the original bug (a WITH CHECK that forgot what
   * USING said) is exactly what a volunteer INSERT would expose.
   */
  test("a volunteer cannot create a card at all", async () => {
    const before = await count(admin, "membership_subscription");

    // return=minimal is the shape that used to hide this: with return=representation
    // the readback tripped sub_select and it looked like a plain error.
    const res = await insertBlind(volunteer, "membership_subscription", {
      partner_id: FIXTURES.partnerOutOfScope,
      year: 2033,
      status: "active",
      notes: "KI03-PROBE",
    });
    expect(wasDenied(res)).toBe(true);
    expect(await count(admin, "membership_subscription")).toBe(before);
  });

  test("a coordinator can create one for any contact", async () => {
    const res = await insert(coordinator, "membership_subscription", {
      partner_id: FIXTURES.partnerInScope,
      year: 2038,
      status: "active",
      notes: "KI03ok-PROBE",
    });
    expect(didAffectRows(res)).toBe(true);
    await remove(admin, "membership_subscription", `id=eq.${res.rows[0].id}`);
  });

  test("including one that used to be outside its perimeter", async () => {
    const res = await insert(coordinator, "membership_subscription", {
      partner_id: FIXTURES.partnerOutOfScope,
      year: 2039,
      status: "active",
      notes: "KI03c-PROBE",
    });
    expect(didAffectRows(res)).toBe(true);
    await remove(admin, "membership_subscription", `id=eq.${res.rows[0].id}`);
  });

  test("UPDATE and DELETE stay closed to a volunteer", async () => {
    const seeded = await insert(admin, "membership_subscription", {
      partner_id: FIXTURES.partnerOutOfScope,
      year: 2034,
      status: "inactive",
      notes: "KI03b-PROBE",
    });
    const id = seeded.rows[0].id;
    expect(didAffectRows(await remove(volunteer, "membership_subscription", `id=eq.${id}`))).toBe(false);
    expect(
      didAffectRows(await update(volunteer, "membership_subscription", `id=eq.${id}`, { status: "active" })),
    ).toBe(false);
    await remove(admin, "membership_subscription", `id=eq.${id}`);
  });
});

describe("KI-04 — the 204 trap (withdrawn finding, kept as a guard)", () => {
  // The single most misleading behaviour in this stack, and the reason every write
  // assertion in this suite goes through didAffectRows: PostgREST cannot distinguish a
  // denial from a success by status code alone.
  test("a PATCH that RLS filtered away still answers 2xx", async () => {
    const res = await update(
      coordinator,
      "res_partner_category",
      `id=eq.${FIXTURES.categoryNapoli}`,
      { phone: "KI04-PROBE" },
    );
    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.status).toBeLessThan(300);
    expect(res.rows).toHaveLength(0);
  });

  test("and nothing was actually written", async () => {
    const row = (
      await select(admin, "res_partner_category", `select=phone&id=eq.${FIXTURES.categoryNapoli}`)
    ).rows[0];
    expect(row.phone).not.toBe("KI04-PROBE");
  });
});

describe("KI-10 — membership numbers are generated inside the INSERT (FIXED)", () => {
  test("the trigger fills the number, so no client round-trip can race", async () => {
    const res = await insert(admin, "membership_subscription", {
      partner_id: FIXTURES.partnerInScope,
      year: 2039,
      status: "active",
      notes: "KI10-PROBE",
    });
    expect(didAffectRows(res)).toBe(true);
    // Format is YYNNNNN — two-digit year plus a five-digit counter.
    expect(res.rows[0].membership_number).toMatch(/^39\d{5}$/);
    await remove(admin, "membership_subscription", `id=eq.${res.rows[0].id}`);
  });

  test("concurrent creates for the same year all get distinct numbers", async () => {
    // The advisory lock is transaction-scoped, so it actually holds across the read and
    // the write. The old code read the maximum in one HTTP request and inserted in
    // another, which no lock could span.
    const partners = await Promise.all(
      [1, 2, 3, 4, 5].map((i) =>
        insert(admin, "res_partner", {
          first_name: "AUTOTEST",
          last_name: `race-${i}`,
          email: `autotest-race-${i}-${Date.now()}@oltremani.test`,
        }),
      ),
    );
    const ids = partners.map((p) => p.rows[0].id);

    const results = await Promise.all(
      ids.map((pid) =>
        insert(admin, "membership_subscription", {
          partner_id: pid,
          year: 2040,
          status: "active",
          notes: "KI10race-PROBE",
        }),
      ),
    );

    const numbers = results.map((r) => r.rows[0]?.membership_number);
    expect(numbers.every(Boolean)).toBe(true);
    expect(new Set(numbers).size).toBe(numbers.length);

    await remove(admin, "membership_subscription", "year=eq.2040&notes=eq.KI10race-PROBE");
    for (const id of ids) await remove(admin, "res_partner", `id=eq.${id}`);
  });

  test("generate_membership_number is no longer callable by the client at all", async () => {
    // The trigger is SECURITY DEFINER and calls it as the owner, so no API role needs it.
    expect((await rpc(admin, "generate_membership_number", { p_year: 2026 })).status)
      .toBeGreaterThanOrEqual(400);
  });
});

describe("2026-07-25 hardening — must not regress", () => {
  test("partner_type rejects anything outside the three allowed values", async () => {
    const res = await insert(admin, "res_partner", {
      first_name: "AUTOTEST",
      email: `autotest-type-${Date.now()}@oltremani.test`,
      partner_type: "not_a_type",
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  test("email uniqueness is case-insensitive", async () => {
    const email = `autotest-Case-${Date.now()}@oltremani.test`;
    const first = await insert(admin, "res_partner", { first_name: "AUTOTEST", email });
    expect(didAffectRows(first)).toBe(true);

    const clash = await insert(admin, "res_partner", {
      first_name: "AUTOTEST",
      email: email.toUpperCase(),
    });
    // idx_partner_email_lower, not the plain UNIQUE, is what catches this.
    expect(clash.status).toBe(409);

    await remove(admin, "res_partner", `id=eq.${first.rows[0].id}`);
  });

  test("only one active card per partner per year", async () => {
    const y = 2035;
    const a = await insert(admin, "membership_subscription", {
      partner_id: FIXTURES.partnerInScope,
      year: y,
      status: "active",
      notes: "KIuniq-PROBE",
    });
    expect(didAffectRows(a)).toBe(true);

    const b = await insert(admin, "membership_subscription", {
      partner_id: FIXTURES.partnerInScope,
      year: y,
      status: "active",
      notes: "KIuniq-PROBE",
    });
    expect(b.status).toBe(409);

    // A second non-active row is allowed on purpose: the partial index keeps the history.
    const c = await insert(admin, "membership_subscription", {
      partner_id: FIXTURES.partnerInScope,
      year: y,
      status: "revoked",
      notes: "KIuniq-PROBE",
    });
    expect(didAffectRows(c)).toBe(true);

    await remove(admin, "membership_subscription", `year=eq.${y}&notes=eq.KIuniq-PROBE`);
  });

  test("sub_default_end_date fills end_date with 31 December", async () => {
    const res = await insert(admin, "membership_subscription", {
      partner_id: FIXTURES.partnerInScope,
      year: 2036,
      status: "inactive",
      notes: "KIenddate-PROBE",
    });
    expect(res.rows[0].end_date).toBe("2036-12-31");
    await remove(admin, "membership_subscription", `id=eq.${res.rows[0].id}`);
  });

  test("the helpers refuse to answer about somebody else", async () => {
    // Before this guard a signed-in user could map other accounts' permissions by RPC.
    expect((await rpc(volunteer, "is_admin_or_super", { _uid: admin.userId })).body).toBe(false);
  });

  test("the trigger functions still fire after being revoked from every API role", async () => {
    // PostgreSQL checks EXECUTE on a trigger function at CREATE TRIGGER time, not on each
    // fire — which is what makes the KI-01 revokes safe. This proves it on live data.
    const res = await insert(volunteer, "res_partner", {
      first_name: "AUTOTEST",
      last_name: "triggers",
      email: `autotest-trg-${Date.now()}@oltremani.test`,
    });
    expect(didAffectRows(res)).toBe(true);
    expect(res.rows[0].created_by).toBe(volunteer.userId); // set_created_by fired
    await remove(admin, "res_partner", `id=eq.${res.rows[0].id}`);
  });
});
