import { useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { membershipNumberUsage, previewMembershipNumber, upsertSubscription } from "@/lib/subscriptions.functions";

export function SubscriptionDialog({ open, onOpenChange, partnerId, onSaved }: { open: boolean; onOpenChange: (b: boolean) => void; partnerId: string; onSaved?: () => void }) {
  const year = new Date().getFullYear();
  const today = new Date().toISOString().slice(0, 10);
  const [start, setStart] = useState(today);
  const [end, setEnd] = useState(`${year}-12-31`);
  const [notes, setNotes] = useState("");
  const [number, setNumber] = useState("");
  const [saving, setSaving] = useState(false);

  // Cards are numbered by hand, so the number is checked while it is being typed rather
  // than refused on save. Reference data for the whole register, hence one query.
  const { data: usage } = useQuery({
    queryKey: ["membership-number-usage"],
    queryFn: () => membershipNumberUsage(),
    enabled: open,
  });
  // What would be assigned if the field is left empty, and whether the contact already
  // holds a card for this year. Both are advisory: the number is fixed by the INSERT.
  const { data: preview } = useQuery({
    queryKey: ["membership-number-preview", partnerId],
    queryFn: () => previewMembershipNumber({ data: { partner_id: partnerId } }),
    enabled: open,
    gcTime: 0,
  });
  const typed = number.trim();
  const alreadyUsed = typed.length > 0 && (usage?.used ?? []).includes(typed);

  async function save() {
    setSaving(true);
    try {
      await upsertSubscription({ data: { partner_id: partnerId, year, start_date: start, end_date: end, notes: notes || null, status: "active", membership_number: typed || null } });
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
          <div className="space-y-2">
            <Label>N° tessera</Label>
            <Input
              value={number}
              onChange={e => setNumber(e.target.value)}
              placeholder={preview?.number ? `Vuoto = ${preview.number}` : "Digita il numero della tessera"}
              className="font-mono"
            />
            {!typed && preview?.number && (
              <p className="text-xs text-muted-foreground">
                Lasciandolo vuoto la tessera sarà la <strong className="font-mono">{preview.number}</strong>.
              </p>
            )}
            {!typed && preview?.error && (
              <p className="flex items-start gap-1.5 text-xs text-destructive">
                <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
                {preview.error}
              </p>
            )}
            {(preview?.active_this_year ?? 0) > 0 && (
              <p className="flex items-start gap-1.5 text-xs text-[#E8921E]">
                <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
                Questo contatto ha già {preview!.active_this_year === 1 ? "una tessera attiva" : `${preview!.active_this_year} tessere attive`} per il {year}.
                Puoi salvare lo stesso: resterà segnalato finché non ne revochi una.
              </p>
            )}
            {alreadyUsed && (
              <p className="flex items-start gap-1.5 text-xs text-[#E8921E]">
                <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
                Questo numero è già su un'altra tessera. Puoi salvare lo stesso: resterà
                segnalato come duplicato finché non lo correggi.
              </p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2"><Label>Data inizio</Label><Input type="date" value={start} onChange={e => setStart(e.target.value)} /></div>
            <div className="space-y-2"><Label>Data fine</Label><Input type="date" value={end} onChange={e => setEnd(e.target.value)} /></div>
          </div>
          <div className="space-y-2"><Label>Note</Label><Textarea rows={3} value={notes} onChange={e => setNotes(e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Annulla</Button>
          <Button onClick={save} disabled={saving || (!typed && !!preview?.error)}>{saving ? "Salvataggio…" : "Abilita"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
