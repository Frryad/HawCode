'use strict';

const fs = require('fs');

const { createDecoder, encodeFrames } = require('./wire');
const { codeMatches } = require('../server');
const { EV } = require('../sync-engine');

// A friend who connects and then says nothing is either a stale invite or
// somebody poking at the port. Either way, do not keep the door open.
const AUTH_TIMEOUT_MS = 20000;

/** The engine deals in Buffers; the wire hands us Uint8Arrays. Wrap, do not copy. */
function toBuffer(bytes) {
  if (!bytes) return bytes;
  if (Buffer.isBuffer(bytes)) return bytes;
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function normaliseIncoming(payload) {
  if (payload && payload.bytes) payload.bytes = toBuffer(payload.bytes);
  return payload;
}

/**
 * One friend, on the far end of one data channel.
 *
 * This is the whole security boundary for peer-to-peer sharing, so it is
 * deliberately narrow: until the room code checks out nothing is answered, and
 * even afterwards the only things reachable are the five workspace operations
 * in electron/api.js. Terminals, scripts and git stay where they are — local to
 * the desktop app — exactly as they already do for the network server.
 */
function createChannelLink({ peerId, api, engine, roomCode, sendFrame, onAuthed, onClose }) {
  let authed = false;
  let isDesktop = false;
  let name = null;
  let closed = false;

  const authTimer = setTimeout(() => {
    if (!authed) close('The friend never sent the invite code');
  }, AUTH_TIMEOUT_MS);

  function post(message) {
    if (closed) return;
    for (const frame of encodeFrames(message)) sendFrame(frame);
  }

  function close(reason) {
    if (closed) return;
    closed = true;
    clearTimeout(authTimer);
    if (authed && isDesktop) engine.removeLink(peerId);
    if (onClose) onClose(reason);
  }

  function handleAuth(message) {
    if (!codeMatches(roomCode, message.code)) {
      post({ k: 'auth-failed', reason: 'bad-code' });
      close('The friend used the wrong code');
      return;
    }
    authed = true;
    clearTimeout(authTimer);
    isDesktop = Boolean(message.desktop);
    name = typeof message.name === 'string' && message.name.trim()
      ? message.name.trim().slice(0, 40)
      : `friend-${peerId.slice(0, 6)}`;

    post({ k: 'auth-ok', payload: api.hello(roomCode).body });

    if (isDesktop) {
      // Same shape of link the LAN server registers, so everything downstream —
      // manifests, chunking, conflicts, presence — is entirely unaware that this
      // peer arrived through a hole in the carrier's NAT.
      engine.addLink({
        id: peerId,
        name,
        emit: (event, payload) => post({ k: 'ev', ev: event, payload })
      });
      engine.requestReconcile(peerId);
    }
    if (onAuthed) onAuthed({ name, isDesktop });
  }

  function handleRequest(message) {
    const args = message.args || {};
    const id = message.id;
    let reply;
    switch (message.op) {
      case 'hello':
        reply = api.hello(roomCode);
        break;
      case 'tree':
        reply = api.tree();
        break;
      case 'read':
        reply = api.read(args.path);
        break;
      case 'write':
        reply = api.write(args.path, args.content);
        break;
      case 'raw': {
        const resolved = api.raw(args.path);
        if (!resolved.ok) {
          reply = resolved;
          break;
        }
        try {
          reply = {
            ok: true,
            status: 200,
            body: { bytes: fs.readFileSync(resolved.body.absolute) }
          };
        } catch {
          reply = { ok: false, status: 404, body: { error: 'File not found' } };
        }
        break;
      }
      default:
        reply = { ok: false, status: 400, body: { error: `Unknown operation "${message.op}"` } };
    }
    post({ k: 'res', id, ok: reply.ok, status: reply.status, payload: reply.body });
  }

  const decode = createDecoder(
    (message) => {
      if (closed || !message || typeof message.k !== 'string') return;

      if (!authed) {
        // Nothing but the greeting is answered before the code is checked.
        if (message.k === 'auth') handleAuth(message);
        else close('The friend spoke before sending the invite code');
        return;
      }

      switch (message.k) {
        case 'req':
          handleRequest(message);
          break;
        case 'ev':
          if (!isDesktop) return;
          if (!Object.values(EV).includes(message.ev)) return;
          engine.handleRemote(peerId, message.ev, normaliseIncoming(message.payload));
          break;
        default:
          break;
      }
    },
    (reason) => close(`The connection sent something unreadable: ${reason}`)
  );

  return {
    peerId,
    feed: decode,
    close,
    /** Push a change to a browser friend, which runs no sync engine of its own. */
    notify(event, payload) {
      if (!authed || isDesktop) return;
      post({ k: 'push', ev: event, payload });
    },
    get info() {
      return { id: peerId, name, desktop: isDesktop, authed };
    }
  };
}

module.exports = { createChannelLink };
