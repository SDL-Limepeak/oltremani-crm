import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { APP_URL, TEST_TAG } from "./helpers/env";
import {
  count,
  didAffectRows,
  insert,
  login,
  remove,
  rpc,
  select,
  update,
  wasDenied,
  type Session,
} from "./helpers/pgrest";
import { callServerFn, failedWith, serverUp } from "./helpers/serverfn";

/**
 * The 2026-10-04 round, walked profile by profile.
 *
 * Who may issue a card and what number it gets, who may edit a group's prefix, who sees the
 * warning data, who can assign the new role, and the path a contact takes from the public
 * form to a card — as admin, superuser (Dario's profile), coordinator, volunteer and a
 * volunteer with no group at all.
 *
 * Everything is drawn from a throwaway group (`ZQA`) so the real groups' counters are never
 * touched, and everything it creates is deleted at the end.
 */

// The first call into each server-function module makes the dev server compile it, which
// can take longer than bun's 5 s default; the warm-up below pays that once.
setDefaultTimeout(30_000);

let admin: Session, superuser: Session, coordinator: Session, volunteer: Session, noscope: Session;
let up = false;
let groupId: string;
const stamp = Date.now();
const created = { partners: [] as string[], categories: [] as string[] };
const PREFIX = "ZQA";

const ALL = () => [admin, superuser, coordinator, volunteer, noscope] as const;
const CAN_ISSUE = () => [admin, superuser, coordinator] as const;
const CANNOT_ISSUE = () => [volunteer, noscope] as const;

beforeAll(async () => {
  [admin, superuser, coordinator, volunteer, noscope] = await Promise.all([
    login("admin"), login("superuser"), login("coordinator"), login("volunteer"), login("noscope"),
  ]);
  up = await serverUp();
  if (!up) console.warn(`[cards-by-profile] no server on ${APP_URL} — server-function tests skipped.`);
  if (up) {
    for (const [mod, fn, method] of [["subscriptions", "membershipNumberUsage", "GET"], ["partners", "listPartnerRoles", "GET"]] as const) {
      await callServerFn(admin, `src/lib/${mod}.functions.ts`, fn, {}, method);
    }
    for (const [mod, fn] of [["subscriptions", "previewMembershipNumber"], ["categories", "upsertCategory"], ["partners", "validatePartner"]] as const) {
      await callServerFn(admin, `src/lib/${mod}.functions.ts`, fn, {}).catch(() => undefined);
    }
  }

  const g = await insert(admin, "res_partner_category", {
    name: `${TEST_TAG}-cards-${stamp}`,
    category_type: "territorial",
    status: "active",
    card_prefix: PREFIX,
  });
  groupId = g.rows[0].id;
  created.categories.push(groupId);
});

afterAll(async () => {
  for (const id of created.partners) await remove(admin, "res_partner", `id=eq.${id}`);
  await remove(admin, "res_partner", "email=like.autotest-cp-%");
  for (const id of created.categories) await remove(admin, "res_partner_category", `id=eq.${id}`);
  await remove(admin, "res_partner_category", `name=like.${TEST_TAG}-cards-%`);
  await remove(admin, "res_partner_category", `name=like.${TEST_TAG}-cardsx-%`);
});

let seq = 0;
async function contact(inGroup = true): Promise<string> {
  const res = await insert(admin, "res_partner", {
    first_name: TEST_TAG,
    last_name: `cp-${++seq}`,
    email: `autotest-cp-${seq}-${stamp}@oltremani.test`,
  });
  const id = res.rows[0].id as string;
  created.partners.push(id);
  if (inGroup) await insert(admin, "res_partner_category_rel", { partner_id: id, category_id: groupId });
  return id;
}

const numberOf = (res: { rows: any[] }) => res.rows[0]?.membership_number as string;
const n = (num: string) => parseInt(num.slice(3), 10);

describe("issuing a card without a number — straight to the table", () => {
  const issued: Record<string, string> = {};

  test("admin, superuser and coordinator get the next number of the group", async () => {
    let last = 0;
    for (const s of CAN_ISSUE()) {
      const p = await contact();
      const res = await insert(s, "membership_subscription", { partner_id: p, year: 2061, status: "active" });
      expect(didAffectRows(res)).toBe(true);
      const num = numberOf(res);
      expect(num).toMatch(new RegExp(`^${PREFIX}\\d{4}$`));
      expect(n(num)).toBeGreaterThan(last); // strictly increasing across profiles
      last = n(num);
      issued[s.role] = num;
    }
    expect(new Set(Object.values(issued)).size).toBe(3);
  });

  test("a volunteer, with or without a group, cannot issue one", async () => {
    for (const s of CANNOT_ISSUE()) {
      const p = await contact();
      const res = await insert(s, "membership_subscription", { partner_id: p, year: 2062, status: "active" });
      expect(didAffectRows(res)).toBe(false);
    }
  });

  test("a hand-typed number higher than the counter moves the counter on, for every issuer", async () => {
    const hi = await insert(admin, "membership_subscription", {
      partner_id: await contact(), year: 2063, status: "revoked", membership_number: `${PREFIX}0200`,
    });
    expect(didAffectRows(hi)).toBe(true);
    for (const [i, s] of [...CAN_ISSUE()].entries()) {
      const res = await insert(s, "membership_subscription", { partner_id: await contact(), year: 2064, status: "active" });
      expect(numberOf(res)).toBe(`${PREFIX}${String(201 + i).padStart(4, "0")}`);
    }
  });

  test("a contact with no group gets a readable refusal, from every issuer", async () => {
    for (const s of CAN_ISSUE()) {
      const p = await contact(false);
      const res = await insert(s, "membership_subscription", { partner_id: p, year: 2065, status: "active" });
      expect(didAffectRows(res)).toBe(false);
      expect(JSON.stringify(res.body)).toContain("gruppo con sigla");
    }
  });

  test("a contact in two groups that both have a prefix is refused and told to type it", async () => {
    const other = await insert(admin, "res_partner_category", {
      name: `${TEST_TAG}-cardsx-${stamp}`, category_type: "territorial", status: "active", card_prefix: "ZQB",
    });
    created.categories.push(other.rows[0].id);
    const p = await contact();
    await insert(admin, "res_partner_category_rel", { partner_id: p, category_id: other.rows[0].id });

    const res = await insert(admin, "membership_subscription", { partner_id: p, year: 2066, status: "active" });
    expect(didAffectRows(res)).toBe(false);
    expect(JSON.stringify(res.body)).toContain("più gruppi");
    // Typing the number is the way out, and it works.
    const typed = await insert(admin, "membership_subscription", {
      partner_id: p, year: 2066, status: "active", membership_number: `TYPED-${stamp}`,
    });
    expect(didAffectRows(typed)).toBe(true);
  });
});

describe("issuing a card through the app (server function)", () => {
  test("every issuer gets a group number; a volunteer is refused", async () => {
    if (!up) return;
    for (const s of CAN_ISSUE()) {
      const p = await contact();
      const res = await callServerFn(s, "src/lib/subscriptions.functions.ts", "upsertSubscription", { partner_id: p, year: 2067 });
      expect(res.denied).toBe(false);
      expect(res.text).toMatch(new RegExp(`${PREFIX}\\d{4}`));
    }
    for (const s of CANNOT_ISSUE()) {
      const p = await contact();
      const res = await callServerFn(s, "src/lib/subscriptions.functions.ts", "upsertSubscription", { partner_id: p, year: 2068 });
      expect(res.denied).toBe(true);
      expect((await select(admin, "membership_subscription", `select=id&partner_id=eq.${p}`)).rows).toHaveLength(0);
    }
  });

  test("a contact with no group surfaces the sentence the dialog shows", async () => {
    if (!up) return;
    const p = await contact(false);
    const res = await callServerFn(superuser, "src/lib/subscriptions.functions.ts", "upsertSubscription", { partner_id: p, year: 2069 });
    expect(failedWith(res, "gruppo con sigla")).toBe(true);
  });
});

describe("the preview in the issue dialog", () => {
  test("every signed-in profile gets the next number; anon is refused", async () => {
    const p = await contact();
    for (const s of ALL()) {
      const res = await rpc(s, "preview_membership_number", { p_partner: p });
      expect(res.status).toBe(200);
      expect(res.body.number).toMatch(new RegExp(`^${PREFIX}\\d{4,}$`));
      expect(res.body.error).toBeNull();
    }
    expect((await rpc(null, "preview_membership_number", { p_partner: p })).status).toBeGreaterThanOrEqual(400);
  });

  test("it never writes: asking twice gives the same number", async () => {
    const p = await contact();
    const a = await rpc(admin, "preview_membership_number", { p_partner: p });
    const b = await rpc(coordinator, "preview_membership_number", { p_partner: p });
    expect(a.body.number).toBe(b.body.number);
  });

  test("for a contact with no group it carries the reason instead of a number", async () => {
    const p = await contact(false);
    const res = await rpc(admin, "preview_membership_number", { p_partner: p });
    expect(res.body.number).toBeNull();
    expect(res.body.error).toContain("gruppo con sigla");
  });

  test("it reports how many active cards the contact already has this year", async () => {
    const p = await contact();
    const year = new Date().getFullYear();
    await insert(admin, "membership_subscription", { partner_id: p, year, status: "active" });
    await insert(admin, "membership_subscription", { partner_id: p, year, status: "active" });
    await insert(admin, "membership_subscription", { partner_id: p, year, status: "revoked" });
    const res = await rpc(volunteer, "preview_membership_number", { p_partner: p });
    expect(res.body.active_this_year).toBe(2); // revoked does not count
  });
});

describe("group prefixes — who may see and change them", () => {
  test("everybody reads every group's prefix — groups are open since 2026-10-04", async () => {
    for (const s of ALL()) {
      expect((await select(s, "res_partner_category", `select=card_prefix&id=eq.${FIXTURES_VARESE}`)).rows[0]?.card_prefix).toBe("VAR");
      expect((await select(s, "res_partner_category", `select=card_prefix&id=eq.${groupId}`)).rows[0]?.card_prefix).toBe(PREFIX);
    }
  });

  test("an account that was switched off sees no groups and no contacts", async () => {
    // current_role_name() is NULL for a non-active user, and rpc_select keys off it.
    const uid = noscope.userId;
    try {
      expect(didAffectRows(await update(admin, "res_users", `id=eq.${uid}`, { status: "inactive" }))).toBe(true);
      expect(await count(noscope, "res_partner_category")).toBe(0);
      expect(await count(noscope, "res_partner")).toBe(0);
    } finally {
      await update(admin, "res_users", `id=eq.${uid}`, { status: "active" });
    }
    expect(await count(noscope, "res_partner_category")).toBeGreaterThan(0);
  });

  test("an anonymous caller reads no group", async () => {
    const res = await select(null, "res_partner_category", "select=id");
    expect(res.rows).toHaveLength(0);
  });

  test("a volunteer cannot change a prefix; admin and superuser can", async () => {
    expect(didAffectRows(await update(volunteer, "res_partner_category", `id=eq.${groupId}`, { card_prefix: "ZQC" }))).toBe(false);
    expect(didAffectRows(await update(admin, "res_partner_category", `id=eq.${groupId}`, { card_prefix: "ZQC" }))).toBe(true);
    expect(didAffectRows(await update(superuser, "res_partner_category", `id=eq.${groupId}`, { card_prefix: PREFIX }))).toBe(true);
  });

  test("a coordinator cannot reach a group outside their perimeter, prefix included", async () => {
    const res = await update(coordinator, "res_partner_category", `id=eq.${groupId}`, { card_prefix: "ZQD" });
    expect(didAffectRows(res)).toBe(false);
    expect((await select(admin, "res_partner_category", `select=card_prefix&id=eq.${groupId}`)).rows[0].card_prefix).toBe(PREFIX);
  });

  test("changing the prefix changes the next number, and leaves cards already issued alone", async () => {
    const before = await insert(admin, "membership_subscription", { partner_id: await contact(), year: 2070, status: "active" });
    expect(numberOf(before)).toMatch(new RegExp(`^${PREFIX}`));
    await update(admin, "res_partner_category", `id=eq.${groupId}`, { card_prefix: "ZQE" });
    const after = await insert(admin, "membership_subscription", { partner_id: await contact(), year: 2070, status: "active" });
    expect(numberOf(after)).toBe("ZQE0001"); // a new prefix starts a new sequence
    expect((await select(admin, "membership_subscription", `select=membership_number&id=eq.${before.rows[0].id}`)).rows[0].membership_number)
      .toBe(numberOf(before));
    await update(admin, "res_partner_category", `id=eq.${groupId}`, { card_prefix: PREFIX });
  });

  test("two groups cannot share a prefix, and the shape is enforced by the database", async () => {
    expect(didAffectRows(await update(admin, "res_partner_category", `id=eq.${groupId}`, { card_prefix: "VAR" }))).toBe(false);
    for (const bad of ["zq", "ZQAB", "Z1A", "zqa"]) {
      expect(didAffectRows(await update(admin, "res_partner_category", `id=eq.${groupId}`, { card_prefix: bad }))).toBe(false);
    }
    expect((await select(admin, "res_partner_category", `select=card_prefix&id=eq.${groupId}`)).rows[0].card_prefix).toBe(PREFIX);
  });

  test("through the app: lowercase is capitalised, a clash says which prefix, junk is refused", async () => {
    if (!up) return;
    const make = (card_prefix: string) =>
      callServerFn(admin, "src/lib/categories.functions.ts", "upsertCategory", {
        id: groupId, name: `${TEST_TAG}-cards-${stamp}`, category_type: "territorial", status: "active", card_prefix,
      });

    expect(failedWith(await make("VAR"), "già usata")).toBe(true);
    expect((await make("zz")).denied).toBe(true);
    expect((await make("ZQAB")).denied).toBe(true);

    expect((await make("zqf")).denied).toBe(false);
    expect((await select(admin, "res_partner_category", `select=card_prefix&id=eq.${groupId}`)).rows[0].card_prefix).toBe("ZQF");
    expect((await make("")).denied).toBe(false); // empty means "no prefix"
    expect((await select(admin, "res_partner_category", `select=card_prefix&id=eq.${groupId}`)).rows[0].card_prefix).toBeNull();
    expect((await make(PREFIX)).denied).toBe(false);
  });

  test("a volunteer cannot do it through the app either", async () => {
    if (!up) return;
    const res = await callServerFn(volunteer, "src/lib/categories.functions.ts", "upsertCategory", {
      id: groupId, name: `${TEST_TAG}-cards-${stamp}`, category_type: "territorial", status: "active", card_prefix: "ZQG",
    });
    expect(res.denied).toBe(true);
    expect((await select(admin, "res_partner_category", `select=card_prefix&id=eq.${groupId}`)).rows[0].card_prefix).toBe(PREFIX);
  });
});

describe("the warnings — what every profile is shown", () => {
  test("a number on two cards, one of them revoked, is reported as duplicated to everybody", async () => {
    if (!up) return;
    const num = `DUP-${stamp}`;
    await insert(admin, "membership_subscription", { partner_id: await contact(), year: 2071, status: "revoked", membership_number: num });
    await insert(admin, "membership_subscription", { partner_id: await contact(), year: 2072, status: "active", membership_number: num });
    for (const s of ALL()) {
      const res = await callServerFn(s, "src/lib/subscriptions.functions.ts", "membershipNumberUsage", {}, "GET");
      expect(res.denied).toBe(false);
      expect(res.text).toContain(num);
    }
  });

  test("the contacts list carries the card numbers for every profile", async () => {
    if (!up) return;
    const p = await contact();
    const year = new Date().getFullYear();
    const num = `LIST-${stamp}`;
    await insert(admin, "membership_subscription", { partner_id: p, year, status: "active", membership_number: num });
    for (const s of ALL()) {
      const res = await callServerFn(s, "src/lib/partners.functions.ts", "listPartners", { search: `cp-${seq}`, limit: 50 });
      expect(res.denied).toBe(false);
      expect(res.text).toContain(num);
    }
  });

  test("two active cards in one year show up as two numbers on the same contact", async () => {
    if (!up) return;
    const p = await contact();
    const year = new Date().getFullYear();
    await insert(admin, "membership_subscription", { partner_id: p, year, status: "active", membership_number: `TWOA-${stamp}` });
    await insert(admin, "membership_subscription", { partner_id: p, year, status: "active", membership_number: `TWOB-${stamp}` });
    const res = await callServerFn(coordinator, "src/lib/partners.functions.ts", "listPartners", { search: `cp-${seq}`, limit: 50 });
    expect(res.text).toContain(`TWOA-${stamp}`);
    expect(res.text).toContain(`TWOB-${stamp}`);
  });
});

describe("roles — the new picklist as each profile uses it", () => {
  test("everybody who can edit a contact can give it Cerco supporto, and nobody can edit the picklist", async () => {
    const role = (await select(admin, "res_partner_role", "select=id&code=eq.cerco_supporto")).rows[0].id;
    for (const s of ALL()) {
      const p = await contact();
      const res = await insert(s, "res_partner_role_rel", { partner_id: p, role_id: role });
      expect(didAffectRows(res)).toBe(true);
    }
    for (const s of [coordinator, volunteer, noscope]) {
      expect(didAffectRows(await update(s, "res_partner_role", "code=eq.cerco_supporto", { name: "hacked" }))).toBe(false);
    }
    expect((await select(admin, "res_partner_role", "select=name&code=eq.cerco_supporto")).rows[0].name).toBe("Cerco supporto e/o ospitalità");
  });

  test("the retired role is still readable, so the contact that holds it keeps showing it", async () => {
    for (const s of ALL()) {
      const res = await select(s, "res_partner_role", "select=status&code=eq.membro_comunita");
      expect(res.rows[0]?.status).toBe("inactive");
    }
  });

  test("the picklist offered to the app is the active ones only, in the client's order", async () => {
    if (!up) return;
    for (const s of ALL()) {
      const res = await callServerFn(s, "src/lib/partners.functions.ts", "listPartnerRoles", {}, "GET");
      expect(res.denied).toBe(false);
      const order = ["cerco_supporto", "attivista", "famiglia_ospitante", "specialista_diritti", "socio_aps"]
        .map((c) => res.text.indexOf(c));
      expect(order.every((i) => i >= 0)).toBe(true);
      expect([...order].sort((a, b) => a - b)).toEqual(order);
      expect(res.text).not.toContain("membro_comunita");
    }
  });
});

describe("from the public form to a card, seen by the people who work the queue", () => {
  const FORM = `${APP_URL}/api/public/contact`;
  async function submit(body: Record<string, unknown>) {
    const res = await fetch(FORM, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return { status: res.status, body: await res.json().catch(() => null) };
  }

  test("a Sì with a number: the card is there, active, and each profile reads the same contact", async () => {
    if (!up) return;
    const email = `autotest-cp-form-${stamp}@oltremani.test`;
    const num = `FORM-${stamp}`;
    const res = await submit({
      first_name: "AUTOTEST", last_name: "FormFlow", email, phone: "+390000040",
      city: "Siena", province: "SI", role_codes: ["cerco_supporto", "attivista"], is_member: true, membership_number: num,
    });
    if (res.status === 429) return;
    expect(res.body.membership_status).toBe("created");

    for (const s of ALL()) {
      const r = await select(
        s, "res_partner",
        `select=id,res_partner_role_rel(res_partner_role(code)),res_partner_category_rel(res_partner_category(name)),membership_subscription(membership_number,status)&email=eq.${email}`,
      );
      expect(r.rows).toHaveLength(1);
      const row = r.rows[0];
      expect(row.res_partner_role_rel.map((x: any) => x.res_partner_role.code).sort())
        .toEqual(["attivista", "cerco_supporto", "socio_aps"]);
      // Group names come back for every profile, including the ones whose old perimeter
      // did not contain them (it used to be blank for a Varese coordinator).
      expect(row.res_partner_category_rel.map((x: any) => x.res_partner_category.name).sort()).toEqual(["Siena", "Validation"]);
      expect(row.membership_subscription).toEqual([{ membership_number: num, status: "active" }]);
    }
  });

  test("Validation is cleared by whoever triages it, and the next card then uses the group's prefix", async () => {
    if (!up) return;
    // City SI belongs to the Siena group since 2026-10-04.
    const siCity = (await select(admin, "res_city", "select=id&province_code=eq.SI")).rows[0].id;
    for (const s of [admin, superuser, coordinator, volunteer]) {
      const email = `autotest-cp-triage-${s.role}-${stamp}@oltremani.test`;
      const sub = await submit({
        first_name: "AUTOTEST", last_name: `Triage${s.role}`, email, phone: "+390000041",
        city: "Nowhereville", province: "ZZ", is_member: false,
      });
      if (sub.status === 429) return;
      expect(sub.body.validation).toBe(true);

      const v = await callServerFn(s, "src/lib/partners.functions.ts", "validatePartner", { partner_id: sub.body.partner_id, city_id: siCity });
      expect(v.denied).toBe(false);
      const groups = (await select(admin, "res_partner_category_rel", `select=res_partner_category(name)&partner_id=eq.${sub.body.partner_id}`)).rows
        .map((r: any) => r.res_partner_category.name);
      expect({ by: s.role, groups }).toEqual({ by: s.role, groups: ["Siena"] });

      const preview = await rpc(s, "preview_membership_number", { p_partner: sub.body.partner_id });
      expect(preview.body.number).toMatch(/^SIE\d{4}$/);
    }
  });

  test("a Sì with a number already held by a namesake merges into them; nobody else is created", async () => {
    if (!up) return;
    const num = `NAMESAKE-${stamp}`;
    const holder = await insert(admin, "res_partner", { first_name: "AUTOTEST", last_name: `Namesake${stamp}`, email: `autotest-cp-ns-${stamp}@oltremani.test` });
    created.partners.push(holder.rows[0].id);
    await insert(admin, "membership_subscription", { partner_id: holder.rows[0].id, year: 2026, status: "active", membership_number: num });

    const res = await submit({
      first_name: "AUTOTEST", last_name: `Namesake${stamp}`, email: `autotest-cp-ns-new-${stamp}@oltremani.test`, phone: "+390000042",
      city: "Varese", province: "VA", is_member: true, membership_number: num,
    });
    if (res.status === 429) return;
    expect(res.body.membership_status).toBe("reconciled");
    expect(res.body.partner_id).toBe(holder.rows[0].id);
    expect(await count(admin, "res_partner", `email=eq.autotest-cp-ns-new-${stamp}@oltremani.test`)).toBe(0);
    const notes = (await select(admin, "res_partner", `select=notes&id=eq.${holder.rows[0].id}`)).rows[0].notes as string;
    expect(notes).toContain("riconciliato per nome");
    expect(notes).toContain("autotest-cp-ns-new"); // the new address is kept where somebody can see it
  });

  test("a Dario-style review: revoke the form's card, the number stays taken, a re-issue only warns", async () => {
    if (!up) return;
    const email = `autotest-cp-rev-${stamp}@oltremani.test`;
    const num = `REV-${stamp}`;
    const res = await submit({
      first_name: "AUTOTEST", last_name: "Revoke", email, phone: "+390000043",
      city: "Varese", province: "VA", is_member: true, membership_number: num,
    });
    if (res.status === 429) return;
    const pid = res.body.partner_id as string;
    const card = (await select(admin, "membership_subscription", `select=id&membership_number=eq.${num}`)).rows[0].id;

    const rev = await callServerFn(superuser, "src/lib/subscriptions.functions.ts", "revokeSubscription", { id: card, partner_id: pid });
    expect(rev.denied).toBe(false);

    const again = await callServerFn(superuser, "src/lib/subscriptions.functions.ts", "upsertSubscription", {
      partner_id: pid, membership_number: num, year: new Date().getFullYear(),
    });
    expect(again.denied).toBe(false); // warned, not refused
    const usage = await callServerFn(superuser, "src/lib/subscriptions.functions.ts", "membershipNumberUsage", {}, "GET");
    expect(usage.text).toContain(num);
  });
});

describe("what a profile without issuing rights still gets right", () => {
  test("a volunteer cannot reach the number generator or the nightly job directly", async () => {
    for (const s of [volunteer, noscope]) {
      expect((await rpc(s, "generate_membership_number", { p_partner: await contact() })).status).toBeGreaterThanOrEqual(400);
      expect((await rpc(s, "expire_memberships", {})).status).toBeGreaterThanOrEqual(400);
    }
  });
});

const FIXTURES_VARESE = "31e3f71f-9f96-4383-b772-dbc1d6df52ad";
