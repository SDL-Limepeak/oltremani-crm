import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Link } from "@tanstack/react-router";
import { listSubscriptions } from "@/lib/subscriptions.functions";
import { useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/subscriptions")({
  ssr: false,
  head: () => ({ meta: [{ title: "Tesseramenti · Oltremani" }] }),
  component: SubsPage,
});

function SubsPage() {
  const now = new Date().getFullYear();
  const [year, setYear] = useState<number>(now);
  const { data, isLoading } = useQuery({ queryKey: ["subs", year], queryFn: () => listSubscriptions({ data: { year } }) });

  return (
    <AppShell title="Tesseramenti" subtitle="Iscrizioni soci per anno">
      <div className="mb-4 flex gap-2 items-center">
        <span className="text-sm text-muted-foreground">Anno</span>
        <Select value={String(year)} onValueChange={v => setYear(Number(v))}>
          <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
          <SelectContent>
            {[now + 1, now, now - 1, now - 2].map(y => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <Card className="rounded-2xl border-0 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground">
              <tr><th className="p-4">N° · Socio</th><th className="p-4">Email</th><th className="p-4">Periodo</th><th className="p-4">Stato</th></tr>
            </thead>
            <tbody>
              {isLoading && <tr><td colSpan={4} className="p-6 text-muted-foreground">Caricamento…</td></tr>}
              {!isLoading && !data?.length && <tr><td colSpan={4} className="p-6 text-muted-foreground">Nessuna tessera per l'anno selezionato.</td></tr>}
              {data?.map((s: any) => {
                const statusLabel = s.status === "active" ? "Attiva" : s.status === "revoked" ? "Revocata" : "Inattiva";
                const name = s.res_partner?.display_name ?? `${s.res_partner?.first_name ?? ""} ${s.res_partner?.last_name ?? ""}`.trim();
                return (
                  <tr key={s.id} className="border-t border-border/40">
                    <td className="p-4">
                      <div className="flex items-center gap-2">
                        {s.membership_number && (
                          <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">{s.membership_number}</span>
                        )}
                        <Link to="/contacts/$id" params={{ id: s.partner_id }} className="font-medium hover:underline">{name || "—"}</Link>
                      </div>
                    </td>
                    <td className="p-4 text-muted-foreground">{s.res_partner?.email}</td>
                    <td className="p-4 text-muted-foreground">{s.start_date} → {s.end_date ?? "—"}</td>
                    <td className="p-4">
                      <Badge
                        className={`rounded-full ${s.status === "revoked" ? "bg-destructive/10 text-destructive" : ""}`}
                        variant={s.status === "active" ? "default" : "secondary"}
                      >
                        {statusLabel}
                      </Badge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </AppShell>
  );
}
