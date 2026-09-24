'use strict';

/**
 * Framing for the peer-to-peer data channel.
 *
 * Two problems to solve. First, SCTP caps a single message at 256 KB and the
 * sync engine already hands us chunks exactly that big (CHUNK_SIZE in
 * electron/transfer.js), so anything carrying bytes has to be fragmented or the
 * channel tears down mid-transfer. Second, a data channel message is either
 * text or binary, never both, while a sync event is a JSON payload with a
 * Buffer hiding inside it.
 *
 * So each message goes out as one JSON header followed by its binary
 * fragments. Data channels are ordered and reliable, which is what makes that
 * pairing safe — the fragments cannot overtake their header or each other.
 *
 * Written without Buffer or require so that build-invite-page.js can inline
 * this file verbatim into the standalone browser client.
 */

// Well under the 64 KB that every engine handles comfortably, leaving room for
// the SCTP overhead on top of our own.
var FRAGMENT_SIZE = 48 * 1024;

function asUint8(value) {
  if (value instanceof Uint8Array) return value;
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  // A Buffer that crossed a process boundary can arrive as { type:'Buffer', data:[…] }.
  if (value && value.type === 'Buffer' && Array.isArray(value.data)) return new Uint8Array(value.data);
  return null;
}

/**
 * Pull the binary field out of a payload so the rest can be JSON. Only
 * `payload.bytes` is ever binary — that is the single convention the sync
 * engine uses (EV.FILE and EV.CHUNK).
 */
function splitBinary(payload) {
  if (!payload || typeof payload !== 'object') return { rest: payload, bytes: null };
  var candidate = payload.bytes;
  if (candidate === undefined || candidate === null) return { rest: payload, bytes: null };
  var bytes = asUint8(candidate);
  if (!bytes) return { rest: payload, bytes: null };
  var rest = {};
  for (var key in payload) {
    if (Object.prototype.hasOwnProperty.call(payload, key) && key !== 'bytes') rest[key] = payload[key];
  }
  return { rest: rest, bytes: bytes };
}

/** Turn one message into the frames to put on the channel, in order. */
function encodeFrames(message) {
  var split = splitBinary(message.payload);
  var header = {};
  for (var key in message) {
    if (Object.prototype.hasOwnProperty.call(message, key) && key !== 'payload') header[key] = message[key];
  }
  header.payload = split.rest;
  header.binLen = split.bytes ? split.bytes.length : 0;

  var frames = [JSON.stringify(header)];
  if (split.bytes) {
    for (var offset = 0; offset < split.bytes.length; offset += FRAGMENT_SIZE) {
      // slice() copies, which matters: the engine hands us subarray views onto
      // one big file buffer, and sending those directly would keep the whole
      // file alive until the last fragment drained.
      frames.push(split.bytes.slice(offset, offset + FRAGMENT_SIZE));
    }
  }
  return frames;
}

/**
 * Reassembles what encodeFrames produced. `onMessage` fires once per complete
 * message; `onError` fires on anything malformed, which for a public-facing
 * channel means anything a hostile peer might send.
 */
function createDecoder(onMessage, onError) {
  var pending = null;
  var received = 0;
  var parts = [];

  function fail(reason) {
    pending = null;
    received = 0;
    parts = [];
    if (onError) onError(reason);
  }

  return function feed(data) {
    if (typeof data === 'string') {
      if (pending) return fail('Text frame arrived while binary fragments were still outstanding');
      var header;
      try {
        header = JSON.parse(data);
      } catch {
        return fail('Unreadable frame');
      }
      if (!header || typeof header !== 'object') return fail('Unreadable frame');
      if (!header.binLen) {
        onMessage(header);
        return undefined;
      }
      if (typeof header.binLen !== 'number' || header.binLen < 0 || header.binLen > 64 * 1024 * 1024) {
        return fail('Frame declares an impossible size');
      }
      pending = header;
      received = 0;
      parts = [];
      return undefined;
    }

    var bytes = asUint8(data);
    if (!bytes) return fail('Unreadable binary frame');
    if (!pending) return fail('Binary fragment arrived with no header');

    parts.push(bytes);
    received += bytes.length;
    if (received < pending.binLen) return undefined;
    if (received > pending.binLen) return fail('Binary fragments overran the declared size');

    var joined = new Uint8Array(pending.binLen);
    var offset = 0;
    for (var i = 0; i < parts.length; i += 1) {
      joined.set(parts[i], offset);
      offset += parts[i].length;
    }
    var message = pending;
    pending = null;
    received = 0;
    parts = [];
    if (!message.payload || typeof message.payload !== 'object') message.payload = {};
    message.payload.bytes = joined;
    delete message.binLen;
    onMessage(message);
    return undefined;
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { encodeFrames: encodeFrames, createDecoder: createDecoder, FRAGMENT_SIZE: FRAGMENT_SIZE };
}
