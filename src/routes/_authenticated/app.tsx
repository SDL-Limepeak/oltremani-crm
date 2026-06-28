import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, ScrollText } from "lucide-react";

export const Route = createFileRoute("/_authenticated/app")({
  ssr: false,
  head: () => ({ meta: [{ title: "App · Oltremani" }] }),
  component: AppInfoPage,
});

const RELEASE_NOTES = [
  {
    version: "1.0.0",
    date: "2026-06-28",
    notes: [
      "Partner type: Attivista, Cittadino, Non specificato con icone e filtri",
      "Tessere con numero progressivo YYXXXXX, emissione e revoca",
      "Consensi Privacy Policy con storico completo e canale di raccolta",
      "Cronologia modifiche per admin con dettaglio campi",
      "Dashboard con statistiche e grafici a torta per tipo e gruppo",
      "API pubblica per form di contatto (anon, SECURITY DEFINER)",
      "Gruppi territoriali ad albero con conteggio attivisti e cittadini",
      "Recupero password via email",
      "Gestione città con assegnazione a gruppi territoriali",
      "Guida in-app con HOW-TO per tutti i ruoli",
    ],
  },
];

function AppInfoPage() {
  const latestVersion = RELEASE_NOTES[RELEASE_NOTES.length - 1].version;
  const [openVersions, setOpenVersions] = useState<Set<string>>(new Set([latestVersion]));

  function toggleVersion(v: string) {
    setOpenVersions(prev => {
      const next = new Set(prev);
      next.has(v) ? next.delete(v) : next.add(v);
      return next;
    });
  }

  return (
    <AppShell title="App" subtitle="Informazioni sull'applicazione">
      <div className="space-y-4">

        {/* Limepeak credit */}
        <Card className="p-6 rounded-2xl border-0 shadow-sm">
          <div className="flex items-center gap-6">
            <div className="flex-1">
              <p className="text-xs text-muted-foreground uppercase tracking-wide mb-0.5">Sviluppato da</p>
              <p className="text-base font-semibold text-[#E8921E]">Limepeak</p>
              <p className="text-sm text-muted-foreground mt-1">
                Gestionale su misura per associazioni e realtà del terzo settore.
              </p>
              <a
                href="https://limepeak.it"
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-[#E8921E] underline underline-offset-2 hover:opacity-80 mt-0.5 inline-block"
              >
                limepeak.it
              </a>
            </div>
            <div className="flex-shrink-0">
              <img
                src="/logo-limepeak.png"
                alt="Limepeak"
                className="h-14 w-auto object-contain"
                onError={e => {
                  const el = e.currentTarget as HTMLImageElement;
                  el.style.display = "none";
                  const fb = el.nextElementSibling as HTMLElement | null;
                  if (fb) fb.style.display = "flex";
                }}
              />
              <div
                className="h-14 w-14 rounded-2xl bg-[#E8921E] items-center justify-center hidden"
                aria-hidden="true"
              >
                <span className="text-white font-bold text-xl font-serif">L</span>
              </div>
            </div>
          </div>
        </Card>

        {/* Release notes */}
        <Card className="rounded-2xl border-0 shadow-sm overflow-hidden">
          <div className="flex items-center gap-2 px-6 py-5 border-b border-border/30">
            <ScrollText className="h-4 w-4 text-[#E8921E]" />
            <h3 className="font-serif text-base font-semibold">Release notes</h3>
          </div>
          <div className="divide-y divide-border/30">
            {[...RELEASE_NOTES].reverse().map(r => {
              const isOpen = openVersions.has(r.version);
              return (
                <div key={r.version}>
                  <button
                    type="button"
                    onClick={() => toggleVersion(r.version)}
                    className="w-full flex items-center gap-3 px-6 py-4 text-left hover:bg-muted/30 transition-colors"
                  >
                    <Badge variant="outline" className="rounded-full font-mono text-xs">v{r.version}</Badge>
                    <span className="text-xs text-muted-foreground">{r.date}</span>
                    <ChevronDown className={`h-4 w-4 text-muted-foreground ml-auto transition-transform ${isOpen ? "rotate-180" : ""}`} />
                  </button>
                  {isOpen && (
                    <ul className="px-6 pb-5 space-y-1.5">
                      {r.notes.map((n, i) => (
                        <li key={i} className="text-sm text-muted-foreground flex gap-2">
                          <span className="text-[#E8921E] flex-shrink-0 mt-0.5">·</span>
                          {n}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        </Card>

      </div>
    </AppShell>
  );
}
