-- ============================================================================
-- RLS hardening + data integrity
-- ============================================================================
-- Applied 2026-07-25 via Lovable MCP (query_database), NOT through the Lovable
-- agent: recorded here so it stays tracked in the repo. If the agent regenerates
-- the schema, re-check that these policies are still in place by running the
-- suite in tests/ (bun test).
--
-- Context and exploitability proofs: .claude/history.md
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. Self-promotion to superuser
-- ----------------------------------------------------------------------------
-- users_update allows `id = auth.uid()` and has no WITH CHECK, and
-- protect_admin_users only blocked the 'admin' role. A volunteer could therefore
-- raise itself to 'superuser'.
--
-- The fix belongs in the trigger, not the policy: WITH CHECK only sees the NEW
-- row, and comparing OLD against NEW requires a trigger.
--
-- auth.uid() IS NULL means service_role / server-side seeding, which stays free
-- to set roles.

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
    IF NEW.role = 'admin' AND OLD.role <> 'admin' THEN
      RAISE EXCEPTION 'Cannot promote to admin from UI';
    END IF;

    IF auth.uid() IS NOT NULL AND NOT public.is_admin_or_super(auth.uid()) THEN
      IF NEW.role IS DISTINCT FROM OLD.role THEN
        RAISE EXCEPTION 'Solo admin o superuser possono cambiare il ruolo';
      END IF;
      IF NEW.status IS DISTINCT FROM OLD.status THEN
        RAISE EXCEPTION 'Solo admin o superuser possono cambiare lo stato';
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
-- 2. Granting yourself visibility over any contact
-- ----------------------------------------------------------------------------
-- rpcr_mod had WITH CHECK (current_role_name() IS NOT NULL): any authenticated
-- user could insert an arbitrary (partner_id, category_id) pair and make a
-- contact they were not allowed to see visible to themselves.
--
-- The created_by exception is required: upsertPartner (src/lib/partners.functions.ts)
-- creates the partner and immediately attaches its categories using the user's own
-- client, at which point can_see_partner is still false. Without the exception,
-- contact creation would break for every non-admin.

-- SECURITY DEFINER helper, mandatory: a plain EXISTS on res_partner inside the
-- policy would itself be filtered by res_partner's RLS and always return false.
CREATE OR REPLACE FUNCTION public.partner_created_by(_uid uuid, _partner_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.res_partner
    WHERE id = _partner_id AND created_by = _uid
  );
$function$;

ALTER POLICY rpcr_mod ON public.res_partner_category_rel
  USING (public.can_see_partner(auth.uid(), partner_id))
  WITH CHECK (
    (
      public.can_see_partner(auth.uid(), partner_id)
      OR public.partner_created_by(auth.uid(), partner_id)
    )
    AND category_id IN (SELECT public.visible_category_ids(auth.uid()))
  );

-- Accepted side effect: a coordinator validating a contact into another area's
-- category now gets an error instead of succeeding. That matches the permissions
-- matrix in the build plan; admin and superuser still pass, because
-- visible_category_ids returns everything for them.


-- ----------------------------------------------------------------------------
-- 3. Forgeable privacy consents
-- ----------------------------------------------------------------------------
-- consent_mod had WITH CHECK (true): a consent row could be inserted for any
-- partner, visible or not. This is a GDPR consent register, so it has to be closed.

ALTER POLICY consent_mod ON public.privacy_consent
  USING (public.can_see_partner(auth.uid(), partner_id))
  WITH CHECK (public.can_see_partner(auth.uid(), partner_id));


-- ----------------------------------------------------------------------------
-- 4. Forgeable audit log
-- ----------------------------------------------------------------------------
-- audit_insert had WITH CHECK (true) for authenticated, so rows could be written
-- in someone else's name. Reads were already admin-only and there is no DELETE
-- policy, so all that was missing was binding the author.
-- NULL stays allowed for server-side writes that have no uid.

ALTER POLICY audit_insert ON public.audit_log
  WITH CHECK (changed_by_user_id = auth.uid() OR changed_by_user_id IS NULL);


-- ----------------------------------------------------------------------------
-- 5. partner_type had no CHECK
-- ----------------------------------------------------------------------------
-- The UI offers three values, the database accepted any string.

ALTER TABLE public.res_partner
  DROP CONSTRAINT IF EXISTS res_partner_partner_type_check;
ALTER TABLE public.res_partner
  ADD CONSTRAINT res_partner_partner_type_check
  CHECK (partner_type IN ('individual', 'activist', 'citizen'));


-- ----------------------------------------------------------------------------
-- 6. Duplicate contacts differing only in letter case
-- ----------------------------------------------------------------------------
-- res_partner.email was UNIQUE but case-sensitive, and submit_public_contact
-- looked it up with `WHERE email = p_email`: Mario@x.it and mario@x.it produced
-- TWO partners.

UPDATE public.res_partner
   SET email = lower(trim(email))
 WHERE email IS NOT NULL AND email <> lower(trim(email));

DROP INDEX IF EXISTS public.idx_partner_email;
CREATE UNIQUE INDEX IF NOT EXISTS idx_partner_email_lower
  ON public.res_partner (lower(email))
  WHERE email IS NOT NULL;


-- ----------------------------------------------------------------------------
-- 7. submit_public_contact: email normalisation + wildcard escaping
-- ----------------------------------------------------------------------------
-- Two fixes; the rest of the logic is identical to the original:
--   a) the email is normalised to lower(trim()) both in the lookup and in the
--      insert, so deduplication actually works and matches the new unique index
--   b) the city fallback ILIKE '%'||p_city||'%' did not escape % and _ : input
--      containing those characters behaved as a wildcard and produced wrong
--      matches (not SQL injection — the query is parameterised regardless)
--
-- Superseded by 20260725160000, which adds p_notes and makes phone mandatory.

CREATE OR REPLACE FUNCTION public.submit_public_contact(
  p_first_name text DEFAULT NULL::text,
  p_last_name text DEFAULT NULL::text,
  p_email text DEFAULT NULL::text,
  p_phone text DEFAULT NULL::text,
  p_city text DEFAULT NULL::text,
  p_province text DEFAULT NULL::text,
  p_privacy_consents jsonb DEFAULT NULL::jsonb,
  p_ip_address text DEFAULT NULL::text,
  p_user_agent text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_partner_id        uuid;
  v_existing_id       uuid;
  v_city_id           uuid;
  v_city_category_id  uuid;
  v_validation_cat_id uuid;
  v_validation        boolean := true;
  v_consent           jsonb;
  v_city_pattern      text;
BEGIN
  IF p_email IS NULL OR trim(p_email) = '' THEN
    RAISE EXCEPTION 'email required';
  END IF;

  p_email := lower(trim(p_email));

  INSERT INTO audit_log (log_type, action, source, new_values_json)
  VALUES ('inbound_form','api_call','public_form',
          jsonb_build_object('first_name',p_first_name,'last_name',p_last_name,
                             'email',p_email,'phone',p_phone,'city',p_city,'province',p_province));

  SELECT id INTO v_existing_id FROM res_partner WHERE lower(email) = p_email LIMIT 1;

  IF v_existing_id IS NULL THEN
    INSERT INTO res_partner (first_name,last_name,display_name,email,phone,raw_city,raw_province,status)
    VALUES (p_first_name,p_last_name,
            NULLIF(trim(coalesce(p_first_name,'')||' '||coalesce(p_last_name,'')),''),
            p_email,p_phone,p_city,p_province,'new')
    RETURNING id INTO v_partner_id;
    INSERT INTO audit_log (log_type,action,model_name,record_id,source,new_values_json)
    VALUES ('record_change','create','res_partner',v_partner_id,'public_form',
            jsonb_build_object('email',p_email));
  ELSE
    v_partner_id := v_existing_id;
    UPDATE res_partner SET
      first_name   = COALESCE(first_name,p_first_name),
      last_name    = COALESCE(last_name,p_last_name),
      phone        = COALESCE(phone,p_phone),
      raw_city     = COALESCE(raw_city,p_city),
      raw_province = COALESCE(raw_province,p_province)
    WHERE id = v_partner_id;
    INSERT INTO audit_log (log_type,action,model_name,record_id,source,new_values_json)
    VALUES ('record_change','merge','res_partner',v_partner_id,'public_form',
            jsonb_build_object('email',p_email));
  END IF;

  IF p_city IS NOT NULL OR p_province IS NOT NULL THEN
    SELECT id,category_id INTO v_city_id,v_city_category_id
      FROM res_city
     WHERE (p_province IS NULL OR province_code = upper(p_province))
       AND lower(name) = lower(coalesce(p_city,''))
     LIMIT 1;

    IF v_city_id IS NULL AND p_city IS NOT NULL THEN
      v_city_pattern := '%' || replace(replace(p_city, '%', '\%'), '_', '\_') || '%';
      SELECT id,category_id INTO v_city_id,v_city_category_id
        FROM res_city
       WHERE (p_province IS NULL OR province_code = upper(p_province))
         AND name ILIKE v_city_pattern
       LIMIT 1;
    END IF;
  END IF;

  SELECT id INTO v_validation_cat_id FROM res_partner_category WHERE name = 'Validation' LIMIT 1;

  IF v_city_id IS NOT NULL THEN
    UPDATE res_partner SET city_id = v_city_id WHERE id = v_partner_id;
    IF v_city_category_id IS NOT NULL THEN
      INSERT INTO res_partner_category_rel (partner_id,category_id)
      VALUES (v_partner_id,v_city_category_id) ON CONFLICT DO NOTHING;
    END IF;
    IF v_validation_cat_id IS NOT NULL THEN
      DELETE FROM res_partner_category_rel
       WHERE partner_id = v_partner_id AND category_id = v_validation_cat_id;
    END IF;
    v_validation := false;
  ELSE
    IF v_validation_cat_id IS NOT NULL THEN
      INSERT INTO res_partner_category_rel (partner_id,category_id)
      VALUES (v_partner_id,v_validation_cat_id) ON CONFLICT DO NOTHING;
    END IF;
  END IF;

  IF p_privacy_consents IS NOT NULL THEN
    FOR v_consent IN SELECT value FROM jsonb_array_elements(p_privacy_consents) AS value LOOP
      IF (v_consent->>'consent_type') IN ('privacy_policy','marketing','newsletter') THEN
        INSERT INTO privacy_consent (partner_id,consent_type,accepted,accepted_at,source,version,ip_address,user_agent)
        VALUES (v_partner_id, v_consent->>'consent_type', (v_consent->>'accepted')::boolean,
                CASE WHEN (v_consent->>'accepted')::boolean THEN now() ELSE NULL END,
                'public_form', v_consent->>'version', p_ip_address, p_user_agent);
      END IF;
    END LOOP;
  END IF;

  RETURN jsonb_build_object('ok',true,'partner_id',v_partner_id,'validation',v_validation);
END;
$function$;
