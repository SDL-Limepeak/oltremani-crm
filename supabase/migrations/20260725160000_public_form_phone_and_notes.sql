-- ============================================================================
-- Public form: phone becomes mandatory, and free-text notes are accepted
-- ============================================================================
-- Applied 2026-07-25 via Lovable MCP (query_database).
-- Client feedback of 2026-07-25, points 9 and 11.
--
-- Point 9 — phone required. Enforced here as well as in the form, because the RPC is
-- the real entry point: WordPress will call the HTTP route directly and client-side
-- validation is trivially bypassed.
--
-- Point 11 — notes from the form land in res_partner.notes.
-- On an existing contact the notes are APPENDED, not replaced. Everything else in this
-- function uses COALESCE and never overwrites, but notes are cumulative by nature:
-- someone submitting the form twice with two different messages must not lose the
-- first one. Each block is prefixed with its date so an operator can tell where it
-- came from and when.
--
-- Unchanged from the previous version (20260725120000): email normalisation, wildcard
-- escaping in the city fallback, merge-only-empty-fields, city/category routing,
-- Validation handling, privacy consents.
--
-- NOTE the explicit DROP below. Adding p_notes changes the signature, so
-- CREATE OR REPLACE does NOT replace the old function: it creates a second overload
-- alongside it. Two versions would leave PostgREST free to resolve an RPC call to the
-- 9-argument one, which has neither the notes handling nor the mandatory phone check —
-- so the fix would silently not apply. Checked after applying: exactly one version left.
-- ============================================================================

DROP FUNCTION IF EXISTS public.submit_public_contact(
  text, text, text, text, text, text, jsonb, text, text
);

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
BEGIN
  IF p_email IS NULL OR trim(p_email) = '' THEN
    RAISE EXCEPTION 'email required';
  END IF;
  IF p_phone IS NULL OR trim(p_phone) = '' THEN
    RAISE EXCEPTION 'phone required';
  END IF;

  p_email := lower(trim(p_email));

  v_note_block := CASE
    WHEN p_notes IS NULL OR trim(p_notes) = '' THEN NULL
    ELSE '[' || to_char(now(), 'YYYY-MM-DD') || ' form pubblico] ' || trim(p_notes)
  END;

  INSERT INTO audit_log (log_type, action, source, new_values_json)
  VALUES ('inbound_form','api_call','public_form',
          jsonb_build_object('first_name',p_first_name,'last_name',p_last_name,
                             'email',p_email,'phone',p_phone,'city',p_city,
                             'province',p_province,'notes',p_notes));

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
