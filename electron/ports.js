'use strict';

const { execFile } = require('child_process');
const path = require('path');

const LOOKUP_TIMEOUT_MS = 8000;

function run(file, args) {
  return new Promise((resolve) => {
    execFile(file, args, { windowsHide: true, timeout: LOOKUP_TIMEOUT_MS, encoding: 'utf-8' },
      (error, stdout) => resolve(error ? '' : String(stdout || '')));
  });
}

/**
 * Which process is listening on a port, by name.
 *
 * "Another program is using port 80" is the unhelpful half of that sentence — the
 * user cannot free a port they cannot identify. On this machine the answer is
 * usually HawCode itself, which is worth saying too rather than sending someone
 * hunting for a conflict that does not exist.
 */
async function owner(port, protocol = 'TCP') {
  const wanted = Number(port);
  if (!Number.isInteger(wanted) || wanted < 1) return null;
  if (process.platform !== 'win32') return null;

  const flags = protocol === 'UDP' ? ['-ano', '-p', 'UDP'] : ['-ano', '-p', 'TCP'];
  const output = await run('netstat', flags);
  if (!output) return null;

  let pid = null;
  for (const line of output.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/);
    // TCP  0.0.0.0:80  0.0.0.0:0  LISTENING  9856
    // UDP  0.0.0.0:53  *:*                   4242
    if (parts.length < 3) continue;
    if (parts[0] !== protocol) continue;
    const local = parts[1] || '';
    const colon = local.lastIndexOf(':');
    if (colon < 0 || Number(local.slice(colon + 1)) !== wanted) continue;
    if (protocol === 'TCP' && !/LISTENING/i.test(line)) continue;
    const candidate = Number(parts[parts.length - 1]);
    if (Number.isInteger(candidate) && candidate > 0) {
      pid = candidate;
      break;
    }
  }
  if (!pid) return null;

  // tasklist rather than PowerShell: no startup cost and no execution policy.
  const listed = await run('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH']);
  const match = listed.match(/^"([^"]+)"/);
  const image = match ? match[1] : null;
  return {
    port: wanted,
    protocol,
    pid,
    processName: image,
    // Worth distinguishing: "HawCode has it" is not a conflict to go and fix.
    isThisApp: Boolean(image && path.basename(process.execPath).toLowerCase() === image.toLowerCase())
  };
}

module.exports = { owner };
