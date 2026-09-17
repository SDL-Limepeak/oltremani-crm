import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { PROFILES } from "./helpers/env";
import { didAffectRows, login, remove, select, update, type Session } from "./helpers/pgrest";

/**
 * The profile hierarchy, added 2026-09-17.
 *
 *   admin > superuser > coordinator > volunteer
 *
 * You may act on profiles strictly below your own; admin may act on anyone. A volunteer
 * therefore manages nobody — including other volunteers, which is the case most likely to
 * be got wrong, because "peers can edit peers" is the intuitive reading and is not what
 * was asked for.
 *
 * These go through PostgREST rather than the server functions on purpose: that is the
 * boundary an attacker has. The TypeScript copy of the same rule in users.functions.ts
 * guards the supabaseAdmin writes, which RLS never sees — both have to hold.
 */

let admin: Session, superuser: Session, coordinator: Session, volunteer: Session, noscope: Session;

const ids = Object.fromEntries(
  Object.entries(PROFILES).map(([k, p]: any) => [k, p.userId as string]),
) as Record<string, string>;

beforeAll(async () => {
  [admin, superuser, coordinator, volunteer, noscope] = await Promise.all([
    login("admin"), login("superuser"), login("coordinator"), login("volunteer"), login("noscope"),
  ]);
});

afterAll(async () => {
  // Whatever the assertions did, every test account goes back to active. An account left
  // inactive stops passing current_role_name() and silently fails every later suite.
  for (const key of ["superuser", "coordinator", "volunteer", "noscope"]) {
    await update(admin, "res_users", `id=eq.${ids[key]}`, { status: "active" });
  }
});

/** Disabling is the action the hierarchy gates in the UI, so it is the one probed here. */
async function canDisable(actor: Session, targetKey: string): Promise<boolean> {
  const targetId = ids[targetKey];
  const res = await update(admin, "res_users", `id=eq.${targetId}`, { status: "active" });
  expect(res.status).toBeLessThan(400);
  const attempt = await update(actor, "res_users", `id=eq.${targetId}`, { status: "inactive" });
  const ok = didAffectRows(attempt);
  if (ok) await update(admin, "res_users", `id=eq.${targetId}`, { status: "active" });
  return ok;
}

describe("who may act on whom", () => {
  test("a superuser reaches coordinators and volunteers", async () => {
    expect(await canDisable(superuser, "coordinator")).toBe(true);
    expect(await canDisable(superuser, "volunteer")).toBe(true);
  });

  test("a coordinator reaches volunteers", async () => {
    expect(await canDisable(coordinator, "volunteer")).toBe(true);
  });

  test("a coordinator cannot reach a superuser", async () => {
    expect(await canDisable(coordinator, "superuser")).toBe(false);
  });

  test("a volunteer reaches nobody, not even another volunteer", async () => {
    // The peer case. Both accounts are volunteers; the rule is strictly-lower, not
    // lower-or-equal, so this is a denial.
    expect(await canDisable(volunteer, "noscope")).toBe(false);
    expect(await canDisable(volunteer, "coordinator")).toBe(false);
    expect(await canDisable(noscope, "volunteer")).toBe(false);
  });
});

describe("promotion cannot be used to climb", () => {
  test("a coordinator cannot promote a volunteer to superuser", async () => {
    // USING passes — the volunteer is below the coordinator — and WITH CHECK is what
    // refuses, because the *destination* profile is not. Dropping the second clause is
    // the mistake this test exists for.
    const res = await update(coordinator, "res_users", `id=eq.${ids.volunteer}`, {
      role: "superuser",
    });
    expect(didAffectRows(res)).toBe(false);

    const back = await select(admin, "res_users", `select=role&id=eq.${ids.volunteer}`);
    expect(back.rows[0].role).toBe("volunteer");
  });

  test("nobody can promote to admin, hierarchy or not", async () => {
    for (const actor of [superuser, coordinator]) {
      const res = await update(actor, "res_users", `id=eq.${ids.volunteer}`, { role: "admin" });
      expect(didAffectRows(res)).toBe(false);
    }
    const back = await select(admin, "res_users", `select=role&id=eq.${ids.volunteer}`);
    expect(back.rows[0].role).toBe("volunteer");
  });
});

describe("deleting a user is admin-only now", () => {
  test("a superuser can no longer delete — that became disable", async () => {
    // Seeded and removed by admin: the assertion is about the refusal, and leaving a
    // stray profile row behind would break listUsers for everyone.
    const probe = ids.noscope;
    expect(didAffectRows(await remove(superuser, "res_users", `id=eq.${probe}`))).toBe(false);
    expect(didAffectRows(await remove(coordinator, "res_users", `id=eq.${probe}`))).toBe(false);

    const still = await select(admin, "res_users", `select=id&id=eq.${probe}`);
    expect(still.rows).toHaveLength(1);
  });

  test("an admin still cannot delete another admin", async () => {
    expect(didAffectRows(await remove(admin, "res_users", `id=eq.${ids.admin}`))).toBe(false);
  });
});
