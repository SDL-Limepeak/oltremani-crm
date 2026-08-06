import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const searchCities = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ q: z.string().optional(), province_code: z.string().optional(), limit: z.number().int().max(200).default(50) }).default({}).parse(d ?? {}))
  .handler(async ({ data, context }) => {
    let q = context.supabase
      .from("res_city")
      .select("id, name, province, province_code, region, category_id, res_partner_category(id, name)")
      .order("name")
      .limit(data.limit);
    if (data.q) q = q.ilike("name", `%${data.q}%`);
    if (data.province_code) q = q.eq("province_code", data.province_code);
    const { data: rows, error } = await q;
    if (error) throw error;
    return rows ?? [];
  });

/**
 * Every write below goes through supabaseAdmin, which bypasses RLS — so the role
 * check in each handler is the only thing enforcing authorization, and the audit
 * row is the only record that it happened.
 */
async function auditCity(
  supabase: any,
  userId: string,
  action: "create" | "update" | "delete",
  cityId: string | null,
  old: unknown,
  next: unknown,
) {
  await supabase.from("audit_log").insert({
    log_type: "record_change",
    action,
    model_name: "res_city",
    record_id: cityId,
    old_values_json: old ?? null,
    new_values_json: next ?? null,
    changed_by_user_id: userId,
    source: "ui",
  });
}

export const setCityCategory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ city_id: z.string().uuid(), category_id: z.string().uuid().nullable() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: caller } = await supabase.from("res_users").select("role").eq("id", userId).maybeSingle();
    if (!caller || !["admin", "superuser"].includes(caller.role)) throw new Error("Non autorizzato");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: old } = await supabaseAdmin.from("res_city").select("id, name, category_id").eq("id", data.city_id).maybeSingle();
    const { error } = await supabaseAdmin.from("res_city").update({ category_id: data.category_id }).eq("id", data.city_id);
    if (error) throw error;
    // Re-pointing a city changes which group future public-form submissions land in.
    await auditCity(supabase, userId, "update", data.city_id, old, { category_id: data.category_id });
    return { ok: true };
  });

export const upsertCity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      id: z.string().uuid().optional(),
      name: z.string().min(1).max(150),
      province_code: z.string().max(5).nullable().optional(),
      province: z.string().nullable().optional(),
      region: z.string().nullable().optional(),
    }).parse(d)
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: caller } = await supabase.from("res_users").select("role").eq("id", userId).maybeSingle();
    if (!caller || !["admin", "superuser"].includes(caller.role)) throw new Error("Non autorizzato");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { id, ...rest } = data;
    if (id) {
      const { data: old } = await supabaseAdmin.from("res_city").select("*").eq("id", id).maybeSingle();
      const { error } = await supabaseAdmin.from("res_city").update(rest).eq("id", id);
      if (error) throw error;
      await auditCity(supabase, userId, "update", id, old, rest);
    } else {
      const { data: ins, error } = await supabaseAdmin.from("res_city").insert(rest).select().single();
      if (error) throw error;
      await auditCity(supabase, userId, "create", ins.id, null, ins);
    }
    return { ok: true };
  });

export const deleteCityById = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: caller } = await supabase.from("res_users").select("role").eq("id", userId).maybeSingle();
    if (!caller || !["admin", "superuser"].includes(caller.role)) throw new Error("Non autorizzato");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: old } = await supabaseAdmin.from("res_city").select("*").eq("id", data.id).maybeSingle();
    const { error } = await supabaseAdmin.from("res_city").delete().eq("id", data.id);
    if (error) throw error;
    await auditCity(supabase, userId, "delete", data.id, old, null);
    return { ok: true };
  });
