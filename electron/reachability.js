'use strict';

const dgram = require('dgram');
const crypto = require('crypto');

// RFC 5389. The cookie is what distinguishes a STUN response from anything else
// that might arrive on the socket, and it is also the XOR key for the address.
const MAGIC_COOKIE = 0x2112a442;
const BINDING_REQUEST = 0x0001;
const BINDING_SUCCESS = 0x0101;
const ATTR_MAPPED_ADDRESS = 0x0001;
const ATTR_XOR_MAPPED_ADDRESS = 0x0020;
const FAMILY_IPV4 = 0x01;

const STUN_TIMEOUT_MS = 2500;
const PROBE_TIMEOUT_MS = 6000;
const DOH_TIMEOUT_MS = 6000;

// Ranges that mean "this is not a public address", and therefore that no port can
// be forwarded to it from the internet.
const CGNAT_RANGE = { base: '100.64.0.0', bits: 10 };
const PRIVATE_RANGES = [
  { base: '10.0.0.0', bits: 8 },
  { base: '172.16.0.0', bits: 12 },
  { base: '192.168.0.0', bits: 16 },
  { base: '169.254.0.0', bits: 16 },
  { base: '127.0.0.0', bits: 8 }
];

function toLong(address) {
  const parts = String(address || '').split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    const octet = Number(part);
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) return null;
    value = (value * 256) + octet;
  }
  return value;
}

function inRange(address, range) {
  const value = toLong(address);
  const base = toLong(range.base);
  if (value === null || base === null) return false;
  const mask = range.bits === 0 ? 0 : (0xffffffff << (32 - range.bits)) >>> 0;
  return ((value & mask) >>> 0) === ((base & mask) >>> 0);
}

function isCgnat(address) {
  return inRange(address, CGNAT_RANGE);
}

function isPrivate(address) {
  return PRIVATE_RANGES.some((range) => inRange(address, range));
}

/** Split 'stun.example.com:3478' into its parts, defaulting the port. */
function parseServer(entry) {
  const text = String(entry || '').trim().replace(/^stun:/i, '');
  const match = text.match(/^\[?([^\]]+?)\]?(?::(\d+))?$/);
  if (!match) return null;
  return { host: match[1], port: Number(match[2] || 3478) };
}

/** Pull the reflexive address out of a STUN success response. */
function parseStunResponse(message, transactionId) {
  if (!message || message.length < 20) return null;
  if (message.readUInt16BE(0) !== BINDING_SUCCESS) return null;
  if (message.readUInt32BE(4) !== MAGIC_COOKIE) return null;
  if (!message.subarray(8, 20).equals(transactionId)) return null;

  const length = message.readUInt16BE(2);
  let offset = 20;
  const end = Math.min(20 + length, message.length);

  while (offset + 4 <= end) {
    const type = message.readUInt16BE(offset);
    const valueLength = message.readUInt16BE(offset + 2);
    const value = message.subarray(offset + 4, offset + 4 + valueLength);
    // Attributes are padded to a multiple of four bytes.
    offset += 4 + valueLength + ((4 - (valueLength % 4)) % 4);

    if (value.length < 8) continue;
    if (value.readUInt8(1) !== FAMILY_IPV4) continue;

    if (type === ATTR_XOR_MAPPED_ADDRESS) {
      // The address is stored XORed with the cookie, so that a NAT rewriting any
      // payload it recognises as an address cannot silently corrupt it.
      const xored = value.readUInt32BE(4) ^ MAGIC_COOKIE;
      return [24, 16, 8, 0].map((shift) => (xored >>> shift) & 0xff).join('.');
    }
    if (type === ATTR_MAPPED_ADDRESS) {
      return Array.from(value.subarray(4, 8)).join('.');
    }
  }
  return null;
}

/** One STUN round trip against one server. */
function askStun(server) {
  return new Promise((resolve) => {
    const target = parseServer(server);
    if (!target) {
      resolve(null);
      return;
    }

    const transactionId = crypto.randomBytes(12);
    const request = Buffer.alloc(20);
    request.writeUInt16BE(BINDING_REQUEST, 0);
    request.writeUInt16BE(0, 2);
    request.writeUInt32BE(MAGIC_COOKIE, 4);
    transactionId.copy(request, 8);

    const socket = dgram.createSocket('udp4');
    let settled = false;

    const done = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { socket.close(); } catch { /* already closed */ }
      resolve(value);
    };

    const timer = setTimeout(() => done(null), STUN_TIMEOUT_MS);
    socket.on('message', (message) => done(parseStunResponse(message, transactionId)));
    socket.on('error', () => done(null));
    socket.send(request, 0, request.length, target.port, target.host, (error) => {
      if (error) done(null);
    });
  });
}

async function fetchHttpPublicIp() {
  const endpoints = [
    { url: 'https://api.ipify.org?format=json', parse: (data) => (typeof data === 'object' ? data.ip : String(data).trim()) },
    { url: 'https://icanhazip.com', parse: (data) => String(data).trim() },
    { url: 'https://ifconfig.me/ip', parse: (data) => String(data).trim() }
  ];
  for (const ep of endpoints) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3500);
      const res = await fetch(ep.url, { signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) continue;
      const text = await res.text();
      let candidate = text;
      try {
        const parsedJson = JSON.parse(text);
        candidate = ep.parse(parsedJson);
      } catch {
        candidate = ep.parse(text);
      }
      if (candidate && /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(candidate)) {
        return candidate;
      }
    } catch {
      /* try next endpoint */
    }
  }
  return null;
}

/**
 * How this computer looks from outside, and whether anything can be forwarded to it.
 *
 * STUN + HTTP IP fallback: STUN is tried first for fast UDP resolution; if UDP STUN
 * fails or is blocked by firewall, HTTP public IP lookup provides a reliable fallback.
 */
function createReachability({ getStunServers, getGateway, getLocalAddress } = {}) {
  let cachedPublicIp = null;

  /** Ask each configured server in turn until one answers; fallback to HTTP IP lookup if UDP STUN fails. */
  async function publicAddress() {
    const servers = (getStunServers ? getStunServers() : []) || [];
    for (const server of servers) {
      const address = await askStun(server);
      if (address) {
        cachedPublicIp = address;
        return address;
      }
    }
    const httpIp = await fetchHttpPublicIp();
    if (httpIp) {
      cachedPublicIp = httpIp;
      return httpIp;
    }
    return cachedPublicIp;
  }

  /**
   * What the rest of the internet sees for a name.
   *
   * DNS is global, so a public resolver is a genuine outside observer — this is the
   * one check that can prove a name landed without a second internet connection.
   * Only the hostname is sent.
   */
  async function resolvePublic(name) {
    const endpoints = [
      { url: `https://dns.google/resolve?name=${encodeURIComponent(name)}&type=A`, headers: {} },
      {
        url: `https://dns.quad9.net:5053/dns-query?name=${encodeURIComponent(name)}&type=A`,
        headers: { accept: 'application/dns-json' }
      }
    ];
    for (const endpoint of endpoints) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), DOH_TIMEOUT_MS);
        const response = await fetch(endpoint.url, {
          headers: endpoint.headers,
          signal: controller.signal
        });
        clearTimeout(timer);
        if (!response.ok) continue;
        const body = await response.json();
        const addresses = (body.Answer || [])
          .filter((entry) => entry.type === 1 && typeof entry.data === 'string')
          .map((entry) => entry.data.trim());
        // An empty answer is still an answer: the name simply does not resolve yet.
        return { addresses, via: new URL(endpoint.url).hostname };
      } catch {
        // Try the second opinion.
      }
    }
    return { addresses: [], via: null, error: 'No public resolver could be reached' };
  }

  /**
   * Try to fetch our own unauthenticated /api/hello through the public address.
   *
   * Success is strong evidence the forward works. Failure proves nothing at all —
   * plenty of routers will not send a packet back to the network it came from — so
   * a failure here must never be shown as "the port is closed".
   */
  async function probeHostPort(host, port) {
    const url = `http://${host}${port && port !== 80 ? `:${port}` : ''}/api/hello`;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
      const response = await fetch(url, { signal: controller.signal, redirect: 'manual' });
      clearTimeout(timer);
      return { ok: response.ok, status: response.status, url };
    } catch (error) {
      return { ok: false, url, error: error.name === 'AbortError' ? 'timed out' : error.message };
    }
  }

  /**
   * The verdict that decides whether internet mode is worth attempting at all.
   *
   * Deliberately says 'unknown-public' rather than guessing: past this point the
   * only way to be certain is to compare with the address on the router's own
   * status page, which is a step only the user can take.
   */
  function classify({ reflexive, local }) {
    if (!reflexive) {
      return {
        verdict: 'unknown',
        label: 'Undetected',
        canForward: null,
        summary: 'This computer could not work out how it looks from outside.',
        advice: 'Check the address-reflection servers under Settings, Direct sharing.'
      };
    }
    if (isCgnat(reflexive)) {
      return {
        verdict: 'cgnat',
        label: 'Carrier CGNAT',
        canForward: false,
        summary: 'Your internet provider shares one address between several customers.',
        advice: 'No port can be forwarded to a connection like this, whatever the router '
          + 'offers. Use Direct sharing instead, or ask your provider for a public address.'
      };
    }
    if (isPrivate(reflexive)) {
      return {
        verdict: 'double-nat',
        label: 'Double NAT Router',
        canForward: false,
        summary: 'There is a second router between yours and the internet.',
        advice: 'Forward the port on both boxes, or put the provider box into bridge mode. '
          + 'Direct sharing works either way.'
      };
    }
    if (local && reflexive === local) {
      return {
        verdict: 'public-direct',
        label: 'Direct Public IP',
        canForward: true,
        summary: 'This computer holds the public address itself.',
        advice: 'Nothing needs forwarding — allowing the ports through Windows Firewall is enough.'
      };
    }
    return {
      verdict: 'public-ip',
      label: 'Public IP (Port Forwarding Ready)',
      canForward: true,
      summary: `Public address detected (${reflexive}). Port forwarding is supported!`,
      advice: 'Forward the TCP port on your router to this computer. If your router status page '
        + `shows an internet address other than ${reflexive}, there is another router in `
        + 'front of it and forwarding one box will not be enough.'
    };
  }

  let pathCache = null;

  /**
   * Find out whether the public address sits on a box in this home at all.
   *
   * STUN shows the address the world sees, but not who holds it. With carrier
   * NAT the address is a normal-looking public one (so `classify` cannot tell),
   * yet it belongs to the provider's equipment and no forwarding here can reach
   * it. A traceroute to our own public address shows the difference. A router
   * that holds it answers as the destination. Otherwise the packet is forwarded
   * past every box in the house into the provider's network, and a router
   * that forwards it is by definition not the one holding the address.
   *
   * Windows only (tracert); elsewhere, and on any failure, the verdict is
   * 'unknown' and nothing else changes.
   */
  function tracePublic(publicIp, { maxHops = 5, force = false } = {}) {
    if (!publicIp || process.platform !== 'win32') return Promise.resolve({ verdict: 'unknown', hops: [] });
    if (!force && pathCache && pathCache.ip === publicIp && Date.now() - pathCache.at < 10 * 60 * 1000) {
      return Promise.resolve(pathCache.result);
    }
    return new Promise((resolve) => {
      require('child_process').execFile('tracert', ['-d', '-h', String(maxHops), '-w', '600', publicIp],
        { windowsHide: true, timeout: 30000, encoding: 'utf-8' }, (_error, stdout) => {
          const hops = [];
          for (const line of String(stdout || '').split(/\r?\n/)) {
            const match = /^\s*(\d+)\s+(.*)$/.exec(line);
            if (!match) continue;
            const address = (/(\d{1,3}(?:\.\d{1,3}){3})\s*$/.exec(match[2]) || [])[1] || null;
            hops.push({ hop: Number(match[1]), address });
          }
          const reached = hops.find((entry) => entry.address === publicIp);
          const answered = hops.filter((entry) => entry.address && entry.address !== publicIp);
          let verdict = 'unknown';
          if (reached) {
            verdict = 'owned';
          } else if (answered.length >= 2) {
            // At least two boxes forwarded a packet addressed to "us" onwards,
            // so neither of them holds the address.
            verdict = 'carrier';
          }
          const result = { verdict, hops, reachedAtHop: reached ? reached.hop : null };
          pathCache = { ip: publicIp, at: Date.now(), result };
          resolve(result);
        });
    });
  }

  /** `classify`, corrected by the traceroute when it proves carrier NAT. */
  async function classifyDeep({ reflexive, local, fresh = false }) {
    const base = classify({ reflexive, local });
    if (!reflexive || base.canForward === false) return base;
    const path = await tracePublic(reflexive, { force: fresh }).catch(() => ({ verdict: 'unknown', hops: [] }));
    if (path.verdict !== 'carrier') return { ...base, path };
    const route = path.hops.filter((entry) => entry.address).map((entry) => entry.address).join(' → ');
    return {
      verdict: 'cgnat-hidden',
      label: 'Carrier NAT (shared address)',
      canForward: false,
      path,
      summary: `${reflexive} is not held by any router in your home. Your provider shares it `
        + 'between customers (carrier-grade NAT), so visitors who open it time out.',
      advice: `Traffic to ${reflexive} leaves your routers (${route}) and goes into the provider's `
        + 'network. No port forwarding, DMZ or firewall setting here can open it. Ask your internet '
        + 'provider for a public (real / static) IPv4 address, or for IPv6. After that, forward the port '
        + 'on each box (HawCode opens your own router automatically). Until then, use Wi-Fi sharing '
        + 'or Direct P2P.'
    };
  }

  /** Everything the diagnostics panel needs, in one call. */
  async function inspect({ hostname, port, fresh = false } = {}) {
    const local = getLocalAddress ? getLocalAddress() : null;
    const reflexive = await publicAddress();
    const result = {
      localIp: local,
      gateway: getGateway ? getGateway() : null,
      publicIp: reflexive,
      reflexive,
      ...(await classifyDeep({ reflexive, local, fresh }))
    };
    if (!hostname) return result;

    result.resolved = await resolvePublic(hostname);
    result.pointsHere = Boolean(
      reflexive && result.resolved.addresses && result.resolved.addresses.includes(reflexive)
    );
    if (result.canForward !== false) {
      // Hairpin attempt: informative when it works, meaningless when it does not.
      result.hairpin = await probeHostPort(hostname, port);
    }
    return result;
  }

  return {
    publicAddress,
    resolvePublic,
    probeHostPort,
    classify,
    classifyDeep,
    tracePublic,
    inspect,
    getCachedPublicIp: () => cachedPublicIp
  };
}

module.exports = {
  createReachability,
  isCgnat,
  isPrivate,
  parseServer,
  parseStunResponse
};
