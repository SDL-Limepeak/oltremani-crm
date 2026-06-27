import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { searchCities } from "@/lib/cities.functions";
import { validatePartner } from "@/lib/partners.functions";

export function ValidationDialog({ open, onOpenChange, partnerId, defaultCity, defaultProvince, onSaved }: { open: boolean; onOpenChange: (b: boolean) => void; partnerId: string; defaultCity?: string; defaultProvince?: string; onSaved?: () => void }) {
  const [q, setQ] = useState(defaultCity ?? "");
  const [selected, setSelected] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const { data: cities } = useQuery({ queryKey: ["cities-val", q, defaultProvince], queryFn: () => searchCities({ data: { q, province_code: defaultProvince, limit: 30 } }), enabled: q.length >= 2 });

  async function save() {
    if (!selected) return toast.error("Seleziona una città");
    setSaving(true);
    try {
      await validatePartner({ data: { partner_id: partnerId, city_id: selected } });
      onSaved?.();
      onOpenChange(false);
    } catch (e: any) { toast.error(e.message ?? "Errore"); }
    setSaving(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-2xl">
        <DialogHeader><DialogTitle>Valida contatto</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <Label>Cerca città valida</Label>
          <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Nome del comune…" />
          {cities && cities.length > 0 && (
            <div className="border border-border rounded-xl divide-y divide-border/40 max-h-64 overflow-auto">
              {cities.map((c: any) => (
                <button key={c.id} type="button" onClick={() => setSelected(c.id)} className={`w-full text-left px-3 py-2 text-sm hover:bg-muted ${selected === c.id ? "bg-muted" : ""}`}>
                  {c.name} <span className="text-muted-foreground">({c.province_code})</span>
                  {c.res_partner_category && <span className="text-xs text-muted-foreground ml-2">→ {c.res_partner_category.name}</span>}
                </button>
              ))}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Annulla</Button>
          <Button onClick={save} disabled={saving || !selected}>{saving ? "Salvataggio…" : "Valida"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
