'use strict';

const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

function encode(script) {
  return Buffer.from(script, 'utf16le').toString('base64');
}

/** Quote a value as a PowerShell single-quoted string literal. */
function psQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function runPowerShell(script, { timeoutMs = 20000 } = {}) {
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encode(script)],
      { windowsHide: true, timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 },
      (err, stdout, stderr) => resolve({ code: err ? (err.code || 1) : 0, stdout: String(stdout || ''), stderr: String(stderr || '') }));
  });
}

async function runPowerShellJson(script, opts) {
  const res = await runPowerShell(`$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'\n${script}`, opts);
  const text = res.stdout.trim();
  if (!text) return { ok: res.code === 0, data: null, error: res.stderr.trim() || null };
  try {
    return { ok: true, data: JSON.parse(text) };
  } catch {
    return { ok: false, data: null, error: (res.stderr || text).trim() };
  }
}

/**
 * Runs `script` as administrator (one UAC prompt). The script is passed as an
 * encoded command — nothing is written to a user-writable file and then run
 * elevated. The elevated script's JSON result comes back through a temp file.
 * Resolves { ok, cancelled, result, error }.
 */
async function runElevated(script, { timeoutMs = 120000 } = {}) {
  if (process.platform !== 'win32') return { ok: false, error: 'Only available on Windows.' };
  const resultFile = path.join(os.tmpdir(), `hawhost-elevated-${crypto.randomBytes(6).toString('hex')}.json`);
  const inner = `$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'
$__out = ${psQuote(resultFile)}
try {
  $__r = & {
${script}
  }
  @{ ok = $true; result = $__r } | ConvertTo-Json -Depth 6 -Compress | Set-Content -LiteralPath $__out -Encoding UTF8
  exit 0
} catch {
  @{ ok = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress | Set-Content -LiteralPath $__out -Encoding UTF8
  exit 1
}`;
  const innerEncoded = encode(inner);
  const outer = `
try {
  $p = Start-Process -FilePath 'powershell.exe' -Verb RunAs -WindowStyle Hidden -Wait -PassThru -ArgumentList @('-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-EncodedCommand', $env:HAWHOST_ELEVATED)
  exit $p.ExitCode
} catch {
  exit 1223
}`;
  const code = await new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encode(outer)],
      { windowsHide: true, timeout: timeoutMs, env: { ...process.env, HAWHOST_ELEVATED: innerEncoded } },
      (err) => resolve(err ? (typeof err.code === 'number' ? err.code : 1) : 0));
  });

  let payload = null;
  try {
    payload = JSON.parse(fs.readFileSync(resultFile, 'utf-8').replace(/^﻿/, ''));
  } catch { /* no result written */ }
  try { fs.unlinkSync(resultFile); } catch { /* ignore */ }

  if (code === 1223 && !payload) return { ok: false, cancelled: true, error: 'The administrator prompt was cancelled.' };
  if (!payload) return { ok: false, error: `The administrator task did not complete (exit code ${code}).` };
  return payload.ok ? { ok: true, result: payload.result } : { ok: false, error: payload.error };
}

module.exports = { runPowerShell, runPowerShellJson, runElevated, psQuote };
