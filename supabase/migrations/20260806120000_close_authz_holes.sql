-- ============================================================================
-- Closes KI-01, KI-02, KI-03 and KI-10 from .claude/knowissues.md
-- ============================================================================
-- Applied 2026-08-06 via Lovable MCP (query_database), NOT through the Lovable
-- agent — same conscious exception as the 202607251* migrations. Lovable does not
-- have these in its changelog, so re-run `bun test` after any schema regeneration.
--
-- All three holes were reproduced against production before the fix and are
-- covered by tests/regressions.test.ts afterwards.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- KI-01. anon could execute seven SECURITY DEFINER functions
-- ----------------------------------------------------------------------------
-- Migration 20260725200000 revoked EXECUTE from anon and it changed nothing,
-- because Postgres grants EXECUTE on every new function to PUBLIC and anon
-- inherits from PUBLIC. Revoking a role-specific grant they never used is a
-- no-op. The revoke has to name PUBLIC.
--
-- Trigger functions can be revoked from everyone: PostgreSQL checks EXECUTE on a
-- trigger function at CREATE TRIGGER time, not on each fire, so the existing
-- triggers keep working.

REVOKE EXECUTE ON FUNCTION public.handle_new_user()        FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.protect_admin_users()    FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_updated_at()         FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_created_by()         FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sub_default_end_date()   FROM PUBLIC, anon, authenticated;

-- partner_created_by is called from the rpcr_mod WITH CHECK, and policy
-- expressions run with the querying user's privileges, so authenticated must
-- keep it. anon must not: the _uid guard is inert for anon (auth.uid() is NULL,
-- so the guard's own precondition is false) and the function reads res_partner
-- past RLS.
REVOKE EXECUTE ON FUNCTION public.partner_created_by(uuid, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.partner_created_by(uuid, uuid) TO authenticated;

-- generate_membership_number leaked the membership counter to anybody on the
-- internet. After the KI-10 fix below nothing calls it from the client at all,
-- so it can be closed to every API role.
REVOKE EXECUTE ON FUNCTION public.generate_membership_number(integer)
  FROM PUBLIC, anon, authenticated;

-- anon keeps exactly one entry point, which is the whole point of the public form.
REVOKE EXECUTE ON FUNCTION public.submit_public_contact(text,text,text,text,text,text,jsonb,text,text,text)
  FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.submit_public_contact(text,text,text,text,text,text,jsonb,text,text,text)
  TO anon, authenticated;

-- The five authorization helpers already had PUBLIC revoked; restate it so a
-- future CREATE OR REPLACE that recreates one of them cannot silently reopen it.
REVOKE EXECUTE ON FUNCTION public.can_see_partner(uuid, uuid)   FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.current_role_name()           FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, text)          FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_admin_or_super(uuid)       FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.visible_category_ids(uuid)    FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.can_see_partner(uuid, uuid)   TO authenticated;
GRANT  EXECUTE ON FUNCTION public.current_role_name()           TO authenticated;
GRANT  EXECUTE ON FUNCTION public.has_role(uuid, text)          TO authenticated;
GRANT  EXECUTE ON FUNCTION public.is_admin_or_super(uuid)       TO authenticated;
GRANT  EXECUTE ON FUNCTION public.visible_category_ids(uuid)    TO authenticated;


-- ----------------------------------------------------------------------------
-- KI-02. A coordinator could grant itself any group
-- ----------------------------------------------------------------------------
-- rucr_mod validated the caller's ROLE and never looked at which (user_id,
-- category_id) pair was being written, so a coordinator could POST its own id
-- plus any category and immediately read every contact in it. users.functions.ts
-- does guard this, but PostgREST is publicly reachable and skips the app.
--
-- The new expression mirrors what upsertUser enforces in TypeScript: a
-- coordinator may only hand out groups inside its own perimeter, and only to
-- volunteers or other coordinators.
--
-- visible_category_ids() is evaluated during the statement, so a coordinator can
-- never bootstrap itself into a group it does not already hold.

ALTER POLICY rucr_mod ON public.res_user_category_rel
  USING (
    public.is_admin_or_super(auth.uid())
    OR (
      public.current_role_name() = 'coordinator'
      AND category_id IN (SELECT public.visible_category_ids(auth.uid()))
      AND EXISTS (
        SELECT 1 FROM public.res_users u
         WHERE u.id = res_user_category_rel.user_id
           AND u.role IN ('volunteer', 'coordinator')
      )
    )
  )
  WITH CHECK (
    public.is_admin_or_super(auth.uid())
    OR (
      public.current_role_name() = 'coordinator'
      AND category_id IN (SELECT public.visible_category_ids(auth.uid()))
      AND EXISTS (
        SELECT 1 FROM public.res_users u
         WHERE u.id = res_user_category_rel.user_id
           AND u.role IN ('volunteer', 'coordinator')
      )
    )
  );


-- ----------------------------------------------------------------------------
-- KI-03. A coordinator could create membership cards for invisible contacts
-- ----------------------------------------------------------------------------
-- Same mistake as KI-02, one table over. sub_mod's USING did check the perimeter,
-- so UPDATE and DELETE were correctly scoped; its WITH CHECK did not, and INSERT
-- consults only WITH CHECK. The row was created and then invisible to its own
-- author — a silent write, and only reachable with Prefer: return=minimal, which
-- is why it never showed up through the UI.

ALTER POLICY sub_mod ON public.membership_subscription
  WITH CHECK (
    (public.current_role_name() = ANY (ARRAY['admin', 'superuser', 'coordinator']))
    AND public.can_see_partner(auth.uid(), partner_id)
  );


-- ----------------------------------------------------------------------------
-- KI-10. Membership numbers could collide
-- ----------------------------------------------------------------------------
-- upsertSubscription called generate_membership_number over HTTP and then sent a
-- second request to INSERT. Two cards created in the same window computed the
-- same MAX+1 and the second INSERT died on the UNIQUE constraint.
--
-- Generating it inside a BEFORE INSERT trigger makes the read and the write one
-- statement, and the transaction-scoped advisory lock serialises concurrent
-- inserts for the same year — the lock is held until commit, which a separate
-- round-trip could never do.
--
-- SECURITY DEFINER so that generate_membership_number can stay revoked from
-- every API role (KI-01): the trigger calls it as the owner, not as the caller.

CREATE OR REPLACE FUNCTION public.set_membership_number()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.membership_number IS NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext('membership_number:' || NEW.year::text));
    NEW.membership_number := public.generate_membership_number(NEW.year);
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.set_membership_number() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_sub_membership_number ON public.membership_subscription;
CREATE TRIGGER trg_sub_membership_number
  BEFORE INSERT ON public.membership_subscription
  FOR EACH ROW EXECUTE FUNCTION public.set_membership_number();
