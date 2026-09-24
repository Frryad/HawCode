'use strict';

const fs = require('fs');
const path = require('path');

const { psQuote, powershellCommand, DIR_PLACEHOLDER } = require('./elevated');

const HOSTS_PATH = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'drivers', 'etc', 'hosts');
const BEGIN = '# BEGIN HawCode (local names for shared folders; removed by HawCode)';
const END = '# END HawCode';
// Loopback rather than the Wi-Fi address: the name must keep working on this PC
// through every DHCP renewal, and Apache routes by name, not by address.
const ADDRESS = '127.0.0.1';

/** Only plain DNS names ever reach the hosts file. */
function cleanNames(names) {
  return [...new Set((names || [])
    .map((name) => String(name || '').trim().toLowerCase())
    .filter((name) => /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(name)))];
}

function read(file = HOSTS_PATH) {
  try {
    return fs.readFileSync(file, 'utf-8');
  } catch {
    return '';
  }
}

/** The names inside HawCode's block, in file order. */
function namesIn(content) {
  const lines = String(content).split(/\r?\n/);
  const start = lines.indexOf(BEGIN);
  const end = lines.indexOf(END, start + 1);
  if (start < 0 || end < 0) return [];
  return lines.slice(start + 1, end)
    .map((line) => line.trim().split(/\s+/))
    .filter((parts) => parts.length >= 2 && !parts[0].startsWith('#'))
    .map((parts) => parts[1].toLowerCase());
}

/**
 * The file with HawCode's block replaced by one for `names` (or removed when
 * there are none). Everything outside the block is left byte for byte.
 */
function build(content, names) {
  const wanted = cleanNames(names);
  const lines = String(content).split(/\r?\n/);
  const start = lines.indexOf(BEGIN);
  const end = start >= 0 ? lines.indexOf(END, start + 1) : -1;
  const kept = start >= 0 && end >= 0 ? [...lines.slice(0, start), ...lines.slice(end + 1)] : lines;
  while (kept.length && kept[kept.length - 1].trim() === '') kept.pop();
  if (wanted.length) {
    kept.push('', BEGIN, ...wanted.map((name) => `${ADDRESS}\t${name}`), END);
  }
  return `${kept.join('\r\n')}\r\n`;
}

/** Whether every one of `names` already resolves to this PC through the hosts file. */
function status(names, file = HOSTS_PATH) {
  const wanted = cleanNames(names);
  const present = namesIn(read(file));
  return {
    path: file,
    names: present,
    ok: wanted.length > 0 && wanted.every((name) => present.includes(name))
  };
}

/**
 * An elevated step that writes the new file, for elevated.runElevated.
 *
 * The new content is prepared here, without rights, and only copied into place
 * elevated. Set-Content writes into the existing file, so its permissions stay
 * as Windows set them. The DNS cache is flushed so the name works at once.
 */
function step(names, file = HOSTS_PATH) {
  const content = build(read(file), names);
  const source = `${DIR_PLACEHOLDER}\\hosts.new`;
  // Stop turns a failed write into a non-zero exit, which is what gets reported.
  const script = "$ErrorActionPreference = 'Stop'; "
    + `Get-Content -LiteralPath ${psQuote(source)} | Set-Content -LiteralPath ${psQuote(file)} -Encoding ASCII; `
    + 'ipconfig /flushdns | Out-Null; exit 0';
  return {
    files: { 'hosts.new': content },
    entry: {
      id: 'hosts',
      name: cleanNames(names).length ? `Hosts file: ${cleanNames(names).join(', ')} -> this PC` : 'Hosts file: remove HawCode names',
      command: powershellCommand(script)
    }
  };
}

module.exports = { HOSTS_PATH, BEGIN, END, cleanNames, namesIn, build, status, step };
