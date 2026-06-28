import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Users, UserCheck, Inbox, BadgeCheck } from "lucide-react";
import { getDashboardStats } from "@/lib/dashboard.functions";
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from "recharts";

export const Route = createFileRoute("/_authenticated/dashboard")({
  ssr: false,
  head: () => ({ meta: [{ title: "Dashboard · Oltremani" }] }),
  component: DashboardPage,
});

const STATUS_LABEL: Record<string, string> = {
  new: "Nuovo", active: "Attivo", rejected: "Rifiutato", old: "Storico",
};

const TYPE_COLORS: Record<string, string> = {
  activist: "#E8921E",
  citizen: "#1E3271",
  individual: "#94a3b8",
};

const GROUP_PALETTE = [
  "#1E3271", "#2d4a9e", "#3b63ca", "#5480d8", "#7da0e4",
  "#a8c0ef", "#E8921E", "#f5aa55", "#fac88c", "#c8d9f7",
];

function StatCard({ icon: Icon, label, value }: any) {
  return (
    <Card className="p-6 rounded-2xl border-0 shadow-sm bg-card">
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

function TypeTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  const statusRows = Object.entries(d.byStatus ?? {})
    .sort((a: any, b: any) => b[1] - a[1])
    .map(([k, v]) => `${STATUS_LABEL[k] ?? k}: ${v}`)
    .join(", ");
  return (
    <div className="bg-popover border border-border rounded-xl px-3 py-2 text-sm shadow-md">
      <div className="font-semibold">{d.name}</div>
      <div className="text-muted-foreground text-xs mt-0.5">{statusRows || "—"}</div>
    </div>
  );
}

function GroupTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-popover border border-border rounded-xl px-3 py-2 text-sm shadow-md">
      <div className="font-semibold">{d.name}</div>
      <div className="text-muted-foreground text-xs mt-0.5">{d.value} cittadini</div>
    </div>
  );
}

function DonutChart({ data, colors, total, tooltip }: {
  data: Array<{ name: string; value: number; [k: string]: any }>;
  colors: (entry: any, index: number) => string;
  total: number;
  tooltip: React.ReactNode;
}) {
  return (
    <div className="relative">
      <ResponsiveContainer width="100%" height={220}>
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="46%"
            innerRadius={60}
            outerRadius={88}
            paddingAngle={3}
            dataKey="value"
          >
            {data.map((entry, index) => (
              <Cell key={entry.name} fill={colors(entry, index)} />
            ))}
          </Pie>
          {tooltip}
          <Legend
            layout="horizontal"
            verticalAlign="bottom"
            align="center"
            iconType="circle"
            iconSize={8}
            formatter={(value) => <span className="text-xs text-foreground">{value}</span>}
          />
        </PieChart>
      </ResponsiveContainer>
      {/* Center label overlay — positioned above the legend (~40px) */}
      <div
        className="absolute pointer-events-none flex flex-col items-center justify-center"
        style={{ top: 0, left: 0, right: 0, bottom: 40 }}
      >
        <span className="text-2xl font-serif font-semibold leading-none">{total}</span>
        <span className="text-xs text-muted-foreground mt-1">totale</span>
      </div>
    </div>
  );
}

function DashboardPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["dashboard-stats"],
    queryFn: () => getDashboardStats(),
  });

  const ptStats = data?.partnerTypeStats ?? [];
  const ptTotal = ptStats.reduce((s: number, d: any) => s + d.value, 0);
  const cgStats = data?.citizensByGroup ?? [];
  const cgTotal = cgStats.reduce((s: number, d: any) => s + d.value, 0);

  return (
    <AppShell title="Dashboard" subtitle="Panoramica del CRM e tesseramenti">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={Users} label="Contatti totali" value={isLoading ? "—" : data?.total ?? 0} />
        <StatCard icon={Inbox} label="Nuovi contatti" value={isLoading ? "—" : data?.newCount ?? 0} />
        <StatCard icon={UserCheck} label="Contatti attivi" value={isLoading ? "—" : data?.activeCount ?? 0} />
        <StatCard icon={BadgeCheck} label={`Tessere attive ${data?.year ?? ""}`} value={isLoading ? "—" : data?.activeSubs ?? 0} />
      </div>

      {/* Pie charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-6">
        <Card className="p-6 rounded-2xl border-0 shadow-sm">
          <h3 className="font-serif text-lg mb-1">Attivisti e Cittadini</h3>
          <p className="text-xs text-muted-foreground mb-3">Distribuzione per tipo — passa per vedere lo stato</p>
          {isLoading ? (
            <div className="h-56 flex items-center justify-center text-muted-foreground text-sm">Caricamento…</div>
          ) : ptStats.length === 0 ? (
            <div className="h-56 flex items-center justify-center text-muted-foreground text-sm">Nessun dato</div>
          ) : (
            <DonutChart
              data={ptStats}
              total={ptTotal}
              colors={(entry) => TYPE_COLORS[entry.type] ?? "#ccc"}
              tooltip={<Tooltip content={<TypeTooltip />} />}
            />
          )}
        </Card>

        <Card className="p-6 rounded-2xl border-0 shadow-sm">
          <h3 className="font-serif text-lg mb-1">Cittadini per gruppo</h3>
          <p className="text-xs text-muted-foreground mb-3">Distribuzione per gruppo territoriale</p>
          {isLoading ? (
            <div className="h-56 flex items-center justify-center text-muted-foreground text-sm">Caricamento…</div>
          ) : cgStats.length === 0 ? (
            <div className="h-56 flex items-center justify-center text-muted-foreground text-sm">Nessun cittadino registrato</div>
          ) : (
            <DonutChart
              data={cgStats}
              total={cgTotal}
              colors={(entry, index) =>
                entry.name === "Da assegnare"
                  ? "#E8921E"
                  : GROUP_PALETTE[index % GROUP_PALETTE.length]
              }
              tooltip={<Tooltip content={<GroupTooltip />} />}
            />
          )}
        </Card>
      </div>

      {/* Recent activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
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
