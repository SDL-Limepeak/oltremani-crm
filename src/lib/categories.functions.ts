import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const listCategories = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("res_partner_category")
      .select("*")
      .order("name");
    if (error) throw error;
    return data ?? [];
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
      const { data: ins, error } = await supabase.from("res_partner_category").insert(data).select().single();
      if (error) throw error;
      row = ins;
      await supabase.from("audit_log").insert({
        log_type: "record_change", action: "create", model_name: "res_partner_category",
        record_id: row.id, new_values_json: row, changed_by_user_id: userId, source: "ui",
      });
    }
    return row;
  });

export const deleteCategory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("res_partner_category").delete().eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });
