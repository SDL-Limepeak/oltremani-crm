import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { listCategories } from "@/lib/categories.functions";
import { searchCities } from "@/lib/cities.functions";
import { upsertPartner } from "@/lib/partners.functions";

type Props = {
  initial?: any;
  onSaved?: (id: string) => void;
};

const STATUS = ["new", "active", "rejected", "old"] as const;
const STATUS_LABEL: Record<string, string> = { new: "Nuovo", active: "Attivo", rejected: "Rifiutato", old: "Storico" };

export function ContactForm({ initial, onSaved }: Props) {
  const [form, setForm] = useState<any>(() => ({
    first_name: "", last_name: "", email: "", phone: "", mobile: "",
    city_id: null, raw_city: "", raw_province: "", status: "new", notes: "",
    ...(initial ?? {}),
    category_ids: initial?.res_partner_category_rel?.map((r: any) => r.category_id) ?? [],
  }));
  const [saving, setSaving] = useState(false);
  const [cityQuery, setCityQuery] = useState("");

  const { data: cats } = useQuery({ queryKey: ["categories"], queryFn: () => listCategories() });
  const { data: cities } = useQuery({ queryKey: ["cities-pick", cityQuery], queryFn: () => searchCities({ data: { q: cityQuery, limit: 20 } }), enabled: cityQuery.length >= 2 });

  useEffect(() => {
    if (initial) {
      setForm((f: any) => ({ ...f, ...initial, category_ids: initial.res_partner_category_rel?.map((r: any) => r.category_id) ?? [] }));
    }
  }, [initial?.id]);

  function set<K extends string>(k: K, v: any) { setForm((f: any) => ({ ...f, [k]: v })); }

  function toggleCat(id: string) {
    setForm((f: any) => ({
      ...f,
      category_ids: f.category_ids.includes(id) ? f.category_ids.filter((c: string) => c !== id) : [...f.category_ids, id],
    }));
  }

  async function save() {
    setSaving(true);
    try {
      const payload: any = {
        id: initial?.id,
        first_name: form.first_name || null,
        last_name: form.last_name || null,
        email: form.email || null,
        phone: form.phone || null,
        mobile: form.mobile || null,
        city_id: form.city_id || null,
        raw_city: form.raw_city || null,
        raw_province: form.raw_province || null,
        status: form.status,
        notes: form.notes || null,
        category_ids: form.category_ids,
      };
      const row = await upsertPartner({ data: payload });
      toast.success("Contatto salvato");
      onSaved?.(row.id);
    } catch (e: any) { toast.error(e.message ?? "Errore"); }
    setSaving(false);
  }

  return (
    <Card className="p-6 rounded-2xl border-0 shadow-sm space-y-5">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2"><Label>Nome</Label><Input value={form.first_name ?? ""} onChange={e => set("first_name", e.target.value)} /></div>
        <div className="space-y-2"><Label>Cognome</Label><Input value={form.last_name ?? ""} onChange={e => set("last_name", e.target.value)} /></div>
        <div className="space-y-2"><Label>Email</Label><Input type="email" value={form.email ?? ""} onChange={e => set("email", e.target.value)} /></div>
        <div className="space-y-2"><Label>Telefono</Label><Input value={form.phone ?? ""} onChange={e => set("phone", e.target.value)} /></div>
        <div className="space-y-2"><Label>Cellulare</Label><Input value={form.mobile ?? ""} onChange={e => set("mobile", e.target.value)} /></div>
        <div className="space-y-2">
          <Label>Stato</Label>
          <Select value={form.status} onValueChange={v => set("status", v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{STATUS.map(s => <SelectItem key={s} value={s}>{STATUS_LABEL[s]}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-2 md:col-span-2">
          <Label>Città</Label>
          <Input placeholder="Cerca città…" value={cityQuery} onChange={e => setCityQuery(e.target.value)} />
          {cities && cities.length > 0 && cityQuery.length >= 2 && (
            <div className="border border-border rounded-xl divide-y divide-border/40 max-h-48 overflow-auto">
              {cities.map((c: any) => (
                <button key={c.id} type="button" className="w-full text-left px-3 py-2 hover:bg-muted text-sm" onClick={() => { set("city_id", c.id); set("raw_city", c.name); set("raw_province", c.province_code); setCityQuery(""); }}>
                  {c.name} <span className="text-muted-foreground">({c.province_code})</span>
                </button>
              ))}
            </div>
          )}
          {form.raw_city && <p className="text-xs text-muted-foreground">Selezionata: {form.raw_city} {form.raw_province ? `(${form.raw_province})` : ""}</p>}
        </div>
        <div className="space-y-2 md:col-span-2">
          <Label>Gruppi</Label>
          <div className="flex flex-wrap gap-2">
            {cats?.map((c: any) => {
              const active = form.category_ids.includes(c.id);
              return (
                <button type="button" key={c.id} onClick={() => toggleCat(c.id)}>
                  <Badge variant={active ? "default" : "outline"} className="rounded-full cursor-pointer">{c.name}</Badge>
                </button>
              );
            })}
          </div>
        </div>
        <div className="space-y-2 md:col-span-2">
          <Label>Note</Label>
          <Textarea rows={4} value={form.notes ?? ""} onChange={e => set("notes", e.target.value)} />
        </div>
      </div>
      <div className="flex justify-end">
        <Button onClick={save} disabled={saving}>{saving ? "Salvataggio…" : "Salva"}</Button>
      </div>
    </Card>
  );
}
