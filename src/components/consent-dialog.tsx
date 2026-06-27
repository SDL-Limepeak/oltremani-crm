import { useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { recordConsent } from "@/lib/partners.functions";

const CHANNELS = [
  { value: "telefono",     label: "Telefono" },
  { value: "email",        label: "Email" },
  { value: "cartaceo",     label: "Cartaceo" },
  { value: "di_persona",   label: "Di persona" },
  { value: "web",          label: "Web / form online" },
  { value: "altro",        label: "Altro" },
];

export function ConsentDialog({
  open, onOpenChange, partnerId, onSaved,
}: {
  open: boolean;
  onOpenChange: (b: boolean) => void;
  partnerId: string;
  onSaved?: () => void;
}) {
  const [accepted, setAccepted] = useState<"true" | "false">("true");
  const [channel, setChannel] = useState("telefono");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await recordConsent({
        data: {
          partner_id: partnerId,
          accepted: accepted === "true",
          channel,
          notes: notes || null,
        },
      });
      toast.success("Consenso registrato");
      onSaved?.();
      onOpenChange(false);
      setNotes("");
    } catch (e: any) {
      toast.error(e.message ?? "Errore");
    }
    setSaving(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-2xl max-w-sm">
        <DialogHeader>
          <DialogTitle>Nuovo consenso privacy</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Tipo</Label>
            <p className="text-sm text-muted-foreground">Privacy Policy</p>
          </div>
          <div className="space-y-2">
            <Label>Esito</Label>
            <Select value={accepted} onValueChange={v => setAccepted(v as "true" | "false")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="true">Accettato</SelectItem>
                <SelectItem value="false">Rifiutato / Revocato</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Canale di raccolta</Label>
            <Select value={channel} onValueChange={setChannel}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {CHANNELS.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Note <span className="text-muted-foreground font-normal">(opzionale)</span></Label>
            <Textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Es. Cliente ha chiamato per revocare…" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Annulla</Button>
          <Button onClick={save} disabled={saving || !channel}>
            {saving ? "Salvataggio…" : "Registra"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
