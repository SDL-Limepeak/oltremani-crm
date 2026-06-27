import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const SubInput = z.object({
  id: z.string().uuid().optional(),
  partner_id: z.string().uuid(),
  year: z.number().int().min(2000).max(2100).optional(),
  start_date: z.string().optional(),
  end_date: z.string().nullable().optional(),
  status: z.enum(["active", "inactive"]).optional(),
  notes: z.string().nullable().optional(),
});

export const listSubscriptions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ year: z.number().int().optional(), status: z.string().optional() }).default({}).parse(d ?? {}))
  .handler(async ({ data, context }) => {
    let q = context.supabase
      .from("membership_subscription")
      .select("*, res_partner(id, first_name, last_name, display_name, email)")
      .order("created_at", { ascending: false })
      .limit(500);
    if (data.year) q = q.eq("year", data.year);
    if (data.status) q = q.eq("status", data.status);
    const { data: rows, error } = await q;
    if (error) throw error;
    return rows ?? [];
  });

export const upsertSubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => SubInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const year = data.year ?? new Date().getFullYear();
    const payload: any = {
      partner_id: data.partner_id,
      year,
      start_date: data.start_date ?? new Date().toISOString().slice(0, 10),
      end_date: data.end_date ?? `${year}-12-31`,
      status: data.status ?? "active",
      notes: data.notes ?? null,
      updated_by: userId,
    };
    let row;
    if (data.id) {
      const { data: old } = await supabase.from("membership_subscription").select("*").eq("id", data.id).maybeSingle();
      const { data: upd, error } = await supabase.from("membership_subscription").update(payload).eq("id", data.id).select().single();
      if (error) throw error;
      row = upd;
      await supabase.from("audit_log").insert({
        log_type: "subscription_change", action: "update", model_name: "membership_subscription",
        record_id: row.id, old_values_json: old, new_values_json: row, changed_by_user_id: userId, source: "ui",
      });
    } else {
      payload.created_by = userId;
      const { data: ins, error } = await supabase.from("membership_subscription").insert(payload).select().single();
      if (error) throw error;
      row = ins;
      await supabase.from("audit_log").insert({
        log_type: "subscription_change", action: "create", model_name: "membership_subscription",
        record_id: row.id, new_values_json: row, changed_by_user_id: userId, source: "ui",
      });
    }
    return row;
  });
