# Test suite

```
bun test                        # everything
bun test tests/rls-matrix       # one file
bun run dev                     # needed only by public-form.test.ts — serves on :8080
```

> ⚠️ **These tests run against the production database.** There is no staging environment:
> the Supabase project lives inside Lovable's org and cannot be cloned
> ([../.claude/db/access.md](../.claude/db/access.md)). Every test cleans up after itself,
> every write is tagged `AUTOTEST` or `*-PROBE`, and `afterAll` sweeps leftovers. Take a
> backup before changing a test that writes.
>
> **One thing cannot be cleaned up: `audit_log`.** It is append-only by RESTRICTIVE policy,
> so each `public-form.test.ts` run permanently adds ~4 rows whose `record_id` points at a
> contact the suite then deleted. That is the audit log behaving correctly, not a leak.
> Filter them out with `new_values_json->>'email' LIKE 'autotest-%'`.

## What is here

| File | Covers |
|---|---|
| `rls-matrix.test.ts` | the permission matrix: what each of the four roles can see and do |
| `regressions.test.ts` | one test per entry in [knowissues.md](../.claude/knowissues.md), plus the 2026-07-25 hardening |
| `roles-and-membership.test.ts` | client feedback 7 and 10: the role picklist and its RLS, and all four membership-claim branches over real HTTP |
| `selections.test.ts` | the partner_type codes are frozen and the labels say what the client confirmed; cross-checked against the live CHECK constraints |
| `partner-filters.test.ts` | pure unit tests for the contact filters (KI-05) and the triage predicate (KI-15) — no database |
| `public-form.test.ts` | the unauthenticated endpoint, HTTP → route → RPC → DB. Skips itself if no server answers |
| `helpers/pgrest.ts` | PostgREST driver. **Use it; do not hand-roll fetches** — see the trap below |
| `helpers/env.ts` | `.env` + credentials + the fixture UUIDs |

Two files here are **gitignored** because they hold working passwords for accounts on the
production database, so a fresh clone will not have them:

- `credentials.json` — machine-readable, the suite refuses to start without it. Template in
  `credentials.example.json`, accounts recreated with the SQL further down.
- `UTENTI-DI-TEST.md` — the human version: who logs in, what each role should see, what to
  click. Written in Italian because it is handed to the client. Regenerate it from the
  account table below if it goes missing.

Tests go through **PostgREST with a real JWT**, not through the app's server functions.
That is on purpose: PostgREST is publicly reachable, so anything RLS permits, a user can
do with curl. The TypeScript checks in `src/lib/*.functions.ts` are not a boundary for
anything routed through `context.supabase` — and that is exactly how KI-02 is exploited.

**Not covered:** the hand-written authorization inside `users.functions.ts` and
`cities.functions.ts`. Those run on `supabaseAdmin`, bypass RLS entirely, and are only
reachable through TanStack server-function calls over HTTP with a session. They are the
most delicate code in the project, and today they are verified by reading, not by running.

## The trap that invalidates naive tests

**PostgREST answers `204` to a PATCH or DELETE that RLS filtered down to zero rows.**
Status code alone cannot distinguish a denial from a success, so a test that only checks
`res.ok` will report permissions that do not exist. This produced one false-positive
finding before it was caught (knowissues KI-04).

Every write helper therefore sends `Prefer: return=representation`, and assertions go
through `didAffectRows()`, which requires 2xx **and** at least one returned row. The one
exception is `insertBlind()`, which exists specifically to reproduce KI-03.

Three more, inherited from the PowerShell harness this replaced:

- **Shared state between roles.** An identical insert already made by an earlier role fails
  with `409 duplicate key`, which is not a permission denial. Every write is uniquely
  stamped with `Date.now()`.
- **Users created by hand in `auth.users` cannot log in.** GoTrue returns 500 if the token
  columns (`confirmation_token`, `recovery_token`, `email_change`, …) are NULL instead of
  empty strings — its Go parser chokes on NULL. The setup SQL below sets them.
- **For an admin there is no escalation to test**, it is the top role. The meaningful test
  is *demotion*, which must be refused because it is not reversible from the app.

## Test accounts

Five persistent accounts, one per case. Credentials in `credentials.json`
(**gitignored**; template in `credentials.example.json`). They are real accounts on the
production Supabase — the same logins work in the deployed app and in the local dev server.

| Profile | Role | Perimeter | Why it exists |
|---|---|---|---|
| `test-admin@oltremani.test` | admin | all | the only role that can read `audit_log` |
| `test-superuser@oltremani.test` | superuser | all | sees every contact but **not** the audit log |
| `test-coordinator@oltremani.test` | coordinator | Varese | the tier where KI-02 and KI-03 live |
| `test-volunteer@oltremani.test` | volunteer | Varese | scoped, read-mostly |
| `test-noscope@oltremani.test` | volunteer | *none* | must see zero contacts |

### Recreating them

Run through the Lovable MCP `query_database` ([../.claude/db/access.md](../.claude/db/access.md)),
then copy the printed UUIDs into `credentials.json`.

```sql
DO $$
DECLARE v_pwd text := '<password>'; v_varese uuid; r record;
BEGIN
  SELECT id INTO v_varese FROM res_partner_category WHERE name = 'Varese';
  FOR r IN SELECT * FROM (VALUES
      ('test-admin@oltremani.test',       'TEST Admin',                   'admin'),
      ('test-superuser@oltremani.test',   'TEST Superuser',               'superuser'),
      ('test-coordinator@oltremani.test', 'TEST Coordinatore Varese',     'coordinator'),
      ('test-volunteer@oltremani.test',   'TEST Volontario Varese',       'volunteer'),
      ('test-noscope@oltremani.test',     'TEST Volontario senza gruppi', 'volunteer')
    ) AS t(email, name, role)
  LOOP
    INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
                            email_confirmed_at, created_at, updated_at,
                            raw_app_meta_data, raw_user_meta_data)
    VALUES (gen_random_uuid(), '00000000-0000-0000-0000-000000000000',
            'authenticated', 'authenticated', r.email,
            extensions.crypt(v_pwd, extensions.gen_salt('bf')), now(), now(), now(),
            '{"provider":"email","providers":["email"]}'::jsonb,
            jsonb_build_object('name', r.name, 'role', r.role));
  END LOOP;

  -- handle_new_user has created the res_users rows; now give two of them a perimeter.
  INSERT INTO res_user_category_rel (user_id, category_id)
  SELECT u.id, v_varese FROM res_users u
   WHERE u.email IN ('test-coordinator@oltremani.test', 'test-volunteer@oltremani.test');

  -- Without this every login returns 500. See the trap list above.
  UPDATE auth.users SET
    confirmation_token = coalesce(confirmation_token,''),
    recovery_token = coalesce(recovery_token,''),
    email_change = coalesce(email_change,''),
    email_change_token_new = coalesce(email_change_token_new,''),
    email_change_token_current = coalesce(email_change_token_current,''),
    phone_change = coalesce(phone_change,''),
    phone_change_token = coalesce(phone_change_token,''),
    reauthentication_token = coalesce(reauthentication_token,'')
  WHERE email LIKE 'test-%@oltremani.test';
END $$;

SELECT u.id, u.email, u.role,
       (SELECT count(*) FROM res_user_category_rel r WHERE r.user_id = u.id) AS groups
  FROM res_users u WHERE u.email LIKE 'test-%@oltremani.test' ORDER BY u.email;
```

### Removing them

```sql
DELETE FROM auth.users WHERE email LIKE 'test-%@oltremani.test';
DELETE FROM res_users  WHERE email LIKE 'test-%@oltremani.test';  -- no FK, so both
```

Deleting `test-admin` needs the trigger disabled — `protect_admin_users` refuses to delete
an admin row, privileged session included:

```sql
ALTER TABLE res_users DISABLE TRIGGER trg_protect_admin;
-- ... delete ...
ALTER TABLE res_users ENABLE TRIGGER trg_protect_admin;
```

## Reading the results

Every security assertion is paired with a **positive** one: the test that proves a
coordinator cannot self-grant a group sits next to the test that proves it can still assign
a group it does hold. A policy that denied everything would satisfy the first and break the
product, so neither is meaningful alone.

**Re-run the whole suite after the Lovable agent regenerates the schema.** The 2026-07-25
and 2026-08-06 migrations are not in Lovable's changelog and can be overwritten without
warning — `regressions.test.ts` is the fastest way to find out that they were.

## Coverage, honestly

Covered: everything RLS and PostgREST enforce, the public endpoint end to end, and the pure
filter/triage logic.

**Not covered:** the hand-written authorization inside `users.functions.ts` and
`cities.functions.ts`, and the fixes to `upsertSubscription`, `upsertUser`,
`getDashboardStats` and the delete-audit paths. Those run inside TanStack server functions,
reachable only at a build-hashed `/_serverFn/<id>` URL, so there is no stable endpoint to
call. They are verified by typecheck and by reading — which is exactly the weaker guarantee
that let KI-09 and KI-11 sit unnoticed. Anything genuinely security-relevant belongs in a
policy or a trigger, where this suite can reach it.
