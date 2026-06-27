import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { searchCities, setCityCategory } from "@/lib/cities.functions";
import { listCategories } from "@/lib/categories.functions";

export const Route = createFileRoute("/_authenticated/cities")({
  ssr: false,
  head: () => ({ meta: [{ title: "Città · Oltremani" }] }),
  component: CitiesPage,
});

function CitiesPage() {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const { data: cats } = useQuery({ queryKey: ["categories"], queryFn: () => listCategories() });
  const { data: cities, isLoading } = useQuery({
    queryKey: ["cities", q],
    queryFn: () => searchCities({ data: { q, limit: 100 } }),
  });

  return (
    <AppShell title="Città" subtitle="Mappatura comuni e gruppi territoriali">
      <Card className="p-4 rounded-2xl border-0 shadow-sm mb-4">
        <Input placeholder="Cerca città…" value={q} onChange={e => setQ(e.target.value)} />
      </Card>
      <Card className="rounded-2xl border-0 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground">
              <tr><th className="p-4">Comune</th><th className="p-4">Provincia</th><th className="p-4">Regione</th><th className="p-4">Gruppo</th></tr>
            </thead>
            <tbody>
              {isLoading && <tr><td colSpan={4} className="p-6 text-muted-foreground">Caricamento…</td></tr>}
              {!isLoading && !cities?.length && <tr><td colSpan={4} className="p-6 text-muted-foreground">Nessun comune trovato.</td></tr>}
              {cities?.map((c: any) => (
                <tr key={c.id} className="border-t border-border/40">
                  <td className="p-4 font-medium">{c.name}</td>
                  <td className="p-4 text-muted-foreground">{c.province_code}</td>
                  <td className="p-4 text-muted-foreground">{c.region}</td>
                  <td className="p-4">
                    <Select
                      value={c.category_id ?? "none"}
                      onValueChange={async (v) => {
                        try {
                          await setCityCategory({ data: { city_id: c.id, category_id: v === "none" ? null : v } });
                          toast.success("Aggiornato");
                          qc.invalidateQueries({ queryKey: ["cities"] });
                        } catch (e: any) { toast.error(e.message ?? "Errore"); }
                      }}
                    >
                      <SelectTrigger className="w-56"><SelectValue placeholder="—" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">— Nessuno —</SelectItem>
                        {cats?.filter(x => x.category_type === "territorial").map(x => <SelectItem key={x.id} value={x.id}>{x.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
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
