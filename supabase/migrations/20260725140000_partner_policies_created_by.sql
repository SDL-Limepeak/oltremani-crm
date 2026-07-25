-- ============================================================================
-- Fix (follow-up to 20260725130000): created_by belongs in the policy, not the function
-- ============================================================================
-- Applied 2026-07-25 via Lovable MCP (query_database).
--
-- Why the previous migration was not enough: inside INSERT ... RETURNING the row being
-- inserted is NOT yet visible to subqueries of the same statement (command counter).
-- can_see_partner does
--     EXISTS (SELECT 1 FROM res_partner WHERE id = _partner_id AND created_by = _uid)
-- and that SELECT cannot see the in-flight row, so it returns false and RETURNING is
-- refused anyway.
--
-- A policy expression, by contrast, is evaluated directly against the row's values:
-- `created_by = auth.uid()` works without touching the table at all.
--
-- The change to can_see_partner is still useful and should be kept: it covers consents,
-- memberships and category relations, where the partner already exists and the subquery
-- finds it normally.
-- ============================================================================

ALTER POLICY partner_select ON public.res_partner
  USING (public.can_see_partner(auth.uid(), id) OR created_by = auth.uid());

ALTER POLICY partner_update ON public.res_partner
  USING (public.can_see_partner(auth.uid(), id) OR created_by = auth.uid());
