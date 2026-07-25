-- ============================================================================
-- Fix: a non-admin user could not create a contact from the app
-- ============================================================================
-- Applied 2026-07-25 via Lovable MCP (query_database).
--
-- PRE-EXISTING bug, surfaced while testing migration 20260725120000 and not caused
-- by it: none of that migration's policies touched res_partner.
--
-- Symptom: upsertPartner (src/lib/partners.functions.ts) runs
--     .from("res_partner").insert(payload).select().single()
-- which in SQL is INSERT ... RETURNING. Postgres applies the SELECT policy to rows
-- returned by RETURNING as well. partner_select relied purely on categories, and a
-- freshly created contact has none yet, so the read-back was refused and the whole
-- insert failed with
--     new row violates row-level security policy for table "res_partner"
--
-- Verified: the same INSERT without RETURNING succeeds, with RETURNING it does not.
--
-- Why nobody noticed: the only two users are admin and superuser, who short-circuit
-- through is_admin_or_super(). It would have shown up with the first coordinator.
--
-- Fix: whoever created a contact can see it, regardless of categories. Placed inside
-- can_see_partner so it applies consistently to memberships, consents and category
-- relations too, instead of chasing one policy at a time.
--
-- Security note: created_by is not exploitable for escalation. Setting it on someone
-- else's contact would require an UPDATE on that contact, which already requires
-- being able to see it. Setting it on a brand new contact grants no access to
-- anything the caller did not create.
--
-- NOTE: this migration alone was NOT enough — see 20260725140000.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.can_see_partner(_uid uuid, _partner_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT public.is_admin_or_super(_uid)
      OR EXISTS (
           SELECT 1 FROM public.res_partner p
            WHERE p.id = _partner_id AND p.created_by = _uid
         )
      OR EXISTS (
           SELECT 1 FROM public.res_partner_category_rel r
            WHERE r.partner_id = _partner_id
              AND r.category_id IN (SELECT public.visible_category_ids(_uid))
         );
$function$;

-- The OR on partner_created_by() inside rpcr_mod (migration 20260725120000) is now
-- redundant, since can_see_partner already covers that case. Left in place: it is
-- harmless and documents the intent. partner_created_by stays defined.
