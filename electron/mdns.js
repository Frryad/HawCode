'use strict';

const dgram = require('dgram');

const { readName, encodeName, TYPE_A, TYPE_ANY } = require('./dns-wire');

const MDNS_ADDRESS = '224.0.0.251';
const MDNS_PORT = 5353;
const HOSTNAME = 'hawcode.local';
const TTL_SECONDS = 120;
// Top bit of the class field: "this answer replaces anything cached", which is
// what stops a stale address lingering after the host moves to another network.
const CLASS_IN_FLUSH = 0x8001;

function buildResponse(ip) {
  const header = Buffer.alloc(12);
  header.writeUInt16BE(0, 0);       // mDNS responses carry no transaction id
  header.writeUInt16BE(0x8400, 2);  // response, authoritative
  header.writeUInt16BE(0, 4);       // no questions echoed back
  header.writeUInt16BE(1, 6);       // one answer

  const name = encodeName(HOSTNAME);
  const record = Buffer.alloc(10);
  record.writeUInt16BE(TYPE_A, 0);
  record.writeUInt16BE(CLASS_IN_FLUSH, 2);
  record.writeUInt32BE(TTL_SECONDS, 4);
  record.writeUInt16BE(4, 8);

  const address = Buffer.from(ip.split('.').map((part) => Number(part) & 0xff));
  return Buffer.concat([header, name, record, address]);
}

/**
 * Answers `hawcode.local` on the local network.
 *
 * Purely a convenience for friends on the same Wi-Fi, so they get a name
 * instead of an IP that changes with the DHCP lease. It has no bearing on
 * remote access: `.local` stops at the router by design, and behind
 * carrier-grade NAT there is no name that could reach this machine from
 * outside anyway — that is what the invite codes are for.
 */
function createMdnsResponder({ getAddress }) {
  let socket = null;

  function start() {
    if (socket) return;
    const address = getAddress();
    if (!address || address === '127.0.0.1') return;

    try {
      socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    } catch (error) {
      console.error('HawCode could not open the mDNS socket:', error.message);
      socket = null;
      return;
    }

    socket.on('error', (error) => {
      // Windows already runs a responder on this port in some configurations.
      // Losing the friendly name is not worth failing the share over.
      console.error('HawCode mDNS responder stopped:', error.message);
      stop();
    });

    socket.on('message', (message) => {
      if (message.length < 12) return;
      // Ignore responses; only queries need answering.
      if (message.readUInt16BE(2) & 0x8000) return;
      const questions = message.readUInt16BE(4);
      let offset = 12;
      for (let index = 0; index < questions; index += 1) {
        const parsed = readName(message, offset);
        if (!parsed || parsed.offset + 4 > message.length) return;
        const type = message.readUInt16BE(parsed.offset);
        offset = parsed.offset + 4;
        if (parsed.name.toLowerCase() !== HOSTNAME) continue;
        if (type !== TYPE_A && type !== TYPE_ANY) continue;
        const reply = buildResponse(getAddress());
        socket.send(reply, 0, reply.length, MDNS_PORT, MDNS_ADDRESS);
        return;
      }
    });

    socket.bind(MDNS_PORT, () => {
      try {
        socket.addMembership(MDNS_ADDRESS);
      } catch (error) {
        console.error('HawCode could not join the mDNS group:', error.message);
      }
    });
  }

  function stop() {
    if (!socket) return;
    try { socket.close(); } catch { /* already closed */ }
    socket = null;
  }

  return { start, stop, hostname: HOSTNAME };
}

module.exports = { createMdnsResponder, HOSTNAME };
