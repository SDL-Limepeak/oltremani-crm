# Stack, commands, conventions

## Commands

| | |
|---|---|
| dev server | `bun run dev` → http://localhost:3000 (talks to **production** Supabase) |
| typecheck | `bunx tsc --noEmit` |
| build | `bun run build` |
| lint | `bun run lint` |
| tests | `bun test` (see [../tests/README.md](../tests/README.md)) |

Package manager is **bun** (`bun.lock`, `bunfig.toml`). `package-lock.json` is gitignored
on purpose — an npm lockfile here is a mistake, not a second option.

## Environment

`.env` (gitignored, present locally) holds only the **anon/publishable** key. There is no
`service_role` key anywhere on disk; see [db/access.md](db/access.md).

```
SUPABASE_URL / VITE_SUPABASE_URL                       https://rbabjbggrqgadcyzplxh.supabase.co
SUPABASE_PUBLISHABLE_KEY / VITE_SUPABASE_PUBLISHABLE_KEY   anon JWT
SUPABASE_PROJECT_ID / VITE_SUPABASE_PROJECT_ID         rbabjbggrqgadcyzplxh
```

`src/integrations/supabase/client.server.ts` exports `supabaseAdmin`. On Lovable it is
wired to a privileged key injected at runtime; **locally it is not privileged**, so server
functions that depend on it (users, cities) behave differently on `bun run dev` than in
production. Expect user creation to fail locally.

## Conventions

- **DB and code in English, UI strings in Italian.** Error messages thrown from server
  functions are user-facing → Italian. Comments → English.
- Server functions live in `src/lib/*.functions.ts`, one file per domain, using
  `createServerFn` + `requireSupabaseAuth` + a zod `inputValidator`.
- Two ways to reach the DB from a server function, and the choice decides who protects you:
  - `context.supabase` — the caller's JWT, **RLS applies**. Default. Prefer it.
  - `supabaseAdmin` — **RLS bypassed**. Then authorization is your job, in TypeScript.
- Routes are file-based under `src/routes/`. `src/routeTree.gen.ts` is generated — never
  edit by hand.
- `src/integrations/supabase/types.ts` is generated **but hand-patched** (see
  [knowissues.md](knowissues.md) KI-08). Re-generating is fine; re-check that patch.
- shadcn components under `src/components/ui/` were pruned from 46 to 17 by transitive
  reachability. The unused 29 are in `.tmp/old/components-ui/`. If Lovable generates UI
  needing one, it will recreate it — or fish it out of the archive.

## Known lint noise

~127 `@typescript-eslint/no-explicit-any` + 9 `react-hooks/exhaustive-deps`. Stylistic,
pervasive, a consequence of how Lovable generates code. Not correctness errors — do not
mass-fix them, the diff would bury real changes.
