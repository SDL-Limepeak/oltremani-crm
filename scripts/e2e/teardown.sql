-- Rimuove tutto cio' che i test end-to-end hanno creato.
-- Il trigger va disabilitato: protegge le righe admin anche da questa sessione,
-- ed e' proprio la protezione che stiamo verificando.
ALTER TABLE res_users DISABLE TRIGGER trg_protect_admin;

DELETE FROM res_user_category_rel
 WHERE user_id IN (SELECT id FROM res_users WHERE email LIKE 'e2e-%@local.invalid');

DELETE FROM res_partner_category_rel
 WHERE partner_id IN (SELECT id FROM res_partner WHERE email LIKE '%e2e%@local.invalid');
DELETE FROM privacy_consent
 WHERE partner_id IN (SELECT id FROM res_partner WHERE email LIKE '%e2e%@local.invalid');
DELETE FROM membership_subscription
 WHERE partner_id IN (SELECT id FROM res_partner WHERE email LIKE '%e2e%@local.invalid');
DELETE FROM res_partner WHERE email LIKE '%e2e%@local.invalid';

DELETE FROM audit_log
 WHERE source IN ('e2e', 'export')
   AND (changed_by_user_id IN (SELECT id FROM res_users WHERE email LIKE 'e2e-%@local.invalid')
        OR new_values_json::text LIKE '%e2e%@local.invalid%');
DELETE FROM audit_log
 WHERE new_values_json::text LIKE '%e2e%@local.invalid%';

DELETE FROM res_users   WHERE email LIKE 'e2e-%@local.invalid';
DELETE FROM auth.users  WHERE email LIKE 'e2e-%@local.invalid';

-- Categorie e citta create dai test
DELETE FROM res_partner_category WHERE name LIKE 'E2E %';
DELETE FROM res_city WHERE name LIKE 'E2E city%' OR province_code = 'ZZ';

ALTER TABLE res_users ENABLE TRIGGER trg_protect_admin;

SELECT (SELECT count(*) FROM res_users)                                    AS utenti,
       (SELECT count(*) FROM auth.users)                                   AS auth_users,
       (SELECT count(*) FROM res_partner)                                  AS partner,
       (SELECT count(*) FROM privacy_consent)                              AS consensi,
       (SELECT count(*) FROM res_partner_category)                         AS categorie,
       (SELECT count(*) FROM res_partner_category_rel)                     AS rel,
       (SELECT count(*) FROM membership_subscription)                      AS tessere,
       (SELECT count(*) FROM audit_log)                                    AS audit,
       (SELECT count(*) FROM res_users WHERE email LIKE '%local.invalid')  AS residui;
