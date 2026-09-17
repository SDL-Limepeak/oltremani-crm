import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Explicit shape so callers get typed fields instead of implicit any (the Supabase
// select is untyped because of the nested rel). Every field must stay serializable —
// createServerFn rejects `unknown`, so no index signature here.
export type CategoryWithCounts = {
  id: string;
  name: string;
  parent_id: string | null;
  category_type: string;
  president_first_name: string | null;
  president_last_name: string | null;
  president_email: string | null;
  phone: string | null;
  mobile: string | null;
  activation_date: string | null;
  status: string;
  fiscal_code: string | null;
  address: string | null;
  city: string | null;
  province_code: string | null;
  iban: string | null;
  created_at: string;
  updated_at: string;
  activist: number;
  citizen: number;
  memberCount: number;
};

export const listCategories = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<CategoryWithCounts[]> => {
    const { data, error } = await (context.supabase as any)
      .from("res_partner_category")
      .select("*, res_partner_category_rel(res_partner(partner_type))")
      .order("name");
    if (error) throw error;

    return (data ?? []).map((cat: any) => {
      const rels: any[] = cat.res_partner_category_rel ?? [];
      let activist = 0, citizen = 0;
      for (const r of rels) {
        // PostgREST can return either a single object or an array depending on FK cardinality
        const partner = Array.isArray(r.res_partner) ? r.res_partner[0] : r.res_partner;
        const t = partner?.partner_type;
        if (t === "activist") activist++;
        else if (t === "citizen") citizen++;
      }
      const { res_partner_category_rel: _, ...rest } = cat;
      return { ...rest, activist, citizen, memberCount: rels.length };
    });
  });

const CatInput = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(120),
  parent_id: z.string().uuid().nullable().optional(),
  category_type: z.enum(["territorial", "system"]).default("territorial"),
  president_first_name: z.string().nullable().optional(),
  president_last_name: z.string().nullable().optional(),
  president_email: z.string().email().nullable().optional().or(z.literal("").transform(() => null)),
  phone: z.string().nullable().optional(),
  mobile: z.string().nullable().optional(),
  activation_date: z.string().nullable().optional(),
  status: z.enum(["active", "inactive"]).default("active"),
  fiscal_code: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  province_code: z.string().nullable().optional(),
  iban: z.string().nullable().optional(),
});

export const upsertCategory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => CatInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    let row;
    if (data.id) {
      const { data: old } = await supabase.from("res_partner_category").select("*").eq("id", data.id).maybeSingle();
      const { data: upd, error } = await supabase.from("res_partner_category").update(data).eq("id", data.id).select().single();
      if (error) throw error;
      row = upd;
      await supabase.from("audit_log").insert({
        log_type: "record_change", action: "update", model_name: "res_partner_category",
        record_id: row.id, old_values_json: old, new_values_json: row, changed_by_user_id: userId, source: "ui",
      });
    } else {
      // created_by is what lets a non-elevated user read the row back from
      // INSERT ... RETURNING: rpc_select would otherwise refuse a category that is not
      // yet in anybody's perimeter, and the whole insert would fail. See migration
      // 20260725180000.
      const { data: ins, error } = await supabase
        .from("res_partner_category")
        .insert({ ...data, created_by: userId })
        .select()
        .single();
      if (error) throw error;
      row = ins;
      await supabase.from("audit_log").insert({
        log_type: "record_change", action: "create", model_name: "res_partner_category",
        record_id: row.id, new_values_json: row, changed_by_user_id: userId, source: "ui",
      });
    }
    return row;
  });

/**
 * What deleting a group would disturb: how many contacts are in it, and how many groups
 * would be left without a parent.
 *
 * Asked before the confirmation dialog opens. The contact count is the one that decides
 * whether the delete is allowed at all — see deleteCategory.
 */
export const categoryDeletionImpact = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;

    const { data: rels } = await supabase
      .from("res_partner_category_rel")
      .select("partner_id, res_partner(display_name)")
      .eq("category_id", data.id);

    const { data: children } = await supabase
      .from("res_partner_category")
      .select("id, name")
      .eq("parent_id", data.id);

    const { data: users } = await supabase
      .from("res_user_category_rel")
      .select("user_id")
      .eq("category_id", data.id);

    return {
      contacts: (rels ?? []).length,
      // A few names make the dialog concrete without turning it into a list screen.
      sample: (rels ?? [])
        .map((r: any) => r.res_partner?.display_name)
        .filter(Boolean)
        .slice(0, 5) as string[],
      children: (children ?? []).map((c: any) => c.name as string),
      users: (users ?? []).length,
    };
  });

export const deleteCategory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        /** Where the members go. Required when the group has any; ignored when empty. */
        reassign_to_id: z.string().uuid().nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Read before deleting: the row is gone afterwards and this is the more
    // consequential half of the operation. Deleting a group cascades to
    // res_partner_category_rel, so every contact in it silently loses that assignment.
    const { data: old } = await supabase
      .from("res_partner_category")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();

    const { data: rels } = await supabase
      .from("res_partner_category_rel")
      .select("partner_id")
      .eq("category_id", data.id);
    const memberIds = (rels ?? []).map((r: any) => r.partner_id as string);

    // The rule the client asked for: a group with members cannot simply evaporate, the
    // members have to be told where to go. An empty group deletes with no question.
    if (memberIds.length && !data.reassign_to_id) {
      throw new Error(
        `Il gruppo ha ${memberIds.length} ${memberIds.length === 1 ? "contatto" : "contatti"}: scegli il gruppo in cui spostarli prima di eliminarlo.`,
      );
    }
    if (data.reassign_to_id === data.id) {
      throw new Error("Il gruppo di destinazione non può essere quello che stai eliminando");
    }

    let reassigned = 0;
    if (memberIds.length && data.reassign_to_id) {
      const { data: target } = await supabase
        .from("res_partner_category")
        .select("id, name")
        .eq("id", data.reassign_to_id)
        .maybeSingle();
      if (!target) throw new Error("Gruppo di destinazione non trovato");

      // Before the delete, not after: the cascade would already have removed the rows
      // that say who was in here. ON CONFLICT is not available through PostgREST, so
      // contacts already in the target are filtered out by hand — inserting a duplicate
      // would fail the whole batch on the composite primary key.
      const { data: already } = await supabase
        .from("res_partner_category_rel")
        .select("partner_id")
        .eq("category_id", data.reassign_to_id)
        .in("partner_id", memberIds);
      const have = new Set((already ?? []).map((r: any) => r.partner_id as string));
      const toInsert = memberIds.filter((id) => !have.has(id));

      if (toInsert.length) {
        const { error: insErr } = await supabase
          .from("res_partner_category_rel")
          .insert(toInsert.map((pid) => ({ partner_id: pid, category_id: data.reassign_to_id! })));
        if (insErr) throw insErr;
      }
      reassigned = memberIds.length;

      await supabase.from("audit_log").insert({
        log_type: "record_change", action: "update", model_name: "res_partner_category_rel",
        record_id: data.id,
        old_values_json: { category_id: data.id, partner_ids: memberIds },
        new_values_json: { moved_to: target.id, moved_to_name: target.name, count: reassigned },
        changed_by_user_id: userId, source: "ui",
      });
    }

    const { data: deleted, error } = await supabase
      .from("res_partner_category")
      .delete()
      .eq("id", data.id)
      .select();
    if (error) throw error;
    // RLS can filter the DELETE down to zero rows and still answer success, so an
    // empty result means "not allowed", not "already gone".
    if (!deleted?.length) throw new Error("Gruppo non eliminato: non autorizzato o inesistente");

    await supabase.from("audit_log").insert({
      log_type: "record_change", action: "delete", model_name: "res_partner_category",
      record_id: data.id, old_values_json: old,
      new_values_json: { reassigned_to: data.reassign_to_id ?? null, contacts_moved: reassigned },
      changed_by_user_id: userId, source: "ui",
    });
    return { ok: true, reassigned };
  });
