# Accesso al database — Oltremani CRM

Ultimo aggiornamento: 2026-07-25

---

## In breve

Il backend è **Lovable Cloud**. Il progetto Supabase sottostante (`rbabjbggrqgadcyzplxh`) sta
nell'organizzazione di Lovable, **non** in quella del cliente. Conseguenza pratica:

- **non esiste** una connection string Postgres accessibile
- **non esiste** una `service_role` key scaricabile dalla dashboard
- il `.env` locale contiene solo la chiave `anon`, e con quella la RLS restituisce
  array vuoti su tutte le tabelle (verificato: `res_city` → 0 righe con anon, 107 righe con accesso reale)
- niente `psql` ⇒ **niente `pg_dump`**: i backup si fanno esportando tabella per tabella via `SELECT`

L'unica via d'accesso è il **Lovable MCP server**, tool `query_database`, che esegue
SQL arbitrario (SELECT, INSERT/UPDATE/DELETE e DDL) **bypassando la RLS**.
`auth.users` è raggiungibile via SQL come qualsiasi altra tabella.

Restano fuori dall'SQL e passano per il tool `send_message` (che **consuma crediti Lovable**):
deploy di edge functions, gestione secrets, contenuto dei bucket Storage.

---

## Identificativi

| Cosa | Valore |
|---|---|
| MCP server | `https://mcp.lovable.dev` |
| Authorization server | `https://lovable.dev/oauth` |
| Workspace Lovable | `rJrXpM4xPYpDAZo7KrAL` — "Diego" (piano biz, owner) |
| **Project ID** (per `query_database`) | `5ee874eb-458d-4ddb-99dd-8259082802de` — `oltremani-crm` |
| Supabase project ref | `rbabjbggrqgadcyzplxh` |

⚠️ Il `project_id` che vuole `query_database` è lo **UUID Lovable**, non il ref Supabase.
Sono due cose diverse e vengono confuse facilmente.

Per scoprire i progetti di un altro workspace: `list_projects` richiede
obbligatoriamente `workspace_id`, quindi prima serve `list_workspaces`.

---

## Setup: due cancelli, non uno

`claude mcp list` distingue i due stati, ed è la prima cosa da guardare quando non funziona.

### Cancello 1 — `⏸ Pending approval`

Il server è definito in un `.mcp.json` di progetto che non è ancora stato approvato.
Non è un problema di credenziali. Si risolve in uno dei due modi:

- `enabledMcpjsonServers: ["lovable"]` in `.claude/settings.local.json` (già fatto in questo repo), **oppure**
- registrare il server a **user scope**, che è la scelta migliore avendo più progetti Lovable:

```
claude mcp add --transport http --scope user lovable https://mcp.lovable.dev
```

A user scope vale per tutti i progetti (`lovable_crumb`, `lovable_gas`, `lovable_hybla`, …)
e funziona da qualsiasi cartella, senza `cd`.

### Cancello 2 — `! Needs authentication`

Manca l'OAuth. Lovable **non offre API key**: dalla loro doc,
*"API key authentication is not currently available. OAuth is the only supported way"*.
Non esiste nessun token statico da mettere in un file.

L'authorization server però espone scope `offline` e grant `refresh_token`:
**l'autenticazione interattiva serve una volta sola**, poi il refresh token si rinnova da sé.

---

## Rifare l'autenticazione a mano

Serve quando `claude mcp list` dice `! Needs authentication`, o dopo una revoca lato Lovable.

**1.** Apri un terminale vero (in VS Code: Terminal → New Terminal). Il pannello di chat
dell'estensione **non** va bene: il suo `/mcp` sa fare solo reconnect/enable/disable.

**2.** Una riga sola. Il path non ha spazi, quindi funziona identica in cmd.exe e in PowerShell,
e non serve fare `cd` (il server è a user scope):

```
C:\Users\podom\.vscode\extensions\anthropic.claude-code-2.1.220-win32-x64\resources\native-binary\claude.exe mcp login lovable
```

> Il numero di versione cambia agli aggiornamenti dell'estensione. Se il path non esiste più:
> `Get-ChildItem "$env:USERPROFILE\.vscode\extensions" -Directory -Filter "anthropic.claude-code-*"`
> e prendi la più recente. Se il CLI è installato globalmente (`npm i -g @anthropic-ai/claude-code`)
> basta `claude mcp login lovable`.

**3.** Si apre il browser su Lovable → **Authorize**. Gli scope richiesti sono
`offline projects:read projects:write projects:create workspaces:read workspaces:write`.

**4.** Conferma nel terminale. Poi in chat: `/mcp reconnect all`.

### Vincoli da conoscere

- Il callback è su `http://localhost:3118/callback` ⇒ **il browser deve girare sulla stessa macchina**.
  Via SSH/remote desktop non funziona: usa `claude mcp login lovable --no-browser`, che stampa
  l'URL e chiede di incollare indietro il redirect.
- Il comando **richiede un TTY**. Lanciato da un processo non interattivo muore con
  `stdin isn't a terminal, so authentication can't be completed here`. Non è automatizzabile: è voluto.
- `/mcp reconnect` **non** ripara un OAuth mai completato — rifà solo la connessione col token esistente.

### Diagnosi rapida

Le credenziali stanno in `~/.claude/.credentials.json`, chiave `mcpOAuth["lovable|<hash>"]`
(l'hash deriva da nome + URL, quindi è lo stesso per user scope e project scope: **una sola auth
copre entrambi**). Cosa guardare:

| Sintomo | Significato |
|---|---|
| `accessToken` = `""` e nessun `refreshToken` | client registrato ma consenso mai completato → rifai il login |
| `refreshToken` presente | tutto ok, il rinnovo è automatico anche se `expiresAt` è passato |
| voce assente del tutto | server mai aggiunto → vedi Cancello 1 |

```powershell
$c = Get-Content "$env:USERPROFILE\.claude\.credentials.json" -Raw | ConvertFrom-Json
$c.mcpOAuth.PSObject.Properties | Where-Object Name -like "lovable*" | ForEach-Object {
  $v = $_.Value
  "accessToken : $(if ($v.accessToken) { 'presente' } else { 'ASSENTE' })"
  "refreshToken: $(if ($v.refreshToken) { 'presente' } else { 'ASSENTE' })"
  "scope       : $($v.scope)"
}
```

C'è anche `~/.claude/mcp-needs-auth-cache.json`, che marca i server da autenticare. Se dopo
un'auth riuscita lo stato resta bloccato, serve un riavvio completo di VS Code.

---

## Regole operative

1. **Prima di ogni scrittura, mostra l'SQL a Diego e aspetta conferma.** `query_database` non ha undo
   e non esiste `pg_dump` per rimediare.
2. **Le migrazioni strutturali passano dall'agent Lovable**, non da `query_database`. Se il DDL lo si
   fa a mano, lo schema divergerà dal changelog di Lovable e l'agent potrà rigenerare sopra le modifiche.
   **Eccezione consapevole:** l'hardening RLS del 2026-07-25 è stato applicato direttamente su
   decisione di Diego, e registrato in `supabase/migrations/202607251*` perché resti tracciato nel
   repo. Lovable non lo conosce ⇒ dopo ogni rigenerazione dello schema rilanciare
   `.claude/rls-tests.sql` per controllare che le policy siano ancora in piedi.
3. Per testare qualcosa in modo distruttivo senza rischi, usa un blocco atomico che si annulla da sé:
   `DO $$ ... RAISE EXCEPTION 'ESITO >>> %', v_risultato; END $$;` — l'eccezione fa il rollback di tutto
   e il messaggio torna comunque a chi ha lanciato la query. Utile per verificare le policy RLS
   impersonando un ruolo con `SET LOCAL ROLE authenticated` + `set_config('request.jwt.claims', ...)`.
4. `query_database` con più statement separati da `;` restituisce **solo il risultato dell'ultimo**.
5. **`CREATE OR REPLACE FUNCTION` non sostituisce nulla se cambi la firma**: crea un *overload*
   accanto alla versione vecchia. Con due versioni in giro PostgREST può risolvere una chiamata
   RPC sulla precedente e la modifica sembra non aver avuto effetto. Dopo ogni cambio di
   parametri fai il `DROP FUNCTION` esplicito della firma vecchia e verifica:
   ```sql
   SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname='public' AND p.proname='<nome>';
   ```
   Capitato per davvero aggiungendo `p_notes` a `submit_public_contact`.
6. Se lanci l'SQL da PowerShell, **non costruire il JSON con `ConvertTo-Json`**: in PS 5.1 una
   stringa lunga multi-riga viene serializzata come `{"value":…,"Count":…}` invece che come
   stringa JSON, e il server risponde `Parse error: Invalid JSON`. Serve un escape manuale.

---

## Via d'uscita (se un giorno serve Supabase diretto)

Diego non vuole pagare Supabase separatamente. Se in futuro servisse il controllo pieno
(connection string, `pg_dump`, service_role): Supabase piano Free + exit ufficiale da Lovable Cloud,
da *Cloud → Overview → Advanced settings*.
