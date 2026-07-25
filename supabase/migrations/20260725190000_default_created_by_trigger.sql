-- ============================================================================
-- created_by filled in automatically, instead of relying on every caller
-- ============================================================================
-- Applied 2026-07-25 via Lovable MCP (query_database).
--
-- Migrations 20260725140000 and 20260725180000 made the RLS read-back depend on
-- `created_by = auth.uid()`. That works, but it is fragile: it silently requires every
-- insert path to remember to set the column. Forget it in one place and a coordinator
-- gets an opaque 403 from an operation that is supposed to be allowed — which is
-- exactly how this surfaced in the end-to-end tests.
--
-- A BEFORE INSERT trigger removes the requirement: the column is filled from
-- auth.uid() whenever the caller left it empty. Callers that set it explicitly are
-- untouched, so upsertPartner and upsertCategory keep working as they are.
--
-- auth.uid() is NULL for service_role and for SECURITY DEFINER functions such as
-- submit_public_contact, which bypass RLS anyway: in that case created_by simply stays
-- NULL, as before.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.set_created_by()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.created_by IS NULL THEN
    NEW.created_by := auth.uid();
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_partner_created_by ON public.res_partner;
CREATE TRIGGER trg_partner_created_by
  BEFORE INSERT ON public.res_partner
  FOR EACH ROW EXECUTE FUNCTION public.set_created_by();

DROP TRIGGER IF EXISTS trg_category_created_by ON public.res_partner_category;
CREATE TRIGGER trg_category_created_by
  BEFORE INSERT ON public.res_partner_category
  FOR EACH ROW EXECUTE FUNCTION public.set_created_by();
