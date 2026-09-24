'use strict';

const http = require('http');
const https = require('https');
const path = require('path');
const { EventEmitter } = require('events');

const { handleStatic, serveFile, statOrNull } = require('./static-handler');
const { handlePhp, resolvePhpCgi } = require('./php-handler');
const { proxyRequest, proxyUpgrade } = require('./proxy-handler');
const { sendError, redirect, page, escapeHtml, resolveInside, stripV4Mapped, SERVER_HEADER } = require('./http-util');
const { portOwner } = require('./port-checker');

// ------------------------------------------------------------------ routing

function parseHost(hostHeader) {
  let h = String(hostHeader || '').trim().toLowerCase();
  if (h.startsWith('[')) h = h.slice(0, h.indexOf(']') + 1);
  else h = h.replace(/:\d+$/, '');
  return h.replace(/\.$/, '');
}

function hostScore(pattern, host) {
  if (pattern === host) return 3;
  if (pattern.startsWith('*.') && host.endsWith(pattern.slice(1))) return 2;
  if (pattern === '*') return 1;
  return 0;
}

/**
 * Best website for a request: exact hostname beats *.wildcard beats "*", and a
 * website pinned to the listener port beats one that answers on every port.
 */
function resolveSite(sites, hostHeader, localPort) {
  const host = parseHost(hostHeader);
  let best = null;
  let bestScore = 0;
  for (const site of sites) {
    if (!site.enabled) continue;
    if (site.port && site.port !== localPort) continue;
    const hs = Math.max(0, ...site.hostnames.map((p) => hostScore(p, host)));
    if (!hs) continue;
    const score = hs * 2 + (site.port === localPort ? 1 : 0);
    if (score > bestScore) {
      best = site;
      bestScore = score;
    }
  }
  return best;
}

// ------------------------------------------------------------------ engine

class ServerEngine extends EventEmitter {
  constructor({ store, logger, certs, apps, paths }) {
    super();
    this.store = store;
    this.logger = logger;
    this.certs = certs;
    this.apps = apps;
    this.paths = paths;
    this.running = false;
    this.startedAt = null;
    this.listeners = [];      // { port, tls, state, error, owners, server }
    this.sockets = new Set();
    this.probes = new Map();  // nonce -> expiry
    this.stats = this.freshStats();
    this.statsTimer = null;
    this.busy = Promise.resolve();
  }

  freshStats() {
    return { requests: 0, bytes: 0, activeConnections: 0, status2xx: 0, status3xx: 0, status4xx: 0, status5xx: 0 };
  }

  /** Listener set implied by the configuration. */
  plannedListeners() {
    const cfg = this.store.get();
    const s = cfg.server;
    const map = new Map();
    if (s.enableHttp) map.set(s.httpPort, false);
    if (s.enableHttps) map.set(s.httpsPort, true);
    for (const p of s.extraPorts || []) if (!map.has(p)) map.set(p, false);
    for (const site of cfg.websites) {
      if (site.enabled && site.port && !map.has(site.port)) map.set(site.port, false);
    }
    return [...map.entries()].map(([port, tls]) => ({ port, tls })).sort((a, b) => a.port - b.port);
  }

  status() {
    return {
      running: this.running,
      startedAt: this.startedAt,
      listeners: this.listeners.map(({ port, tls, state, error, owners }) => ({ port, tls, state, error, owners })),
      planned: this.plannedListeners(),
      stats: { ...this.stats, activeConnections: this.sockets.size },
      phpCgi: resolvePhpCgi(this.store.get().server.phpCgiPath),
      apps: this.apps.status()
    };
  }

  /** Serialise start/stop/reload so rapid clicks never interleave. */
  _queue(fn) {
    const next = this.busy.then(fn, fn);
    this.busy = next.catch(() => {});
    return next;
  }

  start() {
    return this._queue(() => this._start());
  }

  stop() {
    return this._queue(() => this._stop());
  }

  restart() {
    return this._queue(async () => {
      await this._stop();
      return this._start();
    });
  }

  /** Apply configuration changes: rebind only if the listener set changed. */
  reload() {
    return this._queue(async () => {
      if (!this.running) return this.status();
      const planned = JSON.stringify(this.plannedListeners());
      const current = JSON.stringify(this.listeners.map(({ port, tls }) => ({ port, tls })));
      if (planned !== current) {
        await this._stop({ quiet: true });
        return this._start({ quiet: true });
      }
      if (this.store.get().server.enableHttps) {
        // Certificates are chosen per handshake, so new hostnames only need the default cert refreshed.
        await this.certs.ensureDefault(this._certHostnames()).catch((err) => this.logger.error('server', err.message));
        this.certs.reloadChangedSources();
      }
      this.apps.sync(this.store.get().websites, true);
      return this.status();
    });
  }

  async _start({ quiet = false } = {}) {
    const cfg = this.store.get();
    const planned = this.plannedListeners();
    if (!planned.length) {
      this.logger.warn('server', 'No ports are enabled; turn on HTTP or HTTPS in Ports & Router.');
    }

    if (planned.some((l) => l.tls)) {
      try {
        await this.certs.ensureDefault(this._certHostnames());
      } catch (err) {
        this.logger.error('server', `Could not prepare the HTTPS certificate: ${err.message}`);
      }
      this.certs.reloadChangedSources();
    }

    this.stats = this.freshStats();
    this.listeners = await Promise.all(planned.map((l) => this._listen(l, cfg.server.bindAddress)));
    const ok = this.listeners.filter((l) => l.state === 'listening');
    this.running = ok.length > 0 || planned.length === 0;
    this.startedAt = this.running ? new Date().toISOString() : null;

    for (const l of this.listeners) {
      if (l.state === 'error') this.logger.error('server', `Port ${l.port}${l.tls ? ' (HTTPS)' : ''}: ${l.error}`);
    }
    if (ok.length && !quiet) {
      this.logger.info('server', `Web server started on port${ok.length > 1 ? 's' : ''} ${ok.map((l) => `${l.port}${l.tls ? ' (HTTPS)' : ''}`).join(', ')}.`);
    }
    this.apps.sync(cfg.websites, this.running);
    clearInterval(this.statsTimer);
    this.statsTimer = setInterval(() => this._emitStats(), 1000);
    this.emit('status', this.status());
    return this.status();
  }

  _listen({ port, tls }, bindAddress) {
    return new Promise((resolve) => {
      const entry = { port, tls, state: 'starting', error: null, owners: [], server: null };
      const handler = (req, res) => this._handle(req, res, entry);
      let server;
      if (tls) {
        server = https.createServer({
          SNICallback: (servername, cb) => cb(null, this.certs.contextFor(servername, this.store.get().websites)),
          ...(this._defaultTlsMaterial()),
          minVersion: 'TLSv1.2'
        }, handler);
      } else {
        server = http.createServer(handler);
      }
      server.keepAliveTimeout = 5000;
      server.headersTimeout = 30000;
      server.requestTimeout = 0; // long uploads/downloads are fine; headersTimeout guards slowloris
      server.on('connection', (sock) => {
        this.sockets.add(sock);
        sock.on('close', () => this.sockets.delete(sock));
      });
      server.on('upgrade', (req, socket, head) => this._upgrade(req, socket, head, entry));
      server.on('clientError', (err, socket) => {
        if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
      });
      entry.server = server;

      const tryListen = (host, fallback) => {
        const onError = async (err) => {
          server.removeListener('listening', onListening);
          if (fallback && ['EAFNOSUPPORT', 'EADDRNOTAVAIL', 'EINVAL'].includes(err.code)) {
            tryListen(fallback, null);
            return;
          }
          entry.state = 'error';
          if (err.code === 'EADDRINUSE') {
            entry.owners = await portOwner(port).catch(() => []);
            const who = entry.owners.map((o) => o.name).join(', ');
            entry.error = `Port ${port} is already used by ${who || 'another program'}. Stop that program or choose a different port.`;
          } else if (err.code === 'EACCES') {
            entry.error = `Windows refused port ${port}. It may be reserved (check "netsh interface ipv4 show excludedportrange protocol=tcp") or blocked by security software.`;
          } else {
            entry.error = `${err.code || ''} ${err.message}`.trim();
          }
          resolve(entry);
        };
        const onListening = () => {
          server.removeListener('error', onError);
          server.on('error', (err) => this.logger.error('server', `Port ${port}: ${err.message}`));
          entry.state = 'listening';
          resolve(entry);
        };
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen({ port, host, ipv6Only: false });
      };
      if (bindAddress) tryListen(bindAddress, null);
      else tryListen('::', '0.0.0.0'); // dual-stack; falls back to IPv4 when IPv6 is off
    });
  }

  _certHostnames() {
    const cfg = this.store.get();
    return [...new Set(cfg.websites.flatMap((w) => w.hostnames)
      .filter((h) => h !== '*' && !h.startsWith('*.'))
      .concat(cfg.ddns.records.map((r) => r.hostname)))];
  }

  _defaultTlsMaterial() {
    const e = this.certs.entries.get('default');
    if (!e) return {};
    const fs = require('fs');
    const dir = path.join(this.certs.certsDir, 'default');
    return { cert: fs.readFileSync(path.join(dir, 'cert.pem')), key: fs.readFileSync(path.join(dir, 'key.pem')) };
  }

  async _stop({ quiet = false } = {}) {
    const wasRunning = this.running;
    this.running = false;
    clearInterval(this.statsTimer);
    const closing = this.listeners.map((l) => new Promise((resolve) => {
      if (!l.server || l.state !== 'listening') return resolve();
      l.server.close(() => resolve());
    }));
    for (const s of this.sockets) s.destroy();
    this.sockets.clear();
    await Promise.all(closing);
    this.listeners = [];
    this.startedAt = null;
    this.apps.stopAll();
    if (wasRunning && !quiet) this.logger.info('server', 'Web server stopped.');
    this.emit('status', this.status());
    return this.status();
  }

  _emitStats() {
    if (this._statsDirty) {
      this._statsDirty = false;
      this.emit('stats', { ...this.stats, activeConnections: this.sockets.size });
    }
  }

  registerProbe(nonce, ttlMs = 60000) {
    this.probes.set(nonce, Date.now() + ttlMs);
    for (const [n, exp] of this.probes) if (exp < Date.now()) this.probes.delete(n);
  }

  // ---------------------------------------------------------------- requests

  async _handle(req, res, listener) {
    const started = Date.now();
    const sock = req.socket;
    const bytesBefore = sock.bytesWritten;
    res.setHeader('Server', SERVER_HEADER);
    res.setHeader('X-Content-Type-Options', 'nosniff');

    let site = null;
    res.on('finish', () => this._record(req, res, listener, site, started, sock.bytesWritten - bytesBefore));
    res.on('close', () => {
      if (!res.writableFinished) this._record(req, res, listener, site, started, sock.bytesWritten - bytesBefore, true);
    });

    try {
      let url;
      try {
        url = new URL(req.url, 'http://x');
      } catch {
        return sendError(res, 400);
      }
      let pathname;
      try {
        pathname = decodeURIComponent(url.pathname);
      } catch {
        return sendError(res, 400, 'The address contains invalid characters.');
      }

      // Reachability self-test and ACME HTTP-01 challenges answer on every hostname.
      if (pathname.startsWith('/.well-known/hawhost-probe/')) {
        const nonce = pathname.split('/').pop();
        if (this.probes.has(nonce)) {
          res.writeHead(200, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
          return res.end(`hawhost:${nonce}`);
        }
        return sendError(res, 404);
      }
      if (pathname.startsWith('/.well-known/acme-challenge/')) {
        const t = resolveInside(this.paths.acmeWebroot, pathname, { hideDotfiles: false });
        const stat = t.path ? await statOrNull(t.path) : null;
        if (stat && stat.isFile()) {
          res.setHeader('Content-Type', 'text/plain');
          return serveFile(req, res, t.path, stat);
        }
      }

      const cfg = this.store.get();
      site = resolveSite(cfg.websites, req.headers.host, listener.port);
      if (!site) {
        const body = page('No website here', `<h1>No website is set up for this address</h1><p>This computer runs HawHost, but no website answers to <code>${escapeHtml(parseHost(req.headers.host) || 'this address')}</code> on port ${listener.port}.</p>`);
        res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
        return res.end(body);
      }

      if (site.forceHttps && !listener.tls && cfg.server.enableHttps) {
        const host = parseHost(req.headers.host);
        const portPart = cfg.server.httpsPort === 443 ? '' : `:${cfg.server.httpsPort}`;
        return redirect(res, `https://${host}${portPart}${req.url}`, 301);
      }

      const ctx = {
        site,
        pathname,
        rawPathname: url.pathname,
        search: url.search,
        localPort: listener.port,
        tls: listener.tls,
        hideDotfiles: cfg.server.hideDotfiles !== false,
        logger: this.logger
      };

      switch (site.type) {
        case 'proxy':
          return proxyRequest(req, res, site.proxyTarget, { ...ctx, preserveHost: site.proxyPreserveHost, label: site.name });
        case 'node':
          return proxyRequest(req, res, `http://127.0.0.1:${site.nodePort}`, { ...ctx, preserveHost: true, label: `The Node.js app for ${site.name}` });
        case 'php':
          return handlePhp(req, res, {
            ...ctx,
            phpCgi: resolvePhpCgi(site.phpCgiPath || cfg.server.phpCgiPath),
            timeoutSec: cfg.server.phpTimeoutSec,
            maxBodyBytes: cfg.server.maxBodyMb * 1024 * 1024
          });
        default:
          return handleStatic(req, res, ctx);
      }
    } catch (err) {
      this.logger.error('server', `Error while handling ${req.method} ${req.url}: ${err.stack || err.message}`);
      return sendError(res, 500);
    }
  }

  _record(req, res, listener, site, started, bytes, aborted = false) {
    if (res._hawhostLogged) return;
    res._hawhostLogged = true;
    const status = aborted && !res.headersSent ? 499 : res.statusCode;
    this.stats.requests += 1;
    this.stats.bytes += Math.max(0, bytes || 0);
    const cls = Math.floor(status / 100);
    if (cls >= 2 && cls <= 5) this.stats[`status${cls}xx`] += 1;
    this._statsDirty = true;
    if (String(req.url).startsWith('/.well-known/hawhost-probe/')) return;
    this.logger.request({
      t: new Date(started).toISOString(),
      ip: stripV4Mapped(req.socket.remoteAddress),
      method: req.method,
      host: parseHost(req.headers.host),
      url: req.url,
      port: listener.port,
      tls: listener.tls,
      status,
      bytes: Math.max(0, bytes || 0),
      ms: Date.now() - started,
      site: site ? site.name : null,
      ua: String(req.headers['user-agent'] || '').slice(0, 200)
    });
  }

  _upgrade(req, socket, head, listener) {
    const site = resolveSite(this.store.get().websites, req.headers.host, listener.port);
    const ctx = { tls: listener.tls, localPort: listener.port };
    if (site && site.type === 'proxy') return proxyUpgrade(req, socket, head, site.proxyTarget, { ...ctx, preserveHost: site.proxyPreserveHost });
    if (site && site.type === 'node') return proxyUpgrade(req, socket, head, `http://127.0.0.1:${site.nodePort}`, { ...ctx, preserveHost: true });
    socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
  }
}

module.exports = { ServerEngine, resolveSite, parseHost };
