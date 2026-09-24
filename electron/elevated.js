'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

const APPLY_TIMEOUT_MS = 120000;

// ShellExecute reports a refused elevation prompt as ERROR_CANCELLED. The launcher
// turns it into this exit code so a refusal is never mistaken for a failure.
const EXIT_UAC_CANCELLED = 1223;
const EXIT_LAUNCH_FAILED = 1222;

// Commands may name files written next to the batch with this placeholder,
// replaced by the batch's own folder before anything runs.
const DIR_PLACEHOLDER = '<<DIR>>';

/**
 * Make a command line safe to write into a .cmd file.
 *
 * cmd expands %NAME% even inside double quotes, so a user profile containing a
 * percent sign would otherwise turn part of the path into an empty string. Doubling
 * it yields a literal percent when the batch runs. Only done on the way into the
 * file — the copy shown to the user stays readable.
 */
function forBatch(text) {
  return String(text).replace(/%/g, '%%');
}

/** A value inside a PowerShell single-quoted string. */
function psQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

/** A PowerShell one-liner as a cmd line. The script must not contain double quotes. */
function powershellCommand(script) {
  return `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "${String(script).replace(/"/g, '')}"`;
}

function run(file, args, timeout) {
  return new Promise((resolve) => {
    execFile(file, args, { windowsHide: true, timeout, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout, stderr) => {
        resolve({
          code: error && typeof error.code === 'number' ? error.code : (error ? 1 : 0),
          stdout: String(stdout || ''),
          stderr: String(stderr || ''),
          failed: Boolean(error)
        });
      });
  });
}

let elevatedCache = null;

/**
 * Are we already running with administrator rights?
 *
 * fltmc exits non-zero for a standard user and zero for an elevated one, exists
 * on every supported Windows, and needs no service running — unlike `net
 * session`, which misreports when the Server service is disabled.
 */
async function isElevated() {
  if (elevatedCache !== null) return elevatedCache;
  if (process.platform !== 'win32') {
    elevatedCache = false;
    return elevatedCache;
  }
  const result = await run('fltmc.exe', [], 4000);
  elevatedCache = result.code === 0;
  return elevatedCache;
}

/**
 * Run a list of commands as administrator, behind a single UAC prompt.
 *
 * One Start-Process against one generated .cmd file is one prompt, however many
 * commands it holds. The elevated child cannot write to our stdout, so each
 * command's exit code comes back through a result file as `<tag> <code>`.
 *
 * `entries` is [{ tag, command }]; a tag is one or two words without spaces
 * inside each word ("ADD web-lan"). `files` is { name: content }, written next
 * to the batch first and reachable from a command as `<<DIR>>\name`.
 */
async function runElevated({ workDir, entries, files = {} }) {
  if (!entries.length) return { ok: true, finished: true, codes: {}, log: '' };
  if (process.platform !== 'win32') {
    return { ok: false, error: 'This can only be changed on Windows.' };
  }

  const nonce = crypto.randomBytes(6).toString('hex');
  const dir = path.join(workDir, nonce);
  const cmdPath = path.join(dir, 'apply.cmd');
  const launcherPath = path.join(dir, 'launch.ps1');
  const resultPath = path.join(dir, 'result.txt');
  const logPath = path.join(dir, 'log.txt');

  const result$ = forBatch(resultPath);
  const log$ = forBatch(logPath);
  const lines = ['@echo off', 'setlocal', `break> "${result$}"`, `break> "${log$}"`];
  for (const entry of entries) {
    const command = String(entry.command).split(DIR_PLACEHOLDER).join(dir);
    lines.push(`${forBatch(command)} >> "${log$}" 2>&1`);
    lines.push(`>> "${result$}" echo ${entry.tag} %ERRORLEVEL%`);
  }
  lines.push(`>> "${result$}" echo END 0`, 'exit /b 0', '');

  const cleanup = () => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* leave it */ }
  };

  try {
    fs.mkdirSync(dir, { recursive: true });
    for (const [name, content] of Object.entries(files)) {
      fs.writeFileSync(path.join(dir, name), content, 'utf-8');
    }
    // ASCII only, so no code page can mangle a rule name we later have to match.
    fs.writeFileSync(cmdPath, lines.join('\r\n'), 'ascii');
  } catch (error) {
    cleanup();
    return { ok: false, error: `Could not prepare the commands: ${error.message}` };
  }

  let outcome;
  if (await isElevated()) {
    // Already administrator: no prompt, no PowerShell, same result file.
    outcome = await run('cmd.exe', ['/c', cmdPath], APPLY_TIMEOUT_MS);
  } else {
    const launcher = [
      '$ErrorActionPreference = \'Stop\'',
      // Taking the path from the environment sidesteps every quoting question a
      // path like C:\Users\FR CL\... would otherwise raise.
      '$target = $env:HAWCODE_ELEVATED_TARGET',
      'try {',
      '  $p = Start-Process -FilePath $target -Verb RunAs -Wait -WindowStyle Hidden -PassThru',
      '  exit $p.ExitCode',
      '} catch [System.ComponentModel.Win32Exception] {',
      `  if ($_.Exception.NativeErrorCode -eq 1223) { exit ${EXIT_UAC_CANCELLED} }`,
      `  exit ${EXIT_LAUNCH_FAILED}`,
      `} catch { exit ${EXIT_LAUNCH_FAILED} }`,
      ''
    ].join('\r\n');
    try {
      fs.writeFileSync(launcherPath, launcher, 'utf-8');
    } catch (error) {
      cleanup();
      return { ok: false, error: `Could not prepare the prompt: ${error.message}` };
    }
    outcome = await new Promise((resolve) => {
      execFile('powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', launcherPath],
        {
          windowsHide: true,
          timeout: APPLY_TIMEOUT_MS,
          env: { ...process.env, HAWCODE_ELEVATED_TARGET: cmdPath }
        },
        (error, stdout, stderr) => resolve({
          code: error && typeof error.code === 'number' ? error.code : (error ? 1 : 0),
          stdout: String(stdout || ''),
          stderr: String(stderr || ''),
          failed: Boolean(error)
        }));
    });

    if (outcome.code === EXIT_UAC_CANCELLED) {
      cleanup();
      return { ok: false, cancelled: true, codes: {} };
    }
    if (outcome.code === EXIT_LAUNCH_FAILED) {
      cleanup();
      return {
        ok: false,
        error: 'Windows would not show the permission prompt. You can run the commands '
          + 'yourself in an Administrator PowerShell instead.'
      };
    }
  }

  let report = '';
  try {
    report = fs.readFileSync(resultPath, 'utf-8');
  } catch {
    cleanup();
    return { ok: false, error: 'The commands did not report back. Nothing may have been changed.' };
  }
  let log = '';
  try { log = fs.readFileSync(logPath, 'utf-8').slice(0, 8000); } catch { /* optional */ }
  cleanup();

  const codes = {};
  for (const line of report.split(/\r?\n/)) {
    const match = line.match(/^(.+?)\s+(\d+)$/);
    if (!match || match[1] === 'END') continue;
    codes[match[1]] = Number(match[2]);
  }
  return {
    ok: true,
    finished: /^END 0$/m.test(report),
    codes,
    log,
    exitCode: outcome.code
  };
}

module.exports = {
  runElevated, isElevated, run, forBatch, psQuote, powershellCommand, DIR_PLACEHOLDER
};
