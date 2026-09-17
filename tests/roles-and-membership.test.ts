import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { APP_URL, FIXTURES } from "./helpers/env";
import {
  didAffectRows,
  insert,
  login,
  remove,
  select,
  wasDenied,
  type Session,
} from "./helpers/pgrest";

/**
 * Client feedback points 7 (operational roles) and 10 (declaring an existing card on the
 * public form), plus the RLS on the new tables.
 *
 * The membership branches go through the real HTTP endpoint, because the interesting part
 * is the whole path: form → route → RPC → DB. Skips if no server answers.
 */

let admin: Session, coordinator: Session, volunteer: Session;
let serverUp = false;
let exercised = 0;

const stamp = Date.now();
const emails = {
  roles: `autotest-roles-${stamp}@oltremani.test`,
  notFound: `autotest-card-nf-${stamp}@oltremani.test`,
  mismatch: `autotest-card-mm-${stamp}@oltremani.test`,
};

beforeAll(async () => {
  [admin, coordinator, volunteer] = await Promise.all([
    login("admin"),
    login("coordinator"),
    login("volunteer"),
  ]);
  try {
    serverUp = (await fetch(`${APP_URL}/api/public/contact`, { method: "OPTIONS" })).ok;
  } catch {
    serverUp = false;
  }
  if (!serverUp) console.warn(`[roles] no server on ${APP_URL} — HTTP tests skipped.`);
});

afterAll(async () => {
  for (const email of Object.values(emails)) {
    await remove(admin, "res_partner", `email=eq.${email}`);
  }
  await remove(admin, "res_partner", "email=like.autotest-*");
});

async function post(body: unknown) {
  const res = await fetch(`${APP_URL}/api/public/contact`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  exercised++;
  return { status: res.status, body: await res.json().catch(() => null) };
}

describe("point 7 — the role picklist", () => {
  test("the five roles are readable by every profile, ordered", async () => {
    // Redefined by the client on 2026-09-17. The order is the one they listed them in and
    // is what sort_order encodes, so it is part of the expectation.
    for (const s of [admin, coordinator, volunteer]) {
      const res = await select(s, "res_partner_role", "select=code,name,sort_order&order=sort_order");
      expect(res.rows.map((r: any) => r.code)).toEqual([
        "attivista",
        "socio_aps",
        "membro_comunita",
        "famiglia_ospitante",
        "specialista_diritti",
      ]);
    }
  });

  test("code and name are separate — the label can move without touching the API name", async () => {
    const rows = (await select(admin, "res_partner_role", "select=code,name")).rows;
    for (const r of rows as any[]) {
      expect(r.code).toMatch(/^[a-z_]+$/); // API name: stable, lowercase, no spaces
      expect(r.name).not.toBe(r.code); // label: prose, translated, free to change
    }
  });

  test("only admin and superuser can edit the picklist", async () => {
    // It is global reference data, unlike the per-contact assignments below.
    for (const s of [coordinator, volunteer]) {
      expect(wasDenied(await insert(s, "res_partner_role", { code: `x_${Date.now()}`, name: "X" }))).toBe(true);
    }
  });
});

describe("point 7 — assigning roles to a contact", () => {
  test("a volunteer can set roles on a contact it created, and read them back", async () => {
    // Same INSERT ... RETURNING shape that broke contact creation before 2026-07-25:
    // partner_created_by in the WITH CHECK is what lets the readback through on a contact
    // that no perimeter covers yet.
    const p = await insert(volunteer, "res_partner", {
      first_name: "AUTOTEST",
      last_name: "roles",
      email: emails.roles,
    });
    expect(didAffectRows(p)).toBe(true);
    const partnerId = p.rows[0].id;

    const roles = (await select(volunteer, "res_partner_role", "select=id,code")).rows as any[];
    const attivista = roles.find((r) => r.code === "attivista");
    const famiglia = roles.find((r) => r.code === "famiglia_ospitante");

    // Two at once on purpose: the selection is multiple by design — "specialista di
    // diritti sulle migrazioni e/o abitare" is one entry now, but a contact can still be
    // an activist *and* a host family.
    const rel = await insert(volunteer, "res_partner_role_rel", [
      { partner_id: partnerId, role_id: attivista.id },
      { partner_id: partnerId, role_id: famiglia.id },
    ]);
    expect(didAffectRows(rel)).toBe(true);
    expect(rel.rows).toHaveLength(2);

    const read = await select(
      volunteer,
      "res_partner",
      `select=res_partner_role_rel(res_partner_role(code))&id=eq.${partnerId}`,
    );
    const codes = read.rows[0].res_partner_role_rel.map((x: any) => x.res_partner_role.code).sort();
    expect(codes).toEqual(["attivista", "famiglia_ospitante"]);

    await remove(admin, "res_partner", `id=eq.${partnerId}`);
  });

  test("a volunteer can assign a role on any contact, but the picklist stays closed", async () => {
    // The perimeter came off contacts on 2026-09-17, so the assignment below is now
    // legitimate — what must NOT follow is the picklist opening up with it. Editing
    // res_partner_role is global reference data and stays admin/superuser.
    // A named role, not "the first one PostgREST happens to return": this contact is a
    // real record and may already carry roles assigned from the app, and the link table
    // has a composite primary key — an accidental collision would read as a denial.
    const roles = (await select(admin, "res_partner_role", "select=id,code")).rows as any[];
    const roleId = roles.find((r) => r.code === "socio_aps").id;
    const pair = `partner_id=eq.${FIXTURES.partnerOutOfScope}&role_id=eq.${roleId}`;
    await remove(admin, "res_partner_role_rel", pair);

    const res = await insert(volunteer, "res_partner_role_rel", {
      partner_id: FIXTURES.partnerOutOfScope,
      role_id: roleId,
    });
    expect(didAffectRows(res)).toBe(true);
    await remove(admin, "res_partner_role_rel", pair);

    expect(
      wasDenied(await insert(volunteer, "res_partner_role", { code: `x_${Date.now()}`, name: "X" })),
    ).toBe(true);
  });

  test("deleting a contact takes its role links with it", async () => {
    const p = await insert(admin, "res_partner", {
      first_name: "AUTOTEST",
      last_name: "cascade",
      email: `autotest-cascade-${Date.now()}@oltremani.test`,
    });
    const partnerId = p.rows[0].id;
    const roleId = (await select(admin, "res_partner_role", "select=id&limit=1")).rows[0].id;
    await insert(admin, "res_partner_role_rel", { partner_id: partnerId, role_id: roleId });

    await remove(admin, "res_partner", `id=eq.${partnerId}`);
    const left = await select(admin, "res_partner_role_rel", `select=role_id&partner_id=eq.${partnerId}`);
    expect(left.rows).toHaveLength(0);
  });
});

describe("point 7 — roles arriving from the public form", () => {
  test("known codes are attached, unknown ones are ignored rather than rejected", async () => {
    if (!serverUp) return;
    const res = await post({
      first_name: "AUTOTEST",
      last_name: "FormRoles",
      email: emails.roles,
      phone: "+390000010",
      city: "Varese",
      province: "VA",
      // Two current codes plus a retired one. "bussola" is deliberate: it was a real
      // code until 2026-09-17, so it is exactly what a WordPress form that nobody
      // updated would still be posting.
      role_codes: ["attivista", "famiglia_ospitante", "bussola"],
    });
    if (res.status === 429) return;
    expect(res.status).toBe(200);

    const read = await select(
      admin,
      "res_partner",
      `select=res_partner_role_rel(res_partner_role(code))&email=eq.${emails.roles}`,
    );
    const codes = read.rows[0].res_partner_role_rel.map((x: any) => x.res_partner_role.code).sort();
    // The unknown code is dropped silently: the WordPress form is maintained by someone
    // else and must not start failing when this list changes. The flip side, and the
    // reason this is worth stating out loud: a form still posting the old codes loses
    // those answers without an error anywhere.
    expect(codes).toEqual(["attivista", "famiglia_ospitante"]);
  });
});

describe("point 10 — declaring an existing membership card", () => {
  test("no number given reports not_provided and changes nothing", async () => {
    if (!serverUp) return;
    const res = await post({
      first_name: "AUTOTEST",
      last_name: "NoCard",
      email: `autotest-nocard-${stamp}@oltremani.test`,
      phone: "+390000011",
      city: "Varese",
      province: "VA",
    });
    if (res.status === 429) return;
    expect(res.body.membership_status).toBe("not_provided");
    expect(res.body.validation).toBe(false);
  });

  test("an unknown number registers the person anyway and flags it for a human", async () => {
    if (!serverUp) return;
    const res = await post({
      first_name: "AUTOTEST",
      last_name: "CardNotFound",
      email: emails.notFound,
      phone: "+390000012",
      city: "Varese", // matches, so validation can only be true because of the card
      province: "VA",
      membership_number: "0000000",
    });
    if (res.status === 429) return;
    expect(res.body.ok).toBe(true);
    expect(res.body.membership_status).toBe("not_found");
    expect(res.body.validation).toBe(true);

    const row = (await select(admin, "res_partner", `select=notes&email=eq.${emails.notFound}`)).rows[0];
    expect(row.notes).toContain("non trovata");
  });

  test("a number belonging to somebody else is NOT reassigned", async () => {
    if (!serverUp) return;
    // The whole point: membership_number is UNIQUE, so honouring the claim would let
    // anyone take over another member's card by typing their number.
    const card = (
      await select(admin, "membership_subscription", "select=membership_number,partner_id&membership_number=not.is.null&limit=1")
    ).rows[0];

    const res = await post({
      first_name: "AUTOTEST",
      last_name: "CardMismatch",
      email: emails.mismatch,
      phone: "+390000013",
      city: "Varese",
      province: "VA",
      membership_number: card.membership_number,
    });
    if (res.status === 429) return;
    expect(res.body.membership_status).toBe("mismatch");
    expect(res.body.validation).toBe(true);

    // The card still belongs to its original owner.
    const after = (
      await select(admin, "membership_subscription", `select=partner_id&membership_number=eq.${card.membership_number}`)
    ).rows[0];
    expect(after.partner_id).toBe(card.partner_id);

    const row = (await select(admin, "res_partner", `select=notes&email=eq.${emails.mismatch}`)).rows[0];
    expect(row.notes).toContain("non riassegnata");
  });

  test("this suite really ran — or says so loudly", () => {
    if (!serverUp) {
      expect(exercised).toBe(0);
      console.warn("[roles] SKIPPED the HTTP tests: no server. Run: bun run dev");
      return;
    }
    expect(exercised).toBeGreaterThanOrEqual(3);
  });
});
