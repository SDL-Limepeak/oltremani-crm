# Flows

## Public contact form

```
WordPress site (or public/test-form.html)
   │  POST /api/public/contact          ← no authentication, see below
   ▼
src/routes/api/public/contact.tsx       ← validates email+phone, resolves client IP
   │  anon client (NOT service_role)
   ▼
RPC submit_public_contact(...)          ← SECURITY DEFINER: all privileged work happens here
   ▼
audit_log + res_partner + res_partner_category_rel + privacy_consent
```

What the RPC does, in order — **the order matters**:

1. reject if `email` or `phone` is empty
2. **rate limit, before recording anything**: 5/min per IP, 30/hour per IP, 60/min global.
   Counted off the existing `inbound_form` rows in `audit_log`, so no new table. Checking
   before logging is what stops someone inflating `audit_log` by hammering a blocked
   endpoint. Messages are prefixed `rate limit:` so the route can map them to **429 with
   `Retry-After`** instead of a misleading 500
3. write `audit_log{log_type:'inbound_form', action:'api_call', source:'public_form'}` with IP
4. look up the partner by lowercased email → absent: INSERT with `status='new'`; present:
   UPDATE that fills **only empty fields** via `COALESCE`, and appends (never overwrites)
   the note block
5. resolve the city against `res_city`: exact `lower(name)` match first, then `ILIKE '%city%'`
   fallback (with `%`/`_` escaped)
6. match found → set `city_id`, link the city's category, **remove** `Validation`;
   no match → link `Validation`
7. attach the operational roles by `code`. **Unknown codes are dropped silently** — the
   WordPress form is maintained by somebody else and must not break when the picklist
   moves. The cost of that choice is KI-17
8. resolve a declared `membership_number`. The card is **never** reassigned; a mismatch
   goes in the notes and back to `Validation`. Since the number stopped being unique
   (2026-09-17) the lookup takes the first match — see KI-19
9. insert the `privacy_consent` rows with IP and user-agent. **Only `privacy_policy`**
   since 2026-09-17: anything else in the payload is ignored, not rejected, on the same
   reasoning as the role codes. `channel` is written as `'web'` by construction — this
   function *is* the web form, and a channel the caller could set is a channel the caller
   could lie about
10. return `{ok, partner_id, validation, membership_status}` — `validation: true` means
    *needs manual triage*

The route adds `unassigned` as an alias of `validation` in the JSON response.

**Client IP:** `cf-connecting-ip` is read **before** `x-forwarded-for`. Cloudflare sets the
first itself and it cannot be forged; to the second it *appends* whatever the client sent,
so its first entry is attacker-controlled and useless for rate limiting.

### The endpoint is OPEN — deliberately

> No key, no signature. Anyone who knows the URL can create contacts. Decided 2026-07-25 for
> the demo phase, after a missing secret had already blocked a client demo once.
> **Close it before oltremani.it goes live.** The TODO is also at the top of
> `src/routes/api/public/contact.tsx`.

`PUBLIC_API_KEY` was removed from the route, the test form and `.env`. What to do instead,
in order of value per unit of effort — decide it *with whoever builds the WordPress form*:

| | Measure | Note |
|---|---|---|
| 1 | **WordPress calls from PHP**, not JavaScript | decides whether anything else is worth doing. `wp_remote_post()` + key in `wp-config.php` = a real secret. A browser-side webhook puts the key in the page source and protects nothing |
| 2 | **CAPTCHA on the WordPress form** (Cloudflare Turnstile, free) | covers what no key covers: a key authenticates *WordPress*, not the human. A bot on the real form produces perfectly authenticated junk |
| 3 | ~~Rate limit~~ — **done** 2026-07-25 | see above |
| 4 | **Constant-time key comparison** | the build plan asked for timing-safe; the old code used `!==`. Only matters if a key comes back |
| 5 | **Close CORS** | today `access-control-allow-origin: *`. While the endpoint is open this is theatre; revisit together with 1 |
| 6 | HMAC + timestamp (Stripe/GitHub style) | secret never travels, captured requests are not replayable. Overkill for a membership form; consider only if the endpoint starts handling more sensitive data |

Rejected: IP allowlisting (fragile on shared WordPress hosting), mTLS and OAuth
client-credentials (disproportionate).

## Authentication

Supabase Auth, email + password, no signup route — accounts are created by
admin/superuser through the Users page.

```
/auth  → supabase.auth.signInWithPassword
       → session in localStorage (browser client)
       → auth-attacher puts the JWT on every server-function call
       → requireSupabaseAuth validates it and injects context.supabase bound to that JWT
       → RLS does the rest
```

`handle_new_user` creates the `res_users` row on `auth.users` INSERT, taking the role from
`raw_user_meta_data->>'role'` and defaulting to `volunteer`. `upsertUser` then corrects the
role, because it cannot pass metadata that the trigger would honour for anything above
volunteer safely.

**Locking yourself out is possible and not self-healing.** Losing the `admin` role cannot be
undone from the app: `protect_admin_users` blocks every promotion to admin, and the trigger
fires for privileged sessions too. Emergency procedure:

```sql
ALTER TABLE res_users DISABLE TRIGGER trg_protect_admin;
UPDATE res_users SET role = 'admin' WHERE email = '<email>';
ALTER TABLE res_users ENABLE TRIGGER trg_protect_admin;
```
