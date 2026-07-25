-- ============================================================================
-- Fix: a coordinator could not create a group at all
-- ============================================================================
-- Applied 2026-07-25 via Lovable MCP (query_database).
--
-- Found by the end-to-end permission matrix: a coordinator creating a category got
-- HTTP 403, even though rpc_insert explicitly allows the coordinator role.
--
-- Same root cause as 20260725140000, in a different table. upsertCategory
-- (src/lib/categories.functions.ts) does
--     .from("res_partner_category").insert(data).select().single()
-- which is INSERT ... RETURNING, so the SELECT policy is applied to the new row too.
-- rpc_select only lets a non-elevated user see categories inside
-- visible_category_ids(), and a category created a moment ago is in nobody's
-- perimeter yet — so the read-back was refused and the whole insert failed.
--
-- Not noticed before for the same reason as the other one: both existing users are
-- admin/superuser and short-circuit through is_admin_or_super(). The build plan does
-- grant coordinators category management ("Manage categories: Coordinator ✓"), so
-- this was broken against spec.
--
-- Fix mirrors the partner one: track who created the category and let them see it.
-- created_by also happens to be useful on its own — until now there was no record of
-- who added a group.
-- ============================================================================

ALTER TABLE public.res_partner_category
  ADD COLUMN IF NOT EXISTS created_by uuid;

COMMENT ON COLUMN public.res_partner_category.created_by IS
  'Author of the category. Also used by rpc_select so the creator can read the row back from INSERT ... RETURNING.';

ALTER POLICY rpc_select ON public.res_partner_category
  USING (
    public.is_admin_or_super(auth.uid())
    OR created_by = auth.uid()
    OR (id IN (SELECT public.visible_category_ids(auth.uid())))
  );
