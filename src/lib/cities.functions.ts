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

export const setCityCategory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ city_id: z.string().uuid(), category_id: z.string().uuid().nullable() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("res_city").update({ category_id: data.category_id }).eq("id", data.city_id);
    if (error) throw error;
    return { ok: true };
  });
