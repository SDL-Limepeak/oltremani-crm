import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { listPartners } from "@/lib/partners.functions";

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

interface Props {
  open: boolean;
  onOpenChange: (b: boolean) => void;
  initial?: any;
  categories?: any[];
  onSaved: (vals: CategoryFormValues) => void;
}

export function CategoryDialog({ open, onOpenChange, initial, categories = [], onSaved }: Props) {
  const [f, setF] = useState<CategoryFormValues>({ name: "", parent_id: null, category_type: "territorial", status: "active" });
  const [presSearch, setPresSearch] = useState("");
  const [presOpen, setPresOpen] = useState(false);
  const presRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (initial) {
      setF({ ...f, ...initial });
      const name = [initial.president_first_name, initial.president_last_name].filter(Boolean).join(" ");
      setPresSearch(name);
    } else {
      setF({ name: "", parent_id: null, category_type: "territorial", status: "active" });
      setPresSearch("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Close dropdown on outside click
  useEffect(() => {
    function handle(e: MouseEvent) {
      if (presRef.current && !presRef.current.contains(e.target as Node)) setPresOpen(false);
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, []);

  const { data: partnerData } = useQuery({
    queryKey: ["partners-pres", presSearch],
    queryFn: () => listPartners({ data: { search: presSearch, limit: 20 } as any }),
    enabled: presSearch.length >= 2 && presOpen,
  });
  const presResults = (partnerData as any)?.rows ?? [];

  function set<K extends keyof CategoryFormValues>(k: K, v: CategoryFormValues[K]) { setF(s => ({ ...s, [k]: v })); }

  // Available parents: all territorial categories except this one
  const parentOptions = categories.filter(
    c => c.category_type === "territorial" && c.id !== initial?.id
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-2xl max-w-2xl">
        <DialogHeader><DialogTitle>{initial?.id ? "Modifica gruppo" : "Nuovo gruppo"}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">

          {/* Nome + Stato */}
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

          {/* Gruppo padre */}
          <div className="space-y-2">
            <Label>Gruppo padre</Label>
            <Select value={f.parent_id ?? "none"} onValueChange={v => set("parent_id", v === "none" ? null : v)}>
              <SelectTrigger><SelectValue placeholder="— Nessuno (radice) —" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— Nessuno (radice) —</SelectItem>
                {parentOptions.map(c => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Presidente — lookup soci */}
          <div className="space-y-2 md:col-span-2" ref={presRef}>
            <Label>Presidente (socio censito)</Label>
            <div className="relative">
              <Input
                value={presSearch}
                onChange={e => { setPresSearch(e.target.value); setPresOpen(true); }}
                onFocus={() => setPresOpen(true)}
                placeholder="Cerca per nome o email…"
              />
              {presOpen && presResults.length > 0 && (
                <div className="absolute top-full left-0 right-0 z-50 bg-popover border border-border rounded-xl mt-1 shadow-lg max-h-48 overflow-y-auto">
                  {presResults.map((p: any) => {
                    const fullName = p.display_name || `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim();
                    return (
                      <button
                        key={p.id}
                        type="button"
                        className="w-full text-left px-3 py-2 text-sm hover:bg-muted flex items-center gap-2"
                        onMouseDown={e => e.preventDefault()}
                        onClick={() => {
                          set("president_first_name", p.first_name ?? "");
                          set("president_last_name", p.last_name ?? "");
                          set("president_email", p.email ?? "");
                          setPresSearch(fullName);
                          setPresOpen(false);
                        }}
                      >
                        <span className="font-medium">{fullName}</span>
                        {p.email && <span className="text-xs text-muted-foreground">{p.email}</span>}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            {f.president_email && (
              <p className="text-xs text-muted-foreground">{f.president_email}</p>
            )}
          </div>

          {/* Contatti organizzativi */}
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
