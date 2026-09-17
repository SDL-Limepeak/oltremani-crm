import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { FIXTURES, TEST_TAG } from "./helpers/env";
import {
  count,
  didAffectRows,
  insert,
  login,
  remove,
  select,
  update,
  wasDenied,
  type Session,
} from "./helpers/pgrest";

/**
 * The permission matrix, exercised through PostgREST with a real JWT per role — the same
 * path `context.supabase` takes, and the same path an attacker has.
 *
 * Reminder while reading assertions: a 2xx is not a permission. PostgREST answers 204 to a
 * write that RLS filtered to zero rows. Everything here goes through `didAffectRows`.
 */

let admin: Session, superuser: Session, coordinator: Session, volunteer: Session, noscope: Session;

const created = { partners: [] as string[], categories: [] as string[] };

beforeAll(async () => {
  [admin, superuser, coordinator, volunteer, noscope] = await Promise.all([
    login("admin"),
    login("superuser"),
    login("coordinator"),
    login("volunteer"),
    login("noscope"),
  ]);
});

afterAll(async () => {
  for (const id of created.partners) await remove(admin, "res_partner", `id=eq.${id}`);
  for (const id of created.categories) await remove(admin, "res_partner_category", `id=eq.${id}`);
  // Belt and braces: anything the suite tagged, whatever went wrong above.
  await remove(admin, "res_partner", `email=like.autotest-*`);
  await remove(admin, "res_partner_category", `name=like.${TEST_TAG}-*`);
});

describe("contact visibility — open to every user since 2026-09-17", () => {
  /**
   * This block used to assert the opposite: visibility came from res_partner_category_rel,
   * a coordinator saw one contact and a user with no group saw none. The client removed
   * the perimeter on 2026-09-17 — every active user now reads and writes every contact.
   *
   * The tests are kept rather than deleted because "everyone sees everything" is a claim
   * that needs holding just as much as the old one did, and because the group perimeter
   * still exists as data: if a future change re-links can_see_partner to the categories by
   * accident, the volunteer and noscope counts are where it shows up first.
   */
  test("every role sees the same contacts, admin included", async () => {
    const all = await count(admin, "res_partner");
    expect(all).toBeGreaterThanOrEqual(8);
    for (const s of [superuser, coordinator, volunteer, noscope]) {
      expect(await count(s, "res_partner")).toBe(all);
    }
  });

  test("a user with no group at all still sees every contact", async () => {
    // The case that proves the perimeter is gone rather than merely widened: this account
    // has no row in res_user_category_rel.
    expect(await count(noscope, "res_partner")).toBe(await count(admin, "res_partner"));
  });

  test("a contact outside the old perimeter is readable", async () => {
    const r = await select(volunteer, "res_partner", `select=id&id=eq.${FIXTURES.partnerOutOfScope}`);
    expect(r.rows).toHaveLength(1);
  });
});

describe("creating a contact — the INSERT ... RETURNING regression", () => {
  // A brand-new contact has no categories, so a category-only SELECT policy refuses the
  // RETURNING clause and the whole INSERT fails. This broke contact creation for every
  // non-admin until 2026-07-25. It must keep working for all four roles.
  for (const role of ["admin", "superuser", "coordinator", "volunteer", "noscope"] as const) {
    test(`${role} can insert and read the row back`, async () => {
      const session = await login(role);
      const email = `autotest-${role}-${Date.now()}@oltremani.test`;
      const res = await insert(session, "res_partner", {
        first_name: TEST_TAG,
        last_name: role,
        email,
        status: "new",
      });
      expect(didAffectRows(res)).toBe(true);
      expect(res.rows[0].email).toBe(email);
      // set_created_by fills it from auth.uid(); that is what makes the readback legal.
      expect(res.rows[0].created_by).toBe(session.userId);
      created.partners.push(res.rows[0].id);
    });
  }
});

describe("modifying and deleting contacts", () => {
  test("only admin and superuser can delete", async () => {
    const seed = await insert(admin, "res_partner", {
      first_name: TEST_TAG,
      last_name: "deletable",
      email: `autotest-del-${Date.now()}@oltremani.test`,
    });
    const id = seed.rows[0].id;
    created.partners.push(id);

    // Sharper than it used to be. Before 2026-09-17 these two were refused because they
    // could not see the row; now they can see it and edit it, and the DELETE is still
    // refused — which is the actual rule, and the only way to tell the two apart.
    expect(didAffectRows(await remove(volunteer, "res_partner", `id=eq.${id}`))).toBe(false);
    expect(didAffectRows(await remove(coordinator, "res_partner", `id=eq.${id}`))).toBe(false);
    expect(didAffectRows(await remove(admin, "res_partner", `id=eq.${id}`))).toBe(true);
    created.partners = created.partners.filter((x) => x !== id);
  });

  test("a volunteer can now edit any contact", async () => {
    const res = await update(
      volunteer,
      "res_partner",
      `id=eq.${FIXTURES.partnerOutOfScope}`,
      { notes: `${TEST_TAG} volunteer edit` },
    );
    expect(didAffectRows(res)).toBe(true);
    // Put it back: this is a real contact in the client's database, not a fixture.
    await update(admin, "res_partner", `id=eq.${FIXTURES.partnerOutOfScope}`, { notes: null });
  });
});

describe("res_users", () => {
  test("a volunteer sees only itself; elevated roles see everyone", async () => {
    expect(await count(volunteer, "res_users")).toBe(1);
    const all = await count(admin, "res_users");
    expect(all).toBeGreaterThanOrEqual(7);
    expect(await count(superuser, "res_users")).toBe(all);
    expect(await count(coordinator, "res_users")).toBe(all);
  });

  test("nobody can promote themselves", async () => {
    for (const s of [volunteer, coordinator]) {
      const res = await update(s, "res_users", `id=eq.${s.userId}`, { role: "superuser" });
      expect(didAffectRows(res)).toBe(false);
      // Blocked twice over: the users_update WITH CHECK and the protect_admin_users trigger.
      expect(wasDenied(res) || res.error !== null).toBe(true);
    }
  });

  test("a volunteer can still rename itself", async () => {
    const res = await update(volunteer, "res_users", `id=eq.${volunteer.userId}`, {
      name: "TEST Volontario Varese",
    });
    expect(didAffectRows(res)).toBe(true);
  });

  test("a volunteer cannot touch anybody else", async () => {
    const res = await update(volunteer, "res_users", `id=eq.${coordinator.userId}`, {
      name: "hijacked",
    });
    expect(didAffectRows(res)).toBe(false);
  });

  test("an admin cannot be demoted, not even by another admin", async () => {
    const res = await update(superuser, "res_users", `id=eq.${admin.userId}`, {
      role: "volunteer",
    });
    expect(didAffectRows(res)).toBe(false);
  });
});

describe("audit_log", () => {
  test("only an admin can read it — a superuser gets an empty list, not an error", async () => {
    expect(await count(admin, "audit_log")).toBeGreaterThan(0);
    // Silent by design, and the reason the dashboard looks broken for non-admins (KI-07).
    expect((await select(superuser, "audit_log", "select=id&limit=5")).rows).toHaveLength(0);
    expect((await select(volunteer, "audit_log", "select=id&limit=5")).rows).toHaveLength(0);
  });

  test("it is append-only for everyone, admin included", async () => {
    const row = (await select(admin, "audit_log", "select=id&limit=1")).rows[0];
    // audit_no_update / audit_no_delete are RESTRICTIVE: they AND with the permissive
    // policies, so they hold even if a broad FOR ALL policy is added later.
    expect(didAffectRows(await update(admin, "audit_log", `id=eq.${row.id}`, { source: "x" }))).toBe(false);
    expect(didAffectRows(await remove(admin, "audit_log", `id=eq.${row.id}`))).toBe(false);
  });

  test("nobody can write an audit row in someone else's name", async () => {
    const res = await insert(volunteer, "audit_log", {
      log_type: "record_change",
      action: "update",
      changed_by_user_id: admin.userId,
    });
    expect(wasDenied(res)).toBe(true);
  });
});

describe("groups (res_partner_category)", () => {
  test("a volunteer cannot create one, a coordinator can", async () => {
    expect(
      wasDenied(await insert(volunteer, "res_partner_category", { name: `${TEST_TAG}-vol` })),
    ).toBe(true);

    const res = await insert(coordinator, "res_partner_category", { name: `${TEST_TAG}-coord` });
    // The readback works only because created_by is set — see history.md, the coordinator
    // could not create groups at all before migration 20260725180000.
    expect(didAffectRows(res)).toBe(true);
    created.categories.push(res.rows[0].id);
  });

  test("the system group cannot be deleted", async () => {
    const res = await remove(admin, "res_partner_category", `id=eq.${FIXTURES.categoryValidation}`);
    expect(didAffectRows(res)).toBe(false);
  });

  test("a coordinator cannot reach a group outside its perimeter", async () => {
    // Denial arrives through rpc_select, not rpc_update: PostgREST has to find the row
    // before patching it. This is exactly the case that produced the KI-04 false positive.
    expect((await select(coordinator, "res_partner_category", `select=id&id=eq.${FIXTURES.categoryNapoli}`)).rows).toHaveLength(0);
    const res = await update(coordinator, "res_partner_category", `id=eq.${FIXTURES.categoryNapoli}`, { phone: "probe" });
    expect(didAffectRows(res)).toBe(false);
  });
});

describe("reference data", () => {
  test("every role can read the city list", async () => {
    for (const s of [admin, superuser, coordinator, volunteer, noscope]) {
      expect(await count(s, "res_city")).toBe(107);
    }
  });

  test("a volunteer cannot modify a city", async () => {
    const res = await update(volunteer, "res_city", `id=eq.${FIXTURES.cityVarese}`, {
      region: "Nowhere",
    });
    expect(didAffectRows(res)).toBe(false);
  });
});
