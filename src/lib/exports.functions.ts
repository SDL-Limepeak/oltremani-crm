import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { applyPartnerFilters } from "@/lib/partner-filters";

// Same filter shape as listPartners, minus limit/offset: an export is meant to return
// everything that matches, not one page of it.
const ExportFilters = z
  .object({
    status: z.string().optional(),
    partner_type: z.string().optional(),
    category_id: z.string().uuid().optional(),
    city_id: z.string().uuid().optional(),
    province_code: z.string().optional(),
    year: z.number().int().optional(),
    has_active_sub: z.boolean().optional(),
    search: z.string().optional(),
  })
  .default({});

const COLUMNS = [
  "nome",
  "cognome",
  "email",
  "telefono",
  "cellulare",
  "città",
  "provincia",
  "stato",
  "gruppi",
  "creato_il",
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

    // Paged so the export is complete. The previous client-side version serialised
    // whatever the contacts table had already loaded (100 rows by default), which
    // silently produced a truncated file — the worst kind of bug, because the result
    // looks perfectly valid.
    const rows: any[] = [];
    for (let offset = 0; ; offset += PAGE) {
      let q = supabase
        .from("res_partner")
        .select(
          `first_name, last_name, email, phone, mobile, status, partner_type, raw_city, raw_province, city_id, created_at,
           res_city(name, province_code),
           res_partner_category_rel(category_id, res_partner_category(name)),
           membership_subscription(year, status)`,
        )
        .order("created_at", { ascending: false })
        .range(offset, offset + PAGE - 1);

      if (data.status) q = q.eq("status", data.status);
      if (data.partner_type) q = q.eq("partner_type", data.partner_type);
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

    const body = filtered.map((r: any) =>
      [
        r.first_name,
        r.last_name,
        r.email,
        r.phone,
        r.mobile,
        r.res_city?.name ?? r.raw_city,
        r.res_city?.province_code ?? r.raw_province,
        r.status,
        (r.res_partner_category_rel ?? [])
          .map((rel: any) => rel.res_partner_category?.name)
          .filter(Boolean)
          .join(" | "),
        r.created_at,
      ]
        .map(csvCell)
        .join(","),
    );

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
