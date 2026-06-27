import { createFileRoute, redirect } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { listAudit } from "@/lib/audit.functions";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/audit")({
  ssr: false,
  head: () => ({ meta: [{ title: "Audit Log · Oltremani" }] }),
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) return;
    const { data: row } = await supabase.from("res_users").select("role").eq("id", data.user.id).maybeSingle();
    if (row?.role !== "admin") throw redirect({ to: "/dashboard" });
  },
  component: AuditPage,
});

function AuditPage() {
  const [logType, setLogType] = useState<string>("all");
  const { data, isLoading } = useQuery({
    queryKey: ["audit-all", logType],
    queryFn: () => listAudit({ data: { log_type: logType === "all" ? undefined : logType, limit: 200 } }),
  });

  return (
    <AppShell title="Audit Log" subtitle="Storico completo delle attività">
      <div className="mb-4 flex gap-2 items-center">
        <Select value={logType} onValueChange={setLogType}>
          <SelectTrigger className="w-64"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tutti i tipi</SelectItem>
            <SelectItem value="inbound_form">Form pubblico</SelectItem>
            <SelectItem value="record_change">Modifica record</SelectItem>
            <SelectItem value="subscription_change">Tesseramento</SelectItem>
            <SelectItem value="permission_change">Permessi</SelectItem>
            <SelectItem value="user_change">Utenti</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <Card className="rounded-2xl border-0 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground">
              <tr><th className="p-4">Quando</th><th className="p-4">Tipo</th><th className="p-4">Azione</th><th className="p-4">Modello</th><th className="p-4">Utente</th><th className="p-4">Sorgente</th></tr>
            </thead>
            <tbody>
              {isLoading && <tr><td colSpan={6} className="p-6 text-muted-foreground">Caricamento…</td></tr>}
              {!isLoading && !data?.length && <tr><td colSpan={6} className="p-6 text-muted-foreground">Nessun log.</td></tr>}
              {data?.map((l: any) => (
                <tr key={l.id} className="border-t border-border/40">
                  <td className="p-4 text-muted-foreground whitespace-nowrap">{new Date(l.created_at).toLocaleString("it-IT")}</td>
                  <td className="p-4"><Badge variant="secondary" className="rounded-full">{l.log_type}</Badge></td>
                  <td className="p-4">{l.action}</td>
                  <td className="p-4 text-muted-foreground">{l.model_name ?? "—"}</td>
                  <td className="p-4">{l.res_users?.name ?? "—"}</td>
                  <td className="p-4 text-muted-foreground">{l.source ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </AppShell>
  );
}
