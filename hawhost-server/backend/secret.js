'use strict';

const { execFileSync } = require('child_process');

// Values stored with this prefix went through Windows DPAPI. Anything without it
// is a config written before encryption existed, and is read as plain text.
const PREFIX = 'enc:dpapi:';
// Mixed into every value, so a blob copied into another DPAPI consumer on this
// machine does not decrypt there.
const ENTROPY = 'HawHost DDNS v1';

/**
 * Windows DPAPI, machine scope, through one PowerShell call per batch.
 *
 * Machine scope rather than user scope because the background server can run as
 * a startup task with S4U logon, and an S4U process has no access to the user's
 * DPAPI keys. Machine scope still makes hawhost-config.json useless once copied
 * off this PC, which is the point: the file sits in %APPDATA% and ends up in
 * backups and sync folders.
 *
 * Synchronous on purpose: ConfigStore loads and saves synchronously. The store
 * caches results, so this runs when a token changes and once at startup, not on
 * every save.
 */
function runDpapi(mode, values) {
  const script = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.Security
$entropy = [Text.Encoding]::UTF8.GetBytes('${ENTROPY}')
$scope = [Security.Cryptography.DataProtectionScope]::LocalMachine
$in = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:HAWHOST_DPAPI_IN)) | ConvertFrom-Json
$out = @(foreach ($v in @($in)) {
  try {
    if ('${mode}' -eq 'protect') {
      [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes([string]$v), $entropy, $scope))
    } else {
      [Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String([string]$v), $entropy, $scope))
    }
  } catch { '' }
})
# Base64 out as well: stdout goes through the console code page, which would
# mangle anything outside ASCII.
[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes((ConvertTo-Json -InputObject $out -Compress)))`;
  const stdout = execFileSync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')
  ], {
    windowsHide: true,
    timeout: 20000,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'ignore'],
    // Passed through the environment so no secret appears on a command line.
    env: { ...process.env, HAWHOST_DPAPI_IN: Buffer.from(JSON.stringify(values), 'utf-8').toString('base64') }
  });
  const parsed = JSON.parse(Buffer.from(String(stdout).trim(), 'base64').toString('utf-8') || '[]');
  return Array.isArray(parsed) ? parsed.map((v) => String(v ?? '')) : [String(parsed ?? '')];
}

function available() {
  return process.platform === 'win32';
}

/** Encrypt many values in one PowerShell start. Empty stays empty. */
function protectAll(values) {
  const wanted = values.map((v) => String(v || ''));
  if (!available() || !wanted.some(Boolean)) return wanted;
  const blobs = runDpapi('protect', wanted.map((v) => v || ''));
  return wanted.map((v, i) => (v && blobs[i] ? PREFIX + blobs[i] : v));
}

/** Decrypt many values. Plain-text (legacy) values come back unchanged. */
function unprotectAll(values) {
  const stored = values.map((v) => String(v || ''));
  const indexes = stored.map((v, i) => (v.startsWith(PREFIX) ? i : -1)).filter((i) => i >= 0);
  if (!indexes.length) return stored;
  if (!available()) return stored.map((v) => (v.startsWith(PREFIX) ? '' : v));
  const plain = runDpapi('unprotect', indexes.map((i) => stored[i].slice(PREFIX.length)));
  const out = [...stored];
  indexes.forEach((index, n) => { out[index] = plain[n] || ''; });
  return out;
}

function isEncrypted(value) {
  return String(value || '').startsWith(PREFIX);
}

module.exports = { protectAll, unprotectAll, isEncrypted, available, PREFIX };
