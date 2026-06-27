
ALTER FUNCTION public.set_updated_at() SET search_path = public;
ALTER FUNCTION public.sub_default_end_date() SET search_path = public;
ALTER FUNCTION public.protect_admin_users() SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.has_role(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_admin_or_super(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.current_role_name() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.visible_category_ids(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.can_see_partner(uuid, uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.has_role(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_admin_or_super(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.current_role_name() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.visible_category_ids(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_see_partner(uuid, uuid) TO authenticated, service_role;
