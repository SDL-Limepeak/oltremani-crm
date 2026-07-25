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

// TODO — SECURITY, before go-live: this endpoint is currently OPEN. Anyone who knows
// the URL can create contacts; no key, no signature, no rate limit. That is a deliberate
// choice for the demo phase (2026-07-25), taken so the sample form works with no setup.
//
// Before oltremani.it goes live, decide the real protection together with whoever builds
// the WordPress form. The trade-offs are written up in .claude/architecture.md, section
// "Protezione dell'endpoint pubblico". In short:
//   - a shared key only works if WordPress calls from PHP, server-side. From JavaScript
//     the key ends up in the page source and protects nothing
//   - whatever the key, it authenticates WordPress and not the person filling the form:
//     a bot on the real form produces perfectly authenticated junk. That needs a CAPTCHA
//     (Cloudflare Turnstile) on the WordPress side
//   - a rate limit is worth more than any key upgrade, and has to live in this code:
//     the app runs as a worker inside Lovable's infrastructure, so edge WAF rules are
//     not ours to configure
export const Route = createFileRoute("/api/public/contact")({
  server: {
    handlers: {
      OPTIONS: () =>
        new Response(null, {
          headers: {
            "access-control-allow-origin": "*",
            "access-control-allow-headers": "content-type",
            "access-control-allow-methods": "POST, OPTIONS",
          },
        }),

      POST: async ({ request }) => {
        let body: any;
        try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

        const { first_name, last_name, email, phone, city, province, notes, privacy_consents } = body ?? {};
        if (!email || typeof email !== "string") return json({ error: "email required" }, 400);
        // Phone is mandatory as of the 2026-07-25 feedback. Checked here for a clean 400,
        // and again inside the RPC because that is the boundary WordPress actually hits.
        if (!phone || typeof phone !== "string" || !phone.trim()) {
          return json({ error: "phone required" }, 400);
        }

        const ip = request.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? null;
        const ua = request.headers.get("user-agent") ?? null;

        const { data, error } = await anonClient().rpc("submit_public_contact", {
          p_first_name:       first_name ?? null,
          p_last_name:        last_name  ?? null,
          p_email:            email,
          p_phone:            phone,
          p_city:             city       ?? null,
          p_province:         province   ?? null,
          p_privacy_consents: Array.isArray(privacy_consents) ? privacy_consents : null,
          p_ip_address:       ip,
          p_user_agent:       ua,
          p_notes:            typeof notes === "string" && notes.trim() ? notes : null,
        });

        if (error) return json({ error: error.message }, 500);
        // unassigned=true means no territorial group was matched — contact will show
        // the "Da assegnare" indicator in the CRM until a group is manually assigned.
        return json({ ...data, unassigned: data?.validation ?? false });
      },
    },
  },
});
