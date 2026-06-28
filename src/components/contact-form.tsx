import { useEffect, useMemo, useState } from "react";
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
import { Save } from "lucide-react";

type Props = {
  initial?: any;
  onSaved?: (id: string) => void;
};

const STATUS = ["new", "active", "rejected", "old"] as const;
const STATUS_LABEL: Record<string, string> = { new: "Nuovo", active: "Attivo", rejected: "Rifiutato", old: "Inattivo" };

export function ContactForm({ initial, onSaved }: Props) {
  const [form, setForm] = useState<any>(() => ({
    first_name: "", last_name: "", email: "", phone: "", mobile: "",
    city_id: null, raw_city: "", raw_province: "", status: "new", partner_type: "individual", notes: "",
    ...(initial ?? {}),
    category_ids: initial?.res_partner_category_rel?.map((r: any) => r.category_id) ?? [],
  }));
  const [saving, setSaving] = useState(false);
  const [cityQuery, setCityQuery] = useState("");

  const isDirty = useMemo(() => {
    if (initial) {
      const orig = {
        first_name: initial.first_name ?? "",
        last_name: initial.last_name ?? "",
        email: initial.email ?? "",
        phone: initial.phone ?? "",
        mobile: initial.mobile ?? "",
        city_id: initial.city_id ?? null,
        status: initial.status ?? "new",
        partner_type: initial.partner_type ?? "individual",
        notes: initial.notes ?? "",
      };
      return JSON.stringify({
        ...orig,
        category_ids: JSON.stringify([...(initial.res_partner_category_rel?.map((r: any) => r.category_id) ?? [])].sort()),
      }) !== JSON.stringify({
        first_name: form.first_name ?? "",
        last_name: form.last_name ?? "",
        email: form.email ?? "",
        phone: form.phone ?? "",
        mobile: form.mobile ?? "",
        city_id: form.city_id ?? null,
        status: form.status ?? "new",
        partner_type: form.partner_type ?? "individual",
        notes: form.notes ?? "",
        category_ids: JSON.stringify([...form.category_ids].sort()),
      });
    }
    return !!(form.first_name || form.last_name || form.email || form.phone);
  }, [form, initial]);

  const { data: cats } = useQuery({ queryKey: ["categories"], queryFn: () => listCategories() });
  const { data: cities } = useQuery({
    queryKey: ["cities-pick", cityQuery],
    queryFn: () => searchCities({ data: { q: cityQuery, limit: 20 } }),
    enabled: cityQuery.length >= 2,
  });

  useEffect(() => {
    if (initial) {
      setForm((f: any) => ({
        ...f, ...initial,
        category_ids: initial.res_partner_category_rel?.map((r: any) => r.category_id) ?? [],
      }));
    }
  }, [initial?.id]);

  function set<K extends string>(k: K, v: any) { setForm((f: any) => ({ ...f, [k]: v })); }

  function toggleCat(id: string) {
    setForm((f: any) => ({
      ...f,
      category_ids: f.category_ids.includes(id)
        ? f.category_ids.filter((c: string) => c !== id)
        : [...f.category_ids, id],
    }));
  }

  async function save() {
    setSaving(true);
    try {
      const validationId = cats?.find((c: any) => c.name.toLowerCase() === "validation")?.id;
      const cleanCatIds = validationId
        ? form.category_ids.filter((x: string) => x !== validationId)
        : form.category_ids;
      const row = await upsertPartner({
        data: {
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
          partner_type: form.partner_type,
          notes: form.notes || null,
          category_ids: cleanCatIds,
        },
      });
      toast.success("Contatto salvato");
      onSaved?.(row.id);
    } catch (e: any) { toast.error(e.message ?? "Errore"); }
    setSaving(false);
  }

  const territorialCats = (cats ?? []).filter(
    (c: any) => c.category_type === "territorial" && c.name.toLowerCase() !== "validation"
  );

  return (
    <Card className="p-6 rounded-2xl border-0 shadow-sm space-y-5">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Tipo e Stato */}
        <div className="space-y-2">
          <Label>Tipo</Label>
          <Select value={form.partner_type ?? "individual"} onValueChange={v => set("partner_type", v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="individual">Non specificato</SelectItem>
              <SelectItem value="activist">Attivista</SelectItem>
              <SelectItem value="citizen">Cittadino</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Stato</Label>
          <Select value={form.status} onValueChange={v => set("status", v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{STATUS.map(s => <SelectItem key={s} value={s}>{STATUS_LABEL[s]}</SelectItem>)}</SelectContent>
          </Select>
        </div>

        {/* Anagrafica */}
        <div className="space-y-2"><Label>Nome</Label><Input value={form.first_name ?? ""} onChange={e => set("first_name", e.target.value)} /></div>
        <div className="space-y-2"><Label>Cognome</Label><Input value={form.last_name ?? ""} onChange={e => set("last_name", e.target.value)} /></div>

        {/* Email + Città 50/50 */}
        <div className="space-y-2">
          <Label>Email</Label>
          <Input type="email" value={form.email ?? ""} onChange={e => set("email", e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>Città</Label>
          {form.city_id ? (
            <div className="flex items-center gap-2">
              <div className="flex-1 text-sm border border-input rounded-md px-3 h-10 flex items-center bg-muted/20">
                {form.raw_city}{form.raw_province ? ` (${form.raw_province})` : ""}
              </div>
              <Button type="button" size="sm" variant="outline"
                onClick={() => { set("city_id", null); set("raw_city", ""); set("raw_province", ""); setCityQuery(""); }}
              >
                Cambia
              </Button>
            </div>
          ) : (
            <div className="relative">
              <Input placeholder="Cerca città…" value={cityQuery} onChange={e => setCityQuery(e.target.value)} />
              {cities && cities.length > 0 && cityQuery.length >= 2 && (
                <div className="absolute z-10 top-full left-0 right-0 bg-popover border border-border rounded-xl mt-1 shadow-lg max-h-48 overflow-auto divide-y divide-border/40">
                  {cities.map((c: any) => (
                    <button key={c.id} type="button"
                      className="w-full text-left px-3 py-2 hover:bg-muted text-sm"
                      onClick={() => { set("city_id", c.id); set("raw_city", c.name); set("raw_province", c.province_code); setCityQuery(""); }}
                    >
                      {c.name} <span className="text-muted-foreground">({c.province_code})</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="space-y-2">
          <Label>Telefono</Label>
          <Input value={form.phone ?? ""} onChange={e => set("phone", e.target.value)} placeholder="+39 000 000 0000" />
          <p className="text-xs text-muted-foreground">Includi il prefisso internazionale: +39 per l'Italia, +33 per la Francia, ecc.</p>
        </div>
        <div className="space-y-2">
          <Label>Telefono alternativo</Label>
          <Input value={form.mobile ?? ""} onChange={e => set("mobile", e.target.value)} placeholder="+39 000 000 0000" />
        </div>

        <div className="space-y-2 md:col-span-2">
          <Label>Gruppi</Label>
          <div className="flex flex-wrap gap-2">
            {territorialCats.map((c: any) => {
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
        <Button size="sm" onClick={save} disabled={saving || !isDirty}>
          <Save className="h-4 w-4 mr-1.5" />{saving ? "Salvataggio…" : "Salva"}
        </Button>
      </div>
    </Card>
  );
}
