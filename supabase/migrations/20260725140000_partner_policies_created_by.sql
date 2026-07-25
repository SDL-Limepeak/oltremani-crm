-- ============================================================================
-- Fix (seguito di 20260725130000): created_by va nella policy, non nella funzione
-- ============================================================================
-- Applicata il 2026-07-25 via Lovable MCP (query_database).
--
-- Perché la migrazione precedente non bastava: dentro INSERT ... RETURNING la
-- riga appena inserita NON è ancora visibile alle sottoquery della stessa
-- istruzione (command counter). can_see_partner fa
--     EXISTS (SELECT 1 FROM res_partner WHERE id = _partner_id AND created_by = _uid)
-- e quella SELECT non trova la riga in corso di inserimento, quindi torna false
-- e RETURNING viene rifiutato comunque.
--
-- L'espressione di una policy invece è valutata direttamente sui valori della
-- riga: `created_by = auth.uid()` funziona senza alcun accesso alla tabella.
--
-- La modifica a can_see_partner resta utile e va tenuta: serve per consensi,
-- tesseramenti e relazioni categoria, dove il partner esiste già e la sottoquery
-- lo trova regolarmente.
-- ============================================================================

ALTER POLICY partner_select ON public.res_partner
  USING (public.can_see_partner(auth.uid(), id) OR created_by = auth.uid());

ALTER POLICY partner_update ON public.res_partner
  USING (public.can_see_partner(auth.uid(), id) OR created_by = auth.uid());
