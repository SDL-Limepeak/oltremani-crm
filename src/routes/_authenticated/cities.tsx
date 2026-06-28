import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { CityDialog } from "@/components/city-dialog";
import { searchCities, setCityCategory, deleteCityById } from "@/lib/cities.functions";
import { listCategories } from "@/lib/categories.functions";
import { useAuthUser } from "@/hooks/use-auth-user";
import { Plus, MoreHorizontal } from "lucide-react";

export const Route = createFileRoute("/_authenticated/cities")({
  ssr: false,
  head: () => ({ meta: [{ title: "Città · Oltremani" }] }),
  component: CitiesPage,
});

function CitiesPage() {
  const qc = useQueryClient();
  const { profile } = useAuthUser();
  const canEdit = profile?.role === "admin" || profile?.role === "superuser";
  const [q, setQ] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editCity, setEditCity] = useState<any | null>(null);

  const { data: cats } = useQuery({ queryKey: ["categories"], queryFn: () => listCategories() });
  const { data: cities, isLoading } = useQuery({
    queryKey: ["cities", q],
    queryFn: () => searchCities({ data: { q, limit: 100 } }),
  });

  function openAdd() { setEditCity(null); setDialogOpen(true); }
  function openEdit(c: any) { setEditCity(c); setDialogOpen(true); }

  async function handleDelete(c: any) {
    if (!confirm(`Eliminare "${c.name}"? L'operazione non può essere annullata.`)) return;
    try {
      await deleteCityById({ data: { id: c.id } });
      toast.success("Città eliminata");
      qc.invalidateQueries({ queryKey: ["cities"] });
    } catch (e: any) { toast.error(e.message ?? "Errore"); }
  }

  return (
    <AppShell
      title="Città"
      subtitle="Mappatura comuni e gruppi territoriali"
      actions={
        canEdit ? (
          <Button size="sm" onClick={openAdd}>
            <Plus className="h-4 w-4 mr-1.5" />Aggiungi città
          </Button>
        ) : undefined
      }
    >
      <Card className="p-4 rounded-2xl border-0 shadow-sm mb-4">
        <Input placeholder="Cerca città…" value={q} onChange={e => setQ(e.target.value)} />
      </Card>
      <Card className="rounded-2xl border-0 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="p-4">Comune</th>
                <th className="p-4">Provincia</th>
                <th className="p-4">Regione</th>
                <th className="p-4">Gruppo</th>
                {canEdit && <th className="p-4 w-12"></th>}
              </tr>
            </thead>
            <tbody>
              {isLoading && <tr><td colSpan={canEdit ? 5 : 4} className="p-6 text-muted-foreground">Caricamento…</td></tr>}
              {!isLoading && !cities?.length && <tr><td colSpan={canEdit ? 5 : 4} className="p-6 text-muted-foreground">Nessun comune trovato.</td></tr>}
              {cities?.map((c: any) => (
                <tr key={c.id} className="border-t border-border/40">
                  <td className="p-4 font-medium">{c.name}</td>
                  <td className="p-4 text-muted-foreground">{c.province_code}</td>
                  <td className="p-4 text-muted-foreground">{c.region}</td>
                  <td className="p-4">
                    {canEdit ? (
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
                        <SelectTrigger className="w-52"><SelectValue placeholder="—" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">— Nessuno —</SelectItem>
                          {cats?.filter((x: any) => x.category_type === "territorial").map((x: any) => (
                            <SelectItem key={x.id} value={x.id}>{x.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <span className="text-sm text-muted-foreground">{c.res_partner_category?.name ?? "—"}</span>
                    )}
                  </td>
                  {canEdit && (
                    <td className="p-4">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button size="icon" variant="ghost" className="h-8 w-8">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem className="cursor-pointer" onClick={() => openEdit(c)}>
                            Modifica
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive cursor-pointer"
                            onClick={() => handleDelete(c)}
                          >
                            Elimina
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <CityDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        city={editCity}
        onSaved={() => qc.invalidateQueries({ queryKey: ["cities"] })}
      />
    </AppShell>
  );
}
