import { beforeAll, describe, expect, test } from "bun:test";
import {
  PARTNER_STATUS,
  SUBSCRIPTION_STATUS,
  SUBSCRIPTION_STATUS_LABEL,
  labelFor,
} from "../src/lib/selections";
import { didAffectRows, insert, login, remove, select, type Session } from "./helpers/pgrest";

/**
 * Selection fields: the stored value is an API name, the label is presentation.
 *
 * What this file protects against is one specific mistake — someone acting on a wording
 * request by renaming the *codes* as well. That looks like a tidy-up and is a breaking
 * change: it needs a CHECK migration, it invalidates every historical audit_log snapshot,
 * it changes the export CSV, and it silently breaks whatever the WordPress form is already
 * posting. The labels are meant to move freely; the codes are not.
 *
 * `partner_type` used to be pinned here. It was removed from the product on 2026-09-17 and
 * replaced by the operational roles, which live in res_partner_role and are covered by
 * roles-and-membership.test.ts. The column survives in the database holding the old values;
 * nothing reads it.
 */

let admin: Session;
beforeAll(async () => {
  admin = await login("admin");
});

describe("selection codes are frozen, labels are not", () => {
  test("the contact statuses are exactly these four, in the client's order", () => {
    // Changing the *codes* is a schema change; changing the *order* is a product decision
    // the client made on 2026-09-17 (Nuovo → Attivo → Inattivo → Rifiutato). The order is
    // pinned because the contacts list sorts by it, not only the dropdown.
    expect(PARTNER_STATUS.map((o) => o.value)).toEqual(["new", "active", "old", "rejected"]);
  });

  test("the card statuses are exactly these four, expired included", () => {
    expect(SUBSCRIPTION_STATUS.map((o) => o.value)).toEqual([
      "active",
      "inactive",
      "expired",
      "revoked",
    ]);
    // Set by expire_memberships() nightly, never typed in. The wording matters because it
    // is what the register shows for a card whose end date has passed.
    expect(SUBSCRIPTION_STATUS_LABEL.expired).toBe("Scaduta");
  });

  test("no label is left as its own code — that would mean an unlabelled option", () => {
    for (const sel of [PARTNER_STATUS, SUBSCRIPTION_STATUS]) {
      for (const o of sel) {
        expect(o.label).not.toBe(o.value);
        expect(o.label.trim()).not.toBe("");
      }
    }
  });

  test("values are unique within each selection", () => {
    for (const sel of [PARTNER_STATUS, SUBSCRIPTION_STATUS]) {
      expect(new Set(sel.map((o) => o.value)).size).toBe(sel.length);
    }
  });

  test("labelFor falls back to the raw value instead of rendering blank", () => {
    expect(labelFor(PARTNER_STATUS, "old")).toBe("Inattivo");
    expect(labelFor(PARTNER_STATUS, "codice_ignoto")).toBe("codice_ignoto");
    expect(labelFor(PARTNER_STATUS, null)).toBe("—");
  });
});

describe("the operational roles are the five the client asked for", () => {
  // Replaced the old set on 2026-09-17. res_partner_role_rel was empty at the time, so
  // nothing had to be reassigned — which is the only reason renaming codes was safe here.
  test("codes and order", async () => {
    const res = await select(admin, "res_partner_role", "select=code,name&order=sort_order");
    expect(res.rows.map((r: any) => r.code)).toEqual([
      "attivista",
      "socio_aps",
      "membro_comunita",
      "famiglia_ospitante",
      "specialista_diritti",
    ]);
  });

  test("the two that were merged and the one that was dropped are gone", async () => {
    const res = await select(admin, "res_partner_role", "select=code");
    const codes = res.rows.map((r: any) => r.code);
    for (const gone of ["specialista_abitare", "specialista_migrazione", "bussola", "membro_semplice"]) {
      expect(codes).not.toContain(gone);
    }
  });
});

describe("the selections match the database CHECK constraints", () => {
  // Behavioural cross-check: every listed value must be insertable, and a value outside
  // the list must be refused. Catches drift in either direction — a code renamed in TS
  // that the DB rejects, or a value added to the DB that no screen can display.
  const created: string[] = [];

  test("every partner status in the list is accepted by the database", async () => {
    for (const o of PARTNER_STATUS) {
      const res = await insert(admin, "res_partner", {
        first_name: "AUTOTEST",
        last_name: `sel-${o.value}`,
        email: `autotest-selst-${o.value}-${Date.now()}@oltremani.test`,
        status: o.value,
      });
      expect(didAffectRows(res)).toBe(true);
      created.push(res.rows[0].id);
    }
  });

  test("every subscription status in the list is accepted by the database", async () => {
    const partner = await insert(admin, "res_partner", {
      first_name: "AUTOTEST",
      last_name: "sel-sub",
      email: `autotest-selsub-${Date.now()}@oltremani.test`,
    });
    const partnerId = partner.rows[0].id;
    created.push(partnerId);

    let year = 2050;
    for (const o of SUBSCRIPTION_STATUS) {
      const res = await insert(admin, "membership_subscription", {
        partner_id: partnerId,
        year: year++,
        status: o.value,
        notes: "SEL-PROBE",
      });
      expect(didAffectRows(res)).toBe(true);
    }
    await remove(admin, "membership_subscription", "notes=eq.SEL-PROBE");
  });

  test("a status outside the list is refused — the constraint is real", async () => {
    const res = await insert(admin, "res_partner", {
      first_name: "AUTOTEST",
      email: `autotest-selbad-${Date.now()}@oltremani.test`,
      status: "sospeso",
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  test("cleanup", async () => {
    for (const id of created) await remove(admin, "res_partner", `id=eq.${id}`);
    await remove(admin, "res_partner", "email=like.autotest-sel*");
  });
});
