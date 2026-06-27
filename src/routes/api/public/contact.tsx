import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
  });
}

// Lightweight anon client — no service_role key required.
// All privileged DB work is done inside the SECURITY DEFINER function
// `submit_public_contact` which runs with owner privileges server-side.
function anonClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Missing SUPABASE_URL or SUPABASE_PUBLISHABLE_KEY");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export const Route = createFileRoute("/api/public/contact")({
  server: {
    handlers: {
      OPTIONS: () =>
        new Response(null, {
          headers: {
            "access-control-allow-origin": "*",
            "access-control-allow-headers": "content-type, x-api-key",
            "access-control-allow-methods": "POST, OPTIONS",
          },
        }),

      POST: async ({ request }) => {
        const apiKey  = request.headers.get("x-api-key");
        const expected = process.env.PUBLIC_API_KEY;
        if (!expected || apiKey !== expected) return json({ error: "Unauthorized" }, 401);

        let body: any;
        try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

        const { first_name, last_name, email, phone, city, province, privacy_consents } = body ?? {};
        if (!email || typeof email !== "string") return json({ error: "email required" }, 400);

        const ip = request.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? null;
        const ua = request.headers.get("user-agent") ?? null;

        const { data, error } = await anonClient().rpc("submit_public_contact", {
          p_first_name:       first_name ?? null,
          p_last_name:        last_name  ?? null,
          p_email:            email,
          p_phone:            phone      ?? null,
          p_city:             city       ?? null,
          p_province:         province   ?? null,
          p_privacy_consents: Array.isArray(privacy_consents) ? privacy_consents : null,
          p_ip_address:       ip,
          p_user_agent:       ua,
        });

        if (error) return json({ error: error.message }, 500);
        // unassigned=true means no territorial group was matched — contact will show
        // the "Da assegnare" indicator in the CRM until a group is manually assigned.
        return json({ ...data, unassigned: data?.validation ?? false });
      },
    },
  },
});
