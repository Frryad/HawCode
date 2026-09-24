'use strict';

const os = require('os');

// Three seconds, to match the discovery beacon's cadence in discovery.js. Reading
// os.networkInterfaces() is a microsecond-scale syscall with no I/O, so this is
// free, and it is well inside the 60-second TTL the name server hands out — a
// device never caches a dead address for more than a minute.
const DEFAULT_INTERVAL_MS = 3000;
const FALLBACK = '127.0.0.1';

/** Turn a dotted quad into a number, or null if it is not one. */
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

function sameSubnet(address, other, netmask) {
  const a = toLong(address);
  const b = toLong(other);
  const mask = toLong(netmask);
  if (a === null || b === null || mask === null) return false;
  // Bitwise on values up to 2^32 must stay unsigned; >>> 0 does that.
  return ((a & mask) >>> 0) === ((b & mask) >>> 0);
}

/**
 * Every address this computer could plausibly be reached at.
 *
 * The 169.254 filter is not theoretical. A Windows machine routinely carries
 * link-local addresses on adapters that have no DHCP server — this one has two,
 * on hidden "Local Area Connection*" interfaces — and picking one of those would
 * register a name that nothing on the network can reach.
 */
function candidates() {
  const found = [];
  for (const [name, entries] of Object.entries(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (!entry || entry.internal) continue;
      // Node 18+ reports family as 'IPv4'; older builds used the number 4.
      if (entry.family !== 'IPv4' && entry.family !== 4) continue;
      if (!entry.address || entry.address.startsWith('169.254.')) continue;
      found.push({ name, address: entry.address, netmask: entry.netmask });
    }
  }
  return found;
}

/**
 * Pick the address to answer for.
 *
 * Gateway affinity first: on a machine with a VPN adapter, a Hyper-V switch and a
 * real Wi-Fi card, the only one that anything else on the network can route back
 * to is the one sharing a subnet with the default gateway. Interface order is not
 * a reliable substitute for that.
 */
function choose(gateway) {
  const list = candidates();
  if (!list.length) return FALLBACK;
  if (gateway) {
    const onGatewaySubnet = list.find((entry) => sameSubnet(entry.address, gateway, entry.netmask));
    if (onGatewaySubnet) return onGatewaySubnet.address;
  }
  return list[0].address;
}

/**
 * The single owner of "what is this computer's address right now".
 *
 * Everything that announces an address — the name server, mDNS, the LAN beacon,
 * the URL on screen — reads it from here, so a DHCP renewal or a Wi-Fi-to-Ethernet
 * switch moves all of them together instead of leaving some pointing at an address
 * that stopped existing.
 *
 * Polling rather than an event: Node exposes no interface-change notification, and
 * the Win32 API that would is unreachable without a native addon.
 */
function createLocalAddress({ onChange, getGateway, intervalMs = DEFAULT_INTERVAL_MS } = {}) {
  // An override for testing the re-registration path, which otherwise needs a
  // real network change or administrator rights to provoke.
  const forced = process.env.HAWCODE_FAKE_IP || null;
  let current = forced || choose(getGateway ? getGateway() : null);
  let timer = null;

  function read() {
    return process.env.HAWCODE_FAKE_IP || choose(getGateway ? getGateway() : null);
  }

  function check() {
    const next = read();
    if (next === current) return current;
    const previous = current;
    current = next;
    if (onChange) {
      try {
        onChange(next, previous);
      } catch (error) {
        console.error('HawCode could not apply an address change:', error.message);
      }
    }
    return current;
  }

  return {
    start() {
      if (timer) return;
      timer = setInterval(check, intervalMs);
      // Never hold the process open for this alone.
      if (timer.unref) timer.unref();
    },

    stop() {
      if (!timer) return;
      clearInterval(timer);
      timer = null;
    },

    /** Re-read now rather than waiting for the next tick. */
    refresh() {
      return check();
    },

    get current() {
      return current;
    },

    /** Every candidate, for the diagnostics panel. */
    get interfaces() {
      return candidates();
    }
  };
}

module.exports = { createLocalAddress, candidates, choose, sameSubnet, FALLBACK };
