'use strict';

const { runPowerShellJson, runElevated, psQuote } = require('./powershell');

const GROUP = 'HawHost';

/** Read-only: which HawHost rules exist, and whether Windows blocks HawHost's own program. */
async function firewallStatus(exePath) {
  if (process.platform !== 'win32') return { supported: false, rules: [], openPorts: [] };
  const script = `
$rules = @(Get-NetFirewallRule -Group ${psQuote(GROUP)} -ErrorAction SilentlyContinue | ForEach-Object {
  $pf = $_ | Get-NetFirewallPortFilter
  [pscustomobject]@{ name = $_.DisplayName; enabled = [string]$_.Enabled; action = [string]$_.Action; direction = [string]$_.Direction; protocol = [string]$pf.Protocol; ports = [string]($pf.LocalPort -join ',') }
})
$blocked = 0
${exePath ? `try { $blocked = @(Get-NetFirewallApplicationFilter -Program ${psQuote(exePath)} -ErrorAction SilentlyContinue | Get-NetFirewallRule | Where-Object { $_.Direction -eq 'Inbound' -and $_.Action -eq 'Block' -and $_.Enabled -eq 'True' }).Count } catch {}` : ''}
$profiles = @(Get-NetFirewallProfile -ErrorAction SilentlyContinue | ForEach-Object { [pscustomobject]@{ name = [string]$_.Name; enabled = [string]$_.Enabled } })
[pscustomobject]@{ rules = $rules; blockedProgramRules = $blocked; profiles = $profiles } | ConvertTo-Json -Depth 4 -Compress`;
  const res = await runPowerShellJson(script, { timeoutMs: 30000 });
  if (!res.ok || !res.data) return { supported: true, error: res.error || 'Could not read Windows Firewall rules.', rules: [], openPorts: [] };
  const rules = [].concat(res.data.rules || []);
  const openPorts = [...new Set(rules
    .filter((r) => r.enabled === 'True' && r.action === 'Allow' && r.direction === 'Inbound')
    .flatMap((r) => String(r.ports).split(',').map(Number).filter(Boolean)))].sort((a, b) => a - b);
  return {
    supported: true,
    rules,
    openPorts,
    blockedProgramRules: Number(res.data.blockedProgramRules || 0),
    profiles: [].concat(res.data.profiles || [])
  };
}

/**
 * Replaces all HawHost rules with one inbound TCP allow rule per port, plus an
 * allow rule for the HawHost program itself. Also removes inbound *block*
 * rules that Windows created for HawHost when someone pressed "Cancel" on the
 * "allow this app" prompt — those would otherwise override the allow rules.
 */
function applyFirewall(ports, exePath) {
  const list = [...new Set(ports.map(Number).filter((p) => p > 0 && p < 65536))];
  const script = `
Remove-NetFirewallRule -Group ${psQuote(GROUP)} -ErrorAction SilentlyContinue
$created = @()
foreach ($p in @(${list.join(',')})) {
  New-NetFirewallRule -DisplayName ("HawHost web server - TCP " + $p) -Group ${psQuote(GROUP)} -Direction Inbound -Action Allow -Protocol TCP -LocalPort $p -Profile Any | Out-Null
  $created += $p
}
${exePath ? `
Get-NetFirewallApplicationFilter -Program ${psQuote(exePath)} -ErrorAction SilentlyContinue | Get-NetFirewallRule | Where-Object { $_.Direction -eq 'Inbound' -and $_.Action -eq 'Block' } | Remove-NetFirewallRule -ErrorAction SilentlyContinue
New-NetFirewallRule -DisplayName 'HawHost web server - program' -Group ${psQuote(GROUP)} -Direction Inbound -Action Allow -Program ${psQuote(exePath)} -Profile Any | Out-Null` : ''}
@{ ports = $created }`;
  return runElevated(script);
}

function removeFirewall() {
  return runElevated(`Remove-NetFirewallRule -Group ${psQuote(GROUP)} -ErrorAction SilentlyContinue\n@{ removed = $true }`);
}

module.exports = { firewallStatus, applyFirewall, removeFirewall, GROUP };
