import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export type UserFormValues = {
  id?: string;
  name: string;
  email: string;
  role: "superuser" | "coordinator" | "volunteer";
  status: "active" | "inactive";
  category_ids: string[];
  password?: string;
};

export function UserDialog({ open, onOpenChange, initial, categories, onSaved }: { open: boolean; onOpenChange: (b: boolean) => void; initial?: any; categories: any[]; onSaved: (vals: UserFormValues) => void }) {
  const [f, setF] = useState<UserFormValues>({ name: "", email: "", role: "volunteer", status: "active", category_ids: [] });

  useEffect(() => {
    if (initial) {
      setF({
        id: initial.id, name: initial.name ?? "", email: initial.email ?? "",
        role: initial.role === "admin" ? "superuser" : initial.role,
        status: initial.status ?? "active",
        category_ids: initial.res_user_category_rel?.map((r: any) => r.category_id) ?? [],
      });
    } else {
      setF({ name: "", email: "", role: "volunteer", status: "active", category_ids: [] });
    }
  }, [open, initial]);

  function set<K extends keyof UserFormValues>(k: K, v: UserFormValues[K]) { setF(s => ({ ...s, [k]: v })); }
  function toggleCat(id: string) { set("category_ids", f.category_ids.includes(id) ? f.category_ids.filter(c => c !== id) : [...f.category_ids, id]); }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-2xl max-w-2xl">
        <DialogHeader><DialogTitle>{initial?.id ? "Modifica utente" : "Nuovo utente"}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-2"><Label>Nome</Label><Input value={f.name} onChange={e => set("name", e.target.value)} /></div>
          <div className="space-y-2">
            <Label>Email</Label>
            <Input type="email" value={f.email} onChange={e => set("email", e.target.value)} disabled={!!initial?.id} placeholder="nome@esempio.it" />
            {!initial?.id && f.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email) && (
              <p className="text-xs text-destructive">Inserisci un indirizzo email valido</p>
            )}
          </div>
          <div className="space-y-2">
            <Label>Ruolo</Label>
            <Select value={f.role} onValueChange={v => set("role", v as any)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="superuser">Superuser</SelectItem>
                <SelectItem value="coordinator">Coordinatore</SelectItem>
                <SelectItem value="volunteer">Volontario</SelectItem>
              </SelectContent>
            </Select>
          </div>
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
          {!initial?.id && (
            <div className="space-y-2 md:col-span-2">
              <Label>Password temporanea</Label>
              <Input type="text" value={f.password ?? ""} onChange={e => set("password", e.target.value)} placeholder="Minimo 8 caratteri" />
              <p className="text-xs text-muted-foreground">L'utente potrà cambiarla dopo l'accesso.</p>
            </div>
          )}
          <div className="space-y-2 md:col-span-2">
            <Label>Gruppi visibili</Label>
            <div className="flex flex-wrap gap-2">
              {categories.map(c => {
                const active = f.category_ids.includes(c.id);
                return (
                  <button key={c.id} type="button" onClick={() => toggleCat(c.id)}>
                    <Badge variant={active ? "default" : "outline"} className="rounded-full cursor-pointer">{c.name}</Badge>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Annulla</Button>
          <Button onClick={() => onSaved(f)} disabled={!f.name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email) || (!initial?.id && (!f.password || f.password.length < 8))}>Salva</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
