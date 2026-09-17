import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { APP_URL } from "./helpers/env";
import { login, remove, select, type Session } from "./helpers/pgrest";

/**
 * The public endpoint, end to end: HTTP POST -> route -> submit_public_contact -> DB.
 *
 * Needs a running server (`bun run dev`). If nothing answers on APP_URL the whole suite
 * skips rather than failing, because the rest of the tests do not need it.
 *
 * The rate limit is 5 submissions per minute per IP, so this file deliberately makes very
 * few requests. If you re-run it in quick succession expect 429s — that is the feature
 * working, not a broken test.
 */

let admin: Session;
let serverUp = false;
/**
 * Counts assertions that actually reached the server. A skipped test still reports as a
 * pass, so without this a suite that quietly did nothing looks identical to a suite that
 * verified everything — see the final test in this file.
 */
let exercised = 0;

const stamp = Date.now();
const emails = {
  matched: `autotest-form-a-${stamp}@oltremani.test`,
  unmatched: `autotest-form-b-${stamp}@oltremani.test`,
  consents: `autotest-form-c-${stamp}@oltremani.test`,
};

beforeAll(async () => {
  admin = await login("admin");
  try {
    const res = await fetch(`${APP_URL}/api/public/contact`, { method: "OPTIONS" });
    serverUp = res.ok;
  } catch {
    serverUp = false;
  }
  if (!serverUp) {
    console.warn(`[public-form] no server on ${APP_URL} — skipping. Start it with: bun run dev`);
  }
});

afterAll(async () => {
  for (const email of Object.values(emails)) {
    await remove(admin, "res_partner", `email=eq.${email}`);
  }
});

async function post(body: unknown) {
  const res = await fetch(`${APP_URL}/api/public/contact`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  exercised++;
  return { status: res.status, body: await res.json().catch(() => null), headers: res.headers };
}

describe("public contact endpoint", () => {
  test("rejects a submission with no email", async () => {
    if (!serverUp) return;
    const res = await post({ first_name: "AUTOTEST", phone: "+390000000" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("email required");
  });

  test("rejects a submission with no phone — mandatory since the 2026-07-25 feedback", async () => {
    if (!serverUp) return;
    const res = await post({ email: emails.matched, first_name: "AUTOTEST" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("phone required");
  });

  test("a recognised city assigns the territorial group and clears Validation", async () => {
    if (!serverUp) return;
    const res = await post({
      first_name: "AUTOTEST",
      last_name: "Matched",
      email: emails.matched,
      phone: "+390000000001",
      city: "Varese",
      province: "VA",
      privacy_consents: [{ consent_type: "privacy_policy", accepted: true, version: "1.0" }],
    });
    if (res.status === 429) return; // rate limit hit; see the note at the top
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.validation).toBe(false);
    expect(res.body.unassigned).toBe(false); // the alias the WordPress form reads

    const rows = (
      await select(
        admin,
        "res_partner",
        `select=status,city_id,res_partner_category_rel(res_partner_category(name))&email=eq.${emails.matched}`,
      )
    ).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("new");
    expect(rows[0].city_id).not.toBeNull();
    const groups = rows[0].res_partner_category_rel.map((r: any) => r.res_partner_category.name);
    expect(groups).toContain("Varese");
    expect(groups).not.toContain("Validation");
  });

  test("an unrecognised city parks the contact in Validation", async () => {
    if (!serverUp) return;
    // res_city holds only province capitals, so any other municipality lands here.
    // Expected behaviour, not a bug — see .claude/db/schema.md.
    const res = await post({
      first_name: "AUTOTEST",
      last_name: "Unmatched",
      email: emails.unmatched,
      phone: "+390000000002",
      city: "Zafferana Etnea",
      province: "CT",
    });
    if (res.status === 429) return;
    expect(res.status).toBe(200);
    expect(res.body.validation).toBe(true);

    const rows = (
      await select(
        admin,
        "res_partner",
        `select=city_id,res_partner_category_rel(res_partner_category(name))&email=eq.${emails.unmatched}`,
      )
    ).rows;
    expect(rows[0].city_id).toBeNull();
    expect(
      rows[0].res_partner_category_rel.map((r: any) => r.res_partner_category.name),
    ).toContain("Validation");
  });

  test("only the privacy policy is recorded, and the channel is web", async () => {
    if (!serverUp) return;
    // The client dropped the two secondary purposes on 2026-09-17. They are ignored
    // rather than rejected — same reasoning as the role codes: the WordPress form is
    // maintained by someone else and must not start failing. So this submission sends
    // all three and expects one row back.
    const res = await post({
      first_name: "AUTOTEST",
      last_name: "Consents",
      email: emails.consents,
      phone: "+390000000009",
      city: "Varese",
      province: "VA",
      privacy_consents: [
        { consent_type: "privacy_policy", accepted: true, version: "1.0" },
        { consent_type: "newsletter", accepted: true, version: "1.0" },
        { consent_type: "marketing", accepted: true, version: "1.0" },
      ],
    });
    if (res.status === 429) return;
    expect(res.status).toBe(200);

    const rows = (
      await select(
        admin,
        "privacy_consent",
        `select=consent_type,channel,source&partner_id=eq.${res.body.partner_id}`,
      )
    ).rows;

    expect(rows.map((r: any) => r.consent_type)).toEqual(["privacy_policy"]);
    // Not a value the form chooses: this function *is* the web form, so the channel is
    // settled by construction. A form that could set it would be a form that could lie.
    expect(rows[0].channel).toBe("web");
    expect(rows[0].source).toBe("public_form");
  });

  test("every submission leaves an inbound_form row in the audit log", async () => {
    if (!serverUp) return;
    const rows = (
      await select(
        admin,
        "audit_log",
        `select=id,ip_address&log_type=eq.inbound_form&new_values_json->>email=eq.${emails.matched}`,
      )
    ).rows;
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });

  test("the response is CORS-open — deliberate while the endpoint is public", async () => {
    if (!serverUp) return;
    // Asserted on the POST, not the OPTIONS preflight: in dev, vite's own middleware
    // answers OPTIONS before our handler ever runs, so the preflight headers are vite's.
    const res = await fetch(`${APP_URL}/api/public/contact`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });

  test("dynamic responses carry X-Robots-Tag", async () => {
    if (!serverUp) return;
    const res = await fetch(`${APP_URL}/auth`);
    expect(res.headers.get("x-robots-tag")).toBeTruthy();
  });

  test("this suite really ran — or says so loudly", () => {
    // Guards the `if (!serverUp) return` pattern above. Without this, forgetting to start
    // the server produces seven green ticks that verified nothing at all.
    if (!serverUp) {
      expect(exercised).toBe(0);
      console.warn(
        `[public-form] SKIPPED — nothing on ${APP_URL}. These 7 tests verified nothing. Run: bun run dev`,
      );
      return;
    }
    expect(exercised).toBeGreaterThanOrEqual(4);
  });
});
