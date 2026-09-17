import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const listUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("res_users")
      .select("*, res_user_category_rel(category_id, res_partner_category(id, name))")
      .order("name");
    if (error) throw error;
    return data ?? [];
  });

const UserInput = z.object({
  id: z.string().uuid().optional(),
  email: z.string().email().max(255),
  name: z.string().min(1).max(120),
  role: z.enum(["superuser", "coordinator", "volunteer"]),
  status: z.enum(["active", "inactive"]).default("active"),
  category_ids: z.array(z.string().uuid()).default([]),
  password: z.string().min(8).max(72).optional(),
});

// Every write below goes through supabaseAdmin, which bypasses RLS. That makes these
// checks the only thing standing between a caller and the whole user table, so they
// have to be explicit — the res_users policies never get a chance to run.
async function requireUserManager(supabase: any, userId: string) {
  const { data: callerRow } = await supabase.from("res_users").select("role").eq("id", userId).maybeSingle();
  if (!callerRow || !["admin", "superuser", "coordinator"].includes(callerRow.role)) {
    throw new Error("Non autorizzato");
  }
  return callerRow.role as string;
}

/**
 * The profile hierarchy, mirroring public.role_rank / public.can_manage_user in the
 * database. Two copies of a rule is a liability, so they are named the same and changed
 * together: the SQL one governs anything reaching PostgREST directly, this one governs
 * the supabaseAdmin writes below, which RLS never sees.
 *
 *   admin > superuser > coordinator > volunteer
 *
 * You act on profiles strictly below your own; admin acts on anyone. A volunteer
 * therefore manages nobody, including other volunteers.
 */
const ROLE_RANK: Record<string, number> = {
  admin: 4, superuser: 3, coordinator: 2, volunteer: 1,
};

function canManage(callerRole: string, targetRole: string): boolean {
  if (callerRole === "admin") return true;
  return (ROLE_RANK[callerRole] ?? 0) > (ROLE_RANK[targetRole] ?? 0);
}

function assertCanManage(callerRole: string, targetRole: string) {
  if (!canManage(callerRole, targetRole)) {
    throw new Error("Non autorizzato a gestire un utente con questo profilo");
  }
}

export const upsertUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => UserInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const callerRole = await requireUserManager(supabase, userId);

    // The profile being written has to be below the caller's, or a coordinator could mint
    // a superuser account and escalate in one call.
    assertCanManage(callerRole, data.role);

    // ...and so does the profile being overwritten, or the same coordinator could take
    // over a superuser's account by writing a lower role onto it.
    if (data.id) {
      const { data: target } = await supabaseAdmin
        .from("res_users").select("role").eq("id", data.id).maybeSingle();
      if (target) assertCanManage(callerRole, target.role);
    }

    // Groups no longer restrict what a user can see (2026-09-17), so they are a label on
    // the user rather than a permission and anyone managing the user may set them.

    let uid = data.id;
    if (!uid) {
      // create auth user
      if (!data.password) throw new Error("Password richiesta per nuovi utenti");
      const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
        email: data.email,
        password: data.password,
        email_confirm: true,
        user_metadata: { name: data.name },
      });
      if (error) throw error;
      uid = created.user!.id;
      // wait for handle_new_user trigger row, then update role
      await supabaseAdmin
        .from("res_users")
        .upsert({ id: uid, email: data.email, name: data.name, role: data.role, status: data.status });
    } else {
      // protect: cannot demote admin or promote to admin via this endpoint
      const { data: old } = await supabaseAdmin
        .from("res_users")
        .select("role, email")
        .eq("id", uid)
        .maybeSingle();
      if (old?.role === "admin") throw new Error("Gli amministratori non possono essere modificati");

      // The login address lives in auth.users and the displayed one in res_users.
      // Writing only the second used to leave the two out of step: the CRM showed the
      // new address while the person kept signing in with the old one. Change the auth
      // side first — if it fails, the profile is still the truth.
      if (old && old.email !== data.email) {
        const { error: authErr } = await supabaseAdmin.auth.admin.updateUserById(uid, {
          email: data.email,
          email_confirm: true,
        });
        if (authErr) throw authErr;
      }

      await supabaseAdmin
        .from("res_users")
        .update({ name: data.name, email: data.email, role: data.role, status: data.status })
        .eq("id", uid);
    }

    // category assignments
    await supabaseAdmin.from("res_user_category_rel").delete().eq("user_id", uid);
    if (data.category_ids.length) {
      await supabaseAdmin
        .from("res_user_category_rel")
        .insert(data.category_ids.map((cid) => ({ user_id: uid!, category_id: cid })));
    }

    await supabase.from("audit_log").insert({
      log_type: "user_change", action: data.id ? "update" : "create", model_name: "res_users",
      record_id: uid, new_values_json: { name: data.name, email: data.email, role: data.role, status: data.status, category_ids: data.category_ids },
      changed_by_user_id: userId, source: "ui",
    });

    return { id: uid };
  });

export const deleteUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Deleting is now admin-only: everyone else disables instead (setUserStatus below).
    // The check lives here because the write goes through supabaseAdmin and never meets
    // the users_delete policy.
    const callerRole = await requireUserManager(context.supabase, context.userId);
    if (callerRole !== "admin") {
      throw new Error("Solo un admin può eliminare un utente. Puoi disabilitarlo.");
    }

    const { data: old } = await supabaseAdmin.from("res_users").select("role").eq("id", data.id).maybeSingle();
    if (old?.role === "admin") throw new Error("Gli amministratori non possono essere eliminati");

    // Remove the auth account. Tolerate "user not found" so a stale profile row
    // left behind by a previous partial delete can still be cleaned up.
    const { error: e1 } = await supabaseAdmin.auth.admin.deleteUser(data.id);
    if (e1 && !/not.?found/i.test(e1.message ?? "")) throw e1;

    // Remove the profile row and its group links so the user disappears from the list.
    await supabaseAdmin.from("res_user_category_rel").delete().eq("user_id", data.id);
    await supabaseAdmin.from("res_users").delete().eq("id", data.id);

    await context.supabase.from("audit_log").insert({
      log_type: "user_change", action: "delete", model_name: "res_users",
      record_id: data.id, old_values_json: old, changed_by_user_id: context.userId, source: "ui",
    });
    return { ok: true };
  });

export const updateProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ name: z.string().min(1).max(120) }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("res_users").update({ name: data.name }).eq("id", context.userId);
    if (error) throw error;
    return { ok: true };
  });

/**
 * Disable or re-enable a user. This is what replaced "elimina" for everyone except admin:
 * an inactive profile cannot pass current_role_name(), so every policy that asks for a
 * role stops answering for them — they are locked out without the account, its history or
 * its audit trail going anywhere.
 */
export const setUserStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ id: z.string().uuid(), status: z.enum(["active", "inactive"]) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const callerRole = await requireUserManager(context.supabase, context.userId);

    if (data.id === context.userId) {
      throw new Error("Non puoi disabilitare il tuo stesso account");
    }

    const { data: target } = await supabaseAdmin
      .from("res_users").select("role, name, email, status").eq("id", data.id).maybeSingle();
    if (!target) throw new Error("Utente non trovato");
    if (target.role === "admin") throw new Error("Gli amministratori non possono essere disabilitati");
    assertCanManage(callerRole, target.role);

    const { error } = await supabaseAdmin
      .from("res_users").update({ status: data.status }).eq("id", data.id);
    if (error) throw error;

    await context.supabase.from("audit_log").insert({
      log_type: "user_change", action: "update", model_name: "res_users",
      record_id: data.id, old_values_json: { status: target.status },
      new_values_json: { status: data.status },
      changed_by_user_id: context.userId, source: "ui",
    });
    return { ok: true };
  });
