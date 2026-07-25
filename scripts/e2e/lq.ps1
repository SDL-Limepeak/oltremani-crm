# Runs SQL against oltremani-crm through the Lovable MCP server (query_database).
#   .\lq.ps1 -Sql "select 1"
#   .\lq.ps1 -Sql "..." -Raw          # raw JSON
#   .\lq.ps1 -SqlFile path\to.sql
#   .\lq.ps1 -Tool list_workspaces
param(
  [string]$Sql,
  [string]$SqlFile,
  [string]$Tool,
  [switch]$Raw
)
$ErrorActionPreference = "Stop"

$PROJECT_ID = "5ee874eb-458d-4ddb-99dd-8259082802de"   # oltremani-crm
$URL = "https://mcp.lovable.dev/"

if ($SqlFile) { $Sql = [System.IO.File]::ReadAllText((Resolve-Path $SqlFile)) }

$cred = Get-Content "$env:USERPROFILE\.claude\.credentials.json" -Raw | ConvertFrom-Json
$tok = $cred.mcpOAuth."lovable|90f57e40d8583ff0".accessToken
if (-not $tok) { throw "No accessToken for lovable. Re-run: claude mcp login lovable" }

$headers = @{ Authorization = "Bearer $tok"; Accept = "application/json, text/event-stream" }
$script:rpcId = 0

# PowerShell 5.1's ConvertTo-Json can emit {"value":...,"Count":...} instead of a plain
# JSON string for long multi-line input, which the server rejects as invalid JSON.
# Hand-escaping removes the guesswork.
function ConvertTo-JsonString([string]$s) {
  $sb = New-Object System.Text.StringBuilder
  [void]$sb.Append('"')
  foreach ($ch in $s.ToCharArray()) {
    $c = [int]$ch
    if     ($c -eq 8)  { [void]$sb.Append('\b') }
    elseif ($c -eq 9)  { [void]$sb.Append('\t') }
    elseif ($c -eq 10) { [void]$sb.Append('\n') }
    elseif ($c -eq 12) { [void]$sb.Append('\f') }
    elseif ($c -eq 13) { [void]$sb.Append('\r') }
    elseif ($c -eq 34) { [void]$sb.Append('\"') }
    elseif ($c -eq 92) { [void]$sb.Append('\\') }
    elseif ($c -lt 32 -or $c -gt 126) { [void]$sb.Append(('\u{0:x4}' -f $c)) }
    else { [void]$sb.Append($ch) }
  }
  [void]$sb.Append('"')
  return $sb.ToString()
}

function Send-Raw([string]$payload) {
  $null = $payload | ConvertFrom-Json   # fail locally, not at the server
  $resp = Invoke-WebRequest -Uri $URL -Method Post -Headers $headers `
    -ContentType "application/json" -Body $payload -UseBasicParsing
  $txt = $resp.Content
  if ($txt -match '(?ms)^data:\s*(\{.*?)\s*$') { return $Matches[1] | ConvertFrom-Json }
  return $txt | ConvertFrom-Json
}

function Send-Rpc([string]$method, [string]$paramsJson) {
  $script:rpcId++
  $p = if ($paramsJson) { ',"params":' + $paramsJson } else { '' }
  return Send-Raw ('{"jsonrpc":"2.0","id":' + $script:rpcId + ',"method":' + (ConvertTo-JsonString $method) + $p + '}')
}

Send-Rpc "initialize" '{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"lq","version":"1.0"}}' | Out-Null

if ($Sql) {
  $args_json = '{"project_id":' + (ConvertTo-JsonString $PROJECT_ID) + ',"sql":' + (ConvertTo-JsonString $Sql) + '}'
  $res = Send-Rpc "tools/call" ('{"name":"query_database","arguments":' + $args_json + '}')
} elseif ($Tool) {
  $inner = if ($Tool -match "workspace") { '{}' } else { '{"project_id":' + (ConvertTo-JsonString $PROJECT_ID) + '}' }
  $res = Send-Rpc "tools/call" ('{"name":' + (ConvertTo-JsonString $Tool) + ',"arguments":' + $inner + '}')
} else {
  throw "Provide -Sql, -SqlFile or -Tool"
}

if ($res.error) { Write-Error "MCP: $($res.error.message)"; exit 1 }
$text = ($res.result.content | ForEach-Object { $_.text }) -join "`n"
if ($res.result.isError) { Write-Error $text; exit 1 }

if ($Raw) { $text; return }
try {
  $o = $text | ConvertFrom-Json
  if ($null -ne $o.rows) {
    if (@($o.rows).Count -eq 0) { "(0 rows)" } else { $o.rows | Format-Table -AutoSize | Out-String -Width 400 }
  } else { $text }
} catch { $text }
