# Oltremani CRM — stato reale del sistema

Ultimo aggiornamento: 2026-07-25 — ricavato leggendo il DB in produzione, non dal piano.

Il piano di build originale è in [`.lovable/plan.md`](../.lovable/plan.md). Questo documento
descrive **com'è realmente**, incluse le divergenze dal piano. Dove i due si contraddicono,
vale questo.

---

## Stack

TanStack Start (React 19, Vite 8) + Tailwind v4 + shadcn. Deploy su Cloudflare via nitro.
Backend Lovable Cloud (Supabase, Postgres 17.6). UI in italiano, codice e DB in inglese.

Per accedere al DB: [`db-access.md`](db-access.md). Brand e UI: [`branding.md`](branding.md).

---

## Schema — 9 tabelle in `public`

RLS **attiva su tutte** (nessuna con `FORCE`). Consistenza dati verificata: nessun orfano,
nessuna email duplicata, nessun partner senza categoria.

| Tabella | Righe (2026-07-25) | Note |
|---|---:|---|
| `res_partner` | 3 | contatti/soci. `status`: `new\|active\|rejected\|old`. `partner_type` default `individual` |
| `res_partner_category` | 10 | 9 territoriali + 1 `system` (`Validation`). Self-FK `parent_id` per gerarchia |
| `res_partner_category_rel` | 3 | M:N partner↔categoria. PK composta |
| `res_city` | 107 | ⚠️ vedi *Divergenze* |
| `res_users` | 2 | utenti app. `id` = `auth.users.id`, **senza FK** |
| `res_user_category_rel` | 0 | ⚠️ vedi *Divergenze* |
| `membership_subscription` | 5 | `status`: `active\|inactive\|revoked` |
| `privacy_consent` | 11 | `consent_type`: `privacy_policy\|marketing\|newsletter` |
| `audit_log` | 66 | log unico. `log_type` e `action` con CHECK |

Utenti attuali: `diego@limepeak.it` (admin), `dario.carpini@gmail.com` (superuser).

### Vincoli notevoli

- `res_partner.email` UNIQUE — ma **case-sensitive**. Esiste anche un indice funzionale
  `idx_partner_email` su `lower(email)`, che però **non** è unique: non protegge dai doppioni di case.
- `membership_subscription`: unique **parziale** `idx_sub_partner_year_active` su `(partner_id, year)
  WHERE status='active'`. Non c'è la `UNIQUE(partner_id, year)` piena che il piano prevedeva — ed è
  meglio così: permette lo storico di righe `inactive`/`revoked` impedendo due tessere attive nello stesso anno.
- `res_city`: UNIQUE `(name, province_code)`.
- `res_partner.partner_type`: **nessun CHECK**, pur avendo la UI tre valori
  (`activist`, `citizen`, `individual`). Qualsiasi stringa passa.

---

## Sicurezza — helper e RLS

Sette funzioni `SECURITY DEFINER`, tutte con `search_path=public` impostato (verificato).

| Funzione | Cosa fa |
|---|---|
| `current_role_name()` | ruolo dell'utente corrente, **solo se `status='active'`** |
| `has_role(uid, role)` | ha quel ruolo ed è attivo |
| `is_admin_or_super(uid)` | admin o superuser attivo |
| `visible_category_ids(uid)` | categorie assegnate **+ tutti i discendenti** (CTE ricorsiva). Admin/superuser → tutte |
| `can_see_partner(uid, pid)` | admin/superuser, oppure il partner ha una categoria ∈ `visible_category_ids` |
| `generate_membership_number(year)` | numero tessera |
| `submit_public_contact(...)` | ingresso del form pubblico, vedi sotto |

La visibilità dei contatti è **interamente derivata dalle categorie**: un partner senza nessuna
riga in `res_partner_category_rel` è invisibile a chiunque non sia admin/superuser. Per questo
`submit_public_contact` assegna sempre almeno `Validation`.

### Trigger

`set_updated_at` su 4 tabelle · `sub_default_end_date` su `membership_subscription` ·
`protect_admin_users` su `res_users` (blocca modifica/cancellazione di righe admin e la
promozione ad admin) · `handle_new_user` su `auth.users` AFTER INSERT → crea la riga `res_users`
con ruolo da `raw_user_meta_data->>'role'`, default `volunteer`.

### Buchi RLS — trovati e chiusi il 2026-07-25

Tutti verificati empiricamente sul DB reale, in transazioni annullate, e ri-verificati dopo
la correzione. Le prove sono in `.claude/rls-tests.sql`: **rilanciarle dopo ogni rigenerazione
dello schema da parte dell'agent Lovable**, perché le migrazioni sono state applicate
direttamente via `query_database` e Lovable non le ha nel suo changelog.

| # | Problema | Stato | Migrazione |
|---|---|---|---|
| 1 | Un volontario poteva portarsi a `superuser` da solo (`users_update` ammette `id = auth.uid()`, nessun `WITH CHECK`, e il trigger bloccava solo `admin`) | chiuso | `20260725120000` |
| 2 | Chiunque autenticato poteva inserire una coppia `(partner_id, category_id)` arbitraria e rendersi visibile un contatto precluso | chiuso | `20260725120000` |
| 3 | `consent_mod` con `WITH CHECK (true)`: consensi GDPR falsificabili per qualsiasi partner | chiuso | `20260725120000` |
| 4 | `audit_insert` con `WITH CHECK (true)`: audit trail scrivibile a nome di altri | chiuso | `20260725120000` |
| 5 | `partner_type` senza CHECK | chiuso | `20260725120000` |
| 6 | `email` UNIQUE ma case-sensitive: `Mario@x.it` e `mario@x.it` creavano due partner | chiuso | `20260725120000` |

Radice comune di 1–4: policy `FOR ALL` / `UPDATE` con `USING` corretto ma `WITH CHECK` assente o
troppo permissivo. In Postgres `USING` filtra le righe **esistenti**, `WITH CHECK` valida quelle
**nuove o modificate**: senza il secondo, la riga può essere spostata fuori dal perimetro.
Per confrontare OLD e NEW (caso 1) una policy non basta: serve un trigger.

### Verifica end-to-end dei permessi — 2026-07-25, 63/63

`scripts/e2e/` contiene un harness ripetibile: crea quattro utenti reali, uno per ruolo,
fa login davvero e chiama PostgREST col JWT di ciascuno — lo stesso percorso dell'app.
16 controlli per ruolo. **Rilanciarlo dopo ogni rigenerazione dello schema da parte di
Lovable**, e leggere il README: documenta cinque trappole che falsavano i risultati,
la più insidiosa delle quali è che PostgREST risponde `204` a un `DELETE` che la RLS ha
svuotato, facendo passare un diniego per un permesso.

Ha fatto emergere due bug che la sola lettura del codice non aveva trovato, entrambi
corretti:

**Un admin poteva retrocedersi, senza ritorno.** `protect_admin_users` proteggeva le
righe admin solo se `NEW.id <> auth.uid()`, quindi un admin che modificava il *proprio*
profilo poteva togliersi il ruolo — e la regola successiva, "Cannot promote to admin from
UI", rendeva la cosa irreversibile. Riprodotto per davvero: per rimettere a posto l'utente
di test è servito disabilitare il trigger da una sessione privilegiata, perché il trigger
scatta anche per `query_database`. Con `diego@limepeak.it` unico admin, e l'audit log
leggibile solo dagli admin, un salvataggio sbagliato sul proprio profilo l'avrebbe chiuso
fuori per sempre. Migrazione `20260725170000`; procedura d'emergenza nel README dell'harness.

**Un coordinatore non riusciva a creare gruppi.** Stessa radice del bug `INSERT ...
RETURNING` qui sotto, ma su `res_partner_category`: `upsertCategory` fa
`.insert().select()`, e `rpc_select` mostrava a un non-elevato solo le categorie già nel
suo perimetro — una categoria appena creata non è nel perimetro di nessuno, quindi la
rilettura veniva rifiutata e l'insert falliva con 403. Era rotto rispetto al piano, che
assegna ai coordinatori la gestione delle categorie. Migrazioni `20260725180000`
(colonna `created_by` + policy) e `20260725190000`.

Quest'ultima merita una nota: far dipendere la policy da `created_by` funziona ma è
fragile, perché richiede che *ogni* percorso di insert si ricordi di valorizzare la
colonna. Un trigger `BEFORE INSERT` la riempie da `auth.uid()` quando è vuota, su
`res_partner` e `res_partner_category`, così nessuno può dimenticarsene.

### Bug pre-esistente emerso testando le patch: `INSERT ... RETURNING`

Non causato dalle migrazioni sopra, ma trovato grazie ai loro test di regressione, e **grave**:
nessun utente non-admin riusciva a creare un contatto dall'app.

`upsertPartner` fa `.insert(payload).select().single()`, che in SQL è `INSERT ... RETURNING`.
Postgres applica la policy **SELECT** anche alle righe restituite da `RETURNING`, e
`partner_select` si basava solo sulle categorie: un contatto appena creato non ne ha, quindi la
lettura di ritorno veniva rifiutata e l'insert intera falliva.

Non se n'era accorto nessuno perché gli unici due utenti sono admin e superuser, che scavalcano
via `is_admin_or_super()`. Si sarebbe manifestato al primo `coordinator` creato.

Correzione in due passi, e il primo **da solo non funzionava**: aggiungere `created_by` dentro
`can_see_partner` è inutile per questo caso, perché la riga in corso di inserimento non è
visibile alle sottoquery della stessa istruzione. Il controllo va **nell'espressione della
policy**, dove `created_by` è una colonna della riga valutata:

```sql
ALTER POLICY partner_select ON res_partner
  USING (can_see_partner(auth.uid(), id) OR created_by = auth.uid());
```

Migrazioni `20260725130000` (can_see_partner, utile per consensi e tesseramenti) e
`20260725140000` (le due policy, è quella che risolve davvero).

---

## Flusso del form pubblico

```
sito WordPress (o public/test-form.html)
   │  POST /api/public/contact        ← nessuna autenticazione, vedi sotto
   ▼
src/routes/api/public/contact.tsx     ← valida email e telefono, poi delega
   │  client anon (NON service_role)
   ▼
RPC submit_public_contact(...)        ← SECURITY DEFINER: qui avviene tutto il lavoro privilegiato
   ▼
audit_log + res_partner + res_partner_category_rel + privacy_consent
```

Logica della RPC:

1. scrive sempre `audit_log{log_type:'inbound_form', action:'api_call', source:'public_form'}`
2. cerca il partner per email: assente → INSERT con `status='new'`; presente → UPDATE che riempie
   **solo i campi vuoti** via `COALESCE` (non sovrascrive mai dati esistenti)
3. risolve città/provincia su `res_city`: prima match esatto `lower(name)`, poi fallback `ILIKE '%city%'`
4. match trovato → imposta `city_id`, collega la categoria della città, **rimuove** `Validation`;
   match mancato → collega `Validation`
5. inserisce le righe `privacy_consent` con IP e user-agent
6. ritorna `{ok, partner_id, validation}` — `validation: true` significa *serve intervento manuale*

La route aggiunge `unassigned` come alias di `validation` nella risposta JSON.

## Fuori dagli indici — è una demo

Finché il progetto non va pubblico, tutto deve restare fuori dai motori di ricerca e dai
crawler che raccolgono materiale per l'addestramento. Sono **quattro** livelli, e servono
tutti perché ognuno copre un buco degli altri:

| Livello | File | Cosa copre |
|---|---|---|
| `<meta name="robots">` | `src/routes/__root.tsx` | le pagine renderizzate dal router, per i crawler che leggono l'HTML |
| `<meta name="robots">` | `public/test-form.html` | serve il suo: è un file statico e **non passa dal worker** |
| header `X-Robots-Tag` | `src/server.ts` | **tutte** le risposte dinamiche, HTML o no: pagine, API, 404, 500. Vale anche per i crawler che ignorano i meta tag |
| header `X-Robots-Tag` | `public/_headers` | i file statici, che su Cloudflare vengono serviti prima di arrivare al worker |
| `Disallow` | `public/robots.txt` | wildcard più l'elenco esplicito dei crawler AI (GPTBot, ClaudeBot, CCBot, Google-Extended, PerplexityBot, Bytespider…) |

Verificato in locale: header presente su `/`, `/auth`, POST all'API e pagina 404. Il solo
caso scoperto è il preflight `OPTIONS`, dove non ha senso — i crawler non fanno preflight.
Su `public/_headers` verificato che nitro lo **unisce** al proprio (la regola di cache su
`/assets/*` sopravvive) invece di sovrascriverlo; l'effetto reale si può confermare solo
dopo un deploy su Cloudflare.

> Nota su `robots.txt`: `Disallow: /` impedisce la *scansione*, quindi un crawler non
> arriva nemmeno a leggere il `noindex`. Se un URL viene linkato da fuori, Google può
> mostrarlo come URL nudo senza contenuto. È esattamente il motivo per cui c'è anche
> `X-Robots-Tag`: quello viaggia con la risposta e non dipende dal fatto che il crawler
> abbia letto la pagina.

L'accesso non è comunque protetto da questi accorgimenti: chi ha il link entra. Se serve
riservatezza vera, è `set_project_visibility` lato Lovable — ma renderebbe il link
inutilizzabile anche per il cliente, quindi non è stato toccato.

Quando si va pubblici, i punti da rimuovere sono marcati con `DEMO:` in tutti e cinque i file.

## Protezione dell'endpoint pubblico

> ⚠️ **Stato attuale: l'endpoint è APERTO.** Nessuna chiave, nessuna firma, nessun rate limit.
> Chiunque conosca l'URL può creare contatti. Scelta deliberata del 2026-07-25 per la fase
> demo, presa per far funzionare il form di esempio senza nessuna configurazione, dopo che il
> secret mancante aveva già bloccato una volta la prova del cliente. **Va richiusa prima del
> go-live di oltremani.it.** Il TODO è anche in testa a `src/routes/api/public/contact.tsx`.

`PUBLIC_API_KEY` è stata **rimossa** da route, test form e `.env`. Prima di reintrodurre una
protezione, la decisione va presa insieme a chi realizza il form WordPress. Sintesi
dell'analisi fatta il 2026-07-25, in ordine di valore per lo sforzo:

| | Intervento | Nota |
|---|---|---|
| 1 | **WordPress chiama da PHP**, non da JavaScript | decide se tutto il resto ha senso. Con `wp_remote_post()` e la chiave in `wp-config.php` la chiave è un segreto vero; con un webhook lato browser finisce nel sorgente della pagina e non protegge nulla |
| 2 | **CAPTCHA sul form WordPress** (Cloudflare Turnstile, gratis) | copre il buco che nessuna chiave copre: la chiave autentica *WordPress*, non la persona. Un bot sul form vero produce richieste perfettamente autenticate |
| 3 | **Rate limit**, obbligatoriamente **in questo codice** | l'app gira come worker nell'infrastruttura di Lovable, quindi le regole WAF di Cloudflare non sono nostre da configurare. `audit_log` già registra ogni chiamata `inbound_form` con timestamp: è la base su cui contare |
| 4 | Confronto della chiave **a tempo costante** | il piano di build lo chiedeva ("timing-safe"), l'implementazione usava `!==`. Da fare se si reintroduce una chiave |
| 5 | **CORS chiuso** | oggi `access-control-allow-origin: *`. Finché l'endpoint è aperto non protegge niente, quindi restringerlo sarebbe solo apparenza: va rivisto insieme al punto 1 |
| 6 | **HMAC + timestamp** (stile webhook Stripe/GitHub) | il segreto non viaggia mai e una richiesta catturata non è riutilizzabile. Sproporzionato per un form di adesione: da valutare solo se l'endpoint gestirà dati più delicati |

Scartati: allowlist per IP (fragile con hosting WordPress condiviso), mTLS e OAuth
client-credentials (sproporzionati).

---

## Divergenze dal piano

| Piano | Realtà | Impatto |
|---|---|---|
| `res_city` = ~8000 comuni ISTAT | **107 righe: solo i capoluoghi di provincia** — scelta **voluta**, è il dataset di test. I comuni ISTAT completi verranno caricati più avanti | Finché resta così, ogni comune non capoluogo (Modica, Vittoria, Gela…) non fa match e il contatto finisce in `Validation`. Atteso, non è un bug |
| 8 categorie territoriali | 9 — c'è anche `1 - GRUPPI INFORMALI (NON APS/ODV)` | nessuno |
| `res_users.id` = `auth.users.id` | vero, ma **senza FK** | la cancellazione va gestita a mano nel codice applicativo (fatto nel commit 757ac9b) |
| `source='website'` nell'audit | `source='public_form'` | cosmetico |
| status tessera `active\|inactive` | c'è anche `revoked` | tenerne conto nei filtri |
| `enforce_single_active_subscription_per_year()` | trigger inesistente | coperto dall'indice unique parziale |

Inoltre: `res_user_category_rel` è **vuota**. Oggi è innocuo perché entrambi gli utenti sono
admin/superuser e bypassano `visible_category_ids`. Ma il primo `coordinator` o `volunteer` creato
**non vedrà nessun contatto** finché non gli si assegna almeno una categoria.

---

## Stato del codice

`tsc --noEmit` pulito · `vite build` pulito.

- `src/integrations/supabase/types.ts` è generato ma **corretto a mano** il 2026-07-25 per
  aggiungere `membership_subscription.membership_number`, che mancava pur essendo una colonna
  reale e usata in tutta la UI. Se Lovable lo rigenera va bene: conterrà lo stesso campo.
  Il valore `revoked` non era un problema — il tipo è `status: string` e UI e server functions
  lo gestiscono già.
- ESLint: ~127 `@typescript-eslint/no-explicit-any` + 9 `react-hooks/exhaustive-deps`.
  Stilistici e diffusi per come Lovable genera il codice, nessun errore di correttezza.
- Gli errori prettier `Delete ␍` erano **un artefatto della working tree Windows**: in git i file
  sono LF (`core.autocrlf=input`). Chiuso con `.gitattributes` (`eol=lf`).
  Non lanciare `prettier --write` sul repo per "sistemarli".
- `src/components/ui/` è passato da 46 a **17 componenti**: i 29 non raggiungibili (calcolati con
  chiusura transitiva, non solo riferimenti diretti) sono in `.tmp/old/components-ui/`.
  Typecheck e build restano puliti. Se l'agent Lovable genera UI che ne richiede uno, lo
  ricreerà da sé — oppure si ripesca dall'archivio.

### ⚠️ Buchi di autorizzazione in `users.functions.ts` — chiusi il 2026-07-25

Trovati rileggendo tutte le server function. Non erano un problema di RLS: **tutte le
scritture su utenti passano da `supabaseAdmin`**, che bypassa la RLS per definizione. Le
policy di `res_users` non venivano nemmeno interpellate, quindi i controlli nel codice erano
l'unica difesa — e mancavano.

| Problema | Chi ne approfittava |
|---|---|
| `deleteUser` **non controllava nulla** sul chiamante, solo il ruolo del bersaglio | qualsiasi utente autenticato, volontario incluso, poteva cancellare qualunque account non-admin |
| `upsertUser` accettava `coordinator` fra i chiamanti e `superuser` fra i ruoli assegnabili | un coordinatore poteva crearsi un superuser, o promuovere un volontario |
| `upsertUser` non limitava il perimetro del coordinatore | poteva modificare qualsiasi utente non-admin e assegnare gruppi fuori dal proprio ambito |

Ora: eliminazione solo per admin/superuser; un coordinatore non può creare superuser, non può
toccare utenti che non siano volontari o coordinatori, e può assegnare solo gruppi presenti nel
proprio `visible_category_ids`.

**Regola generale da tenere:** ogni volta che una server function usa `supabaseAdmin`, i
controlli di autorizzazione vanno scritti a mano. `cities.functions.ts` lo fa correttamente ed
è il modello da seguire. Chi usa `context.supabase` è invece coperto dalla RLS.

### Bug UI corretti il 2026-07-25

- **Non si riusciva a creare più di un gruppo** (`category-dialog.tsx`). L'effetto di reset faceva
  `setF({ ...f, ...initial })`, fondendo sullo **stato precedente**. Per un gruppo nuovo `initial`
  non contiene `id`, quindi l'`id` di un gruppo aperto prima in modifica restava nel form e
  `upsertCategory` prendeva il ramo UPDATE: riscriveva quel gruppo invece di crearne uno nuovo.
  Corretto fondendo su una costante `EMPTY`.
- **Utenti senza gruppi**: in pagina Utenti, `coordinator` e `volunteer` senza nessuna categoria
  assegnata ora hanno un badge d'avviso. Senza gruppi la loro lista contatti è vuota e prima
  nulla lo segnalava.
