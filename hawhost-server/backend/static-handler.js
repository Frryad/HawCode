'use strict';

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const zlib = require('zlib');

const { mimeFor, isCompressible, SCRIPT_EXTENSIONS } = require('./mime');
const { escapeHtml, page, sendError, redirect, resolveInside } = require('./http-util');

const GZIP_MIN = 1024;
const GZIP_MAX = 20 * 1024 * 1024;

async function statOrNull(p) {
  try {
    return await fsp.stat(p);
  } catch {
    return null;
  }
}

function etagFor(stat) {
  return `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
}

function notModified(req, etag, stat) {
  const inm = req.headers['if-none-match'];
  if (inm) {
    return inm.split(',').map((t) => t.trim().replace(/^W\//, '')).includes(etag.replace(/^W\//, '')) || inm.trim() === '*';
  }
  const ims = req.headers['if-modified-since'];
  if (ims) {
    const since = Date.parse(ims);
    return !Number.isNaN(since) && Math.floor(stat.mtimeMs / 1000) <= Math.floor(since / 1000);
  }
  return false;
}

function parseRange(header, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header).trim());
  if (!m || (m[1] === '' && m[2] === '')) return null; // unsupported/multi-range: send whole file
  let start;
  let end;
  if (m[1] === '') {
    const suffix = Number(m[2]);
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (start > end || start >= size) return { invalid: true };
  return { start, end };
}

/** Sends one file with ETag/304, byte ranges (video seeking, resumable downloads), HEAD and gzip. */
function serveFile(req, res, filePath, stat, { status = 200 } = {}) {
  const mime = mimeFor(path.extname(filePath));
  const etag = etagFor(stat);
  const headers = {
    'Content-Type': mime,
    'Last-Modified': stat.mtime.toUTCString(),
    ETag: etag,
    'Accept-Ranges': 'bytes'
  };
  if (mime.startsWith('text/html')) headers['Cache-Control'] = 'no-cache';

  if (status === 200 && notModified(req, etag, stat)) {
    res.writeHead(304, headers);
    res.end();
    return 304;
  }

  let range = null;
  if (status === 200 && req.headers.range) {
    const ifRange = req.headers['if-range'];
    if (!ifRange || ifRange === etag || ifRange === stat.mtime.toUTCString()) {
      range = parseRange(req.headers.range, stat.size);
      if (range && range.invalid) {
        res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
        res.end();
        return 416;
      }
    }
  }

  const gzip = !range && req.method === 'GET' && isCompressible(mime)
    && stat.size >= GZIP_MIN && stat.size <= GZIP_MAX
    && /\bgzip\b/.test(String(req.headers['accept-encoding'] || ''));

  let code = status;
  if (range) {
    code = 206;
    headers['Content-Range'] = `bytes ${range.start}-${range.end}/${stat.size}`;
    headers['Content-Length'] = range.end - range.start + 1;
  } else if (gzip) {
    headers['Content-Encoding'] = 'gzip';
    headers.Vary = 'Accept-Encoding';
  } else {
    headers['Content-Length'] = stat.size;
  }

  res.writeHead(code, headers);
  if (req.method === 'HEAD') {
    res.end();
    return code;
  }

  const stream = fs.createReadStream(filePath, range ? { start: range.start, end: range.end } : undefined);
  stream.on('error', () => res.destroy());
  res.on('close', () => stream.destroy());
  if (gzip) {
    stream.pipe(zlib.createGzip({ level: 6 })).pipe(res);
  } else {
    stream.pipe(res);
  }
  return code;
}

async function directoryListing(req, res, dir, urlPath, hideDotfiles) {
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  const rows = entries
    .filter((e) => !(hideDotfiles && e.name.startsWith('.')))
    .sort((a, b) => (b.isDirectory() - a.isDirectory()) || a.name.localeCompare(b.name))
    .map((e) => {
      const name = e.isDirectory() ? `${e.name}/` : e.name;
      return `<li><a href="${encodeURIComponent(e.name)}${e.isDirectory() ? '/' : ''}">${escapeHtml(name)}</a></li>`;
    });
  const up = urlPath !== '/' ? '<li><a href="../">../</a></li>' : '';
  const body = page(`Index of ${urlPath}`, `<h1>Index of ${escapeHtml(urlPath)}</h1><ul>${up}${rows.join('')}</ul>`);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  res.end(req.method === 'HEAD' ? undefined : body);
  return 200;
}

async function notFound(req, res, site, hideDotfiles) {
  const custom = resolveInside(site.root, '/404.html', { hideDotfiles });
  const stat = custom.path ? await statOrNull(custom.path) : null;
  if (stat && stat.isFile()) return serveFile(req, res, custom.path, stat, { status: 404 });
  return sendError(res, 404, 'The page you asked for does not exist on this website.');
}

/**
 * ctx: { site, pathname (decoded), rawPathname, search, hideDotfiles }
 * Returns the status code that was sent.
 */
async function handleStatic(req, res, ctx) {
  const { site, pathname, rawPathname, search, hideDotfiles } = ctx;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, { Allow: 'GET, HEAD, OPTIONS' });
    res.end();
    return 204;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD, OPTIONS');
    return sendError(res, 405, 'This is a static website; it only answers GET and HEAD requests.');
  }

  const target = resolveInside(site.root, pathname, { hideDotfiles });
  if (target.error) {
    return target.error === 404 ? notFound(req, res, site, hideDotfiles) : sendError(res, target.error);
  }

  const stat = await statOrNull(target.path);

  if (stat && stat.isDirectory()) {
    if (!pathname.endsWith('/')) return redirect(res, `${rawPathname}/${search}`);
    for (const index of site.indexFiles) {
      if (SCRIPT_EXTENSIONS.has(path.extname(index).toLowerCase())) continue;
      const indexPath = path.join(target.path, index);
      const s = await statOrNull(indexPath);
      if (s && s.isFile()) return serveFile(req, res, indexPath, s);
    }
    if (site.directoryListing) return directoryListing(req, res, target.path, pathname, hideDotfiles);
    return sendError(res, 403, 'This folder has no index page and directory listing is turned off.');
  }

  if (stat && stat.isFile()) {
    if (SCRIPT_EXTENSIONS.has(path.extname(target.path).toLowerCase())) {
      // A static website never hands out server-side source code.
      return sendError(res, 403, 'Script files are not served by a static website. Change the website type to PHP to run it.');
    }
    return serveFile(req, res, target.path, stat);
  }

  if (site.spaFallback && !path.extname(pathname)) {
    for (const index of site.indexFiles) {
      if (SCRIPT_EXTENSIONS.has(path.extname(index).toLowerCase())) continue;
      const indexPath = path.join(path.resolve(site.root), index);
      const s = await statOrNull(indexPath);
      if (s && s.isFile()) return serveFile(req, res, indexPath, s);
    }
  }

  return notFound(req, res, site, hideDotfiles);
}

module.exports = { handleStatic, serveFile, statOrNull, notFound };
