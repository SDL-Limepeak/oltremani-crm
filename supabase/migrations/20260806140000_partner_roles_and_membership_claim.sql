-- ============================================================================
-- Client feedback 2026-07-25, points 7 and 10
--   7  operational roles on a contact, multiple, also collected by the public form
--   10 a person who already has a card can declare its number on the form
-- ============================================================================
-- Applied 2026-08-06 via Lovable MCP (query_database). Not in Lovable's changelog —
-- re-run `bun test` after any schema regeneration.
--
-- Point 5 (relabelling activist/citizen to "Dà supporto" / "Cerca supporto") is
-- deliberately NOT here: the stored values stay as they are and only the UI labels
-- change, in src/lib/selections.ts. Renaming the codes would mean a CHECK migration,
-- every historical audit_log snapshot, the export CSV and whatever the WordPress form
-- is already sending — all to change a word on screen.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 7. Operational roles
-- ----------------------------------------------------------------------------
-- Odoo-style picklist: `code` is the API name, `name` is the label, and the two move
-- independently. A table rather than a CHECK constraint because the client will add
-- entries — this way they do it from the UI instead of asking for a migration.

CREATE TABLE IF NOT EXISTS public.res_partner_role (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code       text NOT NULL UNIQUE,
  name       text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  status     text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.res_partner_role_rel (
  partner_id uuid NOT NULL REFERENCES public.res_partner(id) ON DELETE CASCADE,
  role_id    uuid NOT NULL REFERENCES public.res_partner_role(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (partner_id, role_id)
);
CREATE INDEX IF NOT EXISTS idx_prrel_role ON public.res_partner_role_rel(role_id);

DROP TRIGGER IF EXISTS trg_role_updated_at ON public.res_partner_role;
CREATE TRIGGER trg_role_updated_at BEFORE UPDATE ON public.res_partner_role
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.res_partner_role     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.res_partner_role_rel ENABLE ROW LEVEL SECURITY;

-- Reference data: everyone reads it, only admin/superuser edits it.
DROP POLICY IF EXISTS role_select ON public.res_partner_role;
CREATE POLICY role_select ON public.res_partner_role FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS role_mod ON public.res_partner_role;
CREATE POLICY role_mod ON public.res_partner_role FOR ALL TO authenticated
  USING (public.is_admin_or_super(auth.uid()))
  WITH CHECK (public.is_admin_or_super(auth.uid()));

-- The link table follows privacy_consent AFTER its 2026-07-25 fix: the perimeter goes in
-- BOTH clauses. WITH CHECK (true) is the hole closed in 20260725120000, and a role-only
-- WITH CHECK is KI-02/KI-03. partner_created_by covers INSERT ... RETURNING on a contact
-- the caller has just created and that no perimeter covers yet.
DROP POLICY IF EXISTS prrel_select ON public.res_partner_role_rel;
CREATE POLICY prrel_select ON public.res_partner_role_rel FOR SELECT TO authenticated
  USING (public.can_see_partner(auth.uid(), partner_id));
DROP POLICY IF EXISTS prrel_mod ON public.res_partner_role_rel;
CREATE POLICY prrel_mod ON public.res_partner_role_rel FOR ALL TO authenticated
  USING (public.can_see_partner(auth.uid(), partner_id))
  WITH CHECK (public.can_see_partner(auth.uid(), partner_id)
              OR public.partner_created_by(auth.uid(), partner_id));

-- "Specialista di diritti sull'abitare e/o sulla migrazione" is split in two precisely
-- because the selection is multiple: that makes the "e/o" representable.
-- "Persona che cerca supporto" is deliberately NOT a role — it is partner_type='citizen',
-- labelled "Cerca supporto". Having it in both places would create two sources of truth
-- for the same fact.
INSERT INTO public.res_partner_role (code, name, sort_order) VALUES
  ('famiglia_ospitante',     'Famiglia ospitante',                   10),
  ('specialista_abitare',    'Specialista diritti sull''abitare',    20),
  ('specialista_migrazione', 'Specialista diritti sulla migrazione', 30),
  ('membro_semplice',        'Membro semplice della comunità',       40),
  ('bussola',                'Bussola',                              50)
ON CONFLICT (code) DO NOTHING;


-- ----------------------------------------------------------------------------
-- 7 + 10. submit_public_contact gains p_role_codes and p_membership_number
-- ----------------------------------------------------------------------------
-- The DROP is mandatory, not tidiness: CREATE OR REPLACE with a different parameter list
-- creates an OVERLOAD alongside the old function, and PostgREST can resolve an RPC call
-- to the previous one — the change then looks inert. This already happened once, when
-- p_notes was added.
--
-- Membership claim rules. membership_number is UNIQUE, so a code identifies exactly one
-- card and that card already belongs to somebody. Honouring the claim would let anyone
-- take over another member's card by typing their number, so the card is NEVER moved:
--
--   card not provided            -> 'not_provided'
--   card unknown                 -> 'not_found', note added, sent to Validation
--   card belongs to this contact -> 'confirmed', nothing to do
--   card belongs to someone else -> 'mismatch', note added, sent to Validation
--
-- Approved by Diego on 2026-07-25 and kept: a human resolves it, nobody loses a card.

DROP FUNCTION IF EXISTS public.submit_public_contact(text,text,text,text,text,text,jsonb,text,text,text);

CREATE OR REPLACE FUNCTION public.submit_public_contact(
  p_first_name        text    DEFAULT NULL,
  p_last_name         text    DEFAULT NULL,
  p_email             text    DEFAULT NULL,
  p_phone             text    DEFAULT NULL,
  p_city              text    DEFAULT NULL,
  p_province          text    DEFAULT NULL,
  p_privacy_consents  jsonb   DEFAULT NULL,
  p_ip_address        text    DEFAULT NULL,
  p_user_agent        text    DEFAULT NULL,
  p_notes             text    DEFAULT NULL,
  p_role_codes        text[]  DEFAULT NULL,
  p_membership_number text    DEFAULT NULL
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
  v_card              text;
  v_card_partner      uuid;
  v_membership_status text := 'not_provided';
  v_membership_note   text;
BEGIN
  IF p_email IS NULL OR trim(p_email) = '' THEN
    RAISE EXCEPTION 'email required';
  END IF;
  IF p_phone IS NULL OR trim(p_phone) = '' THEN
    RAISE EXCEPTION 'phone required';
  END IF;

  -- Rate limit, checked BEFORE anything is recorded so a rejected request cannot inflate
  -- audit_log. Messages start with 'rate limit' so the route can answer 429.
  IF p_ip_address IS NOT NULL THEN
    SELECT count(*) INTO v_recent_ip
      FROM audit_log
     WHERE log_type = 'inbound_form' AND ip_address = p_ip_address
       AND created_at > now() - interval '1 minute';
    IF v_recent_ip >= 5 THEN
      RAISE EXCEPTION 'rate limit: troppi invii da questo indirizzo, riprova tra un minuto';
    END IF;

    SELECT count(*) INTO v_recent_ip
      FROM audit_log
     WHERE log_type = 'inbound_form' AND ip_address = p_ip_address
       AND created_at > now() - interval '1 hour';
    IF v_recent_ip >= 30 THEN
      RAISE EXCEPTION 'rate limit: troppi invii da questo indirizzo, riprova più tardi';
    END IF;
  END IF;

  SELECT count(*) INTO v_recent_total
    FROM audit_log
   WHERE log_type = 'inbound_form' AND created_at > now() - interval '1 minute';
  IF v_recent_total >= 60 THEN
    RAISE EXCEPTION 'rate limit: il servizio sta ricevendo troppe richieste, riprova tra poco';
  END IF;

  p_email := lower(trim(p_email));
  v_card  := NULLIF(trim(coalesce(p_membership_number, '')), '');

  v_note_block := CASE
    WHEN p_notes IS NULL OR trim(p_notes) = '' THEN NULL
    ELSE '[' || to_char(now(), 'YYYY-MM-DD') || ' form pubblico] ' || trim(p_notes)
  END;

  INSERT INTO audit_log (log_type, action, source, new_values_json, ip_address)
  VALUES ('inbound_form','api_call','public_form',
          jsonb_build_object('first_name',p_first_name,'last_name',p_last_name,
                             'email',p_email,'phone',p_phone,'city',p_city,
                             'province',p_province,'notes',p_notes,
                             'role_codes',to_jsonb(p_role_codes),
                             'membership_number',v_card),
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

  -- Roles. Unknown or inactive codes are ignored rather than rejected: the WordPress form
  -- is maintained by someone else and must not break when this list moves.
  IF p_role_codes IS NOT NULL AND array_length(p_role_codes, 1) > 0 THEN
    INSERT INTO res_partner_role_rel (partner_id, role_id)
    SELECT v_partner_id, r.id
      FROM res_partner_role r
     WHERE r.code = ANY (p_role_codes) AND r.status = 'active'
    ON CONFLICT DO NOTHING;
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

  -- Pre-existing card declared on the form. See the header for why it is never moved.
  IF v_card IS NOT NULL THEN
    SELECT partner_id INTO v_card_partner
      FROM membership_subscription WHERE membership_number = v_card LIMIT 1;

    IF v_card_partner IS NULL THEN
      v_membership_status := 'not_found';
      v_membership_note := 'tessera dichiarata "' || v_card || '" non trovata a sistema';
    ELSIF v_card_partner = v_partner_id THEN
      v_membership_status := 'confirmed';
    ELSE
      v_membership_status := 'mismatch';
      v_membership_note := 'tessera dichiarata "' || v_card ||
                           '" risulta intestata a un altro socio: da verificare, non riassegnata';
    END IF;

    IF v_membership_status <> 'confirmed' THEN
      -- Needs a human either way, so put it back in the validation queue even if the
      -- city matched cleanly.
      v_validation := true;
      IF v_validation_cat_id IS NOT NULL THEN
        INSERT INTO res_partner_category_rel (partner_id,category_id)
        VALUES (v_partner_id,v_validation_cat_id) ON CONFLICT DO NOTHING;
      END IF;
      UPDATE res_partner SET notes = CASE
          WHEN notes IS NULL OR trim(notes) = ''
            THEN '[' || to_char(now(),'YYYY-MM-DD') || ' form pubblico] ' || v_membership_note
          ELSE notes || E'\n\n[' || to_char(now(),'YYYY-MM-DD') || ' form pubblico] ' || v_membership_note
        END
      WHERE id = v_partner_id;
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

  RETURN jsonb_build_object(
    'ok', true,
    'partner_id', v_partner_id,
    'validation', v_validation,
    'membership_status', v_membership_status
  );
END;
$function$;

-- Same PUBLIC-first revoke as 20260806120000: revoking only the role is a no-op while
-- PUBLIC holds the grant. anon must keep exactly this one function.
REVOKE EXECUTE ON FUNCTION public.submit_public_contact(text,text,text,text,text,text,jsonb,text,text,text,text[],text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.submit_public_contact(text,text,text,text,text,text,jsonb,text,text,text,text[],text) TO anon, authenticated;
