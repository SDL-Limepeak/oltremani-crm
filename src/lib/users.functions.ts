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

export const upsertUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => UserInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Authorize caller
    const { data: callerRow } = await supabase.from("res_users").select("role").eq("id", userId).maybeSingle();
    if (!callerRow || !["admin", "superuser", "coordinator"].includes(callerRow.role)) {
      throw new Error("Non autorizzato");
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
      const { data: old } = await supabaseAdmin.from("res_users").select("role").eq("id", uid).maybeSingle();
      if (old?.role === "admin") throw new Error("Gli amministratori non possono essere modificati");
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
    const { data: old } = await supabaseAdmin.from("res_users").select("role").eq("id", data.id).maybeSingle();
    if (old?.role === "admin") throw new Error("Gli amministratori non possono essere eliminati");
    const { error: e1 } = await supabaseAdmin.auth.admin.deleteUser(data.id);
    if (e1) throw e1;
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
