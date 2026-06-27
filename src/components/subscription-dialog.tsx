import { useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { upsertSubscription } from "@/lib/subscriptions.functions";

export function SubscriptionDialog({ open, onOpenChange, partnerId, onSaved }: { open: boolean; onOpenChange: (b: boolean) => void; partnerId: string; onSaved?: () => void }) {
  const year = new Date().getFullYear();
  const today = new Date().toISOString().slice(0, 10);
  const [start, setStart] = useState(today);
  const [end, setEnd] = useState(`${year}-12-31`);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await upsertSubscription({ data: { partner_id: partnerId, year, start_date: start, end_date: end, notes: notes || null, status: "active" } });
      onSaved?.();
      onOpenChange(false);
    } catch (e: any) { toast.error(e.message ?? "Errore"); }
    setSaving(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-2xl">
        <DialogHeader><DialogTitle>Abilita socio · Anno {year}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2"><Label>Data inizio</Label><Input type="date" value={start} onChange={e => setStart(e.target.value)} /></div>
            <div className="space-y-2"><Label>Data fine</Label><Input type="date" value={end} onChange={e => setEnd(e.target.value)} /></div>
          </div>
          <div className="space-y-2"><Label>Note</Label><Textarea rows={3} value={notes} onChange={e => setNotes(e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Annulla</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Salvataggio…" : "Abilita"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
