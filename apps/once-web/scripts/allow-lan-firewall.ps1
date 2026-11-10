# Run in an elevated PowerShell window. Does not disable the firewall or change the network profile.
param(
  [Parameter(Mandatory = $true)][string]$Address,
  [string]$InterfaceAlias = 'WLAN'
)

$ErrorActionPreference = 'Stop'
$oncePrincipal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $oncePrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Administrator permission is required to add the Windows Firewall rule.'
}
if (-not (Get-NetIPAddress -IPAddress $Address -InterfaceAlias $InterfaceAlias -AddressFamily IPv4 -ErrorAction SilentlyContinue)) {
  throw 'The chosen address does not belong to the selected local network interface.'
}
$onceNode = (Get-Command node.exe -ErrorAction Stop).Source
$onceRuleName = 'ONCE-LAN-3000'
$onceExisting = Get-NetFirewallRule -Name $onceRuleName -ErrorAction SilentlyContinue
if ($onceExisting) { $onceExisting | Remove-NetFirewallRule }
New-NetFirewallRule -Name $onceRuleName -DisplayName 'ONCE LAN (TCP 3000)' `
  -Direction Inbound -Action Allow -Protocol TCP -LocalPort 3000 `
  -LocalAddress $Address -RemoteAddress LocalSubnet -InterfaceAlias $InterfaceAlias `
  -Profile Any -Program $onceNode -Enabled True | Out-Null
Write-Output ('Allowed ONCE on http://' + $Address + ':3000 for the local subnet only.')
