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

export const upsertUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => UserInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const callerRole = await requireUserManager(supabase, userId);
    const isElevated = callerRole === "admin" || callerRole === "superuser";

    // A coordinator manages its own team, not its peers or its superiors: without this
    // it could mint a superuser account (or promote a volunteer into one) and escalate.
    if (!isElevated) {
      if (data.role === "superuser") {
        throw new Error("Solo admin o superuser possono creare utenti superuser");
      }
      if (data.id) {
        const { data: target } = await supabaseAdmin
          .from("res_users").select("role").eq("id", data.id).maybeSingle();
        if (target && !["volunteer", "coordinator"].includes(target.role)) {
          throw new Error("Non autorizzato a modificare questo utente");
        }
      }
      // ...and it can only hand out groups it can see itself.
      const { data: visible } = await (supabase as any).rpc("visible_category_ids", { _uid: userId });
      const allowed = new Set((visible ?? []).map((v: any) => (typeof v === "string" ? v : v.visible_category_ids)));
      const outOfScope = data.category_ids.filter((c) => !allowed.has(c));
      if (outOfScope.length) {
        throw new Error("Non autorizzato ad assegnare gruppi fuori dal proprio perimetro");
      }
    }

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

    // This used to check nothing but the target's role, and it deletes through
    // supabaseAdmin: any authenticated user, volunteer included, could wipe out any
    // non-admin account. Deleting people is an admin/superuser action only.
    const callerRole = await requireUserManager(context.supabase, context.userId);
    if (!["admin", "superuser"].includes(callerRole)) {
      throw new Error("Solo admin o superuser possono eliminare utenti");
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
