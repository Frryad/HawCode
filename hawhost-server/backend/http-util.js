'use strict';

const path = require('path');

const SERVER_HEADER = 'HawHost';

const REASONS = {
  400: 'Bad Request',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  413: 'Payload Too Large',
  416: 'Range Not Satisfiable',
  500: 'Internal Server Error',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
  504: 'Gateway Timeout'
};

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function page(title, bodyHtml) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title><style>
:root{color-scheme:light dark}body{font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;margin:0;display:grid;place-items:center;min-height:100vh;background:#f6f7fb;color:#1f2430}
@media (prefers-color-scheme:dark){body{background:#0e1117;color:#e6e8ee}code{background:#1d2230}}
main{max-width:560px;padding:32px}h1{font-size:22px;margin:0 0 8px}p{margin:0 0 8px;opacity:.8}code{background:#e9ecf3;padding:1px 6px;border-radius:4px}
small{opacity:.55}</style></head><body><main>${bodyHtml}<p><small>${SERVER_HEADER}</small></p></main></body></html>`;
}

function sendError(res, status, detail = '') {
  if (res.headersSent) {
    res.destroy();
    return status;
  }
  const title = `${status} ${REASONS[status] || 'Error'}`;
  const body = page(title, `<h1>${escapeHtml(title)}</h1>${detail ? `<p>${detail}</p>` : ''}`);
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  res.end(res.req && res.req.method === 'HEAD' ? undefined : body);
  return status;
}

function redirect(res, location, status = 301) {
  res.writeHead(status, { Location: location, 'Content-Length': 0, 'Cache-Control': 'no-cache' });
  res.end();
  return status;
}

const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9]|conin\$|conout\$)(\..*)?$/i;

/**
 * Maps a decoded URL path onto a file under `root`, refusing anything that could
 * step outside it or that Windows would silently reinterpret:
 *   ..            parent traversal
 *   \  and  :     backslash separators, drive letters, alternate data streams (index.php::$DATA)
 *   trailing . or space   Windows strips them, so "index.php." would open index.php
 *   CON, NUL ...  device names
 *   .env, .git    dotfiles, unless allowed (".well-known" is always allowed)
 */
function resolveInside(root, decodedPath, { hideDotfiles = true } = {}) {
  if (!root) return { error: 404 };
  if (decodedPath.includes('\0') || decodedPath.includes('\\')) return { error: 400 };
  const segments = decodedPath.split('/').filter((s) => s && s !== '.');
  for (const seg of segments) {
    if (seg === '..') return { error: 403 };
    if (seg.includes(':')) return { error: 403 };
    if (/[. ]$/.test(seg)) return { error: 404 };
    if (RESERVED.test(seg)) return { error: 404 };
    if (hideDotfiles && seg.startsWith('.') && seg !== '.well-known') return { error: 404 };
  }
  const rootAbs = path.resolve(root);
  const full = path.resolve(rootAbs, ...segments);
  const prefix = rootAbs.endsWith(path.sep) ? rootAbs : rootAbs + path.sep;
  if (full !== rootAbs && !full.startsWith(prefix)) return { error: 403 };
  return { path: full, segments };
}

function stripV4Mapped(ip) {
  return String(ip || '').replace(/^::ffff:/i, '');
}

module.exports = { SERVER_HEADER, escapeHtml, page, sendError, redirect, resolveInside, stripV4Mapped };
