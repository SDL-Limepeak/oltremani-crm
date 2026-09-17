# Oltremani CRM — KB index

Read this file first, then load **only** the leaves you need. Leaves are self-contained
and do not repeat each other. Everything here is written in English; the product UI is
Italian and stays Italian.

Updated 2026-09-17 · verified against the live DB. The 2026-09-17 application code is
**not committed and not published** — see "Current state" below.

## Router — task → file

| If you are about to… | Read |
|---|---|
| anything, first time in a session | this file |
| query/modify the DB | [db/access.md](db/access.md) |
| reason about tables, columns, constraints | [db/schema.md](db/schema.md) |
| reason about who can see/do what | [db/rls.md](db/rls.md) |
| touch `supabase/migrations/` | [db/migrations.md](db/migrations.md) |
| find where code lives | [app/map.md](app/map.md) |
| touch the public form / auth flow | [app/flows.md](app/flows.md) |
| write or run tests | [../tests/README.md](../tests/README.md) |
| need the test accounts and what they should see | `../tests/UTENTI-DI-TEST.md` (not versioned) |
| write UI | [ui/branding.md](ui/branding.md) |
| change anything user-visible before go-live | [ops/demo-noindex.md](ops/demo-noindex.md) |
| wonder "is this a known bug?" | [knowissues.md](knowissues.md) |
| wonder "did we do what the client asked?" | [client-feedback.md](client-feedback.md) |
| wonder "why is it like this?" | [history.md](history.md) |

## Fixed facts

| | |
|---|---|
| Product | internal CRM + membership backend for oltremani.it (Italian social association) |
| Stack | TanStack Start (React 19, Vite 8) · Tailwind v4 · shadcn · nitro → Cloudflare |
| Backend | Lovable Cloud = Supabase, Postgres 17.6, project ref `rbabjbggrqgadcyzplxh` |
| Lovable project id | `5ee874eb-458d-4ddb-99dd-8259082802de` (**≠** Supabase ref — easy to confuse) |
| Repo | `github.com/SDL-Limepeak/oltremani-crm`, branch `main` |
| Live | https://oltremani-crm.lovable.app · preview https://id-preview--5ee874eb-458d-4ddb-99dd-8259082802de.lovable.app |
| Phase | **demo**, not public. Endpoint open, noindex everywhere |
| Language | UI Italian · code, comments, KB, commits English |

## Hard rules

1. **Never rewrite pushed git history.** Lovable syncs the branch; force-push destroys the
   user's project history on their side (`AGENTS.md`).
2. **Show the SQL and wait before any DB write.** `query_database` has no undo and there is
   no `pg_dump` to fall back on. Exception: the user explicitly authorised the change.
3. **`supabaseAdmin` bypasses RLS.** Any server function that uses it must carry its own
   authorization checks, written by hand. `cities.functions.ts` is the model.
4. **Never run `prettier --write` on the repo.** The `Delete ␍` errors are a Windows
   working-tree artifact; git stores LF (`.gitattributes`).
5. After an agent regenerates the schema, **re-run `bun test`** — the 2026-07-25 migrations
   are not in Lovable's changelog and can be silently overwritten.

## Current state — 2026-09-17

- ⚠️ **The database is ahead of the published application.** The 2026-09-17 client changes
  were applied to production Postgres directly (with the client's go-ahead) while the
  matching application code sits uncommitted in the working tree. Until it is committed,
  pushed and published, the live app at https://oltremani-crm.lovable.app is the 2026-08-06
  build talking to the 2026-09-17 schema. That combination mostly works — the app reads the
  role picklist from the table, so the new names already show — but "Tipo" is still on
  screen, there is no Tesserato column, and the export is still admin-only and ten columns
  wide. Check the published commit with `mcp__lovable__get_project.latest_commit_sha`.
- 11 tables, 30 RLS policies, 16 functions, 12 triggers, 1 pg_cron job. `tsc` clean,
  `bun test` 119/119 across nine files (with the dev server up, so the HTTP suites run).
- **Contacts have no perimeter**: every active user reads and writes every contact.
  User management is a strict profile hierarchy. Both are new on 2026-09-17 and both
  invert what earlier docs and tests said — [db/rls.md](db/rls.md).
- Client feedback: the 2026-07-25 round is closed; the 2026-09-17 round is built but
  unpublished — [client-feedback.md](client-feedback.md).
- Row counts: partner 8 · category 10 · city 107 · role 5 · users 2 (+5 test) · sub 8 ·
  consent 35 · audit ~200 (the suite appends `inbound_form` rows it cannot delete).
- All eleven migrations applied. See [db/migrations.md](db/migrations.md).
- **No known authorization holes.** Twelve of fifteen findings closed on 2026-08-06; the
  three left are a maintenance note (KI-08), a hosting limitation (KI-12) and an open
  product decision (KI-14, the public endpoint). [knowissues.md](knowissues.md).
