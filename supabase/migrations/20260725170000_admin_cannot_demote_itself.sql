-- ============================================================================
-- An admin must not be able to demote itself
-- ============================================================================
-- Applied 2026-07-25 via Lovable MCP (query_database).
--
-- Found during the end-to-end permission tests, and it is a one-way trap.
--
-- protect_admin_users() blocked modifying an admin row only when
-- `NEW.id <> auth.uid()`, i.e. someone else's. An admin editing its OWN row could
-- therefore change its role away from 'admin' — and the very next rule,
-- "Cannot promote to admin from UI", makes that irreversible: nothing in the
-- application can ever grant the admin role back.
--
-- Reproduced for real: after the test admin demoted itself, restoring the role
-- required disabling this trigger from a privileged SQL session. Even
-- query_database, which runs as postgres, is refused — a table trigger fires
-- regardless of RLS or role.
--
-- That matters because diego@limepeak.it is the only admin, and the admin role is
-- the only one that can read the audit log. One wrong save on his own profile
-- would have locked that away permanently.
--
-- Fix: the role of an admin row can never change through the application, not even
-- by the admin itself. Name, email and the rest stay editable, so the profile page
-- keeps working. Promotion to admin remains blocked as the build plan intended:
-- admins are provisioned at database level, on purpose.
--
-- EMERGENCY PROCEDURE, should an admin ever end up locked out anyway:
--   ALTER TABLE res_users DISABLE TRIGGER trg_protect_admin;
--   UPDATE res_users SET role = 'admin' WHERE email = '<email>';
--   ALTER TABLE res_users ENABLE TRIGGER trg_protect_admin;
-- ============================================================================

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

    -- Self-demotion included: losing the admin role is not reversible from the app.
    IF OLD.role = 'admin' AND NEW.role IS DISTINCT FROM OLD.role THEN
      RAISE EXCEPTION 'Il ruolo admin non puo essere modificato dall''applicazione';
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
