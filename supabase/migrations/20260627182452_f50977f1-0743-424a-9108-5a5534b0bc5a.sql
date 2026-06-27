
-- ============================================================
-- HELPERS
-- ============================================================
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

-- ============================================================
-- res_partner_category
-- ============================================================
CREATE TABLE public.res_partner_category (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  parent_id uuid REFERENCES public.res_partner_category(id) ON DELETE SET NULL,
  category_type text NOT NULL DEFAULT 'territorial' CHECK (category_type IN ('territorial','system')),
  president_first_name text,
  president_last_name text,
  president_email text,
  phone text,
  mobile text,
  activation_date date,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  fiscal_code text,
  address text,
  city text,
  province_code text,
  iban text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_rpc_parent ON public.res_partner_category(parent_id);
CREATE INDEX idx_rpc_type ON public.res_partner_category(category_type);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.res_partner_category TO authenticated;
GRANT ALL ON public.res_partner_category TO service_role;
ALTER TABLE public.res_partner_category ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_rpc_updated_at BEFORE UPDATE ON public.res_partner_category
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- res_city
-- ============================================================
CREATE TABLE public.res_city (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  province text,
  province_code text,
  region text,
  category_id uuid REFERENCES public.res_partner_category(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_city_name ON public.res_city(lower(name));
CREATE INDEX idx_city_province ON public.res_city(province_code);
CREATE INDEX idx_city_category ON public.res_city(category_id);
CREATE UNIQUE INDEX idx_city_name_prov ON public.res_city(lower(name), province_code);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.res_city TO authenticated;
GRANT ALL ON public.res_city TO service_role;
ALTER TABLE public.res_city ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_city_updated_at BEFORE UPDATE ON public.res_city
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- res_partner
-- ============================================================
CREATE TABLE public.res_partner (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_type text NOT NULL DEFAULT 'individual',
  first_name text,
  last_name text,
  display_name text,
  email text UNIQUE,
  phone text,
  mobile text,
  city_id uuid REFERENCES public.res_city(id) ON DELETE SET NULL,
  raw_city text,
  raw_province text,
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new','active','rejected','old')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid
);
CREATE INDEX idx_partner_email ON public.res_partner(lower(email));
CREATE INDEX idx_partner_status ON public.res_partner(status);
CREATE INDEX idx_partner_city ON public.res_partner(city_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.res_partner TO authenticated;
GRANT ALL ON public.res_partner TO service_role;
ALTER TABLE public.res_partner ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_partner_updated_at BEFORE UPDATE ON public.res_partner
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- res_partner_category_rel
-- ============================================================
CREATE TABLE public.res_partner_category_rel (
  partner_id uuid NOT NULL REFERENCES public.res_partner(id) ON DELETE CASCADE,
  category_id uuid NOT NULL REFERENCES public.res_partner_category(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (partner_id, category_id)
);
CREATE INDEX idx_rpcr_category ON public.res_partner_category_rel(category_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.res_partner_category_rel TO authenticated;
GRANT ALL ON public.res_partner_category_rel TO service_role;
ALTER TABLE public.res_partner_category_rel ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- membership_subscription
-- ============================================================
CREATE TABLE public.membership_subscription (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL REFERENCES public.res_partner(id) ON DELETE CASCADE,
  year int NOT NULL DEFAULT EXTRACT(YEAR FROM now())::int,
  start_date date NOT NULL DEFAULT CURRENT_DATE,
  end_date date,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid,
  UNIQUE (partner_id, year)
);
CREATE INDEX idx_sub_year ON public.membership_subscription(year);
CREATE INDEX idx_sub_status ON public.membership_subscription(status);
CREATE INDEX idx_sub_partner ON public.membership_subscription(partner_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.membership_subscription TO authenticated;
GRANT ALL ON public.membership_subscription TO service_role;
ALTER TABLE public.membership_subscription ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_sub_updated_at BEFORE UPDATE ON public.membership_subscription
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- default end_date if null
CREATE OR REPLACE FUNCTION public.sub_default_end_date()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.end_date IS NULL THEN
    NEW.end_date := make_date(NEW.year, 12, 31);
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_sub_default_end BEFORE INSERT OR UPDATE ON public.membership_subscription
  FOR EACH ROW EXECUTE FUNCTION public.sub_default_end_date();

-- ============================================================
-- privacy_consent
-- ============================================================
CREATE TABLE public.privacy_consent (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL REFERENCES public.res_partner(id) ON DELETE CASCADE,
  consent_type text NOT NULL CHECK (consent_type IN ('privacy_policy','marketing','newsletter')),
  accepted boolean NOT NULL DEFAULT false,
  accepted_at timestamptz,
  source text,
  version text,
  ip_address text,
  user_agent text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_consent_partner ON public.privacy_consent(partner_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.privacy_consent TO authenticated;
GRANT ALL ON public.privacy_consent TO service_role;
ALTER TABLE public.privacy_consent ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- res_users
-- ============================================================
CREATE TABLE public.res_users (
  id uuid PRIMARY KEY,
  name text,
  email text UNIQUE,
  role text NOT NULL DEFAULT 'volunteer' CHECK (role IN ('admin','superuser','coordinator','volunteer')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.res_users TO authenticated;
GRANT ALL ON public.res_users TO service_role;
ALTER TABLE public.res_users ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON public.res_users
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- res_user_category_rel
-- ============================================================
CREATE TABLE public.res_user_category_rel (
  user_id uuid NOT NULL REFERENCES public.res_users(id) ON DELETE CASCADE,
  category_id uuid NOT NULL REFERENCES public.res_partner_category(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, category_id)
);
CREATE INDEX idx_rucr_category ON public.res_user_category_rel(category_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.res_user_category_rel TO authenticated;
GRANT ALL ON public.res_user_category_rel TO service_role;
ALTER TABLE public.res_user_category_rel ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- audit_log
-- ============================================================
CREATE TABLE public.audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  log_type text NOT NULL CHECK (log_type IN ('inbound_form','record_change','subscription_change','permission_change','user_change')),
  model_name text,
  record_id uuid,
  action text NOT NULL CHECK (action IN ('create','update','merge','validate','delete','api_call')),
  old_values_json jsonb,
  new_values_json jsonb,
  changed_by_user_id uuid,
  source text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_created ON public.audit_log(created_at DESC);
CREATE INDEX idx_audit_record ON public.audit_log(model_name, record_id);
CREATE INDEX idx_audit_user ON public.audit_log(changed_by_user_id);
GRANT SELECT, INSERT ON public.audit_log TO authenticated;
GRANT ALL ON public.audit_log TO service_role;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- SECURITY DEFINER helpers
-- ============================================================
CREATE OR REPLACE FUNCTION public.has_role(_uid uuid, _role text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.res_users WHERE id = _uid AND role = _role AND status = 'active');
$$;

CREATE OR REPLACE FUNCTION public.current_role_name()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT role FROM public.res_users WHERE id = auth.uid() AND status = 'active' LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.is_admin_or_super(_uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.res_users WHERE id = _uid AND role IN ('admin','superuser') AND status = 'active');
$$;

-- visible categories for user (with descendant expansion)
CREATE OR REPLACE FUNCTION public.visible_category_ids(_uid uuid)
RETURNS SETOF uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.is_admin_or_super(_uid) THEN
    RETURN QUERY SELECT id FROM public.res_partner_category;
    RETURN;
  END IF;

  RETURN QUERY
  WITH RECURSIVE roots AS (
    SELECT category_id FROM public.res_user_category_rel WHERE user_id = _uid
  ),
  tree AS (
    SELECT c.id FROM public.res_partner_category c JOIN roots r ON r.category_id = c.id
    UNION
    SELECT c.id FROM public.res_partner_category c JOIN tree t ON c.parent_id = t.id
  )
  SELECT id FROM tree;
END;
$$;

CREATE OR REPLACE FUNCTION public.can_see_partner(_uid uuid, _partner_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_admin_or_super(_uid) OR EXISTS (
    SELECT 1 FROM public.res_partner_category_rel r
    WHERE r.partner_id = _partner_id
      AND r.category_id IN (SELECT public.visible_category_ids(_uid))
  );
$$;

-- ============================================================
-- RLS POLICIES
-- ============================================================

-- res_partner_category: SELECT visible; mutate by admin/super/coordinator
CREATE POLICY rpc_select ON public.res_partner_category FOR SELECT TO authenticated USING (
  public.is_admin_or_super(auth.uid()) OR id IN (SELECT public.visible_category_ids(auth.uid()))
);
CREATE POLICY rpc_insert ON public.res_partner_category FOR INSERT TO authenticated WITH CHECK (
  public.current_role_name() IN ('admin','superuser','coordinator')
);
CREATE POLICY rpc_update ON public.res_partner_category FOR UPDATE TO authenticated USING (
  public.current_role_name() IN ('admin','superuser','coordinator')
);
CREATE POLICY rpc_delete ON public.res_partner_category FOR DELETE TO authenticated USING (
  public.is_admin_or_super(auth.uid()) AND category_type <> 'system'
);

-- res_city: SELECT to all auth; mutate admin/super/coordinator
CREATE POLICY city_select ON public.res_city FOR SELECT TO authenticated USING (true);
CREATE POLICY city_mod ON public.res_city FOR ALL TO authenticated USING (
  public.current_role_name() IN ('admin','superuser','coordinator')
) WITH CHECK (public.current_role_name() IN ('admin','superuser','coordinator'));

-- res_partner
CREATE POLICY partner_select ON public.res_partner FOR SELECT TO authenticated USING (
  public.can_see_partner(auth.uid(), id)
);
CREATE POLICY partner_insert ON public.res_partner FOR INSERT TO authenticated WITH CHECK (
  public.current_role_name() IS NOT NULL
);
CREATE POLICY partner_update ON public.res_partner FOR UPDATE TO authenticated USING (
  public.can_see_partner(auth.uid(), id)
);
CREATE POLICY partner_delete ON public.res_partner FOR DELETE TO authenticated USING (
  public.current_role_name() IN ('admin','superuser')
);

-- res_partner_category_rel
CREATE POLICY rpcr_select ON public.res_partner_category_rel FOR SELECT TO authenticated USING (
  public.can_see_partner(auth.uid(), partner_id)
);
CREATE POLICY rpcr_mod ON public.res_partner_category_rel FOR ALL TO authenticated USING (
  public.can_see_partner(auth.uid(), partner_id)
) WITH CHECK (public.current_role_name() IS NOT NULL);

-- membership_subscription
CREATE POLICY sub_select ON public.membership_subscription FOR SELECT TO authenticated USING (
  public.can_see_partner(auth.uid(), partner_id)
);
CREATE POLICY sub_mod ON public.membership_subscription FOR ALL TO authenticated USING (
  public.current_role_name() IN ('admin','superuser','coordinator') AND public.can_see_partner(auth.uid(), partner_id)
) WITH CHECK (public.current_role_name() IN ('admin','superuser','coordinator'));

-- privacy_consent
CREATE POLICY consent_select ON public.privacy_consent FOR SELECT TO authenticated USING (
  public.can_see_partner(auth.uid(), partner_id)
);
CREATE POLICY consent_mod ON public.privacy_consent FOR ALL TO authenticated USING (
  public.can_see_partner(auth.uid(), partner_id)
) WITH CHECK (true);

-- res_users
CREATE POLICY users_select ON public.res_users FOR SELECT TO authenticated USING (
  id = auth.uid() OR public.current_role_name() IN ('admin','superuser','coordinator')
);
CREATE POLICY users_insert ON public.res_users FOR INSERT TO authenticated WITH CHECK (
  public.current_role_name() IN ('admin','superuser')
);
CREATE POLICY users_update ON public.res_users FOR UPDATE TO authenticated USING (
  id = auth.uid() OR (public.current_role_name() IN ('admin','superuser') AND role <> 'admin')
);
CREATE POLICY users_delete ON public.res_users FOR DELETE TO authenticated USING (
  public.current_role_name() IN ('admin','superuser') AND role <> 'admin'
);

-- prevent admin role being demoted or another user becoming admin from UI
CREATE OR REPLACE FUNCTION public.protect_admin_users()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.role = 'admin' AND NEW.id <> auth.uid() THEN
      RAISE EXCEPTION 'Admin users cannot be modified from UI';
    END IF;
    IF NEW.role = 'admin' AND OLD.role <> 'admin' THEN
      RAISE EXCEPTION 'Cannot promote to admin from UI';
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.role = 'admin' THEN
      RAISE EXCEPTION 'Admin users cannot be deleted from UI';
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;
CREATE TRIGGER trg_protect_admin
  BEFORE UPDATE OR DELETE ON public.res_users
  FOR EACH ROW EXECUTE FUNCTION public.protect_admin_users();

-- res_user_category_rel
CREATE POLICY rucr_select ON public.res_user_category_rel FOR SELECT TO authenticated USING (
  user_id = auth.uid() OR public.current_role_name() IN ('admin','superuser','coordinator')
);
CREATE POLICY rucr_mod ON public.res_user_category_rel FOR ALL TO authenticated USING (
  public.current_role_name() IN ('admin','superuser','coordinator')
) WITH CHECK (public.current_role_name() IN ('admin','superuser','coordinator'));

-- audit_log: admin only read; any auth can insert (audited via server fns)
CREATE POLICY audit_select ON public.audit_log FOR SELECT TO authenticated USING (
  public.has_role(auth.uid(), 'admin')
);
CREATE POLICY audit_insert ON public.audit_log FOR INSERT TO authenticated WITH CHECK (true);

-- ============================================================
-- handle_new_user
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.res_users (id, name, email, role, status)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'role', 'volunteer'),
    'active'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- SEED CATEGORIES
-- ============================================================
INSERT INTO public.res_partner_category (name, category_type, fiscal_code, address, city, province_code, iban) VALUES
  ('Alessandria','territorial','96069420063','Via Volturno 33','Alessandria','AL',NULL),
  ('Ascoli Piceno','territorial','91055250442','Via C. Colombo 15','Monsampolo del Tronto','AP',NULL),
  ('Catania','territorial','93258780878','Via Cesare Beccaria 94','Catania','CT','IT87T0200816934000107381605'),
  ('Genova','territorial','95253630107','Via O. Cancelliere 6/7','Genova','GE','IT95I0501801400000020000551'),
  ('Napoli','territorial','95354040636','Largo Ss. Apostoli 17','Napoli','NA','IT52S0501803400000020001373'),
  ('Pesaro Urbino','territorial','92067060415','Via Castello Abitato 23','Pesaro Urbino','PU','IT20L0501802600000020000608'),
  ('Ragusa','territorial','92051140884','Via Fucà 1/A','Ragusa','RG','IT89K0503617004CC0041074389'),
  ('Varese','territorial','92041210128','Via San Celso 4','Comerio','VA','IT14P0501810800000020000538'),
  ('Validation','system',NULL,NULL,NULL,NULL,NULL);
