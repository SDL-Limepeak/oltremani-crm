import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
  });
}

function normalize(s: string | null | undefined) {
  return (s ?? "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
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
        const apiKey = request.headers.get("x-api-key");
        const expected = process.env.PUBLIC_API_KEY;
        if (!expected || apiKey !== expected) return json({ error: "Unauthorized" }, 401);

        let body: any;
        try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

        const { first_name, last_name, email, phone, city, province, privacy_consents } = body ?? {};
        if (!email || typeof email !== "string") return json({ error: "email required" }, 400);

        const ua = request.headers.get("user-agent") ?? null;
        const ip = request.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? null;

        // 1. inbound_form audit
        await supabaseAdmin.from("audit_log").insert({
          log_type: "inbound_form",
          action: "api_call",
          source: "public_form",
          new_values_json: { first_name, last_name, email, phone, city, province },
        });

        // 2. find partner
        const { data: existing } = await supabaseAdmin
          .from("res_partner")
          .select("*")
          .eq("email", email)
          .maybeSingle();

        let partnerId: string;
        let oldPartner = existing;

        if (!existing) {
          const { data: created, error } = await supabaseAdmin
            .from("res_partner")
            .insert({
              first_name: first_name ?? null,
              last_name: last_name ?? null,
              display_name: [first_name, last_name].filter(Boolean).join(" ") || null,
              email,
              phone: phone ?? null,
              raw_city: city ?? null,
              raw_province: province ?? null,
              status: "new",
            })
            .select()
            .single();
          if (error) return json({ error: error.message }, 500);
          partnerId = created.id;
          await supabaseAdmin.from("audit_log").insert({
            log_type: "record_change", action: "create", model_name: "res_partner",
            record_id: partnerId, new_values_json: created, source: "public_form",
          });
        } else {
          partnerId = existing.id;
          const patch: any = {};
          if (!existing.first_name && first_name) patch.first_name = first_name;
          if (!existing.last_name && last_name) patch.last_name = last_name;
          if (!existing.phone && phone) patch.phone = phone;
          if (!existing.raw_city && city) patch.raw_city = city;
          if (!existing.raw_province && province) patch.raw_province = province;
          if (Object.keys(patch).length) {
            patch.display_name = existing.display_name ?? ([patch.first_name ?? existing.first_name, patch.last_name ?? existing.last_name].filter(Boolean).join(" ") || null);
            const { data: upd } = await supabaseAdmin.from("res_partner").update(patch).eq("id", partnerId).select().single();
            await supabaseAdmin.from("audit_log").insert({
              log_type: "record_change", action: "merge", model_name: "res_partner",
              record_id: partnerId, old_values_json: oldPartner, new_values_json: upd, source: "public_form",
            });
          }
        }

        // 3. resolve city
        let matchedCity: any = null;
        if (city) {
          const ncity = normalize(city);
          let q = supabaseAdmin.from("res_city").select("id, name, category_id, province_code");
          if (province) q = q.eq("province_code", String(province).toUpperCase());
          const { data: cands } = await q.ilike("name", `%${city}%`).limit(20);
          matchedCity = (cands ?? []).find((c: any) => normalize(c.name) === ncity) ?? cands?.[0] ?? null;
        }

        // Validation cat
        const { data: validationCat } = await supabaseAdmin
          .from("res_partner_category").select("id").eq("name", "Validation").maybeSingle();

        if (matchedCity) {
          await supabaseAdmin.from("res_partner").update({ city_id: matchedCity.id }).eq("id", partnerId);
          if (matchedCity.category_id) {
            await supabaseAdmin.from("res_partner_category_rel").upsert(
              { partner_id: partnerId, category_id: matchedCity.category_id },
              { onConflict: "partner_id,category_id" },
            );
          }
          if (validationCat?.id) {
            await supabaseAdmin
              .from("res_partner_category_rel")
              .delete().eq("partner_id", partnerId).eq("category_id", validationCat.id);
          }
        } else if (validationCat?.id) {
          await supabaseAdmin.from("res_partner_category_rel").upsert(
            { partner_id: partnerId, category_id: validationCat.id },
            { onConflict: "partner_id,category_id" },
          );
        }

        // 4. consents
        if (Array.isArray(privacy_consents)) {
          const rows = privacy_consents
            .filter((c: any) => ["privacy_policy", "marketing", "newsletter"].includes(c?.consent_type))
            .map((c: any) => ({
              partner_id: partnerId,
              consent_type: c.consent_type,
              accepted: Boolean(c.accepted),
              accepted_at: c.accepted ? new Date().toISOString() : null,
              source: "public_form",
              version: c.version ?? null,
              ip_address: ip,
              user_agent: ua,
            }));
          if (rows.length) await supabaseAdmin.from("privacy_consent").insert(rows);
        }

        return json({ ok: true, partner_id: partnerId, validation: !matchedCity });
      },
    },
  },
});
