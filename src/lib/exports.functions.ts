import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { applyPartnerFilters, hasActiveCard } from "@/lib/partner-filters";
import { PARTNER_STATUS, labelFor } from "@/lib/selections";

// Same filter shape as listPartners, minus limit/offset: an export is meant to return
// everything that matches, not one page of it.
const ExportFilters = z
  .object({
    status: z.string().optional(),
    role_ids: z.array(z.string().uuid()).optional(),
    category_id: z.string().uuid().optional(),
    city_id: z.string().uuid().optional(),
    province_code: z.string().optional(),
    year: z.number().int().optional(),
    has_active_sub: z.boolean().optional(),
    search: z.string().optional(),
  })
  .default({});

// The file carries every field the contact record holds, not the subset the table shows:
// a CSV is what people work in once it leaves here, and a missing column means going back
// to the app record by record. "tesserato" is derived, not stored — it is the same
// question the list answers with a tick, resolved for the current year.
const COLUMNS = [
  "id",
  "nome",
  "cognome",
  "nome_completo",
  "email",
  "telefono",
  "cellulare",
  "città",
  "provincia",
  "città_dichiarata",
  "provincia_dichiarata",
  "stato",
  "gruppi",
  "ruoli",
  "tesserato",
  "numero_tessera",
  "anno_tessera",
  "note",
  "creato_il",
  "aggiornato_il",
] as const;

// Excel refuses to treat a leading "=", "+", "-" or "@" as text and evaluates it as a
// formula instead, so a contact named "=cmd|..." would run on open. Prefixing with a
// single quote neutralises it without changing what the reader sees.
function csvCell(value: unknown): string {
  const s = (value ?? "").toString();
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}

const PAGE = 500;

export const exportContacts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ExportFilters.parse(d ?? {}))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // The button is hidden for volunteers, but hiding is not a permission: this function
    // is reachable over HTTP by anyone with a session. RLS still caps the rows to the
    // caller's perimeter, so the check is about who may pull a file at all, not about
    // what ends up in it.
    const { data: caller } = await supabase.from("res_users").select("role").eq("id", userId).maybeSingle();
    if (!caller || !["admin", "superuser", "coordinator"].includes(caller.role)) {
      throw new Error("Non autorizzato");
    }

    // Paged so the export is complete. The previous client-side version serialised
    // whatever the contacts table had already loaded (100 rows by default), which
    // silently produced a truncated file — the worst kind of bug, because the result
    // looks perfectly valid.
    const rows: any[] = [];
    for (let offset = 0; ; offset += PAGE) {
      let q = supabase
        .from("res_partner")
        .select(
          `id, first_name, last_name, display_name, email, phone, mobile, status, raw_city, raw_province, city_id, notes, created_at, updated_at,
           res_city(name, province_code),
           res_partner_category_rel(category_id, res_partner_category(name)),
           res_partner_role_rel(role_id, res_partner_role(name, sort_order)),
           membership_subscription(membership_number, year, status)`,
        )
        .order("created_at", { ascending: false })
        .range(offset, offset + PAGE - 1);

      if (data.status) q = q.eq("status", data.status);
      if (data.city_id) q = q.eq("city_id", data.city_id);
      if (data.search) {
        const s = `%${data.search}%`;
        q = q.or(
          `first_name.ilike.${s},last_name.ilike.${s},email.ilike.${s},display_name.ilike.${s}`,
        );
      }

      const { data: page, error } = await q;
      if (error) throw error;
      rows.push(...(page ?? []));
      if (!page || page.length < PAGE) break;
    }

    // Filters PostgREST cannot express on a nested relation. Shared with listPartners
    // through partner-filters.ts: an export that disagreed with the on-screen list
    // would be worse than either being wrong on its own.
    const filtered = applyPartnerFilters(rows, data);

    const year = new Date().getFullYear();

    const body = filtered.map((r: any) => {
      // The card that makes them "tesserato" — active, current year. Not simply the most
      // recent one: a replaced card stays on the record with status revoked.
      const card = (r.membership_subscription ?? []).find(
        (sub: any) => sub.year === year && sub.status === "active",
      );
      return [
        r.id,
        r.first_name,
        r.last_name,
        r.display_name,
        r.email,
        r.phone,
        r.mobile,
        r.res_city?.name ?? r.raw_city,
        r.res_city?.province_code ?? r.raw_province,
        r.raw_city,
        r.raw_province,
        labelFor(PARTNER_STATUS, r.status),
        (r.res_partner_category_rel ?? [])
          .map((rel: any) => rel.res_partner_category?.name)
          .filter(Boolean)
          .join(" | "),
        (r.res_partner_role_rel ?? [])
          .slice()
          .sort((a: any, b: any) => (a.res_partner_role?.sort_order ?? 0) - (b.res_partner_role?.sort_order ?? 0))
          .map((rel: any) => rel.res_partner_role?.name)
          .filter(Boolean)
          .join(" | "),
        hasActiveCard(r, year) ? "Sì" : "No",
        card?.membership_number ?? "",
        card?.year ?? "",
        r.notes,
        r.created_at,
        r.updated_at,
      ]
        .map(csvCell)
        .join(",");
    });

    const csv = [COLUMNS.join(","), ...body].join("\r\n");

    // Pulling personal data out of the CRM is itself an event worth recording.
    await supabase.from("audit_log").insert({
      log_type: "data_export",
      action: "api_call",
      model_name: "res_partner",
      new_values_json: { filters: data, row_count: filtered.length },
      changed_by_user_id: userId,
      source: "export",
    });

    return { csv, count: filtered.length };
  });
