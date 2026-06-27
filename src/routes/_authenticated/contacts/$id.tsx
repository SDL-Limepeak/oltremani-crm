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
import { ValidationDialog } from "@/components/validation-dialog";
import { getPartner } from "@/lib/partners.functions";
import { listAudit } from "@/lib/audit.functions";
import { BadgeCheck, ShieldAlert } from "lucide-react";

export const Route = createFileRoute("/_authenticated/contacts/$id")({
  ssr: false,
  head: () => ({ meta: [{ title: "Contatto · Oltremani" }] }),
  component: ContactDetail,
});

function ContactDetail() {
  const { id } = useParams({ from: "/_authenticated/contacts/$id" });
  const qc = useQueryClient();
  const { data: p } = useQuery({ queryKey: ["partner", id], queryFn: () => getPartner({ data: { id } }) });
  const { data: audit } = useQuery({ queryKey: ["audit", id], queryFn: () => listAudit({ data: { record_id: id } }) });

  const [subOpen, setSubOpen] = useState(false);
  const [valOpen, setValOpen] = useState(false);

  const year = new Date().getFullYear();
  const hasActiveSub = p?.membership_subscription?.some((s: any) => s.year === year && s.status === "active");
  const isValidation = p?.res_partner_category_rel?.some((r: any) => r.res_partner_category?.name === "Validation");

  return (
    <AppShell
      title={p?.display_name || `${p?.first_name ?? ""} ${p?.last_name ?? ""}`.trim() || "Contatto"}
      subtitle={p?.email ?? ""}
      actions={
        <div className="flex gap-2 flex-wrap">
          {isValidation && (
            <Button variant="outline" onClick={() => setValOpen(true)}>
              <ShieldAlert className="h-4 w-4 mr-2" />Valida
            </Button>
          )}
          {!hasActiveSub && p && (
            <Button onClick={() => setSubOpen(true)}>
              <BadgeCheck className="h-4 w-4 mr-2" />Abilita socio
            </Button>
          )}
        </div>
      }
    >
      <Tabs defaultValue="data" className="space-y-4">
        <TabsList className="bg-muted/40 rounded-full p-1">
          <TabsTrigger value="data" className="rounded-full">Dati</TabsTrigger>
          <TabsTrigger value="subs" className="rounded-full">Tessere</TabsTrigger>
          <TabsTrigger value="consents" className="rounded-full">Consensi</TabsTrigger>
          <TabsTrigger value="audit" className="rounded-full">Cronologia</TabsTrigger>
        </TabsList>

        <TabsContent value="data">
          {p && <ContactForm initial={p} onSaved={() => qc.invalidateQueries({ queryKey: ["partner", id] })} />}
        </TabsContent>

        <TabsContent value="subs">
          <Card className="p-6 rounded-2xl border-0 shadow-sm">
            {p?.membership_subscription?.length ? (
              <ul className="divide-y divide-border/40">
                {p.membership_subscription.map((s: any) => (
                  <li key={s.id} className="py-3 flex justify-between text-sm">
                    <span>Anno <strong>{s.year}</strong> · {s.start_date} → {s.end_date ?? "—"}</span>
                    <Badge variant={s.status === "active" ? "default" : "secondary"} className="rounded-full">{s.status}</Badge>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground text-sm">Nessuna tessera registrata.</p>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="consents">
          <Card className="p-6 rounded-2xl border-0 shadow-sm">
            {p?.privacy_consent?.length ? (
              <ul className="divide-y divide-border/40">
                {p.privacy_consent.map((c: any) => (
                  <li key={c.id} className="py-3 flex justify-between text-sm">
                    <span>{c.consent_type} · v{c.version ?? "—"}</span>
                    <span className="text-muted-foreground">{c.accepted ? "Accettato" : "Rifiutato"} · {new Date(c.accepted_at ?? c.created_at).toLocaleDateString("it-IT")}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground text-sm">Nessun consenso registrato.</p>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="audit">
          <Card className="p-6 rounded-2xl border-0 shadow-sm">
            {audit?.length ? (
              <ul className="divide-y divide-border/40">
                {audit.map((l: any) => (
                  <li key={l.id} className="py-3 text-sm">
                    <div className="flex justify-between">
                      <span><strong>{l.action}</strong> · {l.model_name ?? l.log_type}</span>
                      <span className="text-muted-foreground text-xs">{new Date(l.created_at).toLocaleString("it-IT")}</span>
                    </div>
                    {l.res_users && <p className="text-xs text-muted-foreground">da {l.res_users.name}</p>}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground text-sm">Nessuna voce di audit.</p>
            )}
          </Card>
        </TabsContent>
      </Tabs>

      {p && <SubscriptionDialog open={subOpen} onOpenChange={setSubOpen} partnerId={p.id} onSaved={() => { qc.invalidateQueries({ queryKey: ["partner", id] }); toast.success("Tessera creata"); }} />}
      {p && <ValidationDialog open={valOpen} onOpenChange={setValOpen} partnerId={p.id} defaultProvince={p.raw_province ?? undefined} defaultCity={p.raw_city ?? undefined} onSaved={() => { qc.invalidateQueries({ queryKey: ["partner", id] }); toast.success("Contatto validato"); }} />}
    </AppShell>
  );
}
