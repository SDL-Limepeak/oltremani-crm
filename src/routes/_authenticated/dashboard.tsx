import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Users, UserCheck, AlertCircle, BadgeCheck, Inbox, ScrollText } from "lucide-react";
import { getDashboardStats } from "@/lib/dashboard.functions";

export const Route = createFileRoute("/_authenticated/dashboard")({
  ssr: false,
  head: () => ({ meta: [{ title: "Dashboard · Oltremani" }] }),
  component: DashboardPage,
});

function StatCard({ icon: Icon, label, value, tone = "default" }: any) {
  const tones: Record<string, string> = {
    default: "bg-card",
    warm: "bg-[hsl(var(--accent))]/30",
    cool: "bg-[hsl(var(--secondary))]/40",
  };
  return (
    <Card className={`p-6 rounded-2xl border-0 shadow-sm ${tones[tone]}`}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="text-3xl font-serif font-semibold mt-2">{value}</p>
        </div>
        <div className="p-3 rounded-xl bg-background/60">
          <Icon className="h-5 w-5 text-foreground/70" />
        </div>
      </div>
    </Card>
  );
}

function DashboardPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["dashboard-stats"],
    queryFn: () => getDashboardStats(),
  });

  return (
    <AppShell title="Dashboard" subtitle="Panoramica del CRM e tesseramenti">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <StatCard icon={Users} label="Contatti totali" value={isLoading ? "—" : data?.total ?? 0} />
        <StatCard icon={Inbox} label="Nuovi contatti" value={isLoading ? "—" : data?.newCount ?? 0} tone="warm" />
        <StatCard icon={UserCheck} label="Contatti attivi" value={isLoading ? "—" : data?.activeCount ?? 0} tone="cool" />
        <StatCard icon={AlertCircle} label="In validazione" value={isLoading ? "—" : data?.validationCount ?? 0} tone="warm" />
        <StatCard icon={BadgeCheck} label={`Tessere attive ${data?.year ?? ""}`} value={isLoading ? "—" : data?.activeSubs ?? 0} tone="cool" />
        <StatCard icon={ScrollText} label="Log audit recenti" value={isLoading ? "—" : data?.recentAudit?.length ?? 0} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-6">
        <Card className="p-6 rounded-2xl border-0 shadow-sm">
          <h3 className="font-serif text-lg mb-4">Form ricevuti di recente</h3>
          {data?.recentInbound?.length ? (
            <ul className="space-y-3">
              {data.recentInbound.map((l: any) => (
                <li key={l.id} className="text-sm border-b border-border/40 pb-2 last:border-0">
                  <div className="flex justify-between gap-2">
                    <span className="font-medium truncate">{(l.new_values_json as any)?.email ?? "—"}</span>
                    <span className="text-muted-foreground text-xs">{new Date(l.created_at).toLocaleString("it-IT")}</span>
                  </div>
                  <p className="text-muted-foreground text-xs">{l.source ?? "api"}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground text-sm">Nessun form ricevuto.</p>
          )}
        </Card>

        <Card className="p-6 rounded-2xl border-0 shadow-sm">
          <h3 className="font-serif text-lg mb-4">Attività recente</h3>
          {data?.recentAudit?.length ? (
            <ul className="space-y-3">
              {data.recentAudit.map((l: any) => (
                <li key={l.id} className="text-sm border-b border-border/40 pb-2 last:border-0 flex justify-between">
                  <span>
                    <span className="font-medium">{l.action}</span>{" "}
                    <span className="text-muted-foreground">{l.model_name ?? l.log_type}</span>
                  </span>
                  <span className="text-muted-foreground text-xs">{new Date(l.created_at).toLocaleString("it-IT")}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground text-sm">Nessuna attività registrata.</p>
          )}
        </Card>
      </div>
    </AppShell>
  );
}
