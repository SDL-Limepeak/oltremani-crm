import { createFileRoute, useParams } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ContactForm } from "@/components/contact-form";
import { SubscriptionDialog } from "@/components/subscription-dialog";
import { ConsentDialog } from "@/components/consent-dialog";
import { getPartner } from "@/lib/partners.functions";
import { revokeSubscription } from "@/lib/subscriptions.functions";
import { listAudit } from "@/lib/audit.functions";
import { useAuthUser } from "@/hooks/use-auth-user";
import { BadgeCheck, Plus, AlertCircle, HeartHandshake, Home, UserRound } from "lucide-react";

export const Route = createFileRoute("/_authenticated/contacts/$id")({
  ssr: false,
  head: () => ({ meta: [{ title: "Contatto · Oltremani" }] }),
  component: ContactDetail,
});

const CHANNEL_LABEL: Record<string, string> = {
  telefono: "Telefono", email: "Email", cartaceo: "Cartaceo",
  di_persona: "Di persona", web: "Web", altro: "Altro",
};

const SKIP_DIFF_FIELDS = new Set([
  "id", "created_at", "updated_at", "created_by", "updated_by",
  "display_name",
]);

const FIELD_LABEL: Record<string, string> = {
  first_name: "Nome", last_name: "Cognome", email: "Email",
  phone: "Telefono", mobile: "Cellulare", status: "Stato",
  partner_type: "Tipo", notes: "Note", raw_city: "Città",
  raw_province: "Provincia", city_id: "Città (DB)",
  year: "Anno", start_date: "Inizio", end_date: "Fine",
  membership_number: "N° tessera",
};

function diffJson(oldObj: any, newObj: any) {
  if (!oldObj || !newObj) return [];
  return Object.keys(newObj).flatMap(k => {
    if (SKIP_DIFF_FIELDS.has(k)) return [];
    const ov = oldObj[k];
    const nv = newObj[k];
    if (ov === nv) return [];
    return [{ field: FIELD_LABEL[k] ?? k, old: ov, new: nv }];
  });
}

function AuditEntry({ log, isAdmin }: { log: any; isAdmin: boolean }) {
  const diffs = log.action === "update" ? diffJson(log.old_values_json, log.new_values_json) : [];

  return (
    <li className="py-3 text-sm">
      <div className="flex justify-between items-start gap-2">
        <div>
          <span className="font-medium capitalize">{log.action}</span>
          <span className="text-muted-foreground"> · {log.model_name ?? log.log_type}</span>
          {log.res_users && <span className="text-muted-foreground"> · da {log.res_users.name}</span>}
        </div>
        <span className="text-muted-foreground text-xs whitespace-nowrap">
          {new Date(log.created_at).toLocaleString("it-IT")}
        </span>
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

function PartnerTypeIcon({ type }: { type?: string }) {
  if (type === "activist") return <span title="Attivista"><HeartHandshake className="h-5 w-5 text-[#E8921E]" /></span>;
  if (type === "citizen")  return <span title="Cittadino"><Home className="h-5 w-5 text-[#1E3271]" /></span>;
  return <span title="Tipo non specificato"><UserRound className="h-5 w-5 text-muted-foreground/40" /></span>;
}

function ContactDetail() {
  const { id } = useParams({ from: "/_authenticated/contacts/$id" });
  const qc = useQueryClient();
  const { profile } = useAuthUser();
  const isAdmin = profile?.role === "admin";

  const { data: p } = useQuery({ queryKey: ["partner", id], queryFn: () => getPartner({ data: { id } }) });
  const { data: audit } = useQuery({
    queryKey: ["audit", id],
    queryFn: () => listAudit({ data: { record_id: id } }),
    enabled: isAdmin,
  });

  const [subOpen, setSubOpen] = useState(false);
  const [consentOpen, setConsentOpen] = useState(false);

  const year = new Date().getFullYear();
  const hasActiveSub = p?.membership_subscription?.some((s: any) => s.year === year && s.status === "active");
  const noGroup = !p?.res_partner_category_rel?.length;

  async function handleRevoke(sub: any) {
    if (!confirm(`Revocare la tessera ${sub.membership_number ?? sub.year}? L'operazione non può essere annullata.`)) return;
    try {
      await revokeSubscription({ data: { id: sub.id, partner_id: id } });
      toast.success("Tessera revocata");
      qc.invalidateQueries({ queryKey: ["partner", id] });
    } catch (e: any) {
      toast.error(e.message ?? "Errore");
    }
  }

  return (
    <AppShell
      title={
        <span className="flex items-center gap-2">
          <PartnerTypeIcon type={p?.partner_type} />
          {p?.display_name || `${p?.first_name ?? ""} ${p?.last_name ?? ""}`.trim() || "Contatto"}
        </span>
      }
      subtitle={p?.email ?? ""}
      actions={
        noGroup && p ? (
          <span className="flex items-center gap-1 text-sm text-[#E8921E]">
            <AlertCircle className="h-4 w-4" />Nessun gruppo assegnato
          </span>
        ) : undefined
      }
    >
      <Tabs defaultValue="data" className="space-y-4">
        <TabsList className="bg-muted/40 rounded-full p-1">
          <TabsTrigger value="data" className="rounded-full">Dati</TabsTrigger>
          <TabsTrigger value="subs" className="rounded-full">Tessere</TabsTrigger>
          <TabsTrigger value="consents" className="rounded-full">Consensi</TabsTrigger>
          {isAdmin && <TabsTrigger value="audit" className="rounded-full">Cronologia</TabsTrigger>}
        </TabsList>

        {/* Dati */}
        <TabsContent value="data">
          {p && <ContactForm initial={p} onSaved={() => qc.invalidateQueries({ queryKey: ["partner", id] })} />}
        </TabsContent>

        {/* Tessere */}
        <TabsContent value="subs">
          {!hasActiveSub && p && (
            <div className="flex justify-end mb-3">
              <Button onClick={() => setSubOpen(true)}>
                <BadgeCheck className="h-4 w-4 mr-2" />Abilita socio
              </Button>
            </div>
          )}
          <Card className="p-6 rounded-2xl border-0 shadow-sm">
            {p?.membership_subscription?.length ? (
              <ul className="divide-y divide-border/40">
                {p.membership_subscription
                  .slice()
                  .sort((a: any, b: any) => b.year - a.year)
                  .map((s: any) => (
                    <li key={s.id} className="py-3 flex items-center justify-between gap-3 text-sm flex-wrap">
                      <div className="flex items-center gap-3">
                        {s.membership_number && (
                          <span className="font-mono text-xs font-semibold bg-muted px-2 py-0.5 rounded">
                            {s.membership_number}
                          </span>
                        )}
                        <span>Anno <strong>{s.year}</strong> · {s.start_date} → {s.end_date ?? "—"}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge
                          variant={s.status === "active" ? "default" : "secondary"}
                          className={`rounded-full ${s.status === "revoked" ? "bg-destructive/10 text-destructive border-destructive/20" : ""}`}
                        >
                          {s.status === "active" ? "Attiva" : s.status === "revoked" ? "Revocata" : "Inattiva"}
                        </Badge>
                        {s.status === "active" && (
                          <Button
                            size="sm" variant="ghost"
                            className="h-7 px-2 text-xs text-destructive hover:text-destructive"
                            onClick={() => handleRevoke(s)}
                          >
                            Revoca
                          </Button>
                        )}
                      </div>
                    </li>
                  ))}
              </ul>
            ) : (
              <p className="text-muted-foreground text-sm">Nessuna tessera registrata.</p>
            )}
          </Card>
        </TabsContent>

        {/* Consensi */}
        <TabsContent value="consents">
          <div className="flex justify-between items-center mb-3">
            <p className="text-sm text-muted-foreground">Storico consensi Privacy Policy</p>
            <Button size="sm" onClick={() => setConsentOpen(true)}>
              <Plus className="h-4 w-4 mr-1" />Nuovo consenso
            </Button>
          </div>
          <Card className="p-6 rounded-2xl border-0 shadow-sm">
            {p?.privacy_consent?.length ? (
              <ul className="divide-y divide-border/40">
                {p.privacy_consent
                  .filter((c: any) => c.consent_type === "privacy_policy")
                  .slice()
                  .sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
                  .map((c: any) => (
                    <li key={c.id} className="py-3 text-sm">
                      <div className="flex justify-between items-start gap-2 flex-wrap">
                        <div className="flex items-center gap-2">
                          <Badge
                            className={`rounded-full text-xs ${c.accepted ? "bg-emerald-100 text-emerald-900" : "bg-rose-100 text-rose-900"}`}
                          >
                            {c.accepted ? "Accettato" : "Rifiutato/Revocato"}
                          </Badge>
                          {c.channel && (
                            <span className="text-xs text-muted-foreground">
                              via {CHANNEL_LABEL[c.channel] ?? c.channel}
                            </span>
                          )}
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {new Date(c.accepted_at ?? c.created_at).toLocaleDateString("it-IT")}
                        </span>
                      </div>
                      {c.notes && <p className="mt-1 text-xs text-muted-foreground">{c.notes}</p>}
                    </li>
                  ))}
              </ul>
            ) : (
              <p className="text-muted-foreground text-sm">Nessun consenso registrato.</p>
            )}
          </Card>
        </TabsContent>

        {/* Cronologia — admin only */}
        {isAdmin && (
          <TabsContent value="audit">
            <Card className="p-6 rounded-2xl border-0 shadow-sm">
              {audit?.length ? (
                <ul className="divide-y divide-border/40">
                  {audit.map((l: any) => (
                    <AuditEntry key={l.id} log={l} isAdmin={isAdmin} />
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground text-sm">Nessuna voce di cronologia.</p>
              )}
            </Card>
          </TabsContent>
        )}
      </Tabs>

      {p && (
        <SubscriptionDialog
          open={subOpen}
          onOpenChange={setSubOpen}
          partnerId={p.id}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ["partner", id] });
            toast.success("Tessera creata");
          }}
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
