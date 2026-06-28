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
import { useAuthUser } from "@/hooks/use-auth-user";
import { Plus, Download, AlertCircle, HeartHandshake, Home, UserRound } from "lucide-react";

const STATUS_LABEL: Record<string, string> = {
  new: "Nuovo", active: "Attivo", rejected: "Rifiutato", old: "Inattivo",
};

const STATUS_ORDER: Record<string, number> = {
  new: 0, active: 1, rejected: 2, old: 3,
};

function PartnerTypeIcon({ type }: { type?: string }) {
  if (type === "activist")
    return <span title="Attivista"><HeartHandshake className="h-4 w-4 flex-shrink-0 text-[#E8921E]" /></span>;
  if (type === "citizen")
    return <span title="Cittadino"><Home className="h-4 w-4 flex-shrink-0 text-[#1E3271]" /></span>;
  return <span title="Tipo non specificato"><UserRound className="h-4 w-4 flex-shrink-0 text-muted-foreground/40" /></span>;
}
const STATUS_TONE: Record<string, string> = {
  new: "bg-blue-100 text-blue-900",
  active: "bg-emerald-100 text-emerald-900",
  rejected: "bg-rose-100 text-rose-900",
  old: "bg-white text-foreground border border-border",
};

export const Route = createFileRoute("/_authenticated/contacts/")({
  ssr: false,
  head: () => ({ meta: [{ title: "Contatti · Oltremani" }] }),
  component: ContactsPage,
});

function ContactsPage() {
  const { profile } = useAuthUser();
  const isAdmin = profile?.role === "admin";
  const [filters, setFilters] = useState<{ status?: string; partner_type?: string; category_id?: string; year?: number; has_active_sub?: boolean; search?: string }>({});

  const { data: cats } = useQuery({ queryKey: ["categories"], queryFn: () => listCategories() });
  const { data, isLoading } = useQuery({
    queryKey: ["partners", filters],
    queryFn: () => listPartners({ data: filters as any }),
  });

  const rows = (data?.rows ?? []).slice().sort((a: any, b: any) => {
    const aNoGroup = !a.res_partner_category_rel?.length;
    const bNoGroup = !b.res_partner_category_rel?.length;
    if (aNoGroup !== bNoGroup) return aNoGroup ? -1 : 1;
    return (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9);
  });
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
          {isAdmin && (
            <Button variant="outline" onClick={exportCsv}><Download className="h-4 w-4 mr-2" />Esporta CSV</Button>
          )}
          <Button asChild><Link to="/contacts/new"><Plus className="h-4 w-4 mr-2" />Nuovo contatto</Link></Button>
        </div>
      }
    >
      <Card className="p-4 rounded-2xl border-0 shadow-sm mb-4">
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-3">
          <Input placeholder="Cerca per nome, email…" value={filters.search ?? ""} onChange={e => setFilters({ ...filters, search: e.target.value || undefined })} />
          <Select value={filters.status ?? "all"} onValueChange={v => setFilters({ ...filters, status: v === "all" ? undefined : v })}>
            <SelectTrigger><SelectValue placeholder="Stato" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tutti gli stati</SelectItem>
              <SelectItem value="new">Nuovo</SelectItem>
              <SelectItem value="active">Attivo</SelectItem>
              <SelectItem value="rejected">Rifiutato</SelectItem>
              <SelectItem value="old">Inattivo</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filters.partner_type ?? "all"} onValueChange={v => setFilters({ ...filters, partner_type: v === "all" ? undefined : v })}>
            <SelectTrigger><SelectValue placeholder="Tipo" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tutti i tipi</SelectItem>
              <SelectItem value="activist">Attivista</SelectItem>
              <SelectItem value="citizen">Cittadino</SelectItem>
              <SelectItem value="individual">Non specificato</SelectItem>
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
              {rows.map((r: any) => {
                const noGroup = !r.res_partner_category_rel || r.res_partner_category_rel.length === 0;
                return (
                  <tr key={r.id} className={`border-t border-border/40 hover:bg-muted/30 ${noGroup ? "bg-orange-50/40" : ""}`}>
                    <td className="p-4">
                      <div className="flex items-center gap-2">
                        <PartnerTypeIcon type={r.partner_type} />
                        <Link to="/contacts/$id" params={{ id: r.id }} className="font-medium hover:underline">
                          {r.display_name || `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim() || "—"}
                        </Link>
                        {noGroup && (
                          <span title="Nessun gruppo assegnato — da verificare">
                            <AlertCircle className="h-3.5 w-3.5 text-[#E8921E] flex-shrink-0" />
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="p-4 text-muted-foreground">{r.email ?? "—"}</td>
                    <td className="p-4 hidden md:table-cell text-muted-foreground">{r.res_city?.name ?? r.raw_city ?? "—"}</td>
                    <td className="p-4 hidden md:table-cell">
                      {noGroup
                        ? <span className="inline-flex items-center gap-1 text-xs font-medium text-[#E8921E]"><AlertCircle className="h-3 w-3" />Da assegnare</span>
                        : (
                          <div className="flex flex-wrap gap-1">
                            {r.res_partner_category_rel.map((rel: any) => (
                              <Badge key={rel.category_id} variant="secondary" className="rounded-full">{rel.res_partner_category?.name}</Badge>
                            ))}
                          </div>
                        )
                      }
                    </td>
                    <td className="p-4">
                      <Badge className={`rounded-full ${STATUS_TONE[r.status] ?? ""}`}>{STATUS_LABEL[r.status] ?? r.status}</Badge>
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
