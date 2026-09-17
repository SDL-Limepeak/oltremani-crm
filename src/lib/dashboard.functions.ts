import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";


const PAGE = 1000;

/**
 * PostgREST caps a response at its configured maximum (1000 rows on Supabase) and says
 * nothing about it. An unpaged select therefore describes a subset while the headline
 * counters — which use `count: 'exact', head: true` — stay right, so the two disagree
 * and neither explains why. Page until a short page comes back.
 */
async function selectAll(build: (from: number, to: number) => any): Promise<any[]> {
  const out: any[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await build(offset, offset + PAGE - 1);
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) return out;
  }
}

export const getDashboardStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const year = new Date().getFullYear();

    // audit_log is readable by admins only, and a plain query just returns []. Ask first,
    // so the UI can say "administrators only" instead of showing an empty panel that
    // reads as "nothing has happened".
    const { data: me } = await supabase.from("res_users").select("role").eq("id", userId).maybeSingle();
    const canReadAudit = me?.role === "admin";

    const [tot, news, actives, subs, recentInbound, recentAudit, ptRaw, byGroupRaw] = await Promise.all([
      supabase.from("res_partner").select("id", { count: "exact", head: true }),
      supabase.from("res_partner").select("id", { count: "exact", head: true }).eq("status", "new"),
      supabase.from("res_partner").select("id", { count: "exact", head: true }).eq("status", "active"),
      supabase
        .from("membership_subscription")
        .select("id", { count: "exact", head: true })
        .eq("year", year)
        .eq("status", "active"),
      canReadAudit
        ? supabase
            .from("audit_log")
            .select("id, created_at, source, new_values_json")
            .eq("log_type", "inbound_form")
            .order("created_at", { ascending: false })
            .limit(8)
        : Promise.resolve({ data: [] as any[] }),
      canReadAudit
        ? supabase
            .from("audit_log")
            .select("id, created_at, action, model_name, log_type")
            .order("created_at", { ascending: false })
            .limit(8)
        : Promise.resolve({ data: [] as any[] }),
      selectAll((from, to) =>
        (supabase as any)
          .from("res_partner")
          .select("status, res_partner_role_rel(res_partner_role(name, sort_order))")
          .range(from, to),
      ).then((data) => ({ data })),
      selectAll((from, to) =>
        (supabase as any)
          .from("res_partner")
          .select("id, res_partner_category_rel(res_partner_category(name, category_type))")
          .range(from, to),
      ).then((data) => ({ data })),
    ]);

    // Role × status aggregation, in place of the old partner_type one.
    //
    // Roles are multiple, so this does not partition the contacts: someone who is both
    // "Attivista" and "Famiglia ospitante" is counted under each. The totals therefore add
    // up to more than the number of contacts, which is correct for "how many people can do
    // X" and would be wrong for a pie chart of shares. "Senza ruolo" is kept as its own
    // entry rather than dropped — it is the bucket that needs attention.
    const roleMap: Record<string, { total: number; byStatus: Record<string, number>; order: number }> = {};
    const bump = (name: string, order: number, status: string) => {
      if (!roleMap[name]) roleMap[name] = { total: 0, byStatus: {}, order };
      roleMap[name].total++;
      roleMap[name].byStatus[status] = (roleMap[name].byStatus[status] ?? 0) + 1;
    };
    for (const row of (ptRaw.data ?? []) as any[]) {
      const status: string = row.status ?? "unknown";
      const rels: any[] = row.res_partner_role_rel ?? [];
      if (!rels.length) {
        bump("Senza ruolo", 999, status);
        continue;
      }
      for (const rel of rels) {
        bump(rel.res_partner_role?.name ?? "—", rel.res_partner_role?.sort_order ?? 500, status);
      }
    }
    const partnerRoleStats = Object.entries(roleMap)
      .sort((a, b) => a[1].order - b[1].order)
      .map(([name, v]) => ({ type: name, name, value: v.total, byStatus: v.byStatus }));

    // Contacts by territorial group. This used to count only partner_type='citizen';
    // with "Tipo" gone it counts everybody, which is what the card claimed to show anyway.
    const groupMap: Record<string, number> = {};
    for (const row of (byGroupRaw.data ?? []) as any[]) {
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
    const contactsByGroup = Object.entries(groupMap)
      .map(([group, count]) => ({ name: group, value: count }))
      .sort((a, b) => b.value - a.value);

    return {
      year,
      total: tot.count ?? 0,
      newCount: news.count ?? 0,
      activeCount: actives.count ?? 0,
      activeSubs: subs.count ?? 0,
      canReadAudit,
      recentInbound: recentInbound.data ?? [],
      recentAudit: recentAudit.data ?? [],
      partnerRoleStats,
      contactsByGroup,
    };
  });
