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

### ⚠️ Buchi RLS noti (non ancora corretti)

Verificati empiricamente su DB reale, in transazioni annullate. Vedi `.claude/rls-fix.sql`
per le patch proposte, **da applicare via agent Lovable**.

1. **Auto-promozione a superuser.** La policy `users_update` su `res_users` ammette
   `id = auth.uid()` senza `WITH CHECK`, e `protect_admin_users` blocca solo il ruolo `admin`.
   Un volontario può quindi eseguire `PATCH /res_users?id=eq.<sé stesso>` con `{"role":"superuser"}`
   e ottenere accesso a tutti i contatti e alla gestione utenti.
   *Testato: `UPDATE riuscito, ruolo ora = superuser`.*

2. **Auto-assegnazione visibilità.** La policy `rpcr_mod` su `res_partner_category_rel` ha
   `WITH CHECK (current_role_name() IS NOT NULL)`: qualsiasi utente autenticato può inserire una
   coppia `(partner_id, category_id)` arbitraria e rendersi visibile un contatto che non poteva vedere.
   *Testato: `vedeva_prima=false vede_dopo=true`.*

3. Stessa radice, gravità minore: `consent_mod` su `privacy_consent` ha `WITH CHECK (true)`
   (consensi falsificabili per qualsiasi partner) e `audit_insert` su `audit_log` ha
   `WITH CHECK (true)` per `authenticated` (audit trail falsificabile — la lettura invece è solo admin).

Radice comune: policy `FOR ALL` / `UPDATE` con `USING` corretto ma `WITH CHECK` assente o troppo
permissivo. In Postgres `USING` filtra le righe **esistenti**, `WITH CHECK` valida quelle
**nuove o modificate**: senza il secondo, la riga può essere spostata fuori dal perimetro.

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

---

## Divergenze dal piano

| Piano | Realtà | Impatto |
|---|---|---|
| `res_city` = ~8000 comuni ISTAT | **107 righe: solo i capoluoghi di provincia** | Un comune non capoluogo (Modica, Vittoria, Gela…) non fa match e il contatto finisce in `Validation`. È la divergenza con più impatto funzionale |
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

- `src/integrations/supabase/types.ts` è **generato e obsoleto**: manca
  `membership_subscription.membership_number` e il valore `revoked`. Da rigenerare lato Lovable.
  È la ragione di parecchi `as any` sui client Supabase.
- ESLint: ~127 `@typescript-eslint/no-explicit-any` + 9 `react-hooks/exhaustive-deps`.
  Stilistici e diffusi per come Lovable genera il codice, nessun errore di correttezza.
- Gli errori prettier `Delete ␍` che si vedono in locale sono **un artefatto della working tree
  Windows**: in git i file sono LF (`core.autocrlf=input`), quindi il repo è a posto e non serve
  toccare nulla. Non lanciare `prettier --write` per "sistemarli".
- 29 dei 46 componenti in `src/components/ui/` non sono referenziati. **Lasciarli**: sono lo
  scaffold shadcn standard e l'agent Lovable ci conta quando genera UI nuova.
