'use strict';

const dgram = require('dgram');
const net = require('net');
const dns = require('dns');
const os = require('os');

const wire = require('./dns-wire');

const DNS_PORT = 53;
// Short, so a DHCP address change is not cached around the house for an hour.
const OWN_TTL_SECONDS = 60;
const UPSTREAM_TIMEOUT_MS = 4000;
const CACHE_MAX_ENTRIES = 2000;
const CACHE_TTL_MS = 30 * 1000;

function localAddresses() {
  const found = new Set(['127.0.0.1', '0.0.0.0', '::1']);
  const interfaces = os.networkInterfaces();
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries || []) found.add(entry.address);
  }
  return found;
}

/**
 * Work out who to forward to, once, at startup.
 *
 * The timing is the whole point. If this were read later — after the user had
 * pointed this machine at itself, which is exactly what someone testing their
 * own name server does — we would forward to ourselves and spin. Reading it
 * before we ever take over, and filtering out our own addresses, makes that
 * impossible rather than merely unlikely.
 */
function discoverUpstream(fallbackGateway) {
  const mine = localAddresses();
  const configured = [];
  try {
    for (const server of dns.getServers()) {
      const address = server.replace(/%.*$/, '').replace(/^\[|\]$/g, '');
      if (mine.has(address)) continue;
      if (address.includes(':')) continue; // IPv6 upstream, unusable from here
      configured.push(address);
    }
  } catch {
    // Fall through to the gateway.
  }
  if (configured.length) return configured;
  if (fallbackGateway && !mine.has(fallbackGateway)) return [fallbackGateway];
  return [];
}

function cacheKey(question) {
  return [question.name.toLowerCase(), question.type, question.klass].join('|');
}

/**
 * HawCode's name server: authoritative for the names this computer has issued,
 * a plain forwarder for everything else.
 *
 * The forwarding half is not a nicety. A phone can usually only be given one
 * DNS server, so the moment someone points a device here, this process is
 * answerable for every name that device looks up — not only ours. Getting that
 * wrong does not look like "the share is broken", it looks like "the internet
 * is broken", which is why every failure path below ends in either forwarding
 * or an honest SERVFAIL, and never in a dropped packet.
 */
// `gateway` may be the address itself or a function returning it, so a caller
// that reads the routing table in the background can still hand it over.
function createDnsServer({ getAddress, gateway, onStatus }) {
  const records = new Map();
  const cache = new Map();

  let udp = null;
  let tcp = null;
  let upstream = [];
  let running = false;
  let lastError = null;

  function status() {
    return {
      running,
      upstream: upstream.slice(),
      names: Array.from(records.keys()),
      error: lastError
    };
  }

  function report() {
    if (onStatus) onStatus(status());
  }

  function lookupOwn(name) {
    return records.get(String(name).toLowerCase()) || null;
  }

  function fromCache(question) {
    const key = cacheKey(question);
    const entry = cache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expires) {
      cache.delete(key);
      return null;
    }
    return entry.response;
  }

  function toCache(question, response) {
    if (cache.size >= CACHE_MAX_ENTRIES) {
      // Cheapest possible eviction: drop the oldest insertion.
      const oldest = cache.keys().next();
      if (!oldest.done) cache.delete(oldest.value);
    }
    cache.set(cacheKey(question), { response, expires: Date.now() + CACHE_TTL_MS });
  }

  /** Ask upstream and hand back the raw reply, id and all. */
  function forward(message) {
    return new Promise((resolve) => {
      if (!upstream.length) {
        resolve(null);
        return;
      }

      let index = 0;
      const attempt = () => {
        if (index >= upstream.length) {
          resolve(null);
          return;
        }
        const target = upstream[index];
        index += 1;

        const socket = dgram.createSocket('udp4');
        let settled = false;
        const timer = setTimeout(() => done(null), UPSTREAM_TIMEOUT_MS);

        function done(value) {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          try { socket.close(); } catch { /* already closed */ }
          if (value) resolve(value);
          else attempt();
        }

        socket.on('message', (reply) => done(reply));
        socket.on('error', () => done(null));
        socket.send(message, 0, message.length, DNS_PORT, target, (error) => {
          if (error) done(null);
        });
      };
      attempt();
    });
  }

  /**
   * Answer one query. Returns the bytes to send back, or null when there is
   * nothing sensible to say at all.
   */
  async function answer(message) {
    const query = wire.parseQuery(message);
    if (!query || query.isResponse || !query.questions.length) return null;

    const question = query.questions[0];
    const owned = lookupOwn(question.name);

    if (owned) {
      const address = owned.ip || (getAddress && getAddress());
      if (question.type === wire.TYPE_A || question.type === wire.TYPE_ANY) {
        return wire.buildResponse(query, message, {
          answers: address
            ? [{ name: question.name, type: wire.TYPE_A, ip: address, ttl: OWN_TTL_SECONDS }]
            : []
        });
      }
      // The name is ours but has no record of the type asked for — AAAA, most
      // often. NOERROR with no answers, never NXDOMAIN: a client told the name
      // does not exist will not come back and ask for an A record instead.
      return wire.buildResponse(query, message, { answers: [] });
    }

    const cached = fromCache(question);
    if (cached) {
      const reply = Buffer.from(cached);
      reply.writeUInt16BE(query.id, 0);
      return reply;
    }

    const forwarded = await forward(message);
    if (forwarded) {
      toCache(question, forwarded);
      return forwarded;
    }

    // Nowhere left to ask. Say so plainly rather than leaving the client to sit
    // through its own timeout.
    return wire.buildResponse(query, message, {
      rcode: wire.RCODE_SERVFAIL,
      authoritative: false
    });
  }

  function startUdp() {
    return new Promise((resolve, reject) => {
      udp = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      udp.once('error', reject);
      udp.on('message', async (message, remote) => {
        const reply = await answer(message);
        if (!reply || !udp) return;
        udp.send(reply, 0, reply.length, remote.port, remote.address, () => {});
      });
      udp.bind(DNS_PORT, '0.0.0.0', () => {
        udp.removeListener('error', reject);
        udp.on('error', (error) => {
          lastError = error.message;
          report();
        });
        resolve();
      });
    });
  }

  /**
   * TCP is not optional. Once a device uses this as its only resolver, any
   * truncated answer sends it here, and a missing listener looks exactly like
   * a dead network.
   */
  function startTcp() {
    return new Promise((resolve, reject) => {
      tcp = net.createServer((socket) => {
        let buffer = Buffer.alloc(0);
        socket.on('data', async (chunk) => {
          buffer = Buffer.concat([buffer, chunk]);
          // DNS over TCP prefixes each message with its length.
          while (buffer.length >= 2) {
            const length = buffer.readUInt16BE(0);
            if (buffer.length < length + 2) break;
            const message = buffer.subarray(2, length + 2);
            buffer = buffer.subarray(length + 2);
            const reply = await answer(message);
            if (!reply) continue;
            const framed = Buffer.alloc(2 + reply.length);
            framed.writeUInt16BE(reply.length, 0);
            reply.copy(framed, 2);
            socket.write(framed);
          }
        });
        socket.on('error', () => socket.destroy());
        socket.setTimeout(20000, () => socket.destroy());
      });
      tcp.once('error', reject);
      tcp.listen(DNS_PORT, '0.0.0.0', () => {
        tcp.removeListener('error', reject);
        tcp.on('error', (error) => {
          lastError = error.message;
          report();
        });
        resolve();
      });
    });
  }

  async function stop() {
    running = false;
    if (udp) {
      try { udp.close(); } catch { /* already closed */ }
      udp = null;
    }
    if (tcp) {
      try { tcp.close(); } catch { /* already closed */ }
      tcp = null;
    }
    cache.clear();
    report();
  }

  return {
    async start() {
      if (running) return { ok: true, upstream: upstream.slice() };
      upstream = discoverUpstream(typeof gateway === 'function' ? gateway() : gateway);
      lastError = null;
      try {
        await startUdp();
        await startTcp();
      } catch (error) {
        await stop();
        lastError = error.code === 'EADDRINUSE'
          ? 'Another program on this computer is already answering DNS on port 53.'
          : error.message;
        report();
        return { error: lastError };
      }
      running = true;
      report();
      return { ok: true, upstream: upstream.slice() };
    },

    stop,

    /** Start answering for a name this computer has issued. */
    register(name, ip) {
      if (!name) return;
      records.set(String(name).toLowerCase(), { ip: ip || null });
      report();
    },

    unregister(name) {
      if (!name) return;
      records.delete(String(name).toLowerCase());
      report();
    },

    clear() {
      records.clear();
      report();
    },

    /** Backs the UI's "is it actually answering?" check. */
    resolveLocally(name) {
      const owned = lookupOwn(name);
      if (!owned) return null;
      return owned.ip || (getAddress && getAddress()) || null;
    },

    get status() {
      return status();
    }
  };
}

module.exports = { createDnsServer, DNS_PORT, discoverUpstream };
