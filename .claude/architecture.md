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
   │  POST /api/public/contact  ·  header X-API-Key
   ▼
src/routes/api/public/contact.tsx        ← confronta con process.env.PUBLIC_API_KEY, 401 altrimenti
   │  client anon (NON service_role)
   ▼
RPC submit_public_contact(...)           ← SECURITY DEFINER: qui avviene tutto il lavoro privilegiato
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

`PUBLIC_API_KEY` resta necessaria: la userà WordPress. Nel test form la chiave non è più
mostrata a video, ma **non è un segreto** — sta nel bundle della pagina e in `.env` versionato.
Il segreto vero vive server-side su WordPress.

Il valore in uso è stato rigenerato il 2026-07-25: 128 caratteri alfanumerici da
`RandomNumberGenerator`, presente in [.env](../.env) e in `public/test-form.html`, che devono
restare **identici al byte** al secret in Lovable Cloud. Resta comunque **non un segreto**: la
pagina di test è pubblica e la chiave si legge dal sorgente. Per l'integrazione WordPress vera
va generata una chiave **diversa**, tenuta server-side su WordPress e mai messa nel repo.

> ⚠️ **Il secret va impostato in Lovable Cloud, non basta il `.env` versionato.**
> La route fa `if (!expected || apiKey !== expected) return 401`: se `PUBLIC_API_KEY` non è
> configurato nell'ambiente di deploy, `expected` è `undefined` e **ogni** richiesta prende 401,
> anche con la chiave corretta. È esattamente il sintomo segnalato dal cliente il 2026-07-25
> ("chiave API non valida o mancante"): la demo era irraggiungibile, non stava sbagliando nulla.
> Verifica rapida dall'esterno — se anche la chiave giusta dà 401, il secret non c'è:
> ```powershell
> Invoke-WebRequest -Uri "https://oltremani-crm.lovable.app/api/public/contact" -Method Post `
>   -Headers @{ "X-API-Key" = "test-oltremani-2026" } -ContentType "application/json" `
>   -Body '{"email":"probe@local.invalid"}' -UseBasicParsing
> ```

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
