-- ============================================================================
-- Fixes for the Lovable security scan of 2026-07-25
-- ============================================================================
-- Applied via Lovable MCP (query_database).
--
-- Every change below was tested in a rolled-back transaction before being applied,
-- because two of the scanner's suggested remediations would have broken the app.
-- See .claude/architecture.md, "Scan di sicurezza Lovable".
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. CRITICAL — "Public contact form endpoint accepts unlimited writes"
-- ----------------------------------------------------------------------------
-- The endpoint stays unauthenticated: that is a deliberate decision for the demo
-- phase, taken so the sample form needs no setup at all. What is fixed here is the
-- "unlimited" half, which is the part that actually enables mass creation.
--
-- The limiter counts the inbound_form rows already in audit_log, so it needs no new
-- table. The IP is recorded on those rows for the purpose — and it is useful on its
-- own, since until now the audit trail said a form was submitted but not from where.
--
-- Order matters: the quota is checked BEFORE the attempt is logged. A rejected
-- request therefore writes nothing, so an attacker cannot inflate audit_log by
-- hammering a blocked endpoint. Only the first few attempts in a window are recorded.

ALTER TABLE public.audit_log ADD COLUMN IF NOT EXISTS ip_address text;
CREATE INDEX IF NOT EXISTS idx_audit_inbound_ip
  ON public.audit_log (ip_address, created_at DESC)
  WHERE log_type = 'inbound_form';

CREATE OR REPLACE FUNCTION public.submit_public_contact(
  p_first_name text DEFAULT NULL::text,
  p_last_name text DEFAULT NULL::text,
  p_email text DEFAULT NULL::text,
  p_phone text DEFAULT NULL::text,
  p_city text DEFAULT NULL::text,
  p_province text DEFAULT NULL::text,
  p_privacy_consents jsonb DEFAULT NULL::jsonb,
  p_ip_address text DEFAULT NULL::text,
  p_user_agent text DEFAULT NULL::text,
  p_notes text DEFAULT NULL::text
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
  v_note_block        text;
  v_recent_ip         int;
  v_recent_total      int;
BEGIN
  IF p_email IS NULL OR trim(p_email) = '' THEN
    RAISE EXCEPTION 'email required';
  END IF;
  IF p_phone IS NULL OR trim(p_phone) = '' THEN
    RAISE EXCEPTION 'phone required';
  END IF;

  -- Rate limit. The messages start with 'rate limit' so the HTTP route can map them
  -- to 429 without string-matching anything fragile.
  IF p_ip_address IS NOT NULL THEN
    SELECT count(*) INTO v_recent_ip
      FROM audit_log
     WHERE log_type = 'inbound_form'
       AND ip_address = p_ip_address
       AND created_at > now() - interval '1 minute';
    IF v_recent_ip >= 5 THEN
      RAISE EXCEPTION 'rate limit: troppi invii da questo indirizzo, riprova tra un minuto';
    END IF;

    SELECT count(*) INTO v_recent_ip
      FROM audit_log
     WHERE log_type = 'inbound_form'
       AND ip_address = p_ip_address
       AND created_at > now() - interval '1 hour';
    IF v_recent_ip >= 30 THEN
      RAISE EXCEPTION 'rate limit: troppi invii da questo indirizzo, riprova più tardi';
    END IF;
  END IF;

  -- Global ceiling, so a distributed flood cannot bypass the per-IP quota. Sized well
  -- above any plausible legitimate burst for an association of this size.
  SELECT count(*) INTO v_recent_total
    FROM audit_log
   WHERE log_type = 'inbound_form'
     AND created_at > now() - interval '1 minute';
  IF v_recent_total >= 60 THEN
    RAISE EXCEPTION 'rate limit: il servizio sta ricevendo troppe richieste, riprova tra poco';
  END IF;

  p_email := lower(trim(p_email));

  v_note_block := CASE
    WHEN p_notes IS NULL OR trim(p_notes) = '' THEN NULL
    ELSE '[' || to_char(now(), 'YYYY-MM-DD') || ' form pubblico] ' || trim(p_notes)
  END;

  INSERT INTO audit_log (log_type, action, source, new_values_json, ip_address)
  VALUES ('inbound_form','api_call','public_form',
          jsonb_build_object('first_name',p_first_name,'last_name',p_last_name,
                             'email',p_email,'phone',p_phone,'city',p_city,
                             'province',p_province,'notes',p_notes),
          p_ip_address);

  SELECT id INTO v_existing_id FROM res_partner WHERE lower(email) = p_email LIMIT 1;

  IF v_existing_id IS NULL THEN
    INSERT INTO res_partner (first_name,last_name,display_name,email,phone,raw_city,raw_province,status,notes)
    VALUES (p_first_name,p_last_name,
            NULLIF(trim(coalesce(p_first_name,'')||' '||coalesce(p_last_name,'')),''),
            p_email,p_phone,p_city,p_province,'new',v_note_block)
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
      raw_province = COALESCE(raw_province,p_province),
      notes        = CASE
                       WHEN v_note_block IS NULL THEN notes
                       WHEN notes IS NULL OR trim(notes) = '' THEN v_note_block
                       ELSE notes || E'\n\n' || v_note_block
                     END
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


-- ----------------------------------------------------------------------------
-- 2. CRITICAL — "Users may be able to escalate their own role"
-- ----------------------------------------------------------------------------
-- Already blocked since 20260725120000, by the protect_admin_users trigger, and
-- verified: the end-to-end matrix shows every role failing to change its own role.
-- The scanner reads policies, not triggers, so it cannot see that.
--
-- It has a fair point all the same: the protection lived in one place only. If the
-- trigger were ever dropped — an agent regenerating the schema, for instance — the
-- hole would silently reopen. This adds the second layer, in the policy itself.
--
-- WITH CHECK only sees the NEW row, so it cannot compare against OLD directly.
-- current_role_name() gets us there anyway: it reads the caller's stored role, and
-- within the same statement that read still sees the pre-update snapshot. So
-- requiring the new role to equal it means "you may not change your own role",
-- while admins and superusers pass through the first branch.

ALTER POLICY users_update ON public.res_users
  USING (
    (id = auth.uid())
    OR ((public.current_role_name() = ANY (ARRAY['admin'::text, 'superuser'::text]))
        AND role <> 'admin'::text)
  )
  WITH CHECK (
    public.is_admin_or_super(auth.uid())
    OR role = public.current_role_name()
  );


-- ----------------------------------------------------------------------------
-- 3. WARNING — "Audit log records can be permanently altered or destroyed"
-- ----------------------------------------------------------------------------
-- The scanner notes this is not currently exploitable: with RLS on and no permissive
-- UPDATE or DELETE policy, both are already denied. Its concern is the future — a
-- broader policy added later would silently open tampering.
--
-- RESTRICTIVE policies answer exactly that. They are ANDed with every permissive
-- policy instead of ORed, so `USING (false)` keeps the door shut even if someone
-- later adds a permissive ALL policy. Table-owner access (postgres, service_role)
-- bypasses RLS and is unaffected, so legitimate maintenance still works.

DROP POLICY IF EXISTS audit_no_update ON public.audit_log;
CREATE POLICY audit_no_update ON public.audit_log
  AS RESTRICTIVE FOR UPDATE TO public USING (false);

DROP POLICY IF EXISTS audit_no_delete ON public.audit_log;
CREATE POLICY audit_no_delete ON public.audit_log
  AS RESTRICTIVE FOR DELETE TO public USING (false);


-- ----------------------------------------------------------------------------
-- 4/5. WARNING — SECURITY DEFINER functions executable by anon / signed-in users
-- ----------------------------------------------------------------------------
-- The suggested remediation, "revoke EXECUTE", CANNOT be applied to the helpers used
-- inside RLS policies. Tested: revoking EXECUTE on can_see_partner from authenticated
-- makes every SELECT on res_partner fail with "permission denied for function
-- can_see_partner". Policy expressions are evaluated with the querying user's
-- privileges, so those grants are load-bearing. Applying the advice literally would
-- take the whole application down.
--
-- What can be done safely, all of it verified first:
--
--   a) trigger functions do NOT require EXECUTE from the caller — the trigger
--      mechanism invokes them. Tested: insert and update still fire their triggers
--      after revoking from anon and authenticated
--   b) anon only ever needs submit_public_contact. Tested: the public form still
--      works as anon after revoking everything else
--   c) the helpers keep EXECUTE for authenticated because they must, but the
--      information they leak when called directly is closed off below

-- a) trigger functions
REVOKE EXECUTE ON FUNCTION public.handle_new_user()        FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.protect_admin_users()    FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_updated_at()         FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_created_by()         FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sub_default_end_date()   FROM anon, authenticated;

-- b) anon keeps only the public form
REVOKE EXECUTE ON FUNCTION public.generate_membership_number(integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.partner_created_by(uuid, uuid)      FROM anon;

-- c) The helpers take a _uid parameter, so a signed-in user could call them via RPC
--    asking about SOMEBODY ELSE: has_role(<other>, 'admin'),
--    visible_category_ids(<other>), can_see_partner(<other>, <partner>). No contact
--    data leaks, but the permission structure of other accounts does.
--
--    Every policy passes auth.uid(), so refusing any other value costs nothing and
--    closes the probe. auth.uid() IS NULL means service_role or a SECURITY DEFINER
--    context, which must keep working — hence the explicit NULL check.

CREATE OR REPLACE FUNCTION public.has_role(_uid uuid, _role text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN auth.uid() IS NOT NULL AND _uid IS DISTINCT FROM auth.uid() THEN false
    ELSE EXISTS (SELECT 1 FROM public.res_users
                  WHERE id = _uid AND role = _role AND status = 'active')
  END;
$function$;

CREATE OR REPLACE FUNCTION public.is_admin_or_super(_uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN auth.uid() IS NOT NULL AND _uid IS DISTINCT FROM auth.uid() THEN false
    ELSE EXISTS (SELECT 1 FROM public.res_users
                  WHERE id = _uid AND role IN ('admin','superuser') AND status = 'active')
  END;
$function$;

CREATE OR REPLACE FUNCTION public.partner_created_by(_uid uuid, _partner_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN auth.uid() IS NOT NULL AND _uid IS DISTINCT FROM auth.uid() THEN false
    ELSE EXISTS (SELECT 1 FROM public.res_partner
                  WHERE id = _partner_id AND created_by = _uid)
  END;
$function$;

CREATE OR REPLACE FUNCTION public.visible_category_ids(_uid uuid)
RETURNS SETOF uuid
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NOT NULL AND _uid IS DISTINCT FROM auth.uid() THEN
    RETURN;
  END IF;

  IF public.is_admin_or_super(_uid) THEN
    RETURN QUERY SELECT id FROM public.res_partner_category;
    RETURN;
  END IF;

  RETURN QUERY
  WITH RECURSIVE roots AS (
    SELECT category_id FROM public.res_user_category_rel WHERE user_id = _uid
  ),
  tree AS (
    SELECT c.id FROM public.res_partner_category c JOIN roots r ON r.category_id = c.id
    UNION
    SELECT c.id FROM public.res_partner_category c JOIN tree t ON c.parent_id = t.id
  )
  SELECT id FROM tree;
END;
$function$;

CREATE OR REPLACE FUNCTION public.can_see_partner(_uid uuid, _partner_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN auth.uid() IS NOT NULL AND _uid IS DISTINCT FROM auth.uid() THEN false
    ELSE public.is_admin_or_super(_uid)
      OR EXISTS (SELECT 1 FROM public.res_partner p
                  WHERE p.id = _partner_id AND p.created_by = _uid)
      OR EXISTS (SELECT 1 FROM public.res_partner_category_rel r
                  WHERE r.partner_id = _partner_id
                    AND r.category_id IN (SELECT public.visible_category_ids(_uid)))
  END;
$function$;

-- NOTE for whoever reads the scan again: findings 4 and 5 will still be reported.
-- The linter flags any SECURITY DEFINER function in the exposed schema that
-- authenticated can execute, and these must stay that way for RLS to work. Clearing
-- the finding properly means moving the helpers into a schema PostgREST does not
-- expose and rewriting every policy that references them — about fifteen policies.
-- Deliberately not done here: the blast radius is the entire authorisation layer, and
-- an agent regenerating the schema would reference public.* again and break it.
