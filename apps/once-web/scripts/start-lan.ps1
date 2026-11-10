param(
  [string]$Address,
  [string]$InterfaceAlias = 'WLAN'
)

$ErrorActionPreference = 'Stop'
$onceRoot = Split-Path -Parent $PSScriptRoot
$onceRuntime = Join-Path $onceRoot 'backend/dist/main.js'
$onceLegacyRuntime = Join-Path $onceRoot 'output/react-migration/compatible-api/dist/main.js'
$onceEnvFile = Join-Path $onceRoot 'backend/.env'
$onceIndex = Join-Path $onceRoot 'dist/index.html'

if (-not $Address) {
  $Address = Get-NetIPAddress -InterfaceAlias $InterfaceAlias -AddressFamily IPv4 -ErrorAction Stop |
    Where-Object { $_.AddressState -eq 'Preferred' -and $_.IPAddress -notlike '169.254.*' } |
    Select-Object -First 1 -ExpandProperty IPAddress
}
if (-not $Address -or -not (Get-NetIPAddress -IPAddress $Address -AddressFamily IPv4 -ErrorAction SilentlyContinue)) {
  throw 'Choose an IPv4 address assigned to this computer.'
}
foreach ($onceFile in @($onceRuntime, $onceEnvFile, $onceIndex)) {
  if (-not (Test-Path $onceFile)) { throw ('Required local runtime file is missing: ' + $onceFile) }
}

# Reuse the existing development database. Never initialize or migrate it here.
$oncePgData = Join-Path $env:USERPROFILE '.once/postgres-dev/data'
if (-not (Get-NetTCPConnection -State Listen -LocalPort 55432 -ErrorAction SilentlyContinue)) {
  $oncePgCtl = 'D:/postgresql/bin/pg_ctl.exe'
  if (-not (Test-Path $oncePgCtl) -or -not (Test-Path (Join-Path $oncePgData 'PG_VERSION'))) {
    throw 'Start the existing ONCE PostgreSQL database before starting the website.'
  }
  & $oncePgCtl -D $oncePgData -l (Join-Path $env:USERPROFILE '.once/postgres-dev/server.log') -o '-p 55432 -h 127.0.0.1' -w -t 20 start
  if ($LASTEXITCODE -ne 0) { throw 'The existing ONCE database could not be started.' }
}

$onceListeners = @(Get-NetTCPConnection -State Listen -LocalPort 3000 -ErrorAction SilentlyContinue)
foreach ($onceProcessId in @($onceListeners.OwningProcess | Sort-Object -Unique)) {
  $onceOwner = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $onceProcessId)
  $onceCommand = if ($onceOwner.CommandLine) { $onceOwner.CommandLine.Replace('\', '/') } else { '' }
  $onceCurrent = $onceCommand.IndexOf($onceRuntime.Replace('\', '/'), [StringComparison]::OrdinalIgnoreCase) -ge 0
  $onceLegacy = $onceCommand.IndexOf($onceLegacyRuntime.Replace('\', '/'), [StringComparison]::OrdinalIgnoreCase) -ge 0
  if (-not ($onceCurrent -or $onceLegacy)) {
    throw ('Port 3000 belongs to another service; it was not stopped. PID=' + $onceProcessId)
  }
  Stop-Process -Id $onceProcessId -ErrorAction Stop
}

$onceOrigin = 'http://' + $Address + ':3000'
$onceOutput = Join-Path $onceRoot 'output'
New-Item -ItemType Directory -Path $onceOutput -Force | Out-Null
$onceStamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$onceOutLog = Join-Path $onceOutput ('once-lan-' + $onceStamp + '.stdout.log')
$onceErrLog = Join-Path $onceOutput ('once-lan-' + $onceStamp + '.stderr.log')
$onceOldHost = $env:HOST
$onceOldOrigin = $env:APP_ORIGIN
try {
  # Inherited environment takes precedence over the unchanged backend/.env.
  $env:HOST = '0.0.0.0'
  $env:APP_ORIGIN = $onceOrigin
  $onceNode = (Get-Command node.exe -ErrorAction Stop).Source
  $onceProcess = Start-Process -FilePath $onceNode -ArgumentList @(
    ('--env-file="{0}"' -f $onceEnvFile), ('"{0}"' -f $onceRuntime)
  ) -WorkingDirectory (Join-Path $onceRoot 'backend') -WindowStyle Hidden `
    -RedirectStandardOutput $onceOutLog -RedirectStandardError $onceErrLog -PassThru
} finally {
  $env:HOST = $onceOldHost
  $env:APP_ORIGIN = $onceOldOrigin
}

$onceReady = $false
for ($onceAttempt = 0; $onceAttempt -lt 12; $onceAttempt++) {
  try {
    $onceHealth = Invoke-RestMethod -Uri ($onceOrigin + '/api/health') -TimeoutSec 2
    if ($onceHealth.ok) { $onceReady = $true; break }
  } catch { }
  if ($onceProcess.HasExited) { break }
  Start-Sleep -Milliseconds 500
}
if (-not $onceReady) { throw ('The website did not become ready. See ' + $onceErrLog) }

[pscustomobject]@{
  origin = $onceOrigin
  processId = $onceProcess.Id
  bind = '0.0.0.0:3000'
  database = $onceHealth.database
  demo = $onceHealth.demo
  stdout = $onceOutLog
  stderr = $onceErrLog
  firewallCommand = 'powershell -ExecutionPolicy Bypass -File "' + (Join-Path $PSScriptRoot 'allow-lan-firewall.ps1') + '" -Address ' + $Address + ' -InterfaceAlias "' + $InterfaceAlias + '"'
} | ConvertTo-Json
