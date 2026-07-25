-- Crea 4 utenti di test, uno per ruolo. Da rimuovere con e2e_teardown.sql.
-- handle_new_user() legge raw_user_meta_data->>'role', quindi il ruolo si imposta qui.
DO $$
DECLARE
  v_cat_varese uuid;
  v_pwd text := 'E2eTest!Passw0rd-2026';
  r record;
BEGIN
  SELECT id INTO v_cat_varese FROM res_partner_category WHERE name = 'Varese';

  FOR r IN
    SELECT * FROM (VALUES
      ('e2e-admin@local.invalid',       'E2E Admin',       'admin'),
      ('e2e-superuser@local.invalid',   'E2E Superuser',   'superuser'),
      ('e2e-coordinator@local.invalid', 'E2E Coordinator', 'coordinator'),
      ('e2e-volunteer@local.invalid',   'E2E Volunteer',   'volunteer')
    ) AS t(email, name, role)
  LOOP
    INSERT INTO auth.users (
      id, instance_id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data
    ) VALUES (
      gen_random_uuid(), '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated', r.email,
      extensions.crypt(v_pwd, extensions.gen_salt('bf')),
      now(), now(), now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('name', r.name, 'role', r.role)
    );
  END LOOP;

  -- Coordinatore e volontario hanno bisogno di un perimetro, altrimenti non vedono nulla
  INSERT INTO res_user_category_rel (user_id, category_id)
  SELECT u.id, v_cat_varese FROM res_users u
   WHERE u.email IN ('e2e-coordinator@local.invalid', 'e2e-volunteer@local.invalid');
END $$;

SELECT u.email, u.role, u.status,
       (SELECT count(*) FROM res_user_category_rel r WHERE r.user_id = u.id) AS gruppi,
       (SELECT count(*) FROM auth.users a WHERE a.id = u.id AND a.email_confirmed_at IS NOT NULL) AS auth_ok
  FROM res_users u
 WHERE u.email LIKE 'e2e-%@local.invalid'
 ORDER BY u.role;
