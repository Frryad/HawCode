'use strict';

const os = require('os');
const { io: ioClient } = require('socket.io-client');
const { EV } = require('./sync-engine');

const LINK_ID = 'host';

/**
 * The joining side of a workspace: one socket to the host, registered with the
 * sync engine as a normal peer link. Because the protocol is symmetric, nothing
 * here knows or cares that the other end is "the host" — it reconciles and
 * exchanges changes the same way a host does with its peers.
 */
function connectToHost({ url, code, engine, onStatus }) {
  const targetUrl = normalizeUrl(url);
  const socket = ioClient(targetUrl, {
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    auth: { code: code || undefined, desktop: true, peerName: os.hostname() }
  });

  const report = (patch) => onStatus && onStatus({ hostUrl: targetUrl, ...patch });

  socket.on('connect', () => {
    let hostName = targetUrl;
    try { hostName = new URL(targetUrl).host; } catch { /* keep raw */ }
    engine.addLink({
      id: LINK_ID,
      name: hostName,
      emit: (event, payload) => socket.emit(event, payload)
    });
    // Diff manifests on every (re)connect. Matching hashes are skipped, so a
    // reconnect after a short drop costs almost nothing.
    engine.requestReconcile(LINK_ID);
    report({ connected: true, error: null });
  });

  socket.on('disconnect', (reason) => {
    engine.removeLink(LINK_ID);
    report({ connected: false, error: null, reason });
  });

  socket.on('connect_error', (error) => {
    const isBadCode = error && (error.message === 'bad-code' ||
      (error.data && error.data.reason === 'bad-code'));
    report({
      connected: false,
      error: isBadCode ? 'bad-code' : error.message || 'Connection failed'
    });
    // A wrong code will never succeed by retrying; stop hammering the host.
    if (isBadCode) socket.disconnect();
  });

  for (const event of Object.values(EV)) {
    socket.on(event, (payload) => engine.handleRemote(LINK_ID, event, payload));
  }

  return {
    socket,
    url,
    disconnect() {
      engine.removeLink(LINK_ID);
      socket.removeAllListeners();
      socket.disconnect();
    },
    get connected() {
      return socket.connected;
    }
  };
}

function normalizeUrl(inputUrl) {
  let str = String(inputUrl || '').trim();
  if (!str) return '';
  if (!/^https?:\/\//i.test(str)) {
    str = `http://${str}`;
  }
  return str.replace(/\/+$/, '');
}

/**
 * Check a host before committing to it: confirms it is really HawCode and says
 * whether a room code is required, so the Join dialog can ask up front.
 */
async function probeHost(url) {
  const target = normalizeUrl(url);
  if (!target) return { ok: false, error: 'A valid URL is required' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`${target}/api/hello`, { signal: controller.signal });
    if (!response.ok) return { ok: false, error: `Host replied ${response.status}` };
    const data = await response.json();
    if (data.app !== 'hawcode') return { ok: false, error: 'That URL is not a HawCode workspace' };
    return { ok: true, requiresCode: Boolean(data.requiresCode), folderName: data.folderName };
  } catch (error) {
    const reason = error.name === 'AbortError' ? 'Host did not respond in time' : error.message;
    return { ok: false, error: reason };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { connectToHost, probeHost, normalizeUrl, LINK_ID };
