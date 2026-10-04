-- ============================================================================
-- 2026-10-04 — the round that came out of the two voice notes of 2026-09-27
-- ============================================================================
-- Applied directly through the Lovable MCP `query_database`, on Diego's go-ahead, like the
-- 2026-07-25 hardening and the 2026-09-17 round (see .claude/db/access.md rule 2).
--
--   1. Roles: "Cerco supporto e/o ospitalità" in, "Membro della comunità" out of the
--      picklist, "Specialista di diritti…" relabelled.
--   2. Groups: a three-letter card prefix per group (`card_prefix`), Siena and Venezia
--      get their own cities, and four test contacts are put back in the group their
--      province says.
--   3. Cards: numbers become <PREFIX><4 digits> per group; two active cards in the same
--      year are warned about, not blocked; a preview function for the issue dialog.
--   4. submit_public_contact: `p_is_member`, a declared card number now becomes an active
--      card, and a number held by a namesake is reconciled instead of duplicated.
--   5. can_manage_user / role_rank were executable by anon (found while checking on
--      2026-10-04). Closed.
--
-- State before, for the record (there is no pg_dump — see access.md):
--   res_city SI -> group Genova, VE -> group Pesaro Urbino
--   Mario Rossi (SI) in Napoli; Antonina Ciabattoni (raw AP) in Napoli; King Pin (RM) in
--   Genova. Dario Carpini (SI) in Chiusi — left alone on purpose, see section 2.


-- ----------------------------------------------------------------------------
-- 1. Roles
-- ----------------------------------------------------------------------------
-- The visible order on the public form is: cerco supporto, attivista, famiglia ospitante,
-- supporto legale. Socio APS is no longer a checkbox: the form answers "Sei già socio?"
-- and the RPC attaches the role. It stays in the CRM picklist.
--
-- membro_comunita is DEACTIVATED, not deleted: one contact still carries it, and a form
-- that has not been updated yet keeps posting the code, which the RPC then ignores
-- (it only attaches active roles).

INSERT INTO public.res_partner_role (code, name, sort_order, status)
VALUES ('cerco_supporto', 'Cerco supporto e/o ospitalità', 10, 'active')
ON CONFLICT (code) DO UPDATE
   SET name = EXCLUDED.name, sort_order = EXCLUDED.sort_order, status = 'active';

UPDATE public.res_partner_role SET sort_order = 20 WHERE code = 'attivista';
UPDATE public.res_partner_role SET sort_order = 30 WHERE code = 'famiglia_ospitante';
UPDATE public.res_partner_role
   SET sort_order = 40, name = 'Supporto legale e per il diritto all''abitare'
 WHERE code = 'specialista_diritti';
UPDATE public.res_partner_role SET sort_order = 50 WHERE code = 'socio_aps';
UPDATE public.res_partner_role SET status = 'inactive', sort_order = 90 WHERE code = 'membro_comunita';


-- ----------------------------------------------------------------------------
-- 2. Groups: card prefix, and who manages Siena and Venezia
-- ----------------------------------------------------------------------------
-- card_prefix is arbitrary and editable from the group dialog. Three capital letters,
-- unique across groups, NULL for the groups that do not issue cards from the register
-- (the "gruppi informali" container and Validation). Proposed as the province code plus
-- one letter of the name; "APS" was avoided for Ascoli Piceno because it reads as the
-- legal form.
--
-- province_code (the "provincia master") already existed on the group and is untouched
-- apart from the two below.

ALTER TABLE public.res_partner_category ADD COLUMN IF NOT EXISTS card_prefix text;

ALTER TABLE public.res_partner_category DROP CONSTRAINT IF EXISTS res_partner_category_card_prefix_check;
ALTER TABLE public.res_partner_category
  ADD CONSTRAINT res_partner_category_card_prefix_check
  CHECK (card_prefix IS NULL OR card_prefix ~ '^[A-Z]{3}$');

CREATE UNIQUE INDEX IF NOT EXISTS uq_rpc_card_prefix
  ON public.res_partner_category (card_prefix) WHERE card_prefix IS NOT NULL;

UPDATE public.res_partner_category SET card_prefix = v.p
  FROM (VALUES
    ('Alessandria',   'ALE'),
    ('Ascoli Piceno', 'APC'),
    ('Catania',       'CTA'),
    ('Genova',        'GEN'),
    ('Napoli',        'NAP'),
    ('Pesaro Urbino', 'PUR'),
    ('Ragusa',        'RGS'),
    ('Varese',        'VAR'),
    ('Siena',         'SIE'),
    ('Venezia',       'VEN'),
    ('Chiusi',        'CUS')
  ) AS v(n, p)
 WHERE res_partner_category.name = v.n AND res_partner_category.card_prefix IS DISTINCT FROM v.p;

-- A group that exists manages its own province. Siena and Venezia existed as groups while
-- SI sat under Genova and VE under Pesaro Urbino: test data from the first import.
UPDATE public.res_partner_category SET province_code = 'SI' WHERE name = 'Siena'   AND province_code IS NULL;
UPDATE public.res_partner_category SET province_code = 'VE' WHERE name = 'Venezia' AND province_code IS NULL;

UPDATE public.res_city SET category_id = (SELECT id FROM public.res_partner_category WHERE name = 'Siena')
 WHERE province_code = 'SI';
UPDATE public.res_city SET category_id = (SELECT id FROM public.res_partner_category WHERE name = 'Venezia')
 WHERE province_code = 'VE';

-- Contacts whose territorial group disagrees with their province are put back. Done for
-- three named test contacts only; nothing is re-derived for the rest of the register.
-- Dario Carpini is deliberately NOT moved: Chiusi is a sub-group a province cannot
-- express, and he sits there because he is in Chiusi, not by accident.
DO $$
DECLARE
  v_ids uuid[] := ARRAY[
    '1f710fad-60b4-43ae-9e28-1bee26190394',  -- Mario Rossi, SI
    'cf7f2282-9ea9-44bc-8763-a47306655b78',  -- Antonina Ciabattoni, raw AP
    '6a68964b-6f62-4c84-9446-3769e7ec4d6a'   -- King Pin, RM
  ]::uuid[];
  r record;
BEGIN
  FOR r IN
    SELECT p.id,
           (SELECT c.category_id FROM public.res_city c
             WHERE c.province_code = coalesce((SELECT province_code FROM public.res_city WHERE id = p.city_id),
                                              p.raw_province)
               AND c.category_id IS NOT NULL
             LIMIT 1) AS cat
      FROM public.res_partner p
     WHERE p.id = ANY (v_ids)
  LOOP
    CONTINUE WHEN r.cat IS NULL;
    DELETE FROM public.res_partner_category_rel x
     USING public.res_partner_category g
     WHERE x.partner_id = r.id AND g.id = x.category_id AND g.category_type = 'territorial';
    INSERT INTO public.res_partner_category_rel (partner_id, category_id)
    VALUES (r.id, r.cat) ON CONFLICT DO NOTHING;
    INSERT INTO public.audit_log (log_type, action, model_name, record_id, source, new_values_json)
    VALUES ('record_change', 'update', 'res_partner_category_rel', r.id, 'migration',
            jsonb_build_object('reason', 'riallineato al gruppo della provincia', 'category_id', r.cat));
  END LOOP;
END $$;


-- ----------------------------------------------------------------------------
-- 3. Cards: <PREFIX><4 digits>, per group
-- ----------------------------------------------------------------------------
-- The register stays warn-only (decision of 2026-10-04, confirming 2026-09-17): there is no
-- UNIQUE on membership_number and, new, none on "one active card per partner per year".
-- The first would refuse a number that is already printed on a physical card; the second
-- would refuse the public form a card for somebody who already has one, which is exactly
-- the case the client wants flagged rather than blocked. The UI shows the triangle.

DROP INDEX IF EXISTS public.idx_sub_partner_year_active;

-- Next number for the contact's group. Raises when there is nothing sensible to pick, and
-- the message is written for the person at the keyboard because it surfaces as a toast.
CREATE OR REPLACE FUNCTION public.generate_membership_number(p_partner uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_prefixes text[];
  v_prefix   text;
  v_next     bigint;
BEGIN
  SELECT array_agg(DISTINCT c.card_prefix ORDER BY c.card_prefix) INTO v_prefixes
    FROM res_partner_category_rel r
    JOIN res_partner_category c ON c.id = r.category_id
   WHERE r.partner_id = p_partner AND c.card_prefix IS NOT NULL;

  IF v_prefixes IS NULL THEN
    RAISE EXCEPTION 'Il contatto non ha un gruppo con sigla tessere: assegna prima il gruppo o digita il numero a mano';
  END IF;
  IF array_length(v_prefixes, 1) > 1 THEN
    RAISE EXCEPTION 'Il contatto è in più gruppi con sigla (%): digita il numero a mano', array_to_string(v_prefixes, ', ');
  END IF;
  v_prefix := v_prefixes[1];

  -- Transaction-scoped, per prefix: held while the maximum is read and the row is written.
  PERFORM pg_advisory_xact_lock(hashtext('membership_number:' || v_prefix));

  -- Numbers typed by hand in the same shape count; anything else (the old 26xxxxx) does not.
  SELECT COALESCE(MAX(CAST(SUBSTR(membership_number, 4) AS bigint)), 0) + 1
    INTO v_next
    FROM membership_subscription
   WHERE upper(membership_number) ~ ('^' || v_prefix || '[0-9]{1,9}$');

  RETURN v_prefix || LPAD(v_next::text, 4, '0');
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_membership_number()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.membership_number IS NULL THEN
    NEW.membership_number := public.generate_membership_number(NEW.partner_id);
  END IF;
  RETURN NEW;
END;
$function$;

-- The old year-based signature must go: CREATE OR REPLACE with another parameter list
-- would have left it behind as an overload (access.md rule 5).
DROP FUNCTION IF EXISTS public.generate_membership_number(integer);

REVOKE EXECUTE ON FUNCTION public.generate_membership_number(uuid) FROM PUBLIC, anon, authenticated;

-- What the issue dialog shows before saving: the number that would be assigned (or why
-- none can be), and how many active cards the contact already holds this year.
CREATE OR REPLACE FUNCTION public.preview_membership_number(p_partner uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_number text;
  v_error  text;
  v_active int;
BEGIN
  IF NOT public.can_see_partner(auth.uid(), p_partner) THEN
    RETURN jsonb_build_object('number', NULL, 'error', 'Contatto non trovato', 'active_this_year', 0);
  END IF;
  BEGIN
    v_number := public.generate_membership_number(p_partner);
  EXCEPTION WHEN OTHERS THEN
    v_error := SQLERRM;
  END;
  SELECT count(*) INTO v_active
    FROM membership_subscription
   WHERE partner_id = p_partner AND status = 'active'
     AND year = EXTRACT(year FROM (now() AT TIME ZONE 'Europe/Rome'))::int;
  RETURN jsonb_build_object('number', v_number, 'error', v_error, 'active_this_year', v_active);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.preview_membership_number(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.preview_membership_number(uuid) TO authenticated;


-- ----------------------------------------------------------------------------
-- 4. submit_public_contact
-- ----------------------------------------------------------------------------
-- New: p_is_member. "Sei già socia/socio?" is mandatory on the form; Yes (or a card number,
-- which implies it) attaches the role socio_aps alongside whatever else was ticked.
--
-- A declared card number, new behaviour:
--   * held by this contact                 -> 'confirmed', nothing created
--   * held by a namesake (same first and last name, the contact being new by email) ->
--     'reconciled': the namesake is the person, the submission is merged into them
--   * held by somebody else                -> 'duplicate': the card is created anyway, the
--     contact goes to Validation with a note, and the duplicate warning does the rest
--   * not on the register                  -> 'created': same, with a "da verificare" note
--   Created cards are active, from today to 31 December of the current year (Italian date),
--   and the client edits the dates afterwards if needed.
--   Previously the number was only looked up and never created ('not_found'/'mismatch').
-- A Yes without a number is a member, flagged for Validation: 'declared'.
--
-- Signature changed (one more parameter), so the old overload is dropped explicitly and
-- the grants redone from PUBLIC down (access.md rules 5 and 7). The old route, which does
-- not send p_is_member, keeps working against the new function through the default.

DROP FUNCTION IF EXISTS public.submit_public_contact(text,text,text,text,text,text,jsonb,text,text,text,text[],text);

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
  p_membership_number text    DEFAULT NULL,
  p_is_member         boolean DEFAULT NULL
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
  v_card_holder_name  text;
  v_membership_status text := 'not_provided';
  v_membership_note   text;
  v_reconciled        boolean := false;
  v_today             date := (now() AT TIME ZONE 'Europe/Rome')::date;
  v_year              int  := EXTRACT(year FROM (now() AT TIME ZONE 'Europe/Rome'))::int;
  v_sub_id            uuid;
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

  SELECT count(*) INTO v_recent_total
    FROM audit_log
   WHERE log_type = 'inbound_form'
     AND created_at > now() - interval '1 minute';
  IF v_recent_total >= 60 THEN
    RAISE EXCEPTION 'rate limit: il servizio sta ricevendo troppe richieste, riprova tra poco';
  END IF;

  p_email := lower(trim(p_email));
  v_card  := NULLIF(trim(coalesce(p_membership_number, '')), '');
  -- "No" on the form means no card, whatever the number field was left holding.
  IF p_is_member IS FALSE THEN v_card := NULL; END IF;

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
                             'is_member',p_is_member,
                             'membership_number',v_card),
          p_ip_address);

  SELECT id INTO v_existing_id FROM res_partner WHERE lower(email) = p_email LIMIT 1;

  -- Reconcile by name: nobody with this email, but the declared card is held by somebody
  -- with the same first and last name. That is the same person writing from a new address.
  IF v_existing_id IS NULL AND v_card IS NOT NULL
     AND coalesce(trim(p_first_name),'') <> '' AND coalesce(trim(p_last_name),'') <> '' THEN
    SELECT p.id INTO v_existing_id
      FROM membership_subscription s
      JOIN res_partner p ON p.id = s.partner_id
     WHERE s.membership_number = v_card
       AND lower(trim(p.first_name)) = lower(trim(p_first_name))
       AND lower(trim(p.last_name))  = lower(trim(p_last_name))
     LIMIT 1;
    IF v_existing_id IS NOT NULL THEN
      v_reconciled := true;
    END IF;
  END IF;

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
            jsonb_build_object('email',p_email,'reconciled_by_name',v_reconciled));
    IF v_reconciled THEN
      UPDATE res_partner SET notes = CASE
          WHEN notes IS NULL OR trim(notes) = ''
            THEN '[' || to_char(now(),'YYYY-MM-DD') || ' form pubblico] riconciliato per nome con la tessera ' || v_card || '; email indicata nel form: ' || p_email
          ELSE notes || E'\n\n[' || to_char(now(),'YYYY-MM-DD') || ' form pubblico] riconciliato per nome con la tessera ' || v_card || '; email indicata nel form: ' || p_email
        END
      WHERE id = v_partner_id;
    END IF;
  END IF;

  -- Operational roles. Unknown or inactive codes are ignored rather than rejected: the
  -- WordPress form is maintained by someone else and must not break when this list moves.
  IF p_role_codes IS NOT NULL AND array_length(p_role_codes, 1) > 0 THEN
    INSERT INTO res_partner_role_rel (partner_id, role_id)
    SELECT v_partner_id, r.id
      FROM res_partner_role r
     WHERE r.code = ANY (p_role_codes)
       AND r.status = 'active'
    ON CONFLICT DO NOTHING;
  END IF;

  -- "Sei già socia/socio?" = Yes. A declared card number implies it. Added next to the
  -- other roles, never instead of them, and never removed here.
  IF p_is_member IS TRUE OR v_card IS NOT NULL THEN
    INSERT INTO res_partner_role_rel (partner_id, role_id)
    SELECT v_partner_id, r.id FROM res_partner_role r
     WHERE r.code = 'socio_aps' AND r.status = 'active'
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

  -- Membership card declared on the form.
  IF v_card IS NOT NULL THEN
    SELECT partner_id INTO v_card_partner
      FROM membership_subscription
     WHERE membership_number = v_card AND partner_id = v_partner_id
     LIMIT 1;

    IF v_card_partner IS NOT NULL THEN
      v_membership_status := CASE WHEN v_reconciled THEN 'reconciled' ELSE 'confirmed' END;
    ELSE
      SELECT s.partner_id, p.display_name INTO v_card_partner, v_card_holder_name
        FROM membership_subscription s
        JOIN res_partner p ON p.id = s.partner_id
       WHERE s.membership_number = v_card
       LIMIT 1;

      IF v_card_partner IS NULL THEN
        v_membership_status := 'created';
        v_membership_note := 'tessera dichiarata "' || v_card || '" non presente a sistema: creata dal form, da verificare';
      ELSE
        v_membership_status := 'duplicate';
        v_membership_note := 'tessera dichiarata "' || v_card || '" già assegnata a ' ||
                             coalesce(v_card_holder_name,'un altro contatto') ||
                             ': creata comunque, da verificare (compare l''avviso di numero doppio)';
      END IF;

      INSERT INTO membership_subscription (partner_id, year, start_date, end_date, status, membership_number, notes)
      VALUES (v_partner_id, v_year, v_today, make_date(v_year, 12, 31), 'active', v_card, 'creata dal form pubblico')
      RETURNING id INTO v_sub_id;
      INSERT INTO audit_log (log_type,action,model_name,record_id,source,new_values_json)
      VALUES ('subscription_change','create','membership_subscription',v_sub_id,'public_form',
              jsonb_build_object('partner_id',v_partner_id,'membership_number',v_card,'status',v_membership_status));
    END IF;
  ELSIF p_is_member IS TRUE THEN
    v_membership_status := 'declared';
    v_membership_note := 'dichiara di essere già socio/a, tessera non indicata';
  END IF;

  IF v_membership_note IS NOT NULL THEN
    -- Needs a human either way, so put it back in the validation queue.
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

  -- Privacy consents: only 'privacy_policy' is collected (2026-09-17); anything else in
  -- the payload is ignored, not rejected. channel is 'web' by construction.
  IF p_privacy_consents IS NOT NULL THEN
    FOR v_consent IN SELECT value FROM jsonb_array_elements(p_privacy_consents) AS value LOOP
      IF (v_consent->>'consent_type') = 'privacy_policy' THEN
        INSERT INTO privacy_consent (partner_id,consent_type,accepted,accepted_at,source,version,ip_address,user_agent,channel)
        VALUES (v_partner_id, 'privacy_policy', (v_consent->>'accepted')::boolean,
                CASE WHEN (v_consent->>'accepted')::boolean THEN now() ELSE NULL END,
                'public_form', v_consent->>'version', p_ip_address, p_user_agent, 'web');
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

REVOKE EXECUTE ON FUNCTION public.submit_public_contact(text,text,text,text,text,text,jsonb,text,text,text,text[],text,boolean) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.submit_public_contact(text,text,text,text,text,text,jsonb,text,text,text,text[],text,boolean) TO anon, authenticated;


-- ----------------------------------------------------------------------------
-- 5. Helpers that anon could execute
-- ----------------------------------------------------------------------------
-- Same root cause as KI-01: born with EXECUTE to PUBLIC, and the earlier REVOKE FROM anon
-- did nothing while PUBLIC still held it. Both are called from RLS policies of
-- authenticated users, so authenticated keeps them.
REVOKE EXECUTE ON FUNCTION public.can_manage_user(uuid, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.can_manage_user(uuid, text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.role_rank(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.role_rank(text) TO authenticated;


-- ----------------------------------------------------------------------------
-- 6. Everybody can read every group (decision of 2026-10-04: "per ora tutti vedono tutto")
-- ----------------------------------------------------------------------------
-- Found by the per-profile tests the same day, in two steps.
--
-- First symptom: validatePartner looks the Validation group up with the CALLER's client,
-- and rpc_select hid it from anybody whose perimeter did not contain it, so for a
-- coordinator, a volunteer or the account with no groups the Validation tag was never
-- removed: the contact stayed "Da validare" after being triaged. Only admin and superuser
-- could actually clear the queue.
--
-- Underlying cause: contacts became visible to everybody on 2026-09-17, but the groups
-- table was still scoped by perimeter, so a Varese coordinator saw every contact and the
-- NAME of one group — the group badge of a Siena contact came back blank.
--
-- Reading is opened to every active user. WRITING is not: until now the perimeter on
-- UPDATE came for free from the SELECT filter (a row you cannot see you cannot patch).
-- With SELECT open that would have let any coordinator edit any group, president and card
-- prefix included, so the rule is now written into rpc_update itself. Insert and delete are
-- untouched (coordinator+ may insert, admin/superuser delete, never the system group).
--
-- visible_category_ids() stays: res_user_category_rel (who may assign whom to a group) and
-- rpc_update still use it.
DROP POLICY IF EXISTS rpc_select ON public.res_partner_category;
CREATE POLICY rpc_select ON public.res_partner_category FOR SELECT TO public
  USING (current_role_name() IS NOT NULL);

DROP POLICY IF EXISTS rpc_update ON public.res_partner_category;
CREATE POLICY rpc_update ON public.res_partner_category FOR UPDATE TO public
  USING (is_admin_or_super(auth.uid())
         OR (current_role_name() = 'coordinator'
             AND (created_by = auth.uid() OR id IN (SELECT visible_category_ids(auth.uid())))))
  WITH CHECK (is_admin_or_super(auth.uid())
         OR (current_role_name() = 'coordinator'
             AND (created_by = auth.uid() OR id IN (SELECT visible_category_ids(auth.uid())))));
