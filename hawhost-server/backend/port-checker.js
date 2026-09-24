'use strict';

const net = require('net');
const http = require('http');
const https = require('https');
const { execFile } = require('child_process');

function run(cmd, args, timeout = 8000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => resolve(String(stdout || '')));
  });
}

/** TCP connect test. */
function checkTcp(host, port, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const started = Date.now();
    const socket = net.connect({ host, port });
    const done = (open, detail) => {
      socket.destroy();
      resolve({ host, port, open, detail, ms: Date.now() - started });
    };
    socket.setTimeout(timeoutMs, () => done(false, 'timeout'));
    socket.on('connect', () => done(true, 'open'));
    socket.on('error', (err) => done(false, err.code === 'ECONNREFUSED' ? 'refused' : (err.code || err.message)));
  });
}

/**
 * Which process listens on which TCP port (netstat + tasklist; both
 * locale-independent in the columns we read). PID 4 = "System", which means
 * the Windows HTTP driver (IIS, WinRM, Skype for Business, ...).
 */
async function listeningPorts() {
  if (process.platform !== 'win32') return new Map();
  const [netstat, tasklist] = await Promise.all([
    run('netstat.exe', ['-ano', '-p', 'TCP']),
    run('tasklist.exe', ['/FO', 'CSV', '/NH'])
  ]);
  const names = new Map();
  for (const line of tasklist.split(/\r?\n/)) {
    const m = /^"([^"]+)","(\d+)"/.exec(line);
    if (m) names.set(Number(m[2]), m[1]);
  }
  const byPort = new Map();
  for (const line of netstat.split(/\r?\n/)) {
    // TCP    0.0.0.0:80    0.0.0.0:0    LISTENING    1234   (state column may be localized; LISTEN rows have remote port 0)
    const m = /^\s*TCP\s+(\S+):(\d+)\s+\S+:0\s+\S+\s+(\d+)\s*$/.exec(line);
    if (!m) continue;
    const port = Number(m[2]);
    const pid = Number(m[3]);
    const list = byPort.get(port) || [];
    if (!list.some((e) => e.pid === pid)) {
      list.push({ pid, name: pid === 4 ? 'System (Windows HTTP.sys — IIS or another Windows service)' : (names.get(pid) || `PID ${pid}`), address: m[1] });
    }
    byPort.set(port, list);
  }
  return byPort;
}

async function portOwner(port) {
  const map = await listeningPorts();
  return map.get(port) || [];
}

/**
 * Asks http(s)://host:port/.well-known/hawhost-probe/<nonce> and checks the
 * answer came from *this* HawHost. Distinguishes "reached us" from "reached
 * something else" (usually the router's own admin page on its WAN address).
 */
function probeHttp({ host, port, tls = false, nonce, timeoutMs = 5000 }) {
  return new Promise((resolve) => {
    const started = Date.now();
    const lib = tls ? https : http;
    const req = lib.request({
      host,
      port,
      method: 'GET',
      path: `/.well-known/hawhost-probe/${nonce}`,
      headers: { Host: host.includes(':') ? `[${host}]:${port}` : `${host}:${port}`, 'User-Agent': 'HawHost-probe' },
      rejectUnauthorized: false,
      servername: tls && !net.isIP(host) ? host : undefined,
      agent: false
    }, (res) => {
      let body = '';
      res.setEncoding('utf-8');
      res.on('data', (d) => { if (body.length < 4096) body += d; });
      res.on('end', () => {
        const self = body.trim() === `hawhost:${nonce}`;
        resolve({
          host, port, tls,
          result: self ? 'reached' : 'other',
          detail: self ? 'Reached this computer through the router.' : `Something else answered (HTTP ${res.statusCode}${res.headers.server ? `, server "${res.headers.server}"` : ''}) — the router may be forwarding this port to a different device or showing its own page.`,
          ms: Date.now() - started
        });
      });
    });
    req.setTimeout(timeoutMs, () => req.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })));
    req.on('error', (err) => {
      const code = err.code || err.message;
      resolve({
        host, port, tls,
        result: code === 'ETIMEDOUT' ? 'timeout' : code === 'ECONNREFUSED' ? 'refused' : 'error',
        detail: code === 'ETIMEDOUT'
          ? 'No answer (port not forwarded, blocked by the ISP, or the router does not support NAT loopback).'
          : code === 'ECONNREFUSED'
            ? 'Connection refused (nothing forwarded on this port).'
            : `Connection failed (${code}).`,
        ms: Date.now() - started
      });
    });
    req.end();
  });
}

module.exports = { checkTcp, listeningPorts, portOwner, probeHttp };
