'use strict';

const os = require('os');

const { createDecoder, encodeFrames } = require('./wire');
const { EV } = require('../sync-engine');

const LINK_ID = 'host';

/** The engine deals in Buffers; the wire hands us Uint8Arrays. Wrap, do not copy. */
function toBuffer(bytes) {
  if (!bytes) return bytes;
  if (Buffer.isBuffer(bytes)) return bytes;
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/**
 * The joining side of a direct connection.
 *
 * Deliberately the same shape as connectToHost in electron/peer-client.js: once
 * the greeting is accepted this registers one link with the engine and hands
 * every event straight over. The engine's protocol is symmetric, so nothing
 * below this line knows whether it is talking over a LAN socket or a data
 * channel punched through two carriers' NATs.
 */
function createJoinLink({ peerId, engine, code, sendFrame, onStatus }) {
  let authed = false;
  let closed = false;

  function post(message) {
    if (closed) return;
    for (const frame of encodeFrames(message)) sendFrame(frame);
  }

  function report(patch) {
    if (onStatus) onStatus({ peerId, ...patch });
  }

  return {
    peerId,

    /** Called once the channel is open: greet the host with the invite's code. */
    start() {
      post({ k: 'auth', code, desktop: true, name: os.hostname() });
      report({ connected: false, state: 'greeting' });
    },

    feed: createDecoder(
      (message) => {
        if (closed || !message || typeof message.k !== 'string') return;

        if (message.k === 'auth-ok') {
          authed = true;
          engine.addLink({
            id: LINK_ID,
            name: 'host',
            emit: (event, payload) => post({ k: 'ev', ev: event, payload })
          });
          // Diff manifests straight away, so joining only moves what differs.
          engine.requestReconcile(LINK_ID);
          report({
            connected: true,
            state: 'connected',
            folderName: (message.payload && message.payload.folderName) || null,
            // Adopting the host's name is what makes the same address work on
            // both sides — served here from the copy the engine keeps locally.
            domain: (message.payload && message.payload.domain) || null
          });
          return;
        }

        if (message.k === 'auth-failed') {
          report({ connected: false, state: 'refused', error: 'bad-code' });
          return;
        }

        if (!authed || message.k !== 'ev') return;
        if (!Object.values(EV).includes(message.ev)) return;
        if (message.payload && message.payload.bytes) {
          message.payload.bytes = toBuffer(message.payload.bytes);
        }
        engine.handleRemote(LINK_ID, message.ev, message.payload);
      },
      (reason) => report({ connected: false, state: 'error', error: reason })
    ),

    close(reason) {
      if (closed) return;
      closed = true;
      if (authed) engine.removeLink(LINK_ID);
      report({ connected: false, state: 'closed', reason });
    },

    get connected() {
      return authed && !closed;
    }
  };
}

module.exports = { createJoinLink, LINK_ID };
