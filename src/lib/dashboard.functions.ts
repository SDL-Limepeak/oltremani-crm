import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getDashboardStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const year = new Date().getFullYear();

    const [tot, news, actives, validations, subs, recentInbound, recentAudit, validationCat] = await Promise.all([
      supabase.from("res_partner").select("id", { count: "exact", head: true }),
      supabase.from("res_partner").select("id", { count: "exact", head: true }).eq("status", "new"),
      supabase.from("res_partner").select("id", { count: "exact", head: true }).eq("status", "active"),
      supabase.from("res_partner_category").select("id").eq("name", "Validation").maybeSingle(),
      supabase
        .from("membership_subscription")
        .select("id", { count: "exact", head: true })
        .eq("year", year)
        .eq("status", "active"),
      supabase
        .from("audit_log")
        .select("id, created_at, source, new_values_json")
        .eq("log_type", "inbound_form")
        .order("created_at", { ascending: false })
        .limit(8),
      supabase
        .from("audit_log")
        .select("id, created_at, action, model_name, log_type")
        .order("created_at", { ascending: false })
        .limit(8),
      Promise.resolve(null),
    ]);

    let validationCount = 0;
    if (validations.data?.id) {
      const { count } = await supabase
        .from("res_partner_category_rel")
        .select("partner_id", { count: "exact", head: true })
        .eq("category_id", validations.data.id);
      validationCount = count ?? 0;
    }

    return {
      year,
      total: tot.count ?? 0,
      newCount: news.count ?? 0,
      activeCount: actives.count ?? 0,
      validationCount,
      activeSubs: subs.count ?? 0,
      recentInbound: recentInbound.data ?? [],
      recentAudit: recentAudit.data ?? [],
    };
  });
