'use strict';

const express = require('express');
const fs = require('fs');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { Server } = require('socket.io');
const { createApi } = require('./api');
const { isPrivate } = require('./reachability');

const PORT_RANGE_START = 3000;
const PORT_RANGE_END = 3010;
// The point of claiming port 80 is that a name HawCode issues reads as a plain
// address — http://notes.box, with no port to explain to anyone.
const PUBLIC_PORT = 80;
// Digits and uppercase letters minus the ones people misread (0/O, 1/I).
const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
// A code handed out on the local network only has to survive the people in the
// building. One reachable from the internet has to survive a script, so internet
// mode asks for a longer one: 32^10 rather than 32^6.
const LAN_CODE_LENGTH = 6;
const INTERNET_CODE_LENGTH = 10;
// How many wrong codes one address may try before it has to wait.
const MAX_CODE_FAILURES = 5;
const LOCKOUT_BASE_MS = 1000;
const LOCKOUT_MAX_MS = 30 * 1000;
const LOCKOUT_FORGET_MS = 15 * 60 * 1000;

function generateRoomCode(length = 6) {
  const bytes = crypto.randomBytes(length);
  let code = '';
  for (const byte of bytes) code += CODE_ALPHABET[byte % CODE_ALPHABET.length];
  return code;
}

/**
 * Compare in constant time so a caller cannot learn the code character by
 * character from response timing.
 */
function codeMatches(expected, received) {
  if (!expected) return true;
  if (typeof received !== 'string' || received.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(received));
}

/**
 * Slow down repeated wrong codes from one address.
 *
 * Without this, a six-character code on a public address is a few hours of
 * guessing at line rate, and a wrong guess costs the attacker nothing. The
 * lockout doubles from a second up to half a minute and is forgotten after
 * fifteen quiet minutes, so a person who fat-fingered their code once is not
 * locked out of their own workspace.
 */
function createCodeThrottle() {
  const attempts = new Map();

  const prune = () => {
    const cutoff = Date.now() - LOCKOUT_FORGET_MS;
    for (const [key, entry] of attempts) {
      if (entry.lastAt < cutoff) attempts.delete(key);
    }
  };

  return {
    /** Milliseconds this address still has to wait, or 0. */
    retryAfter(address) {
      const entry = attempts.get(address);
      if (!entry || !entry.until) return 0;
      return Math.max(0, entry.until - Date.now());
    },

    fail(address) {
      prune();
      const entry = attempts.get(address) || { failures: 0, until: 0, lastAt: 0 };
      entry.failures += 1;
      entry.lastAt = Date.now();
      if (entry.failures > MAX_CODE_FAILURES) {
        const over = entry.failures - MAX_CODE_FAILURES;
        entry.until = Date.now()
          + Math.min(LOCKOUT_BASE_MS * (2 ** (over - 1)), LOCKOUT_MAX_MS);
      }
      attempts.set(address, entry);
      return entry;
    },

    succeed(address) {
      attempts.delete(address);
    }
  };
}

function listenOnFirstFreePort(server, start, end) {
  return new Promise((resolve, reject) => {
    let port = start;
    const attempt = () => {
      const onError = (error) => {
        if (error.code === 'EADDRINUSE' && port < end) {
          port += 1;
          server.removeListener('error', onError);
          attempt();
          return;
        }
        reject(error);
      };
      server.once('error', onError);
      server.listen(port, '0.0.0.0', () => {
        server.removeListener('error', onError);
        resolve(port);
      });
    };
    attempt();
  });
}

/**
 * The host's HTTP + Socket.IO surface.
 *
 * Browser clients use the REST endpoints; desktop peers use sockets and speak
 * the sync engine's protocol. Both are gated by the same optional room code,
 * which is what makes Host Online safe enough to hand out a public URL.
 */
/**
 * Accept a Socket.IO connection only from a page this server handed out.
 *
 * Desktop peers (socket.io-client under Node) send no Origin at all. A browser
 * always does, and for our own editor page it names the host it was loaded
 * from. Anything else is some other web page — open on this LAN, or on this
 * very computer — trying to write into the shared folder through the visitor's
 * browser, which `cors: '*'` used to allow.
 */
function sameOriginOnly(req, callback) {
  const origin = req.headers.origin;
  if (!origin) return callback(null, true);
  try {
    return callback(null, new URL(origin).host === req.headers.host);
  } catch {
    return callback(null, false);
  }
}

const IO_OPTIONS = {
  allowRequest: sameOriginOnly,
  maxHttpBufferSize: 64 * 1024 * 1024
};

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]);
}

/** A plain listing for a folder with no index.html, so the link never shows a bare 404. */
function directoryListing(root, relative) {
  let entries;
  try {
    entries = fs.readdirSync(path.join(root, relative), { withFileTypes: true })
      .filter((entry) => !entry.name.startsWith('.'))
      .sort((a, b) => (b.isDirectory() - a.isDirectory()) || a.name.localeCompare(b.name));
  } catch {
    return null;
  }
  const parts = relative.split(path.sep).filter(Boolean);
  const prefix = parts.length ? `/${parts.map(encodeURIComponent).join('/')}/` : '/';
  const items = entries.map((entry) => {
    const slash = entry.isDirectory() ? '/' : '';
    return `<li><a href="${prefix}${encodeURIComponent(entry.name)}${slash}">${escapeHtml(entry.name + slash)}</a></li>`;
  }).join('');
  const title = escapeHtml(parts.length ? `/${parts.join('/')}` : path.basename(root));
  return '<!doctype html><html><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1">'
    + `<title>${title}</title>`
    + '<style>body{font:15px system-ui,sans-serif;max-width:40rem;margin:2rem auto;padding:0 1rem}li{margin:.3rem 0}</style>'
    + `</head><body><h1>${title}</h1>${parts.length ? '<p><a href="../">..</a></p>' : ''}<ul>${items}</ul></body></html>`;
}

function createServer({ engine, appRoot, onPeerChange, getDomain, getExtraPort, getShare, mayClaimPort80 }) {
  const expressApp = express();
  const server = http.createServer(expressApp);
  // A second listener over the same app. The app window and Monaco's workers
  // are loaded from the port above and must keep their own server; this one
  // exists so that everyone else gets an address without a port in it.
  const publicServer = http.createServer(expressApp);
  // A third, optional one. Plenty of home routers refuse to forward port 80 at
  // all, and the answer to that is another listener rather than anything involving
  // the registry or administrator rights.
  let extraServer = null;
  const io = new Server(server, IO_OPTIONS);

  const api = createApi({ engine, getDomain });
  const throttle = createCodeThrottle();
  let roomCode = null;
  let actualPort = null;
  let publicPort = null;
  let extraPort = null;
  // The last request that came from outside this network. Proof that a forwarded
  // port really works, which nothing this computer can ask itself will establish.
  let lastPublicHit = null;

  expressApp.use(express.json({ limit: '64mb' }));

  /** The address a request came from, as a bare IPv4 where possible. */
  function clientAddress(req) {
    const raw = (req.socket && req.socket.remoteAddress) || '';
    // Node reports IPv4 over a dual-stack socket as ::ffff:1.2.3.4.
    return raw.replace(/^::ffff:/, '');
  }

  expressApp.use((req, _res, next) => {
    const address = clientAddress(req);
    if (address && !isPrivate(address) && address !== '::1') {
      lastPublicHit = { address, at: Date.now(), path: req.path };
    }
    next();
  });
  /**
   * What is being shared right now, as main.js sees it.
   *
   * `null` means nothing is: the window's own app still loads, but no file in any
   * folder is readable or writable over the network. Without this the last
   * folder stayed open on every interface after Stop, with no code.
   */
  function share() {
    const current = getShare ? getShare() : null;
    if (!current || !engine.rootPath) return null;
    if (engine.state === 'stopped' || engine.state === 'idle') return null;
    return current;
  }

  /** True for a request on port 80 or the extra port, the addresses that are handed out. */
  function isPublicPort(port) {
    return Boolean(port) && (port === publicPort || port === extraPort);
  }

  function servingWebsite(req) {
    const current = share();
    return Boolean(current && current.serveAs === 'website'
      && isPublicPort(req.socket && req.socket.localPort));
  }

  // Website mode: the handed-out addresses serve the folder itself, read-only.
  // The editor keeps its own port (3000-3010), so its assets never collide with
  // the site's, and nothing on these ports can write a file.
  expressApp.use((req, res, next) => {
    if (!servingWebsite(req)) return next();
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return res.status(405).set('Allow', 'GET, HEAD').end();
    }
    if (req.path.startsWith('/api/') || req.path.startsWith('/socket.io/')) {
      return res.status(404).end();
    }
    return express.static(engine.rootPath, {
      dotfiles: 'deny',
      index: ['index.html', 'index.htm'],
      setHeaders(response) {
        response.setHeader('Cache-Control', 'no-cache');
      }
    })(req, res, () => {
      let relative;
      try {
        relative = decodeURIComponent(req.path).replace(/^\/+/, '');
      } catch {
        return res.status(400).end();
      }
      const hidden = relative.split('/').some((part) => part.startsWith('.'));
      const absolute = hidden ? null : engine.resolve(relative);
      if (absolute) {
        try {
          if (fs.statSync(absolute).isDirectory()) {
            if (!req.path.endsWith('/')) return res.redirect(301, `${req.path}/`);
            const page = directoryListing(engine.rootPath, path.relative(engine.rootPath, absolute));
            if (page) return res.type('html').set('Cache-Control', 'no-cache').send(page);
          }
        } catch {
          // Missing: falls through to the 404 below.
        }
      }
      return res.status(404).type('html').send('<!doctype html><title>Not found</title><p>Not found.</p>');
    });
  });

  // Every file under assets/ carries a content hash in its name, so a browser
  // that has one never needs to ask about it again; index.html is what points
  // at the current hashes, so that one is always revalidated.
  expressApp.use(express.static(path.join(appRoot, 'dist'), {
    setHeaders(res, filePath) {
      if (filePath.endsWith('.html')) {
        res.setHeader('Cache-Control', 'no-cache');
      } else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      }
    }
  }));

  // Tells a joining client whether it needs a code before it tries to connect,
  // so the Join dialog can prompt instead of failing.
  expressApp.get('/api/hello', (_req, res) => {
    const reply = api.hello(roomCode);
    res.status(reply.status).json(reply.body);
  });

  function requireCode(req, res, next) {
    if (!share()) return res.status(503).json({ error: 'not-sharing' });
    if (!roomCode) return next();
    const address = clientAddress(req);
    const wait = throttle.retryAfter(address);
    if (wait > 0) {
      res.setHeader('Retry-After', Math.ceil(wait / 1000));
      return res.status(429).json({ error: 'too-many-attempts', retryAfterMs: wait });
    }
    // The header is the only place the code is read from when it arrives from
    // outside this network: a query string lands in every proxy log on the way and
    // leaks through Referer. On the LAN the query form stays, because that is what
    // a pasted link with ?code= uses.
    const fromHeader = req.get('x-hawcode-code');
    const allowQuery = !address || isPrivate(address) || address === '::1';
    const supplied = fromHeader || (allowQuery ? req.query.code : undefined);
    if (!codeMatches(roomCode, supplied)) {
      throttle.fail(address);
      return res.status(401).json({ error: 'bad-code' });
    }
    throttle.succeed(address);
    return next();
  }

  expressApp.get('/api/files', requireCode, (_req, res) => {
    const reply = api.tree();
    res.status(reply.status).json(reply.body);
  });

  expressApp.get('/api/file', requireCode, (req, res) => {
    const reply = api.read(req.query.path);
    res.status(reply.status).json(reply.body);
  });

  // Raw bytes, for downloading a binary the editor cannot display.
  expressApp.get('/api/raw', requireCode, (req, res) => {
    const reply = api.raw(req.query.path);
    if (!reply.ok) return res.status(reply.status).json(reply.body);
    res.sendFile(reply.body.absolute, (error) => {
      if (error && !res.headersSent) res.status(404).json({ error: 'File not found' });
    });
  });

  expressApp.put('/api/file', requireCode, (req, res) => {
    const relativePath = req.query.path || (req.body && req.body.path);
    const reply = api.write(relativePath, req.body && req.body.content);
    res.status(reply.status).json(reply.body);
  });

  io.use((socket, next) => {
    const current = share();
    const localPort = socket.request && socket.request.socket && socket.request.socket.localPort;
    if (!current || (current.serveAs === 'website' && isPublicPort(localPort))) {
      const error = new Error('not-sharing');
      error.data = { reason: 'not-sharing' };
      return next(error);
    }
    if (!roomCode) return next();
    const address = ((socket.handshake && socket.handshake.address) || '').replace(/^::ffff:/, '');
    const wait = throttle.retryAfter(address);
    if (wait > 0) {
      const error = new Error('too-many-attempts');
      error.data = { reason: 'too-many-attempts', retryAfterMs: wait };
      return next(error);
    }
    const supplied = socket.handshake.auth && socket.handshake.auth.code;
    if (codeMatches(roomCode, supplied)) {
      throttle.succeed(address);
      return next();
    }
    throttle.fail(address);
    const error = new Error('bad-code');
    error.data = { reason: 'bad-code' };
    return next(error);
  });

  const notifyPeerChange = () => {
    if (onPeerChange) onPeerChange();
  };

  io.on('connection', (socket) => {
    const peerName = (socket.handshake.auth && socket.handshake.auth.peerName) || socket.id.slice(0, 6);
    const isBrowser = !(socket.handshake.auth && socket.handshake.auth.desktop);

    if (isBrowser) {
      // Browser editors do not run a sync engine; they only need file events.
      socket.on('file-edit', (data) => {
        if (!data || typeof data.path !== 'string' || typeof data.content !== 'string') return;
        engine.writeFromEditor(data.path, data.content);
      });
      socket.on('disconnect', () => notifyPeerChange());
      notifyPeerChange();
      return;
    }

    // A desktop peer: hand it to the engine as a full sync link.
    engine.addLink({
      id: socket.id,
      name: peerName,
      emit: (event, payload) => socket.emit(event, payload)
    });

    for (const event of Object.values(require('./sync-engine').EV)) {
      socket.on(event, (payload) => engine.handleRemote(socket.id, event, payload));
    }

    socket.on('disconnect', () => {
      engine.removeLink(socket.id);
      notifyPeerChange();
    });

    // Diff manifests immediately, so joining only moves what actually differs.
    engine.requestReconcile(socket.id);
    notifyPeerChange();
  });

  /** Push a file change to browser clients, which speak the simpler protocol. */
  function broadcastToBrowsers(event, payload) {
    io.emit(event, payload);
  }

  async function start() {
    actualPort = await listenOnFirstFreePort(server, PORT_RANGE_START, PORT_RANGE_END);
    await syncPublicPort();
    await openExtraPort();
    return actualPort;
  }

  let publicAttached = false;

  /**
   * Hold port 80, or let go of it, to match the settings.
   *
   * Port 80 is given up when XAMPP's Apache is the website on it. Holding on
   * to it then meant Apache failed to start whenever HawCode started first.
   * Losing port 80 is cosmetic for HawCode itself (its addresses just carry a
   * port number), so this never throws.
   */
  async function syncPublicPort() {
    const wanted = mayClaimPort80 ? mayClaimPort80() !== false : true;
    if (!wanted && publicPort !== null) {
      await new Promise((resolve) => publicServer.close(() => resolve()));
      publicPort = null;
      return { ok: true, port: null };
    }
    if (!wanted || publicPort !== null) return { ok: true, port: publicPort };
    try {
      await new Promise((resolve, reject) => {
        publicServer.once('error', reject);
        publicServer.listen(PUBLIC_PORT, '0.0.0.0', () => {
          publicServer.removeListener('error', reject);
          resolve();
        });
      });
      publicPort = PUBLIC_PORT;
      // A closed and re-opened http.Server keeps its listeners, so attaching
      // Socket.IO a second time would answer every request twice.
      if (!publicAttached) {
        io.attach(publicServer, IO_OPTIONS);
        publicAttached = true;
      }
      return { ok: true, port: publicPort };
    } catch (error) {
      publicPort = null;
      return { ok: false, error: error.code === 'EADDRINUSE' ? 'Another program is using port 80.' : error.message };
    }
  }

  /**
   * Open the user's chosen extra port, if they set one.
   *
   * This is what answers "my provider blocks port 80, forward 8080 instead". It
   * needs no administrator rights and nothing outlives the process, which is why
   * it is here rather than in a port-forwarding rule somewhere in Windows.
   */
  async function openExtraPort() {
    const wanted = Number(getExtraPort ? getExtraPort() : null) || null;
    if (wanted === extraPort) return { ok: true, port: extraPort };
    await closeExtraPort();
    if (!wanted || wanted === actualPort || wanted === publicPort) return { ok: true, port: null };

    extraServer = http.createServer(expressApp);
    try {
      await new Promise((resolve, reject) => {
        extraServer.once('error', reject);
        extraServer.listen(wanted, '0.0.0.0', () => {
          extraServer.removeListener('error', reject);
          resolve();
        });
      });
      extraPort = wanted;
      io.attach(extraServer, IO_OPTIONS);
      return { ok: true, port: extraPort };
    } catch (error) {
      extraServer = null;
      extraPort = null;
      // Not fatal: every other address still works, so report it and carry on.
      return { ok: false, error: error.code === 'EADDRINUSE'
        ? `Another program on this computer is already using port ${wanted}.`
        : error.message };
    }
  }

  async function closeExtraPort() {
    if (!extraServer) return;
    const current = extraServer;
    extraServer = null;
    extraPort = null;
    await new Promise((resolve) => current.close(resolve));
  }

  function setRoomCode(code) {
    roomCode = code || null;
    if (roomCode) {
      // Existing desktop peers authenticated under the old rules; make them
      // re-handshake rather than leaving a stale door open.
      for (const socket of io.sockets.sockets.values()) {
        const supplied = socket.handshake.auth && socket.handshake.auth.code;
        if (!codeMatches(roomCode, supplied)) socket.disconnect(true);
      }
    }
  }

  function getPort() {
    return actualPort;
  }

  /** Port 80 when we managed to claim it, otherwise null. */
  function getPublicPort() {
    return publicPort;
  }

  function browserCount() {
    return io.engine.clientsCount;
  }

  async function close() {
    io.close();
    await closeExtraPort();
    if (publicPort !== null) {
      await new Promise((resolve) => publicServer.close(resolve));
      publicPort = null;
    }
    await new Promise((resolve) => server.close(resolve));
  }

  return {
    start,
    close,
    setRoomCode,
    getPort,
    getPublicPort,
    /** The user's extra port, when one is open. */
    getExtraPort() { return extraPort; },
    /** Re-read the setting and open or close the extra listener to match. */
    syncExtraPort: openExtraPort,
    /** Re-read whether port 80 may be held, and claim or release it. */
    syncPublicPort,
    /**
     * The last request seen from beyond this network, or null.
     *
     * The only honest answer to "is my forwarded port actually reachable?" — a
     * machine cannot establish that by asking itself.
     */
    lastPublicHit() { return lastPublicHit; },
    browserCount,
    broadcastToBrowsers,
    get roomCode() { return roomCode; }
  };
}

module.exports = {
  createServer,
  generateRoomCode,
  codeMatches,
  createCodeThrottle,
  PORT_RANGE_START,
  PORT_RANGE_END,
  PUBLIC_PORT,
  LAN_CODE_LENGTH,
  INTERNET_CODE_LENGTH
};
