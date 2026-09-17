import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { didAffectRows, insert, login, remove, select, type Session } from "./helpers/pgrest";
import { callServerFn, failedWith, serverUp } from "./helpers/serverfn";
import { TEST_TAG } from "./helpers/env";

/**
 * Rules that live in server functions and nowhere else.
 *
 * RLS has no opinion about any of these: whether a group may be deleted while it still has
 * members, who may pull a CSV, whether making a contact inactive should drag its cards with
 * it. The database would happily do all three. `helpers/serverfn.ts` explains why both
 * boundaries are tested rather than one.
 *
 * Needs a dev server; skips itself, loudly, when there is none.
 */

let admin: Session, superuser: Session, coordinator: Session, volunteer: Session;
let up = false;
const stamp = Date.now();
const created = { partners: [] as string[], categories: [] as string[] };

beforeAll(async () => {
  [admin, superuser, coordinator, volunteer] = await Promise.all([
    login("admin"), login("superuser"), login("coordinator"), login("volunteer"),
  ]);
  up = await serverUp();
  if (!up) console.log("[server-functions] no server on :8080 — skipping. Start it with: bun run dev");
});

afterAll(async () => {
  for (const id of created.partners) await remove(admin, "res_partner", `id=eq.${id}`);
  for (const id of created.categories) await remove(admin, "res_partner_category", `id=eq.${id}`);
  await remove(admin, "res_partner", "email=like.autotest-sfn-%");
  await remove(admin, "res_partner_category", `name=like.${TEST_TAG}-sfn-%`);
  if (!up) console.log("[server-functions] SKIPPED — nothing on :8080. These tests verified nothing.");
});

async function makeGroup(name: string): Promise<string> {
  const res = await insert(admin, "res_partner_category", {
    name: `${TEST_TAG}-sfn-${name}-${stamp}`,
    category_type: "territorial",
    status: "active",
  });
  const id = res.rows[0].id as string;
  created.categories.push(id);
  return id;
}

async function makeContact(suffix: string, categoryId?: string): Promise<string> {
  const res = await insert(admin, "res_partner", {
    first_name: TEST_TAG,
    last_name: `sfn-${suffix}`,
    email: `autotest-sfn-${suffix}-${stamp}@oltremani.test`,
  });
  const id = res.rows[0].id as string;
  created.partners.push(id);
  if (categoryId) {
    await insert(admin, "res_partner_category_rel", { partner_id: id, category_id: categoryId });
  }
  return id;
}

describe("deleting a group decides where its members go", () => {
  test("a group with members is refused when no destination is given", async () => {
    if (!up) return;
    const groupId = await makeGroup("full");
    await makeContact("member", groupId);

    const res = await callServerFn(admin, "src/lib/categories.functions.ts", "deleteCategory", {
      id: groupId,
    });
    expect(failedWith(res, "scegli il gruppo")).toBe(true);

    // And it is still there — the refusal has to happen before the delete, not after.
    const still = await select(admin, "res_partner_category", `select=id&id=eq.${groupId}`);
    expect(still.rows).toHaveLength(1);
  });

  test("with a destination, the members move and then the group goes", async () => {
    if (!up) return;
    const fromId = await makeGroup("from");
    const toId = await makeGroup("to");
    const contactId = await makeContact("moved", fromId);

    const res = await callServerFn(admin, "src/lib/categories.functions.ts", "deleteCategory", {
      id: fromId,
      reassign_to_id: toId,
    });
    expect(res.denied).toBe(false);

    const gone = await select(admin, "res_partner_category", `select=id&id=eq.${fromId}`);
    expect(gone.rows).toHaveLength(0);

    // The contact is in the destination. If the reassignment had run after the delete,
    // the cascade would have removed the link first and this would be empty.
    const rels = await select(
      admin,
      "res_partner_category_rel",
      `select=category_id&partner_id=eq.${contactId}`,
    );
    expect(rels.rows.map((r: any) => r.category_id)).toContain(toId);
  });

  test("a contact already in the destination is not inserted twice", async () => {
    if (!up) return;
    // The composite primary key would reject the whole batch, taking the other members
    // with it. Someone in both groups is ordinary, not a corner case.
    const fromId = await makeGroup("dup-from");
    const toId = await makeGroup("dup-to");
    const bothId = await makeContact("in-both", fromId);
    await insert(admin, "res_partner_category_rel", { partner_id: bothId, category_id: toId });
    const onlyFromId = await makeContact("only-from", fromId);

    const res = await callServerFn(admin, "src/lib/categories.functions.ts", "deleteCategory", {
      id: fromId,
      reassign_to_id: toId,
    });
    expect(res.denied).toBe(false);

    for (const id of [bothId, onlyFromId]) {
      const rels = await select(
        admin,
        "res_partner_category_rel",
        `select=category_id&partner_id=eq.${id}&category_id=eq.${toId}`,
      );
      expect(rels.rows).toHaveLength(1);
    }
  });

  test("an empty group deletes with no question asked", async () => {
    if (!up) return;
    const groupId = await makeGroup("empty");
    const res = await callServerFn(admin, "src/lib/categories.functions.ts", "deleteCategory", {
      id: groupId,
    });
    expect(res.denied).toBe(false);
    const gone = await select(admin, "res_partner_category", `select=id&id=eq.${groupId}`);
    expect(gone.rows).toHaveLength(0);
  });

  test("the destination cannot be the group being deleted", async () => {
    if (!up) return;
    const groupId = await makeGroup("self");
    await makeContact("self-member", groupId);
    const res = await callServerFn(admin, "src/lib/categories.functions.ts", "deleteCategory", {
      id: groupId,
      reassign_to_id: groupId,
    });
    expect(res.denied).toBe(true);
  });
});

describe("the CSV export", () => {
  test("admin, superuser and coordinator get a file; a volunteer does not", async () => {
    if (!up) return;
    for (const s of [admin, superuser, coordinator]) {
      const res = await callServerFn(s, "src/lib/exports.functions.ts", "exportContacts", {});
      expect(res.denied).toBe(false);
      expect(res.text).toContain("id,nome,cognome");
    }
    const denied = await callServerFn(volunteer, "src/lib/exports.functions.ts", "exportContacts", {});
    expect(failedWith(denied, "Non autorizzato")).toBe(true);
  });

  test("the file carries every column, not the subset the table shows", async () => {
    if (!up) return;
    const res = await callServerFn(admin, "src/lib/exports.functions.ts", "exportContacts", {});
    for (const col of ["ruoli", "tesserato", "numero_tessera", "anno_tessera", "note", "aggiornato_il"]) {
      expect(res.text).toContain(col);
    }
  });
});

describe("deleting a contact", () => {
  test("a coordinator cannot, a superuser can", async () => {
    if (!up) return;
    const id = await makeContact("deletable");

    const refused = await callServerFn(coordinator, "src/lib/partners.functions.ts", "deletePartner", { id });
    expect(failedWith(refused, "Solo admin o superuser")).toBe(true);
    expect((await select(admin, "res_partner", `select=id&id=eq.${id}`)).rows).toHaveLength(1);

    const ok = await callServerFn(superuser, "src/lib/partners.functions.ts", "deletePartner", { id });
    expect(ok.denied).toBe(false);
    expect((await select(admin, "res_partner", `select=id&id=eq.${id}`)).rows).toHaveLength(0);
    created.partners = created.partners.filter((x) => x !== id);
  });

  test("the impact report counts the children that would go with it", async () => {
    if (!up) return;
    const id = await makeContact("impact");
    await insert(admin, "membership_subscription", {
      partner_id: id, year: 2047, status: "active", membership_number: `IMP-${stamp}`,
    });

    const res = await callServerFn(admin, "src/lib/partners.functions.ts", "partnerDeletionImpact", { id });
    expect(res.denied).toBe(false);
    expect(res.text).toContain(`IMP-${stamp}`);
  });
});

describe("a contact going inactive takes its cards with it", () => {
  test("active cards become inactive on the transition", async () => {
    if (!up) return;
    const id = await makeContact("inactive-cascade");
    const card = await insert(admin, "membership_subscription", {
      partner_id: id, year: 2048, status: "active", membership_number: `CASC-${stamp}`,
    });
    expect(didAffectRows(card)).toBe(true);

    const res = await callServerFn(admin, "src/lib/partners.functions.ts", "upsertPartner", {
      id,
      status: "old",
    });
    expect(res.denied).toBe(false);

    const after = await select(
      admin, "membership_subscription", `select=status&id=eq.${card.rows[0].id}`,
    );
    expect(after.rows[0].status).toBe("inactive");
  });

  test("saving an already-inactive contact does not touch a card reactivated since", async () => {
    if (!up) return;
    // The reason the cascade keys off the transition and not the state: someone puts a
    // card back on purpose, then edits the contact's phone number. That edit must not
    // silently undo them.
    const id = await makeContact("inactive-again");
    await callServerFn(admin, "src/lib/partners.functions.ts", "upsertPartner", { id, status: "old" });

    const card = await insert(admin, "membership_subscription", {
      partner_id: id, year: 2049, status: "active", membership_number: `KEEP-${stamp}`,
    });

    await callServerFn(admin, "src/lib/partners.functions.ts", "upsertPartner", {
      id, status: "old", phone: "+390000099",
    });

    const after = await select(
      admin, "membership_subscription", `select=status&id=eq.${card.rows[0].id}`,
    );
    expect(after.rows[0].status).toBe("active");
  });
});
