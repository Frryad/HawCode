'use strict';

const http = require('http');
const https = require('https');
const net = require('net');
const tls = require('tls');

const { sendError, stripV4Mapped } = require('./http-util');

const HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding', 'upgrade', 'proxy-connection'
]);

const agents = {
  http: new http.Agent({ keepAlive: true, maxSockets: 256 }),
  // Local backends (XAMPP, IIS Express, dev servers) often use self-signed certificates.
  https: new https.Agent({ keepAlive: true, maxSockets: 256, rejectUnauthorized: false })
};

function joinPath(basePath, reqUrl) {
  const base = basePath.replace(/\/+$/, '');
  return base ? `${base}${reqUrl.startsWith('/') ? '' : '/'}${reqUrl}` : reqUrl;
}

function forwardedHeaders(req, ctx) {
  const clientIp = stripV4Mapped(req.socket.remoteAddress);
  const prior = req.headers['x-forwarded-for'];
  return {
    'x-forwarded-for': prior ? `${prior}, ${clientIp}` : clientIp,
    'x-forwarded-proto': ctx.tls ? 'https' : 'http',
    'x-forwarded-host': req.headers.host || '',
    'x-forwarded-port': String(ctx.localPort),
    'x-real-ip': clientIp
  };
}

function outgoingHeaders(req, target, ctx, { keepUpgrade = false } = {}) {
  const headers = {};
  const connectionTokens = String(req.headers.connection || '').toLowerCase().split(',').map((s) => s.trim());
  for (const [k, v] of Object.entries(req.headers)) {
    const lower = k.toLowerCase();
    if (!keepUpgrade && (HOP_BY_HOP.has(lower) || connectionTokens.includes(lower))) continue;
    headers[lower] = v;
  }
  headers.host = ctx.preserveHost && req.headers.host ? req.headers.host : target.host;
  Object.assign(headers, forwardedHeaders(req, ctx));
  return headers;
}

/**
 * Forwards one HTTP request to `targetUrl` (e.g. http://127.0.0.1:3000 or
 * http://127.0.0.1:8081/app). ctx: { tls, localPort, preserveHost, label }
 */
function proxyRequest(req, res, targetUrl, ctx) {
  return new Promise((resolve) => {
    const target = new URL(targetUrl);
    const isHttps = target.protocol === 'https:';
    const options = {
      protocol: target.protocol,
      hostname: target.hostname.replace(/^\[|\]$/g, ''),
      port: target.port || (isHttps ? 443 : 80),
      method: req.method,
      path: joinPath(target.pathname, req.url),
      headers: outgoingHeaders(req, target, ctx),
      agent: isHttps ? agents.https : agents.http,
      servername: isHttps && !net.isIP(target.hostname) ? target.hostname : undefined
    };

    const upstream = (isHttps ? https : http).request(options, (up) => {
      const headers = {};
      for (const [k, v] of Object.entries(up.headers)) {
        if (!HOP_BY_HOP.has(k.toLowerCase())) headers[k] = v;
      }
      res.writeHead(up.statusCode || 502, up.statusMessage, headers);
      up.pipe(res);
      up.on('end', () => resolve(up.statusCode));
      up.on('error', () => {
        res.destroy();
        resolve(up.statusCode);
      });
    });

    upstream.setTimeout(120000, () => upstream.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })));
    upstream.on('error', (err) => {
      if (res.headersSent) {
        res.destroy();
        return resolve(502);
      }
      if (err.code === 'ETIMEDOUT') {
        return resolve(sendError(res, 504, `${ctx.label || 'The backend'} did not answer in time.`));
      }
      const hint = err.code === 'ECONNREFUSED'
        ? `Nothing is running at <code>${target.host}</code>. Start the application (or Apache/Nginx) that this website forwards to.`
        : `Could not reach <code>${target.host}</code> (${err.code || err.message}).`;
      resolve(sendError(res, 502, hint));
    });

    res.on('close', () => {
      if (!res.writableFinished) upstream.destroy();
    });
    req.pipe(upstream);
  });
}

/** Forwards a WebSocket (or any HTTP Upgrade) connection byte-for-byte. */
function proxyUpgrade(req, socket, head, targetUrl, ctx) {
  const target = new URL(targetUrl);
  const isTls = target.protocol === 'https:' || target.protocol === 'wss:';
  const port = Number(target.port || (isTls ? 443 : 80));
  const host = target.hostname.replace(/^\[|\]$/g, '');

  const onConnect = () => {
    const headers = outgoingHeaders(req, target, ctx, { keepUpgrade: true });
    let head_ = `${req.method} ${joinPath(target.pathname, req.url)} HTTP/1.1\r\n`;
    for (const [k, v] of Object.entries(headers)) {
      for (const value of Array.isArray(v) ? v : [v]) head_ += `${k}: ${value}\r\n`;
    }
    upstream.write(`${head_}\r\n`);
    if (head && head.length) upstream.write(head);
    upstream.pipe(socket);
    socket.pipe(upstream);
  };

  const upstream = isTls
    ? tls.connect({ host, port, servername: net.isIP(host) ? undefined : host, rejectUnauthorized: false }, onConnect)
    : net.connect(port, host, onConnect);

  upstream.on('error', () => {
    if (socket.writable) socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n');
    socket.destroy();
  });
  socket.on('error', () => upstream.destroy());
  socket.on('close', () => upstream.destroy());
  upstream.on('close', () => socket.destroy());
}

module.exports = { proxyRequest, proxyUpgrade, joinPath };
