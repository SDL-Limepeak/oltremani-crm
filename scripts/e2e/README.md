# Test end-to-end dei permessi

Verifica che ogni ruolo possa fare esattamente ciò che deve, e nient'altro. Fa login
davvero, con quattro utenti reali creati per l'occasione, e chiama PostgREST col JWT di
ciascuno: lo stesso percorso che l'app usa tramite `context.supabase`.

**Quando rilanciarlo:** dopo ogni modifica alle policy RLS, ai trigger o alle server
function, e in particolare **dopo che l'agent Lovable ha rigenerato lo schema**. Le
migrazioni in `supabase/migrations/202607251*` sono state applicate direttamente via
`query_database` e Lovable non le ha nel suo changelog: potrebbe sovrascriverle senza
accorgersene.

## Come si usa

Serve il Lovable MCP autenticato — vedi `.claude/db-access.md`.

```powershell
cd scripts\e2e
.\lq.ps1 -SqlFile setup.sql      # crea i 4 utenti, uno per ruolo
.\matrix.ps1                     # esegue la matrice
.\lq.ps1 -SqlFile teardown.sql   # rimuove tutto
```

`teardown.sql` stampa i conteggi delle tabelle: **devono coincidere con quelli di prima
del setup.** Se non coincidono, qualcosa è rimasto e va rimosso a mano.

Ultima esecuzione pulita: 2026-07-25, **63 controlli su 63 conformi**.

## Cosa copre

Per ognuno dei quattro ruoli (admin, superuser, coordinator, volunteer), 16 controlli:
lettura contatti e perimetro di visibilità, creazione contatto con `RETURNING`,
assegnazione categorie, tentativi di scalata di privilegio (rendersi visibile un contatto
estraneo, cambiarsi il ruolo), modifica del proprio profilo e di quello altrui, accesso
all'audit log, creazione categorie, tesseramenti, consensi privacy propri ed estranei,
anagrafica città, modifica e cancellazione di contatti fuori perimetro.

## Trappole che questo harness evita

Le ha trovate tutte una versione precedente, sbagliando. Sono la ragione per cui vale
la pena tenerlo in repo invece di riscriverlo ogni volta.

1. **PostgREST risponde `204` a un `DELETE` o `PATCH` anche quando la RLS filtra tutte le
   righe** e quindi non ne tocca nessuna. Guardando solo lo status, un permesso negato
   sembra concesso. L'harness chiede `Prefer: return=representation` e conta le righe
   nel corpo: `Effect()` considera permesso solo ciò che ha toccato almeno una riga.
2. **Contare le righe con `@($json | ConvertFrom-Json).Count` non è affidabile** in
   PowerShell 5.1. `CountRows()` controlla prima se il corpo è `[]`.
3. **Stato condiviso fra ruoli.** Una insert identica già fatta da un ruolo precedente fa
   fallire quella successiva con `409` per chiave duplicata, che non è un diniego di
   permesso. Ogni ruolo ha quindi il proprio contatto bersaglio e la propria categoria.
4. **Gli utenti creati a mano in `auth.users` non riescono a fare login**: GoTrue
   restituisce `500`. Le colonne dei token (`confirmation_token`, `recovery_token`,
   `email_change`, …) devono essere **stringa vuota, non NULL** — il parser Go va in
   errore sui NULL. `setup.sql` le valorizza.
5. **Per l'admin non esiste una scalata**, essendo il ruolo più alto: la prova sensata è
   la *retrocessione*, che deve essere impedita perché non è reversibile dall'app.

## Se un admin resta chiuso fuori

Perdere il ruolo `admin` non è reversibile dall'applicazione: il trigger
`protect_admin_users` impedisce qualsiasi promozione ad admin, e il trigger scatta anche
per una sessione privilegiata. Procedura d'emergenza:

```sql
ALTER TABLE res_users DISABLE TRIGGER trg_protect_admin;
UPDATE res_users SET role = 'admin' WHERE email = '<email>';
ALTER TABLE res_users ENABLE TRIGGER trg_protect_admin;
```

## Cosa NON copre

I controlli di autorizzazione scritti in TypeScript dentro `users.functions.ts` e
`cities.functions.ts`, che girano con `supabaseAdmin` e quindi scavalcano la RLS. Quelli
sono verificati per lettura del codice, non per esecuzione: per provarli servirebbe
chiamare le server function di TanStack via HTTP. Sono il punto più delicato del
progetto, perché lì la RLS non protegge nulla — vedi la nota in
`.claude/architecture.md`.
