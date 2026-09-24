'use strict';

const zlib = require('zlib');

// HAW1 is gzipped, HAW0 is plain base64url. The browser invite page emits
// whichever its engine supports — CompressionStream is not everywhere yet — so
// the host has to understand both.
const GZIP_PREFIX = 'HAW1-';
const PLAIN_PREFIX = 'HAW0-';
const INVITE_VERSION = 1;

function toBase64Url(buffer) {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text) {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(padded + '='.repeat((4 - (padded.length % 4)) % 4), 'base64');
}

/**
 * Pack a signalling payload into something a person can paste into a chat app.
 *
 * The whole point of this module: because there is no signalling server, the
 * offer and the answer travel by whatever messenger the two friends already
 * use. So the output has to survive being pasted — no newlines, no characters
 * a chat client might turn into a smiley or a link.
 */
function encode(payload) {
  const json = JSON.stringify({ v: INVITE_VERSION, ...payload });
  return GZIP_PREFIX + toBase64Url(zlib.gzipSync(Buffer.from(json, 'utf-8'), { level: 9 }));
}

/**
 * Unpack a code. Returns `{ error }` rather than throwing: every caller here is
 * handling something a user pasted by hand, where a typo is the normal case and
 * not an exceptional one.
 */
function decode(code) {
  const cleaned = String(code || '').trim().replace(/\s+/g, '');
  if (!cleaned) return { error: 'Paste an invite code first' };

  let body;
  let gzipped;
  if (cleaned.startsWith(GZIP_PREFIX)) {
    body = cleaned.slice(GZIP_PREFIX.length);
    gzipped = true;
  } else if (cleaned.startsWith(PLAIN_PREFIX)) {
    body = cleaned.slice(PLAIN_PREFIX.length);
    gzipped = false;
  } else {
    return { error: 'That does not look like a HawCode invite code' };
  }

  try {
    const raw = fromBase64Url(body);
    const json = (gzipped ? zlib.gunzipSync(raw) : raw).toString('utf-8');
    const parsed = JSON.parse(json);
    if (!parsed || parsed.v !== INVITE_VERSION) {
      return { error: 'This code was made by a different version of HawCode' };
    }
    if (!parsed.sdp || typeof parsed.sdp !== 'string') {
      return { error: 'The code is incomplete — it may have been cut short when it was pasted' };
    }
    return { ok: true, payload: parsed };
  } catch {
    return { error: 'The code is damaged. Ask for it again and copy all of it.' };
  }
}

module.exports = { encode, decode, GZIP_PREFIX, PLAIN_PREFIX, INVITE_VERSION };
