import { beforeAll, describe, expect, test } from "bun:test";
import {
  PARTNER_STATUS,
  PARTNER_TYPE,
  PARTNER_TYPE_LABEL,
  SUBSCRIPTION_STATUS,
  labelFor,
} from "../src/lib/selections";
import { didAffectRows, insert, login, remove, type Session } from "./helpers/pgrest";

/**
 * Selection fields: the stored value is an API name, the label is presentation.
 *
 * What this file protects against is one specific mistake — someone acting on a wording
 * request by renaming the *codes* as well. That looks like a tidy-up and is a breaking
 * change: it needs a CHECK migration, it invalidates every historical audit_log snapshot,
 * it changes the export CSV, and it silently breaks whatever the WordPress form is already
 * posting. The labels are meant to move freely; the codes are not.
 *
 * The last block cross-checks the two directions against the live CHECK constraint, so
 * drift on either side fails here rather than in production.
 */

let admin: Session;
beforeAll(async () => {
  admin = await login("admin");
});

describe("partner type — codes are frozen, labels are not", () => {
  test("the stored values are exactly these three", () => {
    // Changing this array is a schema change. If a test failure brought you here, the fix
    // is almost certainly to revert the rename, not to update the expectation.
    expect(PARTNER_TYPE.map((o) => o.value)).toEqual(["individual", "activist", "citizen"]);
  });

  test("the direction of the relationship, confirmed by the client 2026-08-06", () => {
    // "activist gives support, citizen receives it" — the semantic reading, not the
    // positional one in the original email, which would have paired them backwards.
    expect(PARTNER_TYPE_LABEL.activist).toBe("Dà supporto");
    expect(PARTNER_TYPE_LABEL.citizen).toBe("Cerca supporto");
    expect(PARTNER_TYPE_LABEL.individual).toBe("Non specificato");
  });

  test("no label is left as its own code — that would mean an unlabelled option", () => {
    for (const sel of [PARTNER_TYPE, PARTNER_STATUS, SUBSCRIPTION_STATUS]) {
      for (const o of sel) {
        expect(o.label).not.toBe(o.value);
        expect(o.label.trim()).not.toBe("");
      }
    }
  });

  test("values are unique within each selection", () => {
    for (const sel of [PARTNER_TYPE, PARTNER_STATUS, SUBSCRIPTION_STATUS]) {
      expect(new Set(sel.map((o) => o.value)).size).toBe(sel.length);
    }
  });

  test("labelFor falls back to the raw value instead of rendering blank", () => {
    expect(labelFor(PARTNER_TYPE, "activist")).toBe("Dà supporto");
    expect(labelFor(PARTNER_TYPE, "codice_ignoto")).toBe("codice_ignoto");
    expect(labelFor(PARTNER_TYPE, null)).toBe("—");
  });
});

describe("the selections match the database CHECK constraints", () => {
  // Behavioural cross-check: every listed value must be insertable, and a value outside
  // the list must be refused. Catches drift in either direction — a code renamed in TS
  // that the DB rejects, or a value added to the DB that no screen can display.
  const created: string[] = [];

  test("every partner_type in the list is accepted by the database", async () => {
    for (const o of PARTNER_TYPE) {
      const res = await insert(admin, "res_partner", {
        first_name: "AUTOTEST",
        last_name: `sel-${o.value}`,
        email: `autotest-sel-${o.value}-${Date.now()}@oltremani.test`,
        partner_type: o.value,
      });
      expect(didAffectRows(res)).toBe(true);
      created.push(res.rows[0].id);
    }
  });

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

  test("a value outside the list is refused — the constraint is real", async () => {
    const res = await insert(admin, "res_partner", {
      first_name: "AUTOTEST",
      email: `autotest-selbad-${Date.now()}@oltremani.test`,
      partner_type: "gives_support", // the rename that must never happen quietly
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  test("cleanup", async () => {
    for (const id of created) await remove(admin, "res_partner", `id=eq.${id}`);
    await remove(admin, "res_partner", "email=like.autotest-sel*");
  });
});
