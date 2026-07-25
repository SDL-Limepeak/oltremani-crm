-- ============================================================================
-- Fix: un non-admin non riusciva a creare contatti dall'app
-- ============================================================================
-- Applicata il 2026-07-25 via Lovable MCP (query_database).
--
-- Bug PRE-ESISTENTE, emerso testando la migrazione 20260725120000 e non causato
-- da essa: nessuna policy di quella migrazione toccava res_partner.
--
-- Sintomo: upsertPartner (src/lib/partners.functions.ts) fa
--     .from("res_partner").insert(payload).select().single()
-- che a livello SQL è INSERT ... RETURNING. Postgres applica la policy SELECT
-- anche alle righe restituite da RETURNING. partner_select richiede
-- can_see_partner(), che si basa solo sulle categorie: un contatto appena creato
-- non ne ha ancora nessuna, quindi la lettura di ritorno veniva rifiutata e
-- l'intera insert falliva con
--     new row violates row-level security policy for table "res_partner"
--
-- Verificato: stessa INSERT senza RETURNING passa, con RETURNING no.
--
-- Perché non se ne è accorto nessuno: gli unici due utenti sono admin e
-- superuser, che scavalcano il controllo via is_admin_or_super(). Il problema si
-- manifesta al primo coordinator o volunteer.
--
-- Correzione: chi ha creato un contatto lo vede, indipendentemente dalle
-- categorie. Messa dentro can_see_partner così vale in modo coerente anche per
-- tesseramenti, consensi e relazioni categoria, invece di rincorrere una policy
-- alla volta.
--
-- Nota sicurezza: created_by non è sfruttabile per scalare privilegi. Per
-- impostarlo su un contatto altrui servirebbe una UPDATE su quel contatto, che
-- richiede già di poterlo vedere. Impostarlo su un contatto nuovo non dà accesso
-- a nulla che non si sia creati da soli.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.can_see_partner(_uid uuid, _partner_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT public.is_admin_or_super(_uid)
      OR EXISTS (
           SELECT 1 FROM public.res_partner p
            WHERE p.id = _partner_id AND p.created_by = _uid
         )
      OR EXISTS (
           SELECT 1 FROM public.res_partner_category_rel r
            WHERE r.partner_id = _partner_id
              AND r.category_id IN (SELECT public.visible_category_ids(_uid))
         );
$function$;

-- La OR su partner_created_by() dentro rpcr_mod (migrazione 20260725120000) è ora
-- ridondante, perché can_see_partner copre già il caso. La lascio: è innocua e
-- documenta l'intento. La funzione partner_created_by resta definita.
