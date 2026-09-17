import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const SubInput = z.object({
  id: z.string().uuid().optional(),
  partner_id: z.string().uuid(),
  year: z.number().int().min(2000).max(2100).optional(),
  start_date: z.string().optional(),
  end_date: z.string().nullable().optional(),
  // 'expired' is in the enum so a caller can read it back and send the row unchanged; it
  // is set by the nightly job, not chosen from the UI.
  status: z.enum(["active", "inactive", "revoked", "expired"]).optional(),
  notes: z.string().nullable().optional(),
  // Cards are filled in by hand, so the number is whatever they write on the card. Left
  // out (undefined) it keeps the generated one; the uniqueness that used to enforce this
  // was dropped on 2026-09-17 and a duplicate is now flagged in the UI instead of refused.
  membership_number: z.string().trim().max(32).nullable().optional(),
});

export const listSubscriptions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ year: z.number().int().optional(), status: z.string().optional() }).default({}).parse(d ?? {}))
  .handler(async ({ data, context }) => {
    let q = context.supabase
      .from("membership_subscription")
      .select("*, res_partner(id, first_name, last_name, display_name, email)")
      .order("created_at", { ascending: false })
      .limit(500);
    if (data.year) q = q.eq("year", data.year);
    if (data.status) q = q.eq("status", data.status);
    const { data: rows, error } = await q;
    if (error) throw error;
    return rows ?? [];
  });

export const upsertSubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => SubInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    let row;
    if (data.id) {
      const { data: old } = await supabase
        .from("membership_subscription")
        .select("*")
        .eq("id", data.id)
        .maybeSingle();

      // Only the fields the caller actually sent. Applying the create-time defaults
      // here used to reactivate a revoked card and move its start date to today
      // whenever an update left those fields out.
      // partner_id is never patched: moving a card between contacts is not an edit.
      const patch: {
        updated_by: string;
        year?: number;
        start_date?: string;
        end_date?: string | null;
        status?: string;
        notes?: string | null;
        membership_number?: string | null;
      } = { updated_by: userId };
      if (data.year !== undefined) patch.year = data.year;
      if (data.start_date !== undefined) patch.start_date = data.start_date;
      if (data.end_date !== undefined) patch.end_date = data.end_date;
      if (data.status !== undefined) patch.status = data.status;
      if (data.membership_number !== undefined) {
        patch.membership_number = data.membership_number || null;
      }
      if (data.notes !== undefined) patch.notes = data.notes;

      const { data: upd, error } = await supabase
        .from("membership_subscription")
        .update(patch)
        .eq("id", data.id)
        .select()
        .single();
      if (error) throw error;
      row = upd;
      await supabase.from("audit_log").insert({
        log_type: "subscription_change", action: "update", model_name: "membership_subscription",
        record_id: row.id, old_values_json: old, new_values_json: row, changed_by_user_id: userId, source: "ui",
      });
    } else {
      const year = data.year ?? new Date().getFullYear();
      // A number typed by hand wins. Left empty, the row goes in with NULL and the
      // trg_sub_membership_number trigger fills it: it holds a transaction-scoped advisory
      // lock while it reads the current maximum, which is why the value is not computed
      // here over a separate round-trip.
      const payload = {
        partner_id: data.partner_id,
        year,
        start_date: data.start_date ?? new Date().toISOString().slice(0, 10),
        end_date: data.end_date ?? `${year}-12-31`,
        status: data.status ?? "active",
        notes: data.notes ?? null,
        membership_number: data.membership_number || null,
        created_by: userId,
        updated_by: userId,
      };
      const { data: ins, error } = await supabase
        .from("membership_subscription")
        .insert(payload)
        .select()
        .single();
      if (error) throw error;
      row = ins;
      await supabase.from("audit_log").insert({
        log_type: "subscription_change", action: "create", model_name: "membership_subscription",
        record_id: row.id, new_values_json: row, changed_by_user_id: userId, source: "ui",
      });
    }
    return row;
  });

export const revokeSubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid(), partner_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: old } = await supabase.from("membership_subscription").select("*").eq("id", data.id).maybeSingle();
    const { data: upd, error } = await supabase
      .from("membership_subscription")
      .update({ status: "revoked", updated_by: userId })
      .eq("id", data.id)
      .select()
      .single();
    if (error) throw error;
    await supabase.from("audit_log").insert({
      log_type: "subscription_change", action: "update", model_name: "membership_subscription",
      record_id: data.id, old_values_json: old, new_values_json: upd, changed_by_user_id: userId, source: "ui",
    });
    return upd;
  });

/**
 * The state of the number space: every number in use, and the ones sitting on more than
 * one card.
 *
 * Both lists are needed and they answer different questions. `duplicated` is what the
 * record page flags — a number that already went wrong. `used` is what the dialog checks
 * while someone types, so they are warned *before* creating the duplicate rather than
 * after; a number in use exactly once is not yet a duplicate but typing it again makes one.
 *
 * This exists at all because the UNIQUE constraint was dropped on 2026-09-17: numbers are
 * written by hand on physical cards, so the register records what happened instead of
 * refusing it.
 */
export const membershipNumberUsage = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("membership_subscription")
      .select("membership_number")
      .not("membership_number", "is", null)
      .limit(10_000);
    if (error) throw error;

    const seen = new Map<string, number>();
    for (const row of (data ?? []) as any[]) {
      const n = row.membership_number as string;
      seen.set(n, (seen.get(n) ?? 0) + 1);
    }
    return {
      used: [...seen.keys()],
      duplicated: [...seen.entries()].filter(([, n]) => n > 1).map(([number]) => number),
    };
  });
