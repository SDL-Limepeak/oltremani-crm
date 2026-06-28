import { createFileRoute, useParams } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { getPartner, upsertPartner } from "@/lib/partners.functions";
import { revokeSubscription } from "@/lib/subscriptions.functions";
import { listAudit } from "@/lib/audit.functions";
import { listCategories } from "@/lib/categories.functions";
import { searchCities } from "@/lib/cities.functions";
import { SubscriptionDialog } from "@/components/subscription-dialog";
import { ConsentDialog } from "@/components/consent-dialog";
import { useAuthUser } from "@/hooks/use-auth-user";
import {
  ChevronDown, BadgeCheck, Plus, HeartHandshake, Home, UserRound,
  MoreHorizontal, FolderTree, User, CreditCard, FileText, ScrollText, Save,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/contacts/$id")({
  ssr: false,
  head: () => ({ meta: [{ title: "Contatto · Oltremani" }] }),
  component: ContactDetail,
});

const STATUS = ["new", "active", "rejected", "old"] as const;
const STATUS_LABEL: Record<string, string> = {
  new: "Nuovo", active: "Attivo", rejected: "Rifiutato", old: "Inattivo",
};
const CHANNEL_LABEL: Record<string, string> = {
  telefono: "Telefono", email: "Email", cartaceo: "Cartaceo",
  di_persona: "Di persona", web: "Web", altro: "Altro",
};
const SKIP_DIFF_FIELDS = new Set([
  "id", "created_at", "updated_at", "created_by", "updated_by", "display_name",
]);
const FIELD_LABEL: Record<string, string> = {
  first_name: "Nome", last_name: "Cognome", email: "Email",
  phone: "Telefono", mobile: "Telefono alternativo", status: "Stato",
  partner_type: "Tipo", notes: "Note", raw_city: "Città",
  raw_province: "Provincia", city_id: "Città (DB)",
  year: "Anno", start_date: "Inizio", end_date: "Fine",
  membership_number: "N° tessera",
};

function diffJson(o: any, n: any) {
  if (!o || !n) return [];
  return Object.keys(n).flatMap(k => {
    if (SKIP_DIFF_FIELDS.has(k)) return [];
    if (o[k] === n[k]) return [];
    return [{ field: FIELD_LABEL[k] ?? k, old: o[k], new: n[k] }];
  });
}

function PartnerTypeIcon({ type }: { type?: string }) {
  if (type === "activist") return <span title="Attivista"><HeartHandshake className="h-5 w-5 text-[#E8921E]" /></span>;
  if (type === "citizen") return <span title="Cittadino"><Home className="h-5 w-5 text-[#1E3271]" /></span>;
  return <span title="Non specificato"><UserRound className="h-5 w-5 text-muted-foreground/40" /></span>;
}

function SectionHeader({
  title, icon: Icon, isOpen, onToggle,
}: { title: string; icon: any; isOpen: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-muted/30 transition-colors"
    >
      <Icon className="h-4 w-4 text-[#E8921E] flex-shrink-0" />
      <span className="font-serif font-semibold text-base flex-1">{title}</span>
      <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform flex-shrink-0 ${isOpen ? "rotate-180" : ""}`} />
    </button>
  );
}

function AuditEntry({ log }: { log: any }) {
  const diffs = log.action === "update" ? diffJson(log.old_values_json, log.new_values_json) : [];
  return (
    <li className="py-3 text-sm">
      <div className="flex justify-between items-start gap-2">
        <div>
          <span className="font-medium capitalize">{log.action}</span>
          <span className="text-muted-foreground"> · {log.model_name ?? log.log_type}</span>
          {log.res_users && <span className="text-muted-foreground"> · da {log.res_users.name}</span>}
        </div>
        <span className="text-muted-foreground text-xs whitespace-nowrap">{new Date(log.created_at).toLocaleString("it-IT")}</span>
      </div>
      {diffs.length > 0 && (
        <div className="mt-2 space-y-1 pl-3 border-l-2 border-border/30">
          {diffs.map((d, i) => (
            <div key={i} className="text-xs flex gap-2 flex-wrap">
              <span className="font-medium text-foreground/70 min-w-[80px]">{d.field}</span>
              <span className="text-muted-foreground line-through">{String(d.old ?? "—")}</span>
              <span className="text-foreground">→ {String(d.new ?? "—")}</span>
            </div>
          ))}
        </div>
      )}
    </li>
  );
}

const TRACKED_FIELDS = [
  "first_name", "last_name", "email", "phone", "mobile",
  "city_id", "raw_city", "raw_province", "status", "partner_type", "notes",
] as const;

function ContactDetail() {
  const { id } = useParams({ from: "/_authenticated/contacts/$id" });
  const qc = useQueryClient();
  const { profile } = useAuthUser();
  const isAdmin = profile?.role === "admin";
  const year = new Date().getFullYear();

  const [open, setOpen] = useState({ groups: true, anagrafica: true, subs: false, consent: false, audit: false });
  const toggle = (k: keyof typeof open) => setOpen(o => ({ ...o, [k]: !o[k] }));

  const [subOpen, setSubOpen] = useState(false);
  const [consentOpen, setConsentOpen] = useState(false);
  const [cityQuery, setCityQuery] = useState("");

  const emptyForm = {
    first_name: "", last_name: "", email: "", phone: "", mobile: "",
    city_id: null as string | null, raw_city: "", raw_province: "",
    status: "new", partner_type: "individual", notes: "", category_ids: [] as string[],
  };
  const [form, setForm] = useState<any>(emptyForm);
  const [initialForm, setInitialForm] = useState<any>(null);
  const [saving, setSaving] = useState(false);

  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));

  const isDirty = useMemo(() => {
    if (!initialForm) return false;
    const fieldsDirty = TRACKED_FIELDS.some(k => form[k] !== initialForm[k]);
    const catsDirty =
      JSON.stringify([...form.category_ids].sort()) !==
      JSON.stringify([...(initialForm.category_ids ?? [])].sort());
    return fieldsDirty || catsDirty;
  }, [form, initialForm]);

  const { data: p } = useQuery({ queryKey: ["partner", id], queryFn: () => getPartner({ data: { id } }) });
  const { data: audit } = useQuery({
    queryKey: ["audit", id],
    queryFn: () => listAudit({ data: { record_id: id } }),
    enabled: isAdmin,
  });
  const { data: cats } = useQuery({ queryKey: ["categories"], queryFn: () => listCategories() });
  const { data: cityResults } = useQuery({
    queryKey: ["cities-pick", cityQuery],
    queryFn: () => searchCities({ data: { q: cityQuery, limit: 20 } }),
    enabled: cityQuery.length >= 2,
  });

  useEffect(() => {
    if (!p) return;
    const loaded = {
      first_name: p.first_name ?? "",
      last_name: p.last_name ?? "",
      email: p.email ?? "",
      phone: p.phone ?? "",
      mobile: p.mobile ?? "",
      city_id: p.city_id ?? null,
      raw_city: p.raw_city ?? "",
      raw_province: p.raw_province ?? "",
      status: p.status ?? "new",
      partner_type: p.partner_type ?? "individual",
      notes: p.notes ?? "",
      category_ids: p.res_partner_category_rel?.map((r: any) => r.category_id) ?? [],
    };
    setForm(loaded);
    setInitialForm(loaded);
  }, [p?.id]);

  const territorialCats = (cats ?? []).filter(
    (c: any) => c.category_type === "territorial" && c.name.toLowerCase() !== "validation"
  );
  const validationId = (cats ?? []).find((c: any) => c.name.toLowerCase() === "validation")?.id;

  async function save() {
    const cleanCatIds = validationId
      ? form.category_ids.filter((x: string) => x !== validationId)
      : form.category_ids;
    if (cleanCatIds.length === 0) {
      if (!confirm("Questo contatto non ha nessun gruppo assegnato. Vuoi salvare comunque?")) return;
    }
    setSaving(true);
    try {
      await upsertPartner({
        data: {
          id: p?.id,
          first_name: form.first_name || null,
          last_name: form.last_name || null,
          email: form.email || null,
          phone: form.phone || null,
          mobile: form.mobile || null,
          city_id: form.city_id || null,
          raw_city: form.raw_city || null,
          raw_province: form.raw_province || null,
          status: form.status,
          partner_type: form.partner_type,
          notes: form.notes || null,
          category_ids: cleanCatIds,
        },
      });
      toast.success("Salvato");
      const saved = { ...form, category_ids: cleanCatIds };
      setInitialForm(saved);
      qc.invalidateQueries({ queryKey: ["partner", id] });
    } catch (e: any) { toast.error(e.message ?? "Errore"); }
    setSaving(false);
  }

  async function handleRevoke(sub: any) {
    if (!confirm(`Revocare la tessera ${sub.membership_number ?? sub.year}? L'operazione non può essere annullata.`)) return;
    try {
      await revokeSubscription({ data: { id: sub.id, partner_id: id } });
      toast.success("Tessera revocata");
      qc.invalidateQueries({ queryKey: ["partner", id] });
    } catch (e: any) { toast.error(e.message ?? "Errore"); }
  }

  const hasActiveSub = p?.membership_subscription?.some((s: any) => s.year === year && s.status === "active");
  const partnerName = p?.display_name || `${p?.first_name ?? ""} ${p?.last_name ?? ""}`.trim() || "Contatto";
  const headerMeta = [p?.email, p?.phone].filter(Boolean).join(" · ");
  const sortedSubs = [...(p?.membership_subscription ?? [])].sort((a: any, b: any) => b.year - a.year);
  const sortedConsents = [...(p?.privacy_consent ?? [])]
    .filter((c: any) => c.consent_type === "privacy_policy")
    .sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  const saveBtn = (
    <div className="flex justify-end pt-4">
      <Button size="sm" onClick={save} disabled={!isDirty || saving}>
        <Save className="h-4 w-4 mr-1.5" />{saving ? "Salvataggio…" : "Salva"}
      </Button>
    </div>
  );

  return (
    <AppShell
      title={
        <span className="flex items-center gap-2 flex-wrap">
          <PartnerTypeIcon type={p?.partner_type} />
          <span>{partnerName}</span>
          {headerMeta && (
            <span className="text-sm font-normal text-muted-foreground font-sans">({headerMeta})</span>
          )}
        </span>
      }
    >
      <div>
        <Card className="rounded-2xl border-0 shadow-sm overflow-hidden">
          <div className="divide-y divide-border/20">

            {/* Gruppi */}
            <div>
              <SectionHeader title="Gruppi" icon={FolderTree} isOpen={open.groups} onToggle={() => toggle("groups")} />
              {open.groups && (
                <div className="px-5 pb-5 pt-2">
                  <div className="flex flex-wrap gap-2 mb-1">
                    {territorialCats.length === 0 && (
                      <p className="text-sm text-muted-foreground">Nessun gruppo territoriale disponibile.</p>
                    )}
                    {territorialCats.map((c: any) => {
                      const active = form.category_ids.includes(c.id);
                      return (
                        <button type="button" key={c.id}
                          onClick={() => set("category_ids", active
                            ? form.category_ids.filter((x: string) => x !== c.id)
                            : [...form.category_ids, c.id]
                          )}
                        >
                          <Badge variant={active ? "default" : "outline"} className="rounded-full cursor-pointer">{c.name}</Badge>
                        </button>
                      );
                    })}
                  </div>
                  {saveBtn}
                </div>
              )}
            </div>

            {/* Anagrafica */}
            <div>
              <SectionHeader title="Anagrafica" icon={User} isOpen={open.anagrafica} onToggle={() => toggle("anagrafica")} />
              {open.anagrafica && (
                <div className="px-5 pb-5 pt-2">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Tipo</Label>
                      <Select value={form.partner_type ?? "individual"} onValueChange={v => set("partner_type", v)}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="individual">Non specificato</SelectItem>
                          <SelectItem value="activist">Attivista</SelectItem>
                          <SelectItem value="citizen">Cittadino</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Stato</Label>
                      <Select value={form.status} onValueChange={v => set("status", v)}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>{STATUS.map(s => <SelectItem key={s} value={s}>{STATUS_LABEL[s]}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label>Nome</Label>
                      <Input value={form.first_name ?? ""} onChange={e => set("first_name", e.target.value)} />
                    </div>
                    <div className="space-y-2">
                      <Label>Cognome</Label>
                      <Input value={form.last_name ?? ""} onChange={e => set("last_name", e.target.value)} />
                    </div>

                    {/* Email + Città 50/50 */}
                    <div className="space-y-2">
                      <Label>Email</Label>
                      <Input type="email" value={form.email ?? ""} onChange={e => set("email", e.target.value)} />
                    </div>
                    <div className="space-y-2">
                      <Label>Città</Label>
                      {form.city_id ? (
                        <div className="flex items-center gap-2">
                          <div className="flex-1 text-sm border border-input rounded-md px-3 h-10 flex items-center bg-muted/20">
                            {form.raw_city}{form.raw_province ? ` (${form.raw_province})` : ""}
                          </div>
                          <Button type="button" size="sm" variant="outline"
                            onClick={() => { set("city_id", null); set("raw_city", ""); set("raw_province", ""); setCityQuery(""); }}
                          >
                            Cambia
                          </Button>
                        </div>
                      ) : (
                        <div className="relative">
                          <Input placeholder="Cerca città…" value={cityQuery} onChange={e => setCityQuery(e.target.value)} />
                          {cityResults && cityResults.length > 0 && cityQuery.length >= 2 && (
                            <div className="absolute z-10 top-full left-0 right-0 bg-popover border border-border rounded-xl mt-1 shadow-lg max-h-48 overflow-auto divide-y divide-border/40">
                              {cityResults.map((c: any) => (
                                <button key={c.id} type="button"
                                  className="w-full text-left px-3 py-2 hover:bg-muted text-sm"
                                  onClick={() => { set("city_id", c.id); set("raw_city", c.name); set("raw_province", c.province_code); setCityQuery(""); }}
                                >
                                  {c.name} <span className="text-muted-foreground">({c.province_code})</span>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="space-y-2">
                      <Label>Telefono</Label>
                      <Input value={form.phone ?? ""} onChange={e => set("phone", e.target.value)} placeholder="+39 000 000 0000" />
                      <p className="text-xs text-muted-foreground">Includi il prefisso internazionale (+39 Italia)</p>
                    </div>
                    <div className="space-y-2">
                      <Label>Telefono alternativo</Label>
                      <Input value={form.mobile ?? ""} onChange={e => set("mobile", e.target.value)} placeholder="+39 000 000 0000" />
                    </div>

                    <div className="space-y-2 md:col-span-2">
                      <Label>Note</Label>
                      <Textarea rows={3} value={form.notes ?? ""} onChange={e => set("notes", e.target.value)} />
                    </div>
                  </div>
                  {saveBtn}
                </div>
              )}
            </div>

            {/* Tessere */}
            <div>
              <SectionHeader title="Tessere" icon={CreditCard} isOpen={open.subs} onToggle={() => toggle("subs")} />
              {open.subs && (
                <div className="px-5 pb-5 pt-2">
                  <div className="flex items-center justify-between mb-4">
                    <p className="text-sm font-medium text-foreground">Storico tessere</p>
                    {!hasActiveSub && p && (
                      <Button size="sm" onClick={() => setSubOpen(true)}>
                        <BadgeCheck className="h-4 w-4 mr-1.5" />Tessera
                      </Button>
                    )}
                  </div>
                  {sortedSubs.length ? (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-xs uppercase text-muted-foreground border-b border-border/40">
                            <th className="text-left py-2 pr-4">N° Tessera</th>
                            <th className="text-left py-2 pr-4">Emissione</th>
                            <th className="text-left py-2 pr-4">Scadenza</th>
                            <th className="text-left py-2 pr-4">Stato</th>
                            <th className="py-2 w-8"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {sortedSubs.map((s: any) => (
                            <tr key={s.id} className="border-b border-border/20 last:border-0">
                              <td className="py-3 pr-4">
                                <span className="font-mono text-xs font-semibold bg-muted px-2 py-0.5 rounded">
                                  {s.membership_number ?? `${s.year}`}
                                </span>
                              </td>
                              <td className="py-3 pr-4 text-muted-foreground text-xs">{s.start_date ?? "—"}</td>
                              <td className="py-3 pr-4 text-muted-foreground text-xs">{s.end_date ?? "—"}</td>
                              <td className="py-3 pr-4">
                                <Badge variant="secondary" className={`rounded-full w-24 justify-center text-xs font-semibold tracking-wide ${
                                  s.status === "active"
                                    ? "bg-emerald-100 text-emerald-900 border-emerald-200"
                                    : s.status === "revoked"
                                    ? "bg-destructive/10 text-destructive border-destructive/20"
                                    : "bg-muted text-muted-foreground"
                                }`}>
                                  {s.status === "active" ? "TESSERATO" : s.status === "revoked" ? "REVOCATO" : "INATTIVO"}
                                </Badge>
                              </td>
                              <td className="py-3">
                                {s.status === "active" && (
                                  <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                      <Button size="icon" variant="ghost" className="h-7 w-7">
                                        <MoreHorizontal className="h-4 w-4" />
                                      </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end">
                                      <DropdownMenuItem
                                        className="text-destructive focus:text-destructive cursor-pointer"
                                        onClick={() => handleRevoke(s)}
                                      >
                                        Revoca
                                      </DropdownMenuItem>
                                    </DropdownMenuContent>
                                  </DropdownMenu>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="text-muted-foreground text-sm">Nessuna tessera registrata.</p>
                  )}
                </div>
              )}
            </div>

            {/* Privacy & Consensi */}
            <div>
              <SectionHeader title="Privacy & Consensi" icon={FileText} isOpen={open.consent} onToggle={() => toggle("consent")} />
              {open.consent && (
                <div className="px-5 pb-5 pt-2">
                  <div className="flex items-center justify-between mb-4">
                    <p className="text-sm font-medium text-foreground">Consensi Privacy Policy</p>
                    <Button size="sm" onClick={() => setConsentOpen(true)}>
                      <Plus className="h-4 w-4 mr-1" />Nuovo consenso
                    </Button>
                  </div>
                  {sortedConsents.length ? (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-xs uppercase text-muted-foreground border-b border-border/40">
                            <th className="text-left py-2 pr-4">Data</th>
                            <th className="text-left py-2 pr-4">Canale</th>
                            <th className="text-left py-2">Risposta</th>
                          </tr>
                        </thead>
                        <tbody>
                          {sortedConsents.map((c: any) => (
                            <tr key={c.id} className="border-b border-border/20 last:border-0">
                              <td className="py-3 pr-4 text-muted-foreground text-xs whitespace-nowrap">
                                {new Date(c.accepted_at ?? c.created_at).toLocaleDateString("it-IT")}
                              </td>
                              <td className="py-3 pr-4 text-muted-foreground text-xs">
                                {CHANNEL_LABEL[c.channel] ?? c.channel ?? "—"}
                              </td>
                              <td className="py-3">
                                <Badge className={`rounded-full text-xs ${c.accepted ? "bg-emerald-100 text-emerald-900" : "bg-rose-100 text-rose-900"}`}>
                                  {c.accepted ? "Espresso" : "Rifiutato"}
                                </Badge>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="text-muted-foreground text-sm">Nessun consenso registrato.</p>
                  )}
                </div>
              )}
            </div>

            {/* Cronologia — admin only */}
            {isAdmin && (
              <div>
                <SectionHeader title="Cronologia" icon={ScrollText} isOpen={open.audit} onToggle={() => toggle("audit")} />
                {open.audit && (
                  <div className="px-5 pb-5 pt-2">
                    {audit?.length ? (
                      <ul className="divide-y divide-border/40">
                        {audit.map((l: any) => <AuditEntry key={l.id} log={l} />)}
                      </ul>
                    ) : (
                      <p className="text-muted-foreground text-sm">Nessuna voce di cronologia.</p>
                    )}
                  </div>
                )}
              </div>
            )}

          </div>
        </Card>
      </div>

      {p && (
        <SubscriptionDialog
          open={subOpen}
          onOpenChange={setSubOpen}
          partnerId={p.id}
          onSaved={() => { qc.invalidateQueries({ queryKey: ["partner", id] }); toast.success("Tessera creata"); }}
        />
      )}
      {p && (
        <ConsentDialog
          open={consentOpen}
          onOpenChange={setConsentOpen}
          partnerId={p.id}
          onSaved={() => qc.invalidateQueries({ queryKey: ["partner", id] })}
        />
      )}
    </AppShell>
  );
}
