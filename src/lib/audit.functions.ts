import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const listAudit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    log_type: z.string().optional(),
    action: z.string().optional(),
    model_name: z.string().optional(),
    record_id: z.string().uuid().optional(),
    limit: z.number().int().max(500).default(100),
  }).default({}).parse(d ?? {}))
  .handler(async ({ data, context }) => {
    let q = context.supabase
      .from("audit_log")
      .select("*, res_users:changed_by_user_id(name, email)")
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (data.log_type) q = q.eq("log_type", data.log_type);
    if (data.action) q = q.eq("action", data.action);
    if (data.model_name) q = q.eq("model_name", data.model_name);
    if (data.record_id) q = q.eq("record_id", data.record_id);
    const { data: rows, error } = await q;
    if (error) throw error;
    return rows ?? [];
  });
