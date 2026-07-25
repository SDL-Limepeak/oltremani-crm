-- ============================================================================
-- PATCH RLS PROPOSTE — NON ANCORA APPLICATE
-- ============================================================================
-- Data: 2026-07-25
-- Contesto: .claude/architecture.md, sezione "Buchi RLS noti"
--
-- ⚠️ NON eseguire con query_database.
--    Va passato all'agent Lovable, altrimenti lo schema divergerà dal suo changelog
--    e una rigenerazione successiva potrebbe sovrascrivere queste modifiche.
--
-- ⚠️ Da testare in questo ordine dopo l'applicazione:
--    1. un volontario NON riesce più a cambiarsi il ruolo
--    2. un volontario riesce ancora a creare un contatto e ad assegnargli le categorie
--    3. l'admin riesce ancora a cambiare ruolo/stato ad altri utenti
--    4. il form pubblico continua a funzionare (è SECURITY DEFINER, non dovrebbe essere toccato)
-- ============================================================================


-- ----------------------------------------------------------------------------
-- FIX 1 — Auto-promozione a superuser
-- ----------------------------------------------------------------------------
-- Problema: la policy users_update ammette `id = auth.uid()` e non ha WITH CHECK.
-- protect_admin_users blocca solo la promozione ad 'admin', quindi un volontario
-- può portarsi a 'superuser' da solo.
--   Verificato: UPDATE riuscito, ruolo ora = superuser
--
-- Perché la correzione va nel trigger e non nella policy: WITH CHECK vede solo la
-- riga NUOVA, non può confrontarla con quella vecchia. Serve OLD vs NEW ⇒ trigger.
--
-- Nota su auth.uid() IS NULL: è il caso del service_role e del seeding server-side,
-- che devono restare liberi di impostare i ruoli.

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

    -- NUOVO: solo admin/superuser possono toccare role e status, di chiunque,
    -- incluso il proprio. Chiude l'auto-promozione.
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
-- FIX 2 — Auto-assegnazione della visibilità sui contatti
-- ----------------------------------------------------------------------------
-- Problema: rpcr_mod ha WITH CHECK (current_role_name() IS NOT NULL), quindi
-- qualsiasi utente autenticato può inserire una coppia (partner_id, category_id)
-- arbitraria e rendersi visibile un contatto altrimenti invisibile.
--   Verificato: vedeva_prima=false vede_dopo=true
--
-- Vincolo da rispettare: upsertPartner (src/lib/partners.functions.ts) crea il
-- partner e SUBITO DOPO gli attacca le categorie, usando il client dell'utente.
-- In quel momento il partner non ha ancora categorie, quindi can_see_partner è
-- false: un WITH CHECK basato solo su can_see_partner romperebbe la creazione
-- contatti per chi non è admin. Serve l'eccezione "l'ho creato io", che regge
-- perché upsertPartner valorizza created_by.

-- Helper SECURITY DEFINER: indispensabile. Un EXISTS diretto su res_partner dentro
-- una policy sarebbe filtrato dalla RLS di res_partner stessa e tornerebbe sempre
-- false, rendendo la policy inutilizzabile.
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

-- Effetto collaterale accettato: un coordinatore che valida un contatto verso la
-- categoria di un'altra area territoriale ora riceve un errore invece di riuscire.
-- È il comportamento corretto secondo la matrice permessi del piano; admin e
-- superuser continuano a passare perché visible_category_ids restituisce tutto.


-- ----------------------------------------------------------------------------
-- FIX 3 — Consensi privacy falsificabili
-- ----------------------------------------------------------------------------
-- Problema: consent_mod ha WITH CHECK (true): si può inserire un consenso per
-- qualsiasi partner, anche non visibile. Rilevante lato GDPR, è un registro di consensi.

ALTER POLICY consent_mod ON public.privacy_consent
  USING (public.can_see_partner(auth.uid(), partner_id))
  WITH CHECK (public.can_see_partner(auth.uid(), partner_id));


-- ----------------------------------------------------------------------------
-- FIX 4 — Audit log falsificabile
-- ----------------------------------------------------------------------------
-- Problema: audit_insert ha WITH CHECK (true) per authenticated, quindi si possono
-- scrivere righe a nome di altri. La lettura è già solo admin e non esiste policy
-- DELETE, quindi le righe non si possono cancellare: manca solo legare l'autore.
-- NULL resta ammesso: submit_public_contact scrive senza utente (è SECURITY DEFINER
-- e comunque bypassa, ma altre scritture server-side potrebbero non avere uid).

ALTER POLICY audit_insert ON public.audit_log
  WITH CHECK (changed_by_user_id = auth.uid() OR changed_by_user_id IS NULL);


-- ----------------------------------------------------------------------------
-- FIX 5 — partner_type senza CHECK
-- ----------------------------------------------------------------------------
-- La UI espone tre valori, il DB accetta qualsiasi stringa.

ALTER TABLE public.res_partner
  ADD CONSTRAINT res_partner_partner_type_check
  CHECK (partner_type IN ('individual', 'activist', 'citizen'));


-- ----------------------------------------------------------------------------
-- FIX 6 — Doppioni email per differenza di maiuscole
-- ----------------------------------------------------------------------------
-- res_partner.email è UNIQUE ma case-sensitive, e submit_public_contact cerca con
-- `WHERE email = p_email` esatto. Quindi Mario@x.it e mario@x.it creano DUE partner.
-- Oggi nel DB non ci sono casi (verificato), quindi si può normalizzare senza conflitti.
--
-- Va fatto in tre passi, in questo ordine:
--   a) normalizzare i dati esistenti
--   b) sostituire l'indice non-unique su lower(email) con uno unique
--   c) far normalizzare l'email anche a submit_public_contact (lookup E insert)

-- a)
UPDATE public.res_partner
   SET email = lower(trim(email))
 WHERE email IS NOT NULL AND email <> lower(trim(email));

-- b)
DROP INDEX IF EXISTS public.idx_partner_email;
CREATE UNIQUE INDEX idx_partner_email_lower
  ON public.res_partner (lower(email))
  WHERE email IS NOT NULL;

-- c) da riportare dentro submit_public_contact:
--      all'inizio:  p_email := lower(trim(p_email));
--      nel lookup:  WHERE lower(email) = p_email
--    Riscrivere la funzione per intero tramite l'agent Lovable, così il changelog
--    resta allineato. Nella stessa passata conviene sistemare anche il fallback
--    città `ILIKE '%'||p_city||'%'`: se p_city contiene % o _ diventano wildcard
--    (non è SQL injection, ma dà match sbagliati) — va passato in
--    replace(replace(p_city,'%','\%'),'_','\_').


-- ============================================================================
-- VERIFICA POST-APPLICAZIONE
-- ============================================================================
-- Rilancia le due prove. Devono ora rispondere "BLOCCATO: ...".
-- Il RAISE EXCEPTION finale garantisce il rollback: non lascia nulla nel DB.

-- Prova 1 — auto-promozione
DO $$
DECLARE
  v_uid uuid := '00000000-0000-0000-0000-0000000000aa';
  v_esito text;
BEGIN
  INSERT INTO res_users(id,name,email,role,status)
  VALUES (v_uid,'Test Volontario','test-rls-probe@local.invalid','volunteer','active');
  PERFORM set_config('request.jwt.claims', json_build_object('sub',v_uid::text,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    UPDATE res_users SET role='superuser' WHERE id=v_uid;
    v_esito := 'NON PROTETTO: ruolo ora = ' || (SELECT role FROM res_users WHERE id=v_uid);
  EXCEPTION WHEN others THEN
    v_esito := 'BLOCCATO: ' || SQLERRM;
  END;
  RESET ROLE;
  RAISE EXCEPTION 'ESITO >>> %', v_esito;
END $$;

-- Prova 2 — auto-assegnazione visibilità
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
  VALUES (v_uid,'T2','t2-probe@local.invalid','volunteer','active');
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
  RAISE EXCEPTION 'ESITO >>> %', v_esito;
END $$;
