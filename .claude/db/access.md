# DB access

## The one-line version

The only way in is the **Lovable MCP tool `query_database`**, which runs arbitrary SQL
(SELECT, DML, DDL) **bypassing RLS**, including on `auth.users`.

## Why there is nothing else

The backend is Lovable Cloud. The Supabase project (`rbabjbggrqgadcyzplxh`) belongs to
*Lovable's* organisation, not the customer's. So:

- no Postgres connection string
- no downloadable `service_role` key
- `.env` has only the `anon` key, and under RLS that returns empty arrays on every table
  (verified: `res_city` → 0 rows as anon, 107 with real access)
- no `psql` ⇒ **no `pg_dump`**. Backups are `SELECT`-by-table. Latest:
  `.tmp/oltremani-db-backup-2026-08-06.zip`

Out of SQL reach and requiring `send_message` (which **spends Lovable credits**): edge
function deploys, secrets management, Storage bucket contents.

Diego does not want to pay for Supabase separately. If full control is ever needed
(connection string, `pg_dump`, service_role): Supabase Free plan + the official exit from
Lovable Cloud, under *Cloud → Overview → Advanced settings*.

## IDs

| | |
|---|---|
| MCP server | `https://mcp.lovable.dev` (OAuth at `https://lovable.dev/oauth`) |
| Workspace | `rJrXpM4xPYpDAZo7KrAL` — "Diego" (biz plan, owner) |
| **`project_id` for `query_database`** | `5ee874eb-458d-4ddb-99dd-8259082802de` |
| Supabase ref | `rbabjbggrqgadcyzplxh` |

⚠️ `query_database` wants the **Lovable UUID**, not the Supabase ref.
`list_projects` requires `workspace_id`, so `list_workspaces` comes first.

## When the MCP is not connected

`claude mcp list` distinguishes two different failures.

**`⏸ Pending approval`** — the server is declared in a project `.mcp.json` that was never
approved. Not a credentials problem. Either `enabledMcpjsonServers: ["lovable"]` in
`.claude/settings.local.json` (already done here), or register it at user scope, which is
better when you have several Lovable projects:

```
claude mcp add --transport http --scope user lovable https://mcp.lovable.dev
```

**`! Needs authentication`** — OAuth missing. Lovable offers **no API key**; OAuth is the
only mechanism, and there is no static token to drop in a file. The authorization server
does expose `offline` scope and `refresh_token`, so **you log in once** and it renews itself.

Re-authenticating, from a **real terminal** (the extension's chat `/mcp` only does
reconnect/enable/disable):

```
C:\Users\podom\.vscode\extensions\anthropic.claude-code-<ver>-win32-x64\resources\native-binary\claude.exe mcp login lovable
```

Find the current version with
`Get-ChildItem "$env:USERPROFILE\.vscode\extensions" -Directory -Filter "anthropic.claude-code-*"`.
With a global CLI install it is just `claude mcp login lovable`. Then `/mcp reconnect all`.

Constraints: the callback is `http://localhost:3118/callback`, so the browser must be on
the same machine (`--no-browser` otherwise); the command **requires a TTY** and is
deliberately not automatable; `/mcp reconnect` cannot repair an OAuth that was never
completed.

Credentials live in `~/.claude/.credentials.json` under `mcpOAuth["lovable|<hash>"]`. The
hash derives from name + URL, so **one login covers both user and project scope**.
`refreshToken` present ⇒ fine even if `expiresAt` has passed. `accessToken: ""` and no
refresh token ⇒ consent never completed. Entry missing ⇒ server never added.
`~/.claude/mcp-needs-auth-cache.json` can stay stale after a successful login; a full
VS Code restart clears it.

## Operating rules, learned the hard way

1. **Show the SQL before writing.** No undo, no `pg_dump`.
2. **Structural migrations should go through the Lovable agent**, not `query_database` —
   otherwise the schema diverges from Lovable's changelog and a regeneration can overwrite
   it. Conscious exception: the 2026-07-25 hardening, applied directly on Diego's decision
   and recorded in `supabase/migrations/` so the repo keeps the trace. See
   [migrations.md](migrations.md).
3. **To test something destructive safely**, use a self-cancelling block:
   `DO $$ ... RAISE EXCEPTION 'RESULT >>> %', v; END $$;` — the exception rolls everything
   back and the message still reaches the caller. Combine with
   `SET LOCAL ROLE authenticated` + `set_config('request.jwt.claims', ...)` to impersonate.
4. **Multiple statements separated by `;` return only the last result.**
5. **`CREATE OR REPLACE FUNCTION` does not replace anything if the signature changed** — it
   creates an *overload* next to the old version, and PostgREST may resolve an RPC call to
   the old one, so your change looks inert. After any parameter change, `DROP FUNCTION` the
   old signature explicitly and verify:
   ```sql
   SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='<name>';
   ```
   This actually happened when `p_notes` was added to `submit_public_contact`.
6. From PowerShell, **do not build the JSON with `ConvertTo-Json`**: in PS 5.1 a long
   multi-line string serialises as `{"value":…,"Count":…}` and the server answers
   `Parse error: Invalid JSON`. Escape manually.
7. `CREATE OR REPLACE FUNCTION` **preserves the existing ACL**, and every new function is
   born with `EXECUTE` granted to `PUBLIC`. Consequence:
   `REVOKE EXECUTE … FROM anon` does nothing while PUBLIC still holds it. Always
   `REVOKE EXECUTE ON FUNCTION … FROM PUBLIC` first, then grant explicitly. This is the
   root cause of [../knowissues.md](../knowissues.md) KI-01.
