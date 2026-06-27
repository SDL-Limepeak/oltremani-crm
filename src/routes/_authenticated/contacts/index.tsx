import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { listPartners } from "@/lib/partners.functions";
import { listCategories } from "@/lib/categories.functions";
import { Plus, Download } from "lucide-react";

const STATUS_LABEL: Record<string, string> = {
  new: "Nuovo", active: "Attivo", rejected: "Rifiutato", old: "Storico",
};
const STATUS_TONE: Record<string, string> = {
  new: "bg-[hsl(var(--accent))]/60 text-foreground",
  active: "bg-emerald-100 text-emerald-900",
  rejected: "bg-rose-100 text-rose-900",
  old: "bg-muted text-muted-foreground",
};

export const Route = createFileRoute("/_authenticated/contacts/")({
  ssr: false,
  head: () => ({ meta: [{ title: "Contatti · Oltremani" }] }),
  component: ContactsPage,
});

function ContactsPage() {
  const [filters, setFilters] = useState<{ status?: string; category_id?: string; year?: number; has_active_sub?: boolean; search?: string }>({});

  const { data: cats } = useQuery({ queryKey: ["categories"], queryFn: () => listCategories() });
  const { data, isLoading } = useQuery({
    queryKey: ["partners", filters],
    queryFn: () => listPartners({ data: filters as any }),
  });

  const rows = data?.rows ?? [];
  const csv = useMemo(() => {
    const head = ["nome", "cognome", "email", "telefono", "città", "provincia", "stato"];
    const body = rows.map((r: any) => [r.first_name, r.last_name, r.email, r.phone ?? r.mobile, r.res_city?.name ?? r.raw_city, r.res_city?.province_code ?? r.raw_province, r.status].map(v => `"${(v ?? "").toString().replace(/"/g, '""')}"`).join(","));
    return [head.join(","), ...body].join("\n");
  }, [rows]);

  function exportCsv() {
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `contatti-${Date.now()}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <AppShell
      title="Contatti"
      subtitle="Gestisci la rubrica e le iscrizioni"
      actions={
        <div className="flex gap-2">
          <Button variant="outline" onClick={exportCsv}><Download className="h-4 w-4 mr-2" />Esporta CSV</Button>
          <Button asChild><Link to="/contacts/new"><Plus className="h-4 w-4 mr-2" />Nuovo contatto</Link></Button>
        </div>
      }
    >
      <Card className="p-4 rounded-2xl border-0 shadow-sm mb-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <Input placeholder="Cerca per nome, email…" value={filters.search ?? ""} onChange={e => setFilters({ ...filters, search: e.target.value || undefined })} />
          <Select value={filters.status ?? "all"} onValueChange={v => setFilters({ ...filters, status: v === "all" ? undefined : v })}>
            <SelectTrigger><SelectValue placeholder="Stato" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tutti gli stati</SelectItem>
              {Object.entries(STATUS_LABEL).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filters.category_id ?? "all"} onValueChange={v => setFilters({ ...filters, category_id: v === "all" ? undefined : v })}>
            <SelectTrigger><SelectValue placeholder="Gruppo" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tutti i gruppi</SelectItem>
              {cats?.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filters.has_active_sub === undefined ? "all" : filters.has_active_sub ? "yes" : "no"} onValueChange={v => setFilters({ ...filters, has_active_sub: v === "all" ? undefined : v === "yes" })}>
            <SelectTrigger><SelectValue placeholder="Tessera anno corrente" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tutti</SelectItem>
              <SelectItem value="yes">Con tessera attiva</SelectItem>
              <SelectItem value="no">Senza tessera</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </Card>

      <Card className="rounded-2xl border-0 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="p-4">Nome</th>
                <th className="p-4">Email</th>
                <th className="p-4 hidden md:table-cell">Città</th>
                <th className="p-4 hidden md:table-cell">Gruppi</th>
                <th className="p-4">Stato</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <tr><td className="p-6 text-muted-foreground" colSpan={5}>Caricamento…</td></tr>}
              {!isLoading && rows.length === 0 && <tr><td className="p-6 text-muted-foreground" colSpan={5}>Nessun contatto trovato.</td></tr>}
              {rows.map((r: any) => (
                <tr key={r.id} className="border-t border-border/40 hover:bg-muted/30">
                  <td className="p-4">
                    <Link to="/contacts/$id" params={{ id: r.id }} className="font-medium hover:underline">
                      {r.display_name || `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim() || "—"}
                    </Link>
                  </td>
                  <td className="p-4 text-muted-foreground">{r.email ?? "—"}</td>
                  <td className="p-4 hidden md:table-cell text-muted-foreground">{r.res_city?.name ?? r.raw_city ?? "—"}</td>
                  <td className="p-4 hidden md:table-cell">
                    <div className="flex flex-wrap gap-1">
                      {r.res_partner_category_rel?.map((rel: any) => (
                        <Badge key={rel.category_id} variant="secondary" className="rounded-full">{rel.res_partner_category?.name}</Badge>
                      ))}
                    </div>
                  </td>
                  <td className="p-4">
                    <Badge className={`rounded-full ${STATUS_TONE[r.status] ?? ""}`}>{STATUS_LABEL[r.status] ?? r.status}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </AppShell>
  );
}
