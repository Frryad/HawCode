'use strict';

const http = require('http');
const crypto = require('crypto');

/**
 * Local control API for the desktop app. Listens on 127.0.0.1 only and
 * requires the random token stored in <data>\daemon.json, which only this
 * Windows account can read. No CORS headers are ever sent, and the Host
 * header must be the loopback address, so web pages cannot reach it.
 */
class ControlApi {
  constructor({ logger }) {
    this.logger = logger;
    this.token = crypto.randomBytes(32).toString('hex');
    this.routes = [];
    this.clients = new Set();
    this.server = null;
    this.port = null;
  }

  route(method, pattern, handler) {
    const keys = [];
    const re = new RegExp(`^${pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; })}$`);
    this.routes.push({ method, re, keys, handler });
  }

  get(p, h) { this.route('GET', p, h); }
  post(p, h) { this.route('POST', p, h); }
  put(p, h) { this.route('PUT', p, h); }
  del(p, h) { this.route('DELETE', p, h); }

  broadcast(type, data) {
    const frame = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of this.clients) res.write(frame);
  }

  listen() {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => this.handle(req, res));
      this.server.on('error', reject);
      this.server.listen(0, '127.0.0.1', () => {
        this.port = this.server.address().port;
        setInterval(() => { for (const res of this.clients) res.write(': ping\n\n'); }, 20000).unref();
        resolve(this.port);
      });
    });
  }

  authorized(req) {
    const host = String(req.headers.host || '');
    if (host !== `127.0.0.1:${this.port}` && host !== `localhost:${this.port}`) return false;
    if (req.headers.origin) return false; // browsers always send Origin on cross-site requests
    const auth = String(req.headers.authorization || '');
    const given = Buffer.from(auth.replace(/^Bearer\s+/i, ''));
    const want = Buffer.from(this.token);
    return given.length === want.length && crypto.timingSafeEqual(given, want);
  }

  async handle(req, res) {
    if (!this.authorized(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end('{"error":"unauthorized"}');
      return;
    }
    const url = new URL(req.url, 'http://127.0.0.1');

    if (req.method === 'GET' && url.pathname === '/api/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write(': connected\n\n');
      this.clients.add(res);
      req.on('close', () => this.clients.delete(res));
      return;
    }

    const route = this.routes.find((r) => r.method === req.method && r.re.test(url.pathname));
    if (!route) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end('{"error":"not found"}');
      return;
    }
    const m = route.re.exec(url.pathname);
    const params = Object.fromEntries(route.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));

    let body = {};
    if (req.method !== 'GET') {
      const chunks = [];
      let size = 0;
      for await (const c of req) {
        size += c.length;
        if (size > 20 * 1024 * 1024) {
          res.writeHead(413);
          res.end();
          return;
        }
        chunks.push(c);
      }
      const text = Buffer.concat(chunks).toString('utf-8');
      if (text) {
        try {
          body = JSON.parse(text);
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end('{"error":"invalid JSON"}');
          return;
        }
      }
    }

    try {
      const result = await route.handler({ params, query: Object.fromEntries(url.searchParams), body });
      const json = JSON.stringify(result === undefined ? { ok: true } : result);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(json);
    } catch (err) {
      const status = err.status || 500;
      if (status >= 500) this.logger.error('control', `${req.method} ${url.pathname}: ${err.stack || err.message}`);
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: err.message }));
    }
  }

  close() {
    for (const res of this.clients) res.end();
    this.clients.clear();
    return new Promise((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()));
  }
}

module.exports = { ControlApi };
