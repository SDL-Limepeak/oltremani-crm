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
    const { supabase } = context;

    let q = supabase
      .from("audit_log")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(data.limit);

    if (data.log_type)   q = q.eq("log_type",   data.log_type);
    if (data.action)     q = q.eq("action",      data.action);
    if (data.model_name) q = q.eq("model_name",  data.model_name);
    if (data.record_id)  q = q.eq("record_id",   data.record_id);

    const { data: rows, error } = await q;
    if (error) throw error;
    if (!rows?.length) return [];

    // Enrich with user names without relying on a FK join
    const userIds = [...new Set(rows.map((r: any) => r.changed_by_user_id).filter(Boolean))];
    let userMap: Record<string, { name: string; email: string }> = {};
    if (userIds.length) {
      const { data: users } = await supabase
        .from("res_users")
        .select("id, name, email")
        .in("id", userIds as string[]);
      userMap = Object.fromEntries((users ?? []).map((u: any) => [u.id, { name: u.name, email: u.email }]));
    }

    return rows.map((r: any) => ({
      ...r,
      res_users: r.changed_by_user_id ? (userMap[r.changed_by_user_id] ?? null) : null,
    }));
  });
