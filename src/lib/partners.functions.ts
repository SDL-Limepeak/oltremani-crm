import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { applyPartnerFilters, needsFullScan } from "@/lib/partner-filters";

const ListFilters = z.object({
  status: z.string().optional(),
  partner_type: z.string().optional(),
  category_id: z.string().uuid().optional(),
  city_id: z.string().uuid().optional(),
  province_code: z.string().optional(),
  year: z.number().int().optional(),
  has_active_sub: z.boolean().optional(),
  search: z.string().optional(),
  limit: z.number().int().min(1).max(500).default(100),
  offset: z.number().int().min(0).default(0),
}).default({});

const PARTNER_COLUMNS = `id, first_name, last_name, display_name, email, phone, mobile, status, partner_type, raw_city, raw_province, city_id, created_at,
   res_city(id, name, province_code),
   res_partner_category_rel(category_id, res_partner_category(id, name, category_type)),
   membership_subscription(id, year, status)`;

/** Page size and ceiling for the full-scan path below. */
const SCAN_PAGE = 500;
const SCAN_MAX = 10_000;

export const listPartners = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => ListFilters.parse(data ?? {}))
  .handler(async ({ data, context }) => {
    const { supabase } = context;

    const withDbFilters = (from: number, to: number, exact: boolean) => {
      let q = supabase
        .from("res_partner")
        .select(PARTNER_COLUMNS, exact ? { count: "exact" } : undefined)
        .order("created_at", { ascending: false })
        .range(from, to);
      if (data.status) q = q.eq("status", data.status);
      if (data.partner_type) q = q.eq("partner_type", data.partner_type);
      if (data.city_id) q = q.eq("city_id", data.city_id);
      if (data.search) {
        const s = `%${data.search}%`;
        q = q.or(`first_name.ilike.${s},last_name.ilike.${s},email.ilike.${s},display_name.ilike.${s}`);
      }
      return q;
    };

    // Fast path: everything the caller asked for is expressible in SQL, so let
    // Postgres do the paging and the counting.
    if (!needsFullScan(data)) {
      const { data: rows, count, error } = await withDbFilters(
        data.offset,
        data.offset + data.limit - 1,
        true,
      );
      if (error) throw error;
      return { rows: rows ?? [], total: count ?? (rows?.length ?? 0), truncated: false };
    }

    // Slow path. The JS filters have to see every candidate row before the page is
    // cut, otherwise they only ever filter the first page: the list would silently
    // omit matches and `total` would report the unfiltered count. Same shape as
    // exportContacts, which got this right.
    const all: any[] = [];
    let truncated = false;
    for (let offset = 0; ; offset += SCAN_PAGE) {
      if (offset >= SCAN_MAX) {
        truncated = true;
        break;
      }
      const { data: page, error } = await withDbFilters(offset, offset + SCAN_PAGE - 1, false);
      if (error) throw error;
      all.push(...(page ?? []));
      if (!page || page.length < SCAN_PAGE) break;
    }

    const filtered = applyPartnerFilters(all, data);
    return {
      rows: filtered.slice(data.offset, data.offset + data.limit),
      total: filtered.length,
      // The caller can say so instead of quietly presenting a partial list.
      truncated,
    };
  });

export const getPartner = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: p, error } = await supabase
      .from("res_partner")
      .select(
        `*, res_city(id, name, province_code, province),
         res_partner_category_rel(category_id, res_partner_category(id, name, category_type)),
         res_partner_role_rel(role_id, res_partner_role(id, code, name, sort_order)),
         membership_subscription(*),
         privacy_consent(*)`,
      )
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw error;
    return p;
  });

/**
 * The operational-role picklist. A table rather than a selection field because the client
 * adds entries themselves — see src/lib/selections.ts for where that line is drawn.
 * `code` is the API name (what the public form sends), `name` is the label.
 */
export const listPartnerRoles = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await (context.supabase as any)
      .from("res_partner_role")
      .select("id, code, name, sort_order, status")
      .eq("status", "active")
      .order("sort_order");
    if (error) throw error;
    return (data ?? []) as { id: string; code: string; name: string; sort_order: number; status: string }[];
  });

const PartnerInput = z.object({
  id: z.string().uuid().optional(),
  first_name: z.string().trim().max(100).nullable().optional(),
  last_name: z.string().trim().max(100).nullable().optional(),
  email: z.string().trim().email().max(255).nullable().optional(),
  phone: z.string().trim().max(50).nullable().optional(),
  mobile: z.string().trim().max(50).nullable().optional(),
  city_id: z.string().uuid().nullable().optional(),
  raw_city: z.string().nullable().optional(),
  raw_province: z.string().nullable().optional(),
  status: z.enum(["new", "active", "rejected", "old"]).optional(),
  partner_type: z.enum(["individual", "activist", "citizen"]).optional(),
  notes: z.string().max(5000).nullable().optional(),
  category_ids: z.array(z.string().uuid()).optional(),
  role_ids: z.array(z.string().uuid()).optional(),
});

async function writeAudit(
  supabase: any,
  uid: string,
  args: {
    log_type: string;
    action: string;
    model_name?: string;
    record_id?: string;
    old?: unknown;
    new?: unknown;
    source?: string;
  },
) {
  await supabase.from("audit_log").insert({
    log_type: args.log_type,
    action: args.action,
    model_name: args.model_name ?? null,
    record_id: args.record_id ?? null,
    old_values_json: args.old ?? null,
    new_values_json: args.new ?? null,
    changed_by_user_id: uid,
    source: args.source ?? "ui",
  });
}

export const upsertPartner = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => PartnerInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { category_ids, role_ids, ...partner } = data;

    const display = [partner.first_name, partner.last_name].filter(Boolean).join(" ") || null;
    const payload: any = { ...partner, display_name: display, updated_by: userId };

    let old: any = null;
    let result;
    if (partner.id) {
      const { data: existing } = await supabase.from("res_partner").select("*").eq("id", partner.id).maybeSingle();
      old = existing;
      const { data: upd, error } = await supabase
        .from("res_partner")
        .update(payload)
        .eq("id", partner.id)
        .select()
        .single();
      if (error) throw error;
      result = upd;
      await writeAudit(supabase, userId, {
        log_type: "record_change", action: "update", model_name: "res_partner",
        record_id: result.id, old, new: result,
      });
    } else {
      payload.created_by = userId;
      const { data: ins, error } = await supabase.from("res_partner").insert(payload).select().single();
      if (error) throw error;
      result = ins;
      await writeAudit(supabase, userId, {
        log_type: "record_change", action: "create", model_name: "res_partner",
        record_id: result.id, new: result,
      });
    }

    if (category_ids) {
      const { data: oldCats } = await supabase
        .from("res_partner_category_rel")
        .select("category_id")
        .eq("partner_id", result.id);
      await supabase.from("res_partner_category_rel").delete().eq("partner_id", result.id);
      if (category_ids.length) {
        await supabase
          .from("res_partner_category_rel")
          .insert(category_ids.map((cid) => ({ partner_id: result.id, category_id: cid })));
      }
      await writeAudit(supabase, userId, {
        log_type: "record_change", action: "update", model_name: "res_partner_category_rel",
        record_id: result.id, old: oldCats, new: category_ids,
      });
    }

    // Same delete-then-insert shape as the categories above. `undefined` means "the caller
    // is not managing roles in this request" and leaves them alone; an empty array means
    // "clear them" — the distinction matters for any caller that sends a partial payload.
    if (role_ids) {
      const { data: oldRoles } = await (supabase as any)
        .from("res_partner_role_rel")
        .select("role_id")
        .eq("partner_id", result.id);
      await (supabase as any).from("res_partner_role_rel").delete().eq("partner_id", result.id);
      if (role_ids.length) {
        await (supabase as any)
          .from("res_partner_role_rel")
          .insert(role_ids.map((rid) => ({ partner_id: result.id, role_id: rid })));
      }
      await writeAudit(supabase, userId, {
        log_type: "record_change", action: "update", model_name: "res_partner_role_rel",
        record_id: result.id, old: oldRoles, new: role_ids,
      });
    }

    return result;
  });

export const validatePartner = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ partner_id: z.string().uuid(), city_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: city } = await supabase
      .from("res_city")
      .select("id, name, category_id")
      .eq("id", data.city_id)
      .maybeSingle();
    if (!city) throw new Error("Città non trovata");

    const { data: validationCat } = await supabase
      .from("res_partner_category")
      .select("id")
      .eq("name", "Validation")
      .maybeSingle();

    const { data: oldPartner } = await supabase.from("res_partner").select("*").eq("id", data.partner_id).maybeSingle();

    await supabase
      .from("res_partner")
      .update({ city_id: city.id, status: oldPartner?.status === "new" ? "active" : oldPartner?.status, updated_by: userId })
      .eq("id", data.partner_id);

    if (validationCat?.id) {
      await supabase
        .from("res_partner_category_rel")
        .delete()
        .eq("partner_id", data.partner_id)
        .eq("category_id", validationCat.id);
    }
    if (city.category_id) {
      await supabase
        .from("res_partner_category_rel")
        .insert({ partner_id: data.partner_id, category_id: city.category_id })
        .select();
    }

    await writeAudit(supabase, userId, {
      log_type: "record_change", action: "validate", model_name: "res_partner",
      record_id: data.partner_id, old: oldPartner, new: { city_id: city.id, category_id: city.category_id },
    });
    return { ok: true };
  });

export const deletePartner = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: old } = await supabase.from("res_partner").select("*").eq("id", data.id).maybeSingle();
    const { error } = await supabase.from("res_partner").delete().eq("id", data.id);
    if (error) throw error;
    await writeAudit(supabase, userId, {
      log_type: "record_change", action: "delete", model_name: "res_partner",
      record_id: data.id, old,
    });
    return { ok: true };
  });

export const recordConsent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    partner_id: z.string().uuid(),
    accepted: z.boolean(),
    channel: z.string().min(1),
    notes: z.string().nullable().optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: row, error } = await (supabase as any)
      .from("privacy_consent")
      .insert({
        partner_id: data.partner_id,
        consent_type: "privacy_policy",
        accepted: data.accepted,
        accepted_at: data.accepted ? new Date().toISOString() : null,
        source: "ui",
        operator_id: userId,
        channel: data.channel,
        notes: data.notes ?? null,
      })
      .select()
      .single();
    if (error) throw error;
    return row;
  });
