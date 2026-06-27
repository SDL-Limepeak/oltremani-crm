-- Public contact form handler.
-- SECURITY DEFINER: runs with owner privileges so anon role can insert
-- into res_partner, privacy_consent, audit_log, res_partner_category_rel
-- without needing service_role key in the API layer.
--
-- Returns: { ok, partner_id, validation }
--   validation = true  → no territorial group matched for the given city/province
--                         the contact will show the "Da assegnare" indicator in the CRM.
--   validation = false → group assigned automatically from res_city lookup.
CREATE OR REPLACE FUNCTION public.submit_public_contact(
  p_first_name    text    DEFAULT NULL,
  p_last_name     text    DEFAULT NULL,
  p_email         text    DEFAULT NULL,
  p_phone         text    DEFAULT NULL,
  p_city          text    DEFAULT NULL,
  p_province      text    DEFAULT NULL,
  p_privacy_consents jsonb DEFAULT NULL,
  p_ip_address    text    DEFAULT NULL,
  p_user_agent    text    DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_partner_id        uuid;
  v_existing_id       uuid;
  v_city_id           uuid;
  v_city_category_id  uuid;
  v_unassigned        boolean := true;
  v_consent           jsonb;
BEGIN
  -- Validate
  IF p_email IS NULL OR trim(p_email) = '' THEN
    RAISE EXCEPTION 'email required';
  END IF;

  -- Audit: inbound form
  INSERT INTO audit_log (log_type, action, source, new_values_json)
  VALUES (
    'inbound_form', 'api_call', 'public_form',
    jsonb_build_object('first_name', p_first_name, 'last_name', p_last_name,
                       'email', p_email, 'phone', p_phone,
                       'city', p_city, 'province', p_province)
  );

  -- Find existing partner by email
  SELECT id INTO v_existing_id FROM res_partner WHERE email = p_email LIMIT 1;

  IF v_existing_id IS NULL THEN
    -- Insert new
    INSERT INTO res_partner (
      first_name, last_name, display_name,
      email, phone, raw_city, raw_province, status
    ) VALUES (
      p_first_name,
      p_last_name,
      NULLIF(trim(coalesce(p_first_name,'') || ' ' || coalesce(p_last_name,'')), ''),
      p_email, p_phone, p_city, p_province, 'new'
    )
    RETURNING id INTO v_partner_id;

    INSERT INTO audit_log (log_type, action, model_name, record_id, source, new_values_json)
    VALUES ('record_change', 'create', 'res_partner', v_partner_id, 'public_form',
      jsonb_build_object('email', p_email, 'first_name', p_first_name, 'last_name', p_last_name));
  ELSE
    v_partner_id := v_existing_id;

    -- Merge: only fill in missing fields, never overwrite existing data
    UPDATE res_partner SET
      first_name   = COALESCE(first_name,   p_first_name),
      last_name    = COALESCE(last_name,    p_last_name),
      phone        = COALESCE(phone,        p_phone),
      raw_city     = COALESCE(raw_city,     p_city),
      raw_province = COALESCE(raw_province, p_province)
    WHERE id = v_partner_id;

    INSERT INTO audit_log (log_type, action, model_name, record_id, source, new_values_json)
    VALUES ('record_change', 'merge', 'res_partner', v_partner_id, 'public_form',
      jsonb_build_object('email', p_email));
  END IF;

  -- Resolve city: exact match on province_code + name, then ILIKE fallback
  IF p_city IS NOT NULL OR p_province IS NOT NULL THEN
    SELECT id, category_id INTO v_city_id, v_city_category_id
    FROM res_city
    WHERE (p_province IS NULL OR province_code = upper(p_province))
      AND lower(name) = lower(coalesce(p_city, ''))
    LIMIT 1;

    IF v_city_id IS NULL AND p_city IS NOT NULL THEN
      SELECT id, category_id INTO v_city_id, v_city_category_id
      FROM res_city
      WHERE (p_province IS NULL OR province_code = upper(p_province))
        AND name ILIKE '%' || p_city || '%'
      LIMIT 1;
    END IF;
  END IF;

  IF v_city_id IS NOT NULL THEN
    UPDATE res_partner SET city_id = v_city_id WHERE id = v_partner_id;

    IF v_city_category_id IS NOT NULL THEN
      INSERT INTO res_partner_category_rel (partner_id, category_id)
      VALUES (v_partner_id, v_city_category_id)
      ON CONFLICT (partner_id, category_id) DO NOTHING;
      v_unassigned := false;
    END IF;
  END IF;

  -- Privacy consents
  IF p_privacy_consents IS NOT NULL THEN
    FOR v_consent IN SELECT value FROM jsonb_array_elements(p_privacy_consents) AS value
    LOOP
      IF (v_consent->>'consent_type') IN ('privacy_policy','marketing','newsletter') THEN
        INSERT INTO privacy_consent (
          partner_id, consent_type, accepted, accepted_at,
          source, version, ip_address, user_agent
        ) VALUES (
          v_partner_id,
          v_consent->>'consent_type',
          (v_consent->>'accepted')::boolean,
          CASE WHEN (v_consent->>'accepted')::boolean THEN now() ELSE NULL END,
          'public_form',
          v_consent->>'version',
          p_ip_address,
          p_user_agent
        );
      END IF;
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'ok',         true,
    'partner_id', v_partner_id,
    'validation', v_unassigned
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.submit_public_contact TO anon;
