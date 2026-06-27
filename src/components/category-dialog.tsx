import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export type CategoryFormValues = {
  id?: string;
  name: string;
  parent_id: string | null;
  category_type: "territorial";
  status: "active" | "inactive";
  president_first_name?: string | null;
  president_last_name?: string | null;
  president_email?: string | null;
  phone?: string | null;
  mobile?: string | null;
  fiscal_code?: string | null;
  address?: string | null;
  city?: string | null;
  province_code?: string | null;
  iban?: string | null;
};

export function CategoryDialog({ open, onOpenChange, initial, onSaved }: { open: boolean; onOpenChange: (b: boolean) => void; initial?: any; onSaved: (vals: CategoryFormValues) => void }) {
  const [f, setF] = useState<CategoryFormValues>({ name: "", parent_id: null, category_type: "territorial", status: "active" });

  useEffect(() => {
    if (initial) setF({ ...f, ...initial });
    else setF({ name: "", parent_id: null, category_type: "territorial", status: "active" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function set<K extends keyof CategoryFormValues>(k: K, v: CategoryFormValues[K]) { setF(s => ({ ...s, [k]: v })); }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-2xl max-w-2xl">
        <DialogHeader><DialogTitle>{initial?.id ? "Modifica gruppo" : "Nuovo gruppo"}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-2 md:col-span-2"><Label>Nome</Label><Input value={f.name} onChange={e => set("name", e.target.value)} /></div>
          <div className="space-y-2">
            <Label>Stato</Label>
            <Select value={f.status} onValueChange={v => set("status", v as any)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Attivo</SelectItem>
                <SelectItem value="inactive">Inattivo</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2"><Label>Presidente — Nome</Label><Input value={f.president_first_name ?? ""} onChange={e => set("president_first_name", e.target.value)} /></div>
          <div className="space-y-2"><Label>Presidente — Cognome</Label><Input value={f.president_last_name ?? ""} onChange={e => set("president_last_name", e.target.value)} /></div>
          <div className="space-y-2"><Label>Email referente</Label><Input type="email" value={f.president_email ?? ""} onChange={e => set("president_email", e.target.value)} /></div>
          <div className="space-y-2"><Label>Telefono</Label><Input value={f.phone ?? ""} onChange={e => set("phone", e.target.value)} /></div>
          <div className="space-y-2"><Label>Codice Fiscale</Label><Input value={f.fiscal_code ?? ""} onChange={e => set("fiscal_code", e.target.value)} /></div>
          <div className="space-y-2"><Label>IBAN</Label><Input value={f.iban ?? ""} onChange={e => set("iban", e.target.value)} /></div>
          <div className="space-y-2 md:col-span-2"><Label>Indirizzo</Label><Input value={f.address ?? ""} onChange={e => set("address", e.target.value)} /></div>
          <div className="space-y-2"><Label>Città</Label><Input value={f.city ?? ""} onChange={e => set("city", e.target.value)} /></div>
          <div className="space-y-2"><Label>Provincia</Label><Input value={f.province_code ?? ""} onChange={e => set("province_code", e.target.value)} maxLength={2} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Annulla</Button>
          <Button onClick={() => onSaved(f)} disabled={!f.name.trim()}>Salva</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
