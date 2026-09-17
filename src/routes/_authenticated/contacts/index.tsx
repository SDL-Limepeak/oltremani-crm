import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { listPartners, listPartnerRoles } from "@/lib/partners.functions";
import { listCategories } from "@/lib/categories.functions";
import { exportContacts } from "@/lib/exports.functions";
import { ValidationDialog } from "@/components/validation-dialog";
import { hasActiveCard, needsTriage } from "@/lib/partner-filters";
import { PARTNER_STATUS, PARTNER_STATUS_LABEL } from "@/lib/selections";
import { useAuthUser } from "@/hooks/use-auth-user";
import { Plus, Download, AlertCircle, Check, X, ChevronDown } from "lucide-react";

// Mirrors the order of PARTNER_STATUS in selections.ts — derived from it rather than
// repeated, so the dropdown and the list sort cannot drift apart.
const STATUS_ORDER: Record<string, number> = Object.fromEntries(
  PARTNER_STATUS.map((o, i) => [o.value, i]),
);

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
  const canExport = profile?.role === "admin" || profile?.role === "superuser" || profile?.role === "coordinator";
  const [filters, setFilters] = useState<{ status?: string; role_ids?: string[]; category_id?: string; year?: number; has_active_sub?: boolean; search?: string }>({});
  const [exporting, setExporting] = useState(false);
  // The contact currently being triaged, or null. Opens ValidationDialog, which is the
  // one place that assigns the city, swaps Validation for the territorial group and
  // flips the status in a single call.
  const [validating, setValidating] = useState<{ id: string; city?: string; province?: string } | null>(null);

  const { data: cats } = useQuery({ queryKey: ["categories"], queryFn: () => listCategories() });
  const { data: roles } = useQuery({ queryKey: ["partner-roles"], queryFn: () => listPartnerRoles() });

  const currentYear = new Date().getFullYear();

  const selectedRoles = filters.role_ids ?? [];
  function toggleRole(id: string) {
    const next = selectedRoles.includes(id)
      ? selectedRoles.filter((x) => x !== id)
      : [...selectedRoles, id];
    // undefined rather than [], so "nothing ticked" takes the fast SQL path instead of
    // the full scan an empty-array filter would still trigger.
    setFilters({ ...filters, role_ids: next.length ? next : undefined });
  }
  const roleLabel =
    selectedRoles.length === 0
      ? "Tutti i ruoli"
      : selectedRoles.length === 1
        ? roles?.find((r) => r.id === selectedRoles[0])?.name ?? "1 ruolo"
        : `${selectedRoles.length} ruoli`;
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["partners", filters],
    queryFn: () => listPartners({ data: filters as any }),
  });

  const rows = (data?.rows ?? []).slice().sort((a: any, b: any) => {
    const aNoGroup = !a.res_partner_category_rel?.length;
    const bNoGroup = !b.res_partner_category_rel?.length;
    if (aNoGroup !== bNoGroup) return aNoGroup ? -1 : 1;
    return (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9);
  });
  // Built server-side: the export must cover every matching contact, not just the page
  // currently loaded in the table. It is also recorded in the audit log.
  async function exportCsv() {
    setExporting(true);
    try {
      const { csv, count } = await exportContacts({ data: filters as any });
      // BOM so Excel opens accented names as UTF-8 instead of mojibake.
      const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `contatti-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(count === 1 ? "1 contatto esportato" : `${count} contatti esportati`);
    } catch (e: any) {
      toast.error(e?.message ?? "Export non riuscito");
    } finally {
      setExporting(false);
    }
  }

  return (
    <AppShell
      title="Contatti"
      subtitle="Gestisci la rubrica e le iscrizioni"
      actions={
        <div className="flex gap-2">
          {canExport && (
            <Button variant="outline" onClick={exportCsv} disabled={exporting}>
              <Download className="h-4 w-4 mr-2" />
              {exporting ? "Esportazione…" : "Esporta CSV"}
            </Button>
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
              {PARTNER_STATUS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
          {/* Replaces the old "Tipo" select. Multiple, and OR across the picks. */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                className="justify-between font-normal h-10 px-3 border-input bg-background hover:bg-background"
              >
                <span className={selectedRoles.length ? "" : "text-muted-foreground"}>{roleLabel}</span>
                <ChevronDown className="h-4 w-4 opacity-50 flex-shrink-0" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-64">
              {(roles ?? []).map((r) => (
                <DropdownMenuCheckboxItem
                  key={r.id}
                  checked={selectedRoles.includes(r.id)}
                  onCheckedChange={() => toggleRole(r.id)}
                  onSelect={(e) => e.preventDefault()}
                >
                  {r.name}
                </DropdownMenuCheckboxItem>
              ))}
              {!roles?.length && (
                <div className="px-2 py-1.5 text-sm text-muted-foreground">Nessun ruolo configurato</div>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
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
                <th className="p-4 text-center">Tesserato</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <tr><td className="p-6 text-muted-foreground" colSpan={6}>Caricamento…</td></tr>}
              {!isLoading && rows.length === 0 && <tr><td className="p-6 text-muted-foreground" colSpan={6}>Nessun contatto trovato.</td></tr>}
              {rows.map((r: any) => {
                const noGroup = !r.res_partner_category_rel || r.res_partner_category_rel.length === 0;
                return (
                  <tr key={r.id} className={`border-t border-border/40 hover:bg-muted/30 ${noGroup ? "bg-orange-50/40" : ""}`}>
                    <td className="p-4">
                      <div className="flex items-center gap-2">
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
                      {needsTriage(r)
                        ? (
                          // Clickable, not just a warning. A contact whose city did not
                          // match sits in the Validation group until someone assigns the
                          // right one, and doing that by hand from the edit form means
                          // remembering to remove Validation and add the territorial
                          // group — which is exactly what gets forgotten.
                          <button
                            type="button"
                            onClick={() => setValidating({ id: r.id, city: r.raw_city ?? undefined, province: r.raw_province ?? undefined })}
                            className="inline-flex items-center gap-1 text-xs font-medium text-[#E8921E] hover:underline"
                          >
                            <AlertCircle className="h-3 w-3" />
                            {noGroup ? "Da assegnare" : "Da validare"}
                          </button>
                        )
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
                      <Badge className={`rounded-full ${STATUS_TONE[r.status] ?? ""}`}>{PARTNER_STATUS_LABEL[r.status] ?? r.status}</Badge>
                    </td>
                    <td className="p-4">
                      {/* Answered by the same helper the CSV uses, so the tick and the
                          exported "tesserato" column can never disagree. */}
                      <div className="flex justify-center">
                        {hasActiveCard(r) ? (
                          <span title={`Tessera attiva per il ${currentYear}`}>
                            <Check className="h-4 w-4 text-emerald-600" />
                          </span>
                        ) : (
                          <span title={`Nessuna tessera attiva per il ${currentYear}`}>
                            <X className="h-4 w-4 text-rose-600" />
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {validating && (
        <ValidationDialog
          open
          onOpenChange={(o) => !o && setValidating(null)}
          partnerId={validating.id}
          defaultCity={validating.city}
          defaultProvince={validating.province}
          onSaved={() => {
            setValidating(null);
            toast.success("Contatto validato");
            refetch();
          }}
        />
      )}
    </AppShell>
  );
}
