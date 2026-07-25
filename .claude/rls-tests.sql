-- ============================================================================
-- Test di sicurezza e regressione RLS — riutilizzabili
-- ============================================================================
-- Le patch sono già applicate. Migrazioni in supabase/migrations/:
--   20260725120000_security_rls_hardening.sql
--   20260725130000_fix_self_created_partner_visibility.sql
--   20260725140000_partner_policies_created_by.sql
-- Questo file serve a RI-VERIFICARE, in particolare dopo che l'agent Lovable ha
-- rigenerato lo schema: le migrazioni sono state applicate direttamente via
-- query_database, quindi Lovable non le ha nel suo changelog e potrebbe
-- sovrascrivere le policy senza accorgersene.
--
-- Come lanciarli: uno per volta con query_database. Ogni blocco termina con
-- RAISE EXCEPTION, che fa il ROLLBACK di tutto e restituisce comunque l'esito nel
-- messaggio d'errore. Non lasciano NULLA nel database — verificato confrontando
-- i conteggi delle tabelle prima e dopo.
--
-- Il messaggio arriva come "ERROR: P0001: <etichetta> >>> <esito>": è atteso,
-- non è un fallimento.
--
-- Attesi:
--   EX1  -> BLOCCATO
--   EX2  -> BLOCCATO
--   REGR -> tutti e quattro OK
-- ============================================================================


-- ----------------------------------------------------------------------------
-- EX1 — un volontario NON deve potersi cambiare il ruolo
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_uid uuid := '00000000-0000-0000-0000-0000000000aa';
  v_esito text;
BEGIN
  INSERT INTO res_users(id,name,email,role,status)
  VALUES (v_uid,'Test Volontario','ex1-probe@local.invalid','volunteer','active');
  PERFORM set_config('request.jwt.claims', json_build_object('sub',v_uid::text,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    UPDATE res_users SET role='superuser' WHERE id=v_uid;
    v_esito := 'NON PROTETTO: ruolo ora = ' || (SELECT role FROM res_users WHERE id=v_uid);
  EXCEPTION WHEN others THEN
    v_esito := 'BLOCCATO: ' || SQLERRM;
  END;
  RESET ROLE;
  RAISE EXCEPTION 'EX1 >>> %', v_esito;
END $$;


-- ----------------------------------------------------------------------------
-- EX2 — un volontario NON deve potersi rendere visibile un contatto precluso
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_uid uuid := '00000000-0000-0000-0000-0000000000ab';
  v_cat uuid; v_altra uuid; v_target uuid; v_esito text;
BEGIN
  SELECT id INTO v_cat   FROM res_partner_category WHERE name = 'Varese';
  SELECT id INTO v_altra FROM res_partner_category WHERE name = 'Ragusa';
  SELECT r.partner_id INTO v_target FROM res_partner_category_rel r WHERE r.category_id = v_altra LIMIT 1;
  IF v_target IS NULL THEN SELECT id INTO v_target FROM res_partner LIMIT 1; END IF;

  INSERT INTO res_users(id,name,email,role,status)
  VALUES (v_uid,'T2','ex2-probe@local.invalid','volunteer','active');
  INSERT INTO res_user_category_rel(user_id,category_id) VALUES (v_uid,v_cat);
  PERFORM set_config('request.jwt.claims', json_build_object('sub',v_uid::text,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO res_partner_category_rel(partner_id,category_id) VALUES (v_target,v_cat);
    v_esito := 'NON PROTETTO: vede_dopo=' || can_see_partner(v_uid,v_target);
  EXCEPTION WHEN others THEN
    v_esito := 'BLOCCATO: ' || SQLERRM;
  END;
  RESET ROLE;
  RAISE EXCEPTION 'EX2 >>> %', v_esito;
END $$;


-- ----------------------------------------------------------------------------
-- REGR — i flussi legittimi devono continuare a funzionare
-- ----------------------------------------------------------------------------
-- Il caso A è quello che ha scoperto il bug INSERT ... RETURNING: se torna
-- "new row violates row-level security policy for table res_partner",
-- le policy partner_select / partner_update hanno perso `OR created_by = auth.uid()`.
DO $$
DECLARE
  v_vol   uuid := '00000000-0000-0000-0000-0000000000c1';
  v_admin uuid; v_cat uuid; v_new_partner uuid; r jsonb;
  e1 text; e2 text; e3 text; e4 text;
BEGIN
  SELECT id INTO v_admin FROM res_users WHERE role = 'admin' LIMIT 1;
  SELECT id INTO v_cat   FROM res_partner_category WHERE name = 'Varese';

  INSERT INTO res_users(id,name,email,role,status)
  VALUES (v_vol,'Volontario Test','regr-probe@local.invalid','volunteer','active');
  INSERT INTO res_user_category_rel(user_id,category_id) VALUES (v_vol,v_cat);

  -- A) il volontario crea un contatto e gli assegna la sua categoria
  PERFORM set_config('request.jwt.claims', json_build_object('sub',v_vol::text,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO res_partner (first_name,last_name,email,status,created_by)
    VALUES ('Nuovo','Contatto','regr-new@local.invalid','new',v_vol)
    RETURNING id INTO v_new_partner;
    INSERT INTO res_partner_category_rel (partner_id,category_id) VALUES (v_new_partner,v_cat);
    e1 := 'OK - creazione contatto + assegnazione categoria';
  EXCEPTION WHEN others THEN e1 := 'ROTTO: ' || SQLERRM; END;

  -- B) consenso privacy sul proprio contatto
  BEGIN
    INSERT INTO privacy_consent (partner_id,consent_type,accepted,source)
    VALUES (v_new_partner,'privacy_policy',true,'ui');
    e2 := 'OK - consenso registrato';
  EXCEPTION WHEN others THEN e2 := 'ROTTO: ' || SQLERRM; END;
  RESET ROLE;

  -- C) l'admin cambia ruolo e stato di un altro utente
  PERFORM set_config('request.jwt.claims', json_build_object('sub',v_admin::text,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    UPDATE res_users SET role='coordinator' WHERE id=v_vol;
    UPDATE res_users SET status='inactive'  WHERE id=v_vol;
    e3 := 'OK - admin ha cambiato ruolo a ' || (SELECT role FROM res_users WHERE id=v_vol);
  EXCEPTION WHEN others THEN e3 := 'ROTTO: ' || SQLERRM; END;
  RESET ROLE;

  -- D) il form pubblico, con email volutamente in maiuscolo per testare il dedup
  BEGIN
    r := submit_public_contact('Mario','Rossi','REGR-Form@Local.Invalid','+39 333 0000000',
                               'Ragusa','RG',
                               '[{"consent_type":"privacy_policy","accepted":true,"version":"1.0"}]'::jsonb,
                               '127.0.0.1','regr');
    e4 := 'OK - form pubblico: validation=' || (r->>'validation')
       || ' email_normalizzata=' || (SELECT email FROM res_partner WHERE id=(r->>'partner_id')::uuid);
  EXCEPTION WHEN others THEN e4 := 'ROTTO: ' || SQLERRM; END;

  RAISE EXCEPTION E'REGR >>>\n  A) %\n  B) %\n  C) %\n  D) %', e1, e2, e3, e4;
END $$;


-- ----------------------------------------------------------------------------
-- Controllo residui: dopo i test i conteggi devono essere identici a prima
-- ----------------------------------------------------------------------------
SELECT (SELECT count(*) FROM res_users)  AS utenti,
       (SELECT count(*) FROM res_partner) AS partner,
       (SELECT count(*) FROM privacy_consent) AS consensi,
       (SELECT count(*) FROM res_partner_category_rel) AS rel,
       (SELECT count(*) FROM res_partner WHERE email LIKE '%local.invalid') AS residui_test;
