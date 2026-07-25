# Matrice permessi end-to-end.
# Login reale per ogni ruolo, poi ogni operazione via PostgREST col JWT dell'utente:
# lo stesso percorso che usa l'app tramite context.supabase.
#
# Trappole imparate a mie spese, che questo harness ora evita:
#  - PostgREST risponde 204 a un DELETE/UPDATE anche quando la RLS filtra TUTTO e le
#    righe toccate sono zero. Senza "Prefer: return=representation" un permesso negato
#    sembra concesso. Va contato il corpo della risposta, non lo status.
#  - contare le righe con @($content | ConvertFrom-Json).Count non e' affidabile:
#    si controlla prima se il corpo e' '[]'.
#  - stato condiviso fra ruoli: una insert identica fatta da un ruolo precedente fa
#    fallire quella successiva con 409 (chiave duplicata), che non e' un diniego.
#    Ogni ruolo ha quindi il suo contatto bersaglio e la sua categoria.
$ErrorActionPreference = "Continue"

$SUPA = "https://rbabjbggrqgadcyzplxh.supabase.co"
$ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJiYWJqYmdncnFnYWRjeXpwbHhoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI1NzgxOTIsImV4cCI6MjA5ODE1NDE5Mn0.Mt8vbJ-Kdn1iiMuhiTX97-6YfPuiH6NSEYt4TBA2GiE"
$PW = 'E2eTest!Passw0rd-2026'

function Login($email) {
  $b = @{ email = $email; password = $PW } | ConvertTo-Json -Compress
  $r = Invoke-RestMethod -Uri "$SUPA/auth/v1/token?grant_type=password" -Method Post `
        -Headers @{ apikey = $ANON } -ContentType "application/json" -Body $b
  return @{ token = $r.access_token; uid = $r.user.id }
}

function CountRows([string]$content) {
  if ([string]::IsNullOrWhiteSpace($content)) { return 0 }
  $t = $content.Trim()
  if ($t -eq '[]' -or $t -eq '') { return 0 }
  try {
    $parsed = $t | ConvertFrom-Json
    if ($null -eq $parsed) { return 0 }
    return ([object[]]$parsed).Length
  } catch { return 0 }
}

# Ogni scrittura chiede return=representation, cosi' il numero di righe nel corpo dice
# quante ne sono state toccate davvero.
function Rest($tok, $method, $path, $body) {
  $h = @{ apikey = $ANON; Authorization = "Bearer $tok"; Prefer = "return=representation" }
  $p = @{ Uri = "$SUPA/rest/v1/$path"; Method = $method; Headers = $h; UseBasicParsing = $true }
  if ($body) { $p.Body = $body; $p.ContentType = "application/json" }
  try {
    $r = Invoke-WebRequest @p
    return @{ ok = $true; code = [int]$r.StatusCode; rows = (CountRows $r.Content); body = $r.Content }
  } catch {
    $code = 0; $msg = $_.Exception.Message
    if ($_.Exception.Response) {
      $code = [int]$_.Exception.Response.StatusCode
      try { $msg = (New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())).ReadToEnd() } catch {}
    }
    return @{ ok = $false; code = $code; rows = 0; body = $msg }
  }
}

# Un'operazione e' "permessa" solo se ha risposto ok E ha toccato almeno una riga.
function Effect($res) { if ($res.ok -and $res.rows -gt 0) { "permesso" } else { "negato" } }

$results = @()
function Add-Res($role, $op, $atteso, $esito, $dett) {
  $script:results += [pscustomobject]@{
    Ruolo = $role; Operazione = $op; Atteso = $atteso; Esito = $esito
    OK = $(if ($atteso -eq $esito) { "si" } else { "NO" }); Dettaglio = $dett
  }
}

$roles = @(
  @{ role = "admin";       email = "e2e-admin@local.invalid";       cat = "Varese" },
  @{ role = "superuser";   email = "e2e-superuser@local.invalid";   cat = "Genova" },
  @{ role = "coordinator"; email = "e2e-coordinator@local.invalid"; cat = "Varese" },
  @{ role = "volunteer";   email = "e2e-volunteer@local.invalid";   cat = "Varese" }
)

$sudo = Login "e2e-admin@local.invalid"
$cats = @{}
foreach ($n in @("Varese", "Genova", "Ragusa")) {
  $cats[$n] = ((Rest $sudo.token "GET" "res_partner_category?select=id&name=eq.$n" $null).body | ConvertFrom-Json)[0].id
}

foreach ($r in $roles) {
  $s = Login $r.email
  $tok = $s.token; $uid = $s.uid; $role = $r.role
  $elevated = $role -in @("admin", "superuser")
  $ownCat = $cats[$r.cat]

  # Contatto bersaglio dedicato a questo ruolo, fuori dal suo perimetro (categoria Ragusa),
  # creato dall'admin: serve a provare l'accesso a cio' che non gli compete.
  $foreignEmail = "e2e-foreign-$role-$(Get-Random)@local.invalid"
  $b = @{ first_name = "Estraneo"; last_name = $role; email = $foreignEmail; status = "new" } | ConvertTo-Json -Compress
  $foreign = (Rest $sudo.token "POST" "res_partner?select=id" $b).body | ConvertFrom-Json
  $foreignId = @($foreign)[0].id
  $null = Rest $sudo.token "POST" "res_partner_category_rel" (@{ partner_id = $foreignId; category_id = $cats["Ragusa"] } | ConvertTo-Json -Compress)

  # 1. lettura contatti
  $x = Rest $tok "GET" "res_partner?select=id" $null
  Add-Res $role "SELECT res_partner" "permesso" (Effect $x) "$($x.rows) visibili"

  # 2. il contatto estraneo NON deve comparire ai non elevati
  $x = Rest $tok "GET" "res_partner?select=id&id=eq.$foreignId" $null
  Add-Res $role "SELECT contatto fuori perimetro" $(if ($elevated) { "permesso" } else { "negato" }) (Effect $x) "$($x.rows) righe"

  # 3. creazione contatto con RETURNING: e' il caso che era rotto per i non-admin
  $mine = "e2e-own-$role-$(Get-Random)@local.invalid"
  $b = @{ first_name = "Proprio"; last_name = $role; email = $mine; status = "new"; created_by = $uid } | ConvertTo-Json -Compress
  $x = Rest $tok "POST" "res_partner?select=id" $b
  $ownId = if ($x.ok -and $x.rows -gt 0) { (@($x.body | ConvertFrom-Json)[0]).id } else { $null }
  Add-Res $role "INSERT res_partner (con RETURNING)" "permesso" (Effect $x) "HTTP $($x.code)"

  # 4. categoria del proprio perimetro sul contatto appena creato
  if ($ownId) {
    $x = Rest $tok "POST" "res_partner_category_rel" (@{ partner_id = $ownId; category_id = $ownCat } | ConvertTo-Json -Compress)
    Add-Res $role "INSERT rel (categoria propria)" "permesso" (Effect $x) "HTTP $($x.code)"
  }

  # 5. ESCALATION: rendersi visibile un contatto fuori perimetro
  $x = Rest $tok "POST" "res_partner_category_rel" (@{ partner_id = $foreignId; category_id = $ownCat } | ConvertTo-Json -Compress)
  Add-Res $role "ESCALATION visibilita su contatto estraneo" $(if ($elevated) { "permesso" } else { "negato" }) (Effect $x) "HTTP $($x.code)"

  # 6. ESCALATION: cambiarsi il ruolo. Sopra admin non c'e' niente, quindi per lui la
  #    prova sensata e' la retrocessione: perdere admin non e' reversibile dall'app.
  $target = if ($role -eq "admin") { "superuser" } elseif ($role -eq "volunteer") { "superuser" } else { "admin" }
  $label  = if ($role -eq "admin") { "ESCALATION retrocedersi a superuser" } else { "ESCALATION promuoversi a $target" }
  $x = Rest $tok "PATCH" "res_users?id=eq.$uid" (@{ role = $target } | ConvertTo-Json -Compress)
  Add-Res $role $label "negato" (Effect $x) "HTTP $($x.code)"

  # 7. modifica del proprio nome: consentita a tutti
  $x = Rest $tok "PATCH" "res_users?id=eq.$uid" (@{ name = "E2E $role" } | ConvertTo-Json -Compress)
  Add-Res $role "UPDATE proprio nome" "permesso" (Effect $x) "HTTP $($x.code)"

  # 8. modificare un ALTRO utente
  $other = (Login "e2e-volunteer@local.invalid").uid
  if ($uid -ne $other) {
    $x = Rest $tok "PATCH" "res_users?id=eq.$other" (@{ name = "Toccato da $role" } | ConvertTo-Json -Compress)
    Add-Res $role "UPDATE altro utente" $(if ($elevated) { "permesso" } else { "negato" }) (Effect $x) "HTTP $($x.code)"
  }

  # 9. audit log: solo admin
  $x = Rest $tok "GET" "audit_log?select=id&limit=5" $null
  Add-Res $role "SELECT audit_log" $(if ($role -eq "admin") { "permesso" } else { "negato" }) (Effect $x) "$($x.rows) righe"

  # 10. creare categorie
  $x = Rest $tok "POST" "res_partner_category" (@{ name = "E2E cat $role $(Get-Random)"; category_type = "territorial"; status = "active" } | ConvertTo-Json -Compress)
  Add-Res $role "INSERT res_partner_category" $(if ($role -eq "volunteer") { "negato" } else { "permesso" }) (Effect $x) "HTTP $($x.code)"

  # 11. tesseramenti
  if ($ownId) {
    $x = Rest $tok "POST" "membership_subscription" (@{ partner_id = $ownId; year = 2026; status = "active" } | ConvertTo-Json -Compress)
    Add-Res $role "INSERT membership_subscription" $(if ($role -eq "volunteer") { "negato" } else { "permesso" }) (Effect $x) "HTTP $($x.code)"
  }

  # 12. consenso privacy sul proprio contatto
  if ($ownId) {
    $x = Rest $tok "POST" "privacy_consent" (@{ partner_id = $ownId; consent_type = "privacy_policy"; accepted = $true; source = "e2e" } | ConvertTo-Json -Compress)
    Add-Res $role "INSERT privacy_consent (proprio)" "permesso" (Effect $x) "HTTP $($x.code)"
  }

  # 13. consenso privacy su contatto estraneo
  $x = Rest $tok "POST" "privacy_consent" (@{ partner_id = $foreignId; consent_type = "marketing"; accepted = $true; source = "e2e" } | ConvertTo-Json -Compress)
  Add-Res $role "INSERT privacy_consent (estraneo)" $(if ($elevated) { "permesso" } else { "negato" }) (Effect $x) "HTTP $($x.code)"

  # 14. scrivere anagrafica citta'
  $x = Rest $tok "POST" "res_city" (@{ name = "E2E city $(Get-Random)"; province_code = "ZZ" } | ConvertTo-Json -Compress)
  Add-Res $role "INSERT res_city" $(if ($role -eq "volunteer") { "negato" } else { "permesso" }) (Effect $x) "HTTP $($x.code)"

  # 15. modificare il contatto estraneo
  $x = Rest $tok "PATCH" "res_partner?id=eq.$foreignId" (@{ notes = "toccato da $role" } | ConvertTo-Json -Compress)
  Add-Res $role "UPDATE contatto estraneo" $(if ($elevated) { "permesso" } else { "negato" }) (Effect $x) "HTTP $($x.code)"

  # 16. cancellare il proprio contatto: solo admin/superuser
  if ($ownId) {
    $x = Rest $tok "DELETE" "res_partner?id=eq.$ownId" $null
    Add-Res $role "DELETE res_partner" $(if ($elevated) { "permesso" } else { "negato" }) (Effect $x) "HTTP $($x.code), righe $($x.rows)"
  }
}

"=========================== MATRICE PERMESSI ==========================="
$results | Format-Table Ruolo, Operazione, Atteso, Esito, OK, Dettaglio -AutoSize | Out-String -Width 210
$ko = @($results | Where-Object { $_.OK -eq "NO" })
"conformi: $(@($results | Where-Object { $_.OK -eq 'si' }).Count) / $($results.Count)"
if ($ko.Count) {
  "=== DIFFORMITA ==="
  $ko | Format-Table Ruolo, Operazione, Atteso, Esito, Dettaglio -AutoSize | Out-String -Width 210
} else { "NESSUNA DIFFORMITA" }
