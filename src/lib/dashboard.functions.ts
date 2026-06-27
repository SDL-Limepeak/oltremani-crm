import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const TYPE_LABEL: Record<string, string> = {
  activist: "Attivista",
  citizen: "Cittadino",
  individual: "Non specificato",
};

export const getDashboardStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const year = new Date().getFullYear();

    const [tot, news, actives, subs, recentInbound, recentAudit, ptRaw, citizensRaw] = await Promise.all([
      supabase.from("res_partner").select("id", { count: "exact", head: true }),
      supabase.from("res_partner").select("id", { count: "exact", head: true }).eq("status", "new"),
      supabase.from("res_partner").select("id", { count: "exact", head: true }).eq("status", "active"),
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
      supabase.from("res_partner").select("partner_type, status"),
      (supabase as any)
        .from("res_partner")
        .select("id, res_partner_category_rel(res_partner_category(name, category_type))")
        .eq("partner_type", "citizen"),
    ]);

    // Partner type × status aggregation
    const ptMap: Record<string, { total: number; byStatus: Record<string, number> }> = {};
    for (const row of (ptRaw.data ?? []) as any[]) {
      const t: string = row.partner_type ?? "individual";
      if (!ptMap[t]) ptMap[t] = { total: 0, byStatus: {} };
      ptMap[t].total++;
      const s: string = row.status ?? "unknown";
      ptMap[t].byStatus[s] = (ptMap[t].byStatus[s] ?? 0) + 1;
    }
    const partnerTypeStats = Object.entries(ptMap).map(([type, v]) => ({
      type,
      name: TYPE_LABEL[type] ?? type,
      value: v.total,
      byStatus: v.byStatus,
    }));

    // Citizens by territorial group
    const groupMap: Record<string, number> = {};
    for (const row of (citizensRaw.data ?? []) as any[]) {
      const rels: any[] = row.res_partner_category_rel ?? [];
      const territorial = rels.filter((r: any) => r.res_partner_category?.category_type === "territorial");
      if (!territorial.length) {
        groupMap["Da assegnare"] = (groupMap["Da assegnare"] ?? 0) + 1;
      } else {
        for (const g of territorial) {
          const name: string = g.res_partner_category?.name ?? "—";
          groupMap[name] = (groupMap[name] ?? 0) + 1;
        }
      }
    }
    const citizensByGroup = Object.entries(groupMap)
      .map(([group, count]) => ({ name: group, value: count }))
      .sort((a, b) => b.value - a.value);

    return {
      year,
      total: tot.count ?? 0,
      newCount: news.count ?? 0,
      activeCount: actives.count ?? 0,
      activeSubs: subs.count ?? 0,
      recentInbound: recentInbound.data ?? [],
      recentAudit: recentAudit.data ?? [],
      partnerTypeStats,
      citizensByGroup,
    };
  });
