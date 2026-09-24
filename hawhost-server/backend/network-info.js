'use strict';

const os = require('os');
const dgram = require('dgram');
const { execFile } = require('child_process');

function ipToInt(ip) {
  return ip.split('.').reduce((acc, o) => ((acc << 8) + Number(o)) >>> 0, 0);
}

function inRange(ip, cidr) {
  const [base, bits] = cidr.split('/');
  const mask = bits === '0' ? 0 : (~0 << (32 - Number(bits))) >>> 0;
  return (ipToInt(ip) & mask) === (ipToInt(base) & mask);
}

/** public | private | cgnat | loopback | linklocal | invalid */
function classifyIPv4(ip) {
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(String(ip || ''))) return 'invalid';
  if (inRange(ip, '127.0.0.0/8')) return 'loopback';
  if (inRange(ip, '169.254.0.0/16')) return 'linklocal';
  if (inRange(ip, '100.64.0.0/10')) return 'cgnat';
  if (['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '0.0.0.0/8'].some((c) => inRange(ip, c))) return 'private';
  return 'public';
}

const VIRTUAL_ADAPTER = /(vEthernet|VirtualBox|VMware|Hyper-V|WSL|Loopback|Docker|Tailscale|ZeroTier|Npcap|Bluetooth|TAP-|WireGuard|OpenVPN)/i;

function listAdapters() {
  const out = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family !== 'IPv4' && a.family !== 4) continue;
      if (a.internal) continue;
      out.push({ name, address: a.address, netmask: a.netmask, mac: a.mac, virtual: VIRTUAL_ADAPTER.test(name) });
    }
  }
  return out;
}

/**
 * The address this PC uses for its default route. A connected UDP socket makes
 * the OS pick the outgoing interface; nothing is actually sent.
 */
function routeSourceAddress() {
  return new Promise((resolve) => {
    const sock = dgram.createSocket('udp4');
    const done = (value) => {
      try { sock.close(); } catch { /* ignore */ }
      resolve(value);
    };
    sock.on('error', () => done(null));
    try {
      sock.connect(9, '192.0.2.1', () => {  // TEST-NET-1, never routed anywhere real
        try {
          done(sock.address().address);
        } catch {
          done(null);
        }
      });
    } catch {
      done(null);
    }
  });
}

function defaultGateways() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') {
      execFile('ip', ['-4', 'route', 'show', 'default'], { timeout: 4000 }, (err, stdout) => {
        const m = /default via (\S+)/.exec(stdout || '');
        resolve(m ? [{ gateway: m[1], iface: null, metric: 0 }] : []);
      });
      return;
    }
    execFile('route.exe', ['print', '-4', '0.0.0.0'], { timeout: 5000, windowsHide: true }, (err, stdout) => {
      const out = [];
      for (const line of String(stdout || '').split(/\r?\n/)) {
        const m = /^\s*0\.0\.0\.0\s+0\.0\.0\.0\s+(\d{1,3}(?:\.\d{1,3}){3})\s+(\d{1,3}(?:\.\d{1,3}){3})\s+(\d+)/.exec(line);
        if (m) out.push({ gateway: m[1], iface: m[2], metric: Number(m[3]) });
      }
      resolve(out.sort((a, b) => a.metric - b.metric));
    });
  });
}

async function getNetworkInfo() {
  const adapters = listAdapters();
  const [routeIp, gateways] = await Promise.all([routeSourceAddress(), defaultGateways()]);
  let localIp = routeIp && classifyIPv4(routeIp) !== 'loopback' ? routeIp : null;
  if (!localIp) {
    const physical = adapters.find((a) => !a.virtual && classifyIPv4(a.address) === 'private');
    localIp = (physical || adapters[0] || {}).address || '127.0.0.1';
  }
  const gw = gateways.find((g) => g.iface === localIp) || gateways[0] || null;
  const adapter = adapters.find((a) => a.address === localIp) || null;
  return {
    localIp,
    localIpType: classifyIPv4(localIp),
    gateway: gw ? gw.gateway : null,
    adapterName: adapter ? adapter.name : null,
    hostname: os.hostname(),
    adapters
  };
}

module.exports = { getNetworkInfo, classifyIPv4, listAdapters, inRange };
