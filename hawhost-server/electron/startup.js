'use strict';

const os = require('os');
const { runPowerShellJson, runElevated, psQuote } = require('../backend/powershell');

const TASK_NAME = 'HawHost Server';

function currentUser() {
  const domain = process.env.USERDOMAIN || os.hostname();
  return `${domain}\\${os.userInfo().username}`;
}

/**
 * The "service": a Task Scheduler task that starts the HawHost background
 * server when Windows boots — before anyone signs in — under *your own*
 * account (S4U logon, no stored password), restarting it if it crashes.
 * Running as you rather than SYSTEM means the websites see exactly the same
 * files and settings as the control panel, and nothing gains extra rights.
 */
async function serviceStatus() {
  if (process.platform !== 'win32') return { supported: false, installed: false };
  const res = await runPowerShellJson(`
$t = Get-ScheduledTask -TaskName ${psQuote(TASK_NAME)} -ErrorAction SilentlyContinue
if ($t) {
  $i = $t | Get-ScheduledTaskInfo
  [pscustomobject]@{ installed = $true; state = [string]$t.State; user = [string]$t.Principal.UserId; logonType = [string]$t.Principal.LogonType; lastRun = [string]$i.LastRunTime; lastResult = $i.LastTaskResult } | ConvertTo-Json -Compress
} else { '{"installed":false}' }`);
  if (!res.ok || !res.data) return { supported: true, installed: false, error: res.error || null };
  return { supported: true, ...res.data };
}

function daemonCommandLine({ exe, script, dataDir }) {
  // cmd.exe sets ELECTRON_RUN_AS_NODE so HawHost.exe runs the server headless (no window).
  return `/d /c "set ELECTRON_RUN_AS_NODE=1&& "${exe}" "${script}" --data-dir "${dataDir}" --service"`;
}

function installService({ exe, script, dataDir, user = currentUser(), startNow = true }) {
  const args = daemonCommandLine({ exe, script, dataDir });
  return runElevated(`
$action = New-ScheduledTaskAction -Execute (Join-Path $env:SystemRoot 'System32\\cmd.exe') -Argument ${psQuote(args)} -WorkingDirectory ${psQuote(require('path').dirname(exe))}
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId ${psQuote(user)} -LogonType S4U -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName ${psQuote(TASK_NAME)} -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Starts the HawHost web server at boot (before sign-in) and keeps it running.' -Force | Out-Null
${startNow ? `Start-ScheduledTask -TaskName ${psQuote(TASK_NAME)}` : ''}
@{ installed = $true; user = ${psQuote(user)} }`);
}

function uninstallService() {
  return runElevated(`
$t = Get-ScheduledTask -TaskName ${psQuote(TASK_NAME)} -ErrorAction SilentlyContinue
if ($t) {
  Stop-ScheduledTask -TaskName ${psQuote(TASK_NAME)} -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName ${psQuote(TASK_NAME)} -Confirm:$false
}
@{ installed = $false }`);
}

/** Sign-in start of the control panel (tray only). Needs no administrator rights. */
function loginItemStatus(app) {
  const s = app.getLoginItemSettings(loginItemArgs(app));
  return { enabled: Boolean(s.openAtLogin) };
}

function loginItemArgs(app) {
  if (app.isPackaged) return { path: process.execPath, args: ['--hidden'] };
  return { path: process.execPath, args: [app.getAppPath(), '--hidden'] };
}

function setLoginItem(app, enabled) {
  app.setLoginItemSettings({ openAtLogin: Boolean(enabled), ...loginItemArgs(app) });
  return loginItemStatus(app);
}

module.exports = { TASK_NAME, serviceStatus, installService, uninstallService, loginItemStatus, setLoginItem, daemonCommandLine, currentUser };
