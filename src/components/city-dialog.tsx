import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { upsertCity } from "@/lib/cities.functions";
import { Save } from "lucide-react";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  city?: { id: string; name: string; province_code?: string | null; province?: string | null; region?: string | null } | null;
  onSaved: () => void;
};

const empty = { name: "", province_code: "", province: "", region: "" };

export function CityDialog({ open, onOpenChange, city, onSaved }: Props) {
  const isEdit = !!city?.id;
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setForm({
        name: city?.name ?? "",
        province_code: city?.province_code ?? "",
        province: city?.province ?? "",
        region: city?.region ?? "",
      });
    }
  }, [open, city?.id]);

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  async function handleSave() {
    if (!form.name.trim()) { toast.error("Il nome è obbligatorio"); return; }
    setSaving(true);
    try {
      await upsertCity({
        data: {
          ...(isEdit ? { id: city!.id } : {}),
          name: form.name.trim(),
          province_code: form.province_code.trim() || null,
          province: form.province.trim() || null,
          region: form.region.trim() || null,
        },
      });
      toast.success(isEdit ? "Città aggiornata" : "Città aggiunta");
      onSaved();
      onOpenChange(false);
    } catch (e: any) { toast.error(e.message ?? "Errore"); }
    setSaving(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-2xl max-w-sm">
        <DialogHeader>
          <DialogTitle className="font-serif">{isEdit ? "Modifica città" : "Aggiungi città"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>Nome <span className="text-destructive">*</span></Label>
            <Input value={form.name} onChange={e => set("name", e.target.value)} placeholder="Es. Milano" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Cod. provincia</Label>
              <Input
                value={form.province_code}
                onChange={e => set("province_code", e.target.value.toUpperCase().slice(0, 5))}
                placeholder="Es. MI"
              />
            </div>
            <div className="space-y-2">
              <Label>Provincia</Label>
              <Input value={form.province} onChange={e => set("province", e.target.value)} placeholder="Es. Milano" />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Regione</Label>
            <Input value={form.region} onChange={e => set("region", e.target.value)} placeholder="Es. Lombardia" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Annulla</Button>
          <Button size="sm" onClick={handleSave} disabled={saving}>
            <Save className="h-4 w-4 mr-1.5" />{saving ? "Salvataggio…" : "Salva"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
