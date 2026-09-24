'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

/**
 * Work out which shells are actually installed, so the terminal's picker only
 * offers things that will start. Each entry is
 * `{ id, label, file, args, icon }` — `file` is an absolute path (or a bare
 * command found on PATH) and `args` are passed straight to the spawner.
 */

function exists(candidate) {
  try {
    return Boolean(candidate) && fs.existsSync(candidate);
  } catch {
    return false;
  }
}

/** Look for a bare command on PATH, the way `which`/`where` would. */
function onPath(command) {
  const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  const extensions = process.platform === 'win32'
    ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';')
    : [''];
  for (const dir of dirs) {
    for (const ext of extensions) {
      const candidate = path.join(dir, command + ext);
      if (exists(candidate)) return candidate;
    }
  }
  return null;
}

function windowsShells() {
  const found = [];
  const systemRoot = process.env.SystemRoot || 'C:\\Windows';
  const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
  const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';

  // PowerShell 7+ is a separate install from the one that ships with Windows.
  const pwsh = [
    path.join(programFiles, 'PowerShell', '7', 'pwsh.exe'),
    path.join(programFiles, 'PowerShell', '6', 'pwsh.exe')
  ].find(exists) || onPath('pwsh');
  if (pwsh) {
    found.push({ id: 'pwsh', label: 'PowerShell 7', file: pwsh, args: ['-NoLogo'] });
  }

  const powershell = path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  if (exists(powershell)) {
    found.push({ id: 'powershell', label: 'Windows PowerShell', file: powershell, args: ['-NoLogo'] });
  }

  const cmd = process.env.ComSpec || path.join(systemRoot, 'System32', 'cmd.exe');
  if (exists(cmd)) {
    found.push({ id: 'cmd', label: 'Command Prompt', file: cmd, args: [] });
  }

  const gitBash = [
    path.join(programFiles, 'Git', 'bin', 'bash.exe'),
    path.join(programFilesX86, 'Git', 'bin', 'bash.exe')
  ].find(exists);
  if (gitBash) {
    // `-i` keeps it interactive so the usual profile and prompt are loaded.
    found.push({ id: 'gitbash', label: 'Git Bash', file: gitBash, args: ['-i', '-l'] });
  }

  const wsl = path.join(systemRoot, 'System32', 'wsl.exe');
  if (exists(wsl) && hasWslDistro()) {
    found.push({ id: 'wsl', label: 'WSL', file: wsl, args: [] });
  }

  return found;
}

/**
 * wsl.exe exists on every modern Windows install even with no Linux
 * distribution, where launching it only prints an error. Check for a real
 * distribution before offering it.
 */
function hasWslDistro() {
  try {
    const { execFileSync } = require('child_process');
    const output = execFileSync('wsl.exe', ['--list', '--quiet'], {
      timeout: 3000,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore']
    });
    // wsl.exe writes UTF-16LE.
    return output.toString('utf16le').replace(/\0/g, '').trim().length > 0;
  } catch {
    return false;
  }
}

function unixShells() {
  const found = [];
  const seen = new Set();
  const add = (id, label, file, args = []) => {
    if (!file || seen.has(file)) return;
    seen.add(file);
    found.push({ id, label, file, args });
  };

  // Whatever the user's login shell is should be first.
  const preferred = process.env.SHELL;
  if (exists(preferred)) {
    add('default', `${path.basename(preferred)} (default)`, preferred, ['-l']);
  }

  add('zsh', 'zsh', exists('/bin/zsh') ? '/bin/zsh' : onPath('zsh'), ['-l']);
  add('bash', 'bash', exists('/bin/bash') ? '/bin/bash' : onPath('bash'), ['-l']);
  add('fish', 'fish', onPath('fish'), ['-l']);
  add('sh', 'sh', exists('/bin/sh') ? '/bin/sh' : onPath('sh'), []);
  return found;
}

let cached = null;

/** The installed shells, detected once per run. */
function list() {
  if (cached) return cached;
  const shells = process.platform === 'win32' ? windowsShells() : unixShells();
  if (!shells.length) {
    // Last resort so the terminal is never completely unavailable.
    const fallback = process.platform === 'win32'
      ? { id: 'cmd', label: 'Command Prompt', file: 'cmd.exe', args: [] }
      : { id: 'sh', label: 'sh', file: '/bin/sh', args: [] };
    shells.push(fallback);
  }
  cached = shells;
  return cached;
}

/** Resolve a shell id to its definition, falling back to the first available. */
function resolve(shellId) {
  const shells = list();
  return shells.find((shell) => shell.id === shellId) || shells[0];
}

function defaultShellId() {
  return list()[0].id;
}

function homeDirectory() {
  return os.homedir();
}

module.exports = { list, resolve, defaultShellId, homeDirectory };
