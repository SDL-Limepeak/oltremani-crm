-- ============================================================================
-- Client feedback 2026-09-17
--   1  the five operational roles are redefined
--   2  contacts: the group perimeter is removed entirely
--   3  user management becomes a strict profile hierarchy; delete is admin-only
--   4  card numbers are assigned by hand: UNIQUE dropped, duplicates warned about
--   5  cards expire from their end date, applied nightly by pg_cron
--   6  only the primary privacy purpose is collected; web submissions carry channel='web'
-- ============================================================================
-- Applied 2026-09-17 via Lovable MCP (query_database), with the client's explicit
-- go-ahead to write to production directly. Not in Lovable's changelog — re-run
-- `bun test` after any schema regeneration.
--
-- Verified after applying, against the catalog and with the five test accounts' real
-- tokens, not by reading this file back (access.md rule 7).
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. The five operational roles
-- ----------------------------------------------------------------------------
-- res_partner_role_rel was empty when this ran, so nothing had to be reassigned — that
-- is the only reason renaming codes was safe. It will not be safe again.
--
-- The mapping: famiglia_ospitante keeps its code and id. membro_semplice and
-- specialista_abitare are renamed in place, so their ids survive. The client merged
-- "abitare" and "migrazione" into one entry — the split existed precisely because the
-- selection is multiple, and they decided one line reads better on the form.
-- specialista_migrazione and bussola are dropped.

UPDATE public.res_partner_role
   SET code = 'membro_comunita', name = 'Membro della comunità', sort_order = 30
 WHERE code = 'membro_semplice';

UPDATE public.res_partner_role
   SET code = 'specialista_diritti',
       name = 'Specialista di diritti sulle migrazioni e/o abitare',
       sort_order = 50
 WHERE code = 'specialista_abitare';

DELETE FROM public.res_partner_role WHERE code IN ('specialista_migrazione', 'bussola');

UPDATE public.res_partner_role SET sort_order = 40 WHERE code = 'famiglia_ospitante';

INSERT INTO public.res_partner_role (code, name, sort_order) VALUES
  ('attivista', 'Attivista', 10),
  ('socio_aps', 'Socio APS', 20)
ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, sort_order = EXCLUDED.sort_order;

-- Consequence worth stating: submit_public_contact drops role codes it does not
-- recognise, silently and on purpose, so the WordPress form is not broken by this list
-- changing. The flip side is that a form still posting 'bussola' or 'membro_semplice'
-- loses those answers with no error anywhere. Pinned in roles-and-membership.test.ts.


-- ----------------------------------------------------------------------------
-- 2. Contacts: no perimeter
-- ----------------------------------------------------------------------------
-- Every active user reads and writes every contact. One function does it: twelve
-- policies across six tables route through can_see_partner, so rewriting it is the whole
-- change rather than a sweep of DROP POLICY.
--
-- The _uid guard stays. It is not about the perimeter — it stops a caller asking "what
-- would somebody else be able to see", which is how this helper was probed.

CREATE OR REPLACE FUNCTION public.can_see_partner(_uid uuid, _partner_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN auth.uid() IS NOT NULL AND _uid IS DISTINCT FROM auth.uid() THEN false
    ELSE EXISTS (SELECT 1 FROM public.res_users
                  WHERE id = _uid AND status = 'active')
  END;
$function$;

-- The group link table still carried the perimeter in its WITH CHECK, which would have
-- kept a volunteer from assigning a group outside their own. Half-open is worse than
-- either state: the contact is editable, the group picker silently refuses.
DROP POLICY IF EXISTS rpcr_mod ON public.res_partner_category_rel;
CREATE POLICY rpcr_mod ON public.res_partner_category_rel FOR ALL TO authenticated
  USING (public.can_see_partner(auth.uid(), partner_id))
  WITH CHECK (public.can_see_partner(auth.uid(), partner_id)
              OR public.partner_created_by(auth.uid(), partner_id));

-- NOT changed, deliberately:
--   partner_delete       — still admin/superuser. Removing a contact takes its cards and
--                          its proof of consent with it; that is not an edit.
--   sub_mod              — still admin/superuser/coordinator. Cards were never about the
--                          perimeter, and the client did not ask to open them.
--   visible_category_ids — still real. Nothing on contacts consults it now, but
--                          res_user_category_rel is still where a user's groups live.


-- ----------------------------------------------------------------------------
-- 3. User management: a strict hierarchy
-- ----------------------------------------------------------------------------
--   admin > superuser > coordinator > volunteer
--
-- You act on profiles strictly below your own; admin acts on anyone. A volunteer manages
-- nobody, including other volunteers — strictly-lower, not lower-or-equal.
-- "Ruolo" is called "Profilo" in the UI from this date, because contacts have roles too
-- and the two words were being read as the same thing.

CREATE OR REPLACE FUNCTION public.role_rank(_role text)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT CASE _role
    WHEN 'admin'       THEN 4
    WHEN 'superuser'   THEN 3
    WHEN 'coordinator' THEN 2
    WHEN 'volunteer'   THEN 1
    ELSE 0
  END;
$function$;

CREATE OR REPLACE FUNCTION public.can_manage_user(_uid uuid, _target_role text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN auth.uid() IS NOT NULL AND _uid IS DISTINCT FROM auth.uid() THEN false
    ELSE (
      SELECT CASE
        WHEN u.role = 'admin' THEN true
        ELSE public.role_rank(u.role) > public.role_rank(_target_role)
      END
      FROM public.res_users u
      WHERE u.id = _uid AND u.status = 'active'
    )
  END;
$function$;

-- The same predicate in both clauses is the whole point. USING sees the old row and
-- WITH CHECK the new one, so a coordinator can neither touch a superuser nor promote a
-- volunteer into one. Dropping the second clause reopens privilege escalation.
DROP POLICY IF EXISTS users_update ON public.res_users;
CREATE POLICY users_update ON public.res_users FOR UPDATE TO authenticated
  USING (id = auth.uid() OR public.can_manage_user(auth.uid(), role))
  WITH CHECK (id = auth.uid() OR public.can_manage_user(auth.uid(), role));

-- Delete is admin-only now; everyone else disables, which is reversible.
DROP POLICY IF EXISTS users_delete ON public.res_users;
CREATE POLICY users_delete ON public.res_users FOR DELETE TO authenticated
  USING (public.current_role_name() = 'admin' AND role <> 'admin');

DROP POLICY IF EXISTS users_insert ON public.res_users;
CREATE POLICY users_insert ON public.res_users FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_user(auth.uid(), role));

-- The trigger still said "only admin or superuser may change role or status", which would
-- have overridden the hierarchy and left a coordinator unable to disable a volunteer even
-- though the policy allows it. The admin protections are untouched: losing the only admin
-- is still not recoverable from the application.
CREATE OR REPLACE FUNCTION public.protect_admin_users()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.role = 'admin' AND NEW.id <> auth.uid() THEN
      RAISE EXCEPTION 'Admin users cannot be modified from UI';
    END IF;

    IF OLD.role = 'admin' AND NEW.role IS DISTINCT FROM OLD.role THEN
      RAISE EXCEPTION 'Il ruolo admin non puo essere modificato dall''applicazione';
    END IF;

    IF NEW.role = 'admin' AND OLD.role <> 'admin' THEN
      RAISE EXCEPTION 'Cannot promote to admin from UI';
    END IF;

    IF auth.uid() IS NOT NULL AND NOT public.can_manage_user(auth.uid(), OLD.role) THEN
      IF NEW.role IS DISTINCT FROM OLD.role THEN
        RAISE EXCEPTION 'Non puoi cambiare il profilo di questo utente';
      END IF;
      IF NEW.status IS DISTINCT FROM OLD.status THEN
        RAISE EXCEPTION 'Non puoi cambiare lo stato di questo utente';
      END IF;
    END IF;

  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.role = 'admin' THEN
      RAISE EXCEPTION 'Admin users cannot be deleted from UI';
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$function$;


-- ----------------------------------------------------------------------------
-- 4. Card numbers are written by hand
-- ----------------------------------------------------------------------------
-- The cards are physical and numbered by the association, so the register records what
-- happened instead of deciding what may happen. A duplicate is flagged in the UI.
--
-- Consequence, stated because it is easy to miss: submit_public_contact matches a
-- declared card by number, and with duplicates allowed that lookup resolves to whichever
-- row it finds first. It still never moves a card between contacts, so the worst case
-- remains "sent to validation" — the reason that rule was written that way now covers a
-- case it was not designed for.

ALTER TABLE public.membership_subscription
  DROP CONSTRAINT IF EXISTS membership_subscription_membership_number_key;

-- A non-unique index still serves the lookups the constraint was backing.
CREATE INDEX IF NOT EXISTS idx_sub_membership_number
  ON public.membership_subscription (membership_number);

-- trg_sub_membership_number is left alone: it only fills the number when it is NULL, so a
-- hand-typed number already won. Keeping it leaves the generator as the fallback for
-- anyone who does not want to pick one.


-- ----------------------------------------------------------------------------
-- 5. Expiry, nightly
-- ----------------------------------------------------------------------------
-- Expiry follows end_date, not year: a card issued in December with a twelve-month end
-- date is not expired on 1 January, and deriving it from the year would say it is.

ALTER TABLE public.membership_subscription
  DROP CONSTRAINT IF EXISTS membership_subscription_status_check;
ALTER TABLE public.membership_subscription
  ADD CONSTRAINT membership_subscription_status_check
  CHECK (status = ANY (ARRAY['active'::text, 'inactive'::text, 'revoked'::text, 'expired'::text]));

-- Only 'active' rows are touched: a revoked or manually deactivated card keeps the state
-- somebody chose for it, and re-running the job is harmless.
CREATE OR REPLACE FUNCTION public.expire_memberships()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_count integer;
BEGIN
  WITH done AS (
    UPDATE public.membership_subscription
       SET status = 'expired', updated_at = now()
     WHERE status = 'active'
       AND end_date IS NOT NULL
       AND end_date < CURRENT_DATE
    RETURNING id
  )
  SELECT count(*) INTO v_count FROM done;

  IF v_count > 0 THEN
    INSERT INTO public.audit_log (log_type, action, model_name, new_values_json, source)
    VALUES ('subscription_change', 'update', 'membership_subscription',
            jsonb_build_object('expired', v_count, 'run_on', CURRENT_DATE), 'job');
  END IF;

  RETURN v_count;
END;
$function$;

-- SECURITY DEFINER with EXECUTE revoked: pg_cron runs it, nobody else can. Without the
-- REVOKE any authenticated user could expire the entire register in one call.
REVOKE ALL ON FUNCTION public.expire_memberships() FROM PUBLIC, anon, authenticated;

CREATE EXTENSION IF NOT EXISTS pg_cron;

-- The database runs in UTC and pg_cron 1.6 has no per-job timezone, so "00:02" lands at
-- 02:02 Italian time in summer and 01:02 in winter. That is fine and arguably right:
-- CURRENT_DATE has already rolled over in UTC when the job fires, so a card ending
-- 31 December expires during the night of 1 January either way.
SELECT cron.schedule('expire-memberships', '2 0 * * *', $job$SELECT public.expire_memberships();$job$);


-- ----------------------------------------------------------------------------
-- 6. Privacy consents: one purpose, and a channel that is not guesswork
-- ----------------------------------------------------------------------------
-- The client dropped the two secondary purposes (marketing, newsletter). Only
-- 'privacy_policy' is collected from now on.
--
-- Two things deliberately NOT done:
--
--   * The 22 existing marketing/newsletter rows are kept. They are evidence that a
--     consent was actually given on a date, by a person, from an IP. Deleting proof of
--     consent to tidy up a picklist is the wrong trade in both directions — it loses the
--     record that the processing was lawful, and it cannot be undone.
--   * The CHECK on consent_type is NOT narrowed to a single value. It would have to be
--     added NOT VALID or it would fail against those same rows, and a constraint that
--     does not hold for the table it is on is worse than no constraint. The function
--     below is where the narrowing happens.
--
-- submit_public_contact now: accepts only 'privacy_policy' (anything else in the payload
-- is ignored, not rejected — the WordPress form must not start failing), and writes
-- channel='web' by construction. That function *is* the web form; a channel the caller
-- could set would be a channel the caller could lie about.
--
-- Same parameter list as before, so CREATE OR REPLACE creates no overload. Full body in
-- git history; the changed part is the privacy_consents loop at the end.
--
-- Backfill, applied at the same time: every row with source='public_form' and a NULL
-- channel came in through the web form and simply predates the column being written.
UPDATE public.privacy_consent
   SET channel = 'web'
 WHERE source = 'public_form' AND channel IS NULL;
-- 33 rows. This fills in a gap; it does not change what anybody consented to.


-- ============================================================================
-- Verification performed on 2026-09-17, after applying
-- ============================================================================
--  * res_partner_role: the five codes, in sort_order, read back from the table.
--  * Visibility: all five test accounts counted 8 of 8 contacts through PostgREST with
--    their own JWTs, noscope included — the account with no groups at all.
--  * Hierarchy: probed account by account with real tokens. superuser→coordinator and
--    →volunteer allowed; coordinator→volunteer allowed, →superuser refused;
--    volunteer→volunteer refused (the peer case). Every account restored to active.
--  * expire_memberships: run inside BEGIN … ROLLBACK against production with one card's
--    end_date moved into the past. It flipped to 'expired'; a card with a future end date
--    was untouched; the rollback was confirmed by re-reading the row.
--  * Export: called over HTTP with real tokens. admin and coordinator get the CSV,
--    volunteer is refused; the header carries all 20 columns and the "tesserato" count
--    matched the register (5 of 8).
--  * Consents: a submission carrying all three purposes came back with exactly one
--    privacy_consent row, consent_type='privacy_policy', channel='web'. Exactly 1
--    overload of submit_public_contact after the replace.
--  * bun test: 119/119 across 9 files, with the dev server up so the HTTP suites ran.
--    Nine of those are new and cover the rules that live in server functions rather than
--    in policies — group reassignment, the export gate, contact deletion, the inactive
--    cascade — through the real HTTP endpoint (`tests/helpers/serverfn.ts`).
