-- ============================================================================
-- Hardening RLS + integrità dati
-- ============================================================================
-- Applicata il 2026-07-25 via Lovable MCP (query_database), non tramite l'agent
-- Lovable: registrata qui perché resti tracciata nel repo. Se l'agent rigenera
-- lo schema, ricontrollare che queste policy siano ancora in piedi con le due
-- prove in fondo a .claude/rls-fix.sql.
--
-- Contesto e prove di sfruttabilità: .claude/architecture.md
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. Auto-promozione a superuser
-- ----------------------------------------------------------------------------
-- users_update ammette `id = auth.uid()` e non ha WITH CHECK; protect_admin_users
-- bloccava solo 'admin'. Un volontario poteva portarsi a 'superuser' da solo.
-- La correzione va nel trigger perché WITH CHECK vede solo la riga NUOVA: per
-- confrontare OLD e NEW serve un trigger.
-- auth.uid() IS NULL = service_role / seeding server-side, che resta libero.

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
-- 2. Auto-assegnazione della visibilità sui contatti
-- ----------------------------------------------------------------------------
-- rpcr_mod aveva WITH CHECK (current_role_name() IS NOT NULL): chiunque potesse
-- autenticarsi inseriva una coppia (partner_id, category_id) arbitraria e si
-- rendeva visibile un contatto precluso.
--
-- L'eccezione su created_by è necessaria: upsertPartner crea il partner e subito
-- dopo gli attacca le categorie col client dell'utente, quando can_see_partner è
-- ancora false. Senza l'eccezione si romperebbe la creazione contatti per i non-admin.

-- Helper SECURITY DEFINER obbligatorio: un EXISTS diretto su res_partner dentro
-- la policy sarebbe filtrato dalla RLS di res_partner e tornerebbe sempre false.
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


-- ----------------------------------------------------------------------------
-- 3. Consensi privacy falsificabili
-- ----------------------------------------------------------------------------
-- consent_mod aveva WITH CHECK (true): si inseriva un consenso per qualsiasi
-- partner, anche non visibile. È un registro GDPR, va chiuso.

ALTER POLICY consent_mod ON public.privacy_consent
  USING (public.can_see_partner(auth.uid(), partner_id))
  WITH CHECK (public.can_see_partner(auth.uid(), partner_id));


-- ----------------------------------------------------------------------------
-- 4. Audit log falsificabile
-- ----------------------------------------------------------------------------
-- audit_insert aveva WITH CHECK (true) per authenticated: righe scrivibili a nome
-- di altri. La lettura era già solo admin e non esiste policy DELETE, mancava
-- solo legare l'autore. NULL resta ammesso per le scritture server-side senza uid.

ALTER POLICY audit_insert ON public.audit_log
  WITH CHECK (changed_by_user_id = auth.uid() OR changed_by_user_id IS NULL);


-- ----------------------------------------------------------------------------
-- 5. partner_type senza CHECK
-- ----------------------------------------------------------------------------
-- La UI espone tre valori, il DB accettava qualsiasi stringa.

ALTER TABLE public.res_partner
  DROP CONSTRAINT IF EXISTS res_partner_partner_type_check;
ALTER TABLE public.res_partner
  ADD CONSTRAINT res_partner_partner_type_check
  CHECK (partner_type IN ('individual', 'activist', 'citizen'));


-- ----------------------------------------------------------------------------
-- 6. Doppioni email per differenza di maiuscole
-- ----------------------------------------------------------------------------
-- res_partner.email era UNIQUE ma case-sensitive, e submit_public_contact cercava
-- con `WHERE email = p_email` esatto: Mario@x.it e mario@x.it creavano DUE partner.

UPDATE public.res_partner
   SET email = lower(trim(email))
 WHERE email IS NOT NULL AND email <> lower(trim(email));

DROP INDEX IF EXISTS public.idx_partner_email;
CREATE UNIQUE INDEX IF NOT EXISTS idx_partner_email_lower
  ON public.res_partner (lower(email))
  WHERE email IS NOT NULL;


-- ----------------------------------------------------------------------------
-- 7. submit_public_contact: normalizzazione email + escape wildcard
-- ----------------------------------------------------------------------------
-- Due correzioni, il resto della logica è identico all'originale:
--   a) email normalizzata a lower(trim()) sia nel lookup sia nell'insert, così
--      il dedup funziona davvero e rispetta il nuovo indice unique
--   b) il fallback città ILIKE '%'||p_city||'%' non escapava % e _ : un input
--      con quei caratteri diventava wildcard e dava match sbagliati
--      (non è SQL injection, la query è comunque parametrizzata)

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

  -- NUOVO: normalizzazione, così il dedup non dipende dalle maiuscole
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
      -- NUOVO: % e _ nell'input non vengono più interpretati come wildcard
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
