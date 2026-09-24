'use strict';

const fs = require('fs');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const { sendError, redirect, resolveInside, stripV4Mapped, SERVER_HEADER } = require('./http-util');
const { handleStatic, statOrNull } = require('./static-handler');

const PHP_EXT = /\.(php|php[3-8]|phtml)$/i;

// ------------------------------------------------------------------ discovery

function globDirs(parent, pattern) {
  try {
    return fs.readdirSync(parent)
      .filter((n) => pattern.test(n))
      .sort()
      .reverse() // newest version first
      .map((n) => path.join(parent, n));
  } catch {
    return [];
  }
}

/** Every php-cgi.exe we can find: PATH first, then the usual Windows stacks. */
function findPhpCgiCandidates() {
  const out = [];
  const add = (p) => {
    if (p && !out.includes(p) && fs.existsSync(p)) out.push(p);
  };
  if (process.platform === 'win32') {
    for (const exe of ['php-cgi.exe', 'php.exe']) {
      try {
        const found = execFileSync('where.exe', [exe], { encoding: 'utf-8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
        for (const line of found.split(/\r?\n/).filter(Boolean)) add(path.join(path.dirname(line.trim()), 'php-cgi.exe'));
      } catch { /* not on PATH */ }
    }
    const drives = ['C:', 'D:'];
    for (const d of drives) {
      add(`${d}\\xampp\\php\\php-cgi.exe`);
      add(`${d}\\php\\php-cgi.exe`);
      for (const dir of globDirs(`${d}\\laragon\\bin\\php`, /^php/i)) add(path.join(dir, 'php-cgi.exe'));
      for (const dir of globDirs(`${d}\\wamp64\\bin\\php`, /^php/i)) add(path.join(dir, 'php-cgi.exe'));
      for (const dir of globDirs(`${d}\\tools`, /^php/i)) add(path.join(dir, 'php-cgi.exe'));
    }
    for (const dir of globDirs('C:\\Program Files', /^php/i)) add(path.join(dir, 'php-cgi.exe'));
  } else {
    for (const p of ['/usr/bin/php-cgi', '/usr/local/bin/php-cgi', '/opt/homebrew/bin/php-cgi']) add(p);
  }
  return out;
}

let detectCache = null;
function resolvePhpCgi(configured) {
  if (configured) {
    let p = configured.trim().replace(/^"|"$/g, '');
    if (/php\.exe$/i.test(p)) p = path.join(path.dirname(p), 'php-cgi.exe');
    if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'php-cgi.exe');
    return fs.existsSync(p) ? p : null;
  }
  if (!detectCache || Date.now() - detectCache.at > 60000) {
    detectCache = { at: Date.now(), path: findPhpCgiCandidates()[0] || null };
  }
  return detectCache.path;
}

function phpVersion(cgiPath) {
  try {
    const out = execFileSync(cgiPath, ['-v'], { encoding: 'utf-8', windowsHide: true, timeout: 5000 });
    return (out.match(/PHP\s+(\d+\.\d+\.\d+)/) || [])[1] || null;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ routing

/**
 * Decides what a PHP website should do with a path:
 *   { kind: 'script', file, scriptName, pathInfo }
 *   { kind: 'static' } | { kind: 'redirect', to } | { kind: 'error', status }
 */
async function routePhp(site, pathname, rawPathname, search, hideDotfiles) {
  // /index.php/some/path -> SCRIPT_NAME=/index.php, PATH_INFO=/some/path
  const pi = /^(.*?\.php)(\/.*)$/i.exec(pathname);
  if (pi) {
    const t = resolveInside(site.root, pi[1], { hideDotfiles });
    if (t.path) {
      const s = await statOrNull(t.path);
      if (s && s.isFile()) return { kind: 'script', file: t.path, scriptName: pi[1], pathInfo: pi[2] };
    }
  }

  const target = resolveInside(site.root, pathname, { hideDotfiles });
  if (target.error) return { kind: 'error', status: target.error };
  const stat = await statOrNull(target.path);

  if (stat && stat.isDirectory()) {
    if (!pathname.endsWith('/')) return { kind: 'redirect', to: `${rawPathname}/${search}` };
    for (const index of site.indexFiles) {
      const p = path.join(target.path, index);
      const s = await statOrNull(p);
      if (s && s.isFile()) {
        return PHP_EXT.test(index)
          ? { kind: 'script', file: p, scriptName: `${pathname}${index}`, pathInfo: '' }
          : { kind: 'static' };
      }
    }
  } else if (stat && stat.isFile()) {
    return PHP_EXT.test(target.path)
      ? { kind: 'script', file: target.path, scriptName: pathname, pathInfo: '' }
      : { kind: 'static' };
  }

  // Front controller: WordPress, Laravel, Symfony, CodeIgniter pretty URLs.
  if (site.phpFrontController) {
    const front = path.join(path.resolve(site.root), 'index.php');
    const s = await statOrNull(front);
    if (s && s.isFile()) return { kind: 'script', file: front, scriptName: '/index.php', pathInfo: '' };
  }
  return stat && stat.isDirectory() ? { kind: 'static' } : { kind: 'error', status: 404 };
}

// ------------------------------------------------------------------ CGI

function buildEnv(req, ctx, route) {
  const { site, localPort, tls, search } = ctx;
  const host = String(req.headers.host || 'localhost');
  const root = path.resolve(site.root);
  const env = {};
  // Only what PHP needs from our own environment — never ELECTRON_* or tokens.
  for (const key of ['SystemRoot', 'SYSTEMROOT', 'windir', 'WINDIR', 'PATH', 'Path', 'PATHEXT', 'TEMP', 'TMP', 'COMSPEC', 'ComSpec', 'PHPRC', 'PHP_INI_SCAN_DIR', 'HOME', 'USERPROFILE', 'LANG']) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  Object.assign(env, {
    REDIRECT_STATUS: '200',
    GATEWAY_INTERFACE: 'CGI/1.1',
    SERVER_SOFTWARE: SERVER_HEADER,
    SERVER_PROTOCOL: `HTTP/${req.httpVersion}`,
    SERVER_NAME: host.replace(/:\d+$/, '').replace(/^\[|\]$/g, ''),
    SERVER_PORT: String(localPort),
    SERVER_ADDR: stripV4Mapped(req.socket.localAddress),
    REMOTE_ADDR: stripV4Mapped(req.socket.remoteAddress),
    REMOTE_PORT: String(req.socket.remotePort || ''),
    REQUEST_METHOD: req.method,
    REQUEST_URI: req.url,
    REQUEST_SCHEME: tls ? 'https' : 'http',
    QUERY_STRING: search ? search.slice(1) : '',
    DOCUMENT_ROOT: root,
    CONTEXT_DOCUMENT_ROOT: root,
    SCRIPT_FILENAME: route.file,
    SCRIPT_NAME: route.scriptName,
    PHP_SELF: route.scriptName + (route.pathInfo || ''),
    CONTENT_TYPE: req.headers['content-type'] || '',
    CONTENT_LENGTH: req.headers['content-length'] || ''
  });
  if (tls) env.HTTPS = 'on';
  if (route.pathInfo) {
    env.PATH_INFO = route.pathInfo;
    env.PATH_TRANSLATED = path.join(root, route.pathInfo);
  }
  for (const [name, value] of Object.entries(req.headers)) {
    const key = `HTTP_${name.toUpperCase().replace(/-/g, '_')}`;
    if (key === 'HTTP_PROXY') continue; // "httpoxy": never let a request set a proxy for PHP
    env[key] = Array.isArray(value) ? value.join(', ') : String(value);
  }
  return env;
}

function findHeaderEnd(buf) {
  const crlf = buf.indexOf('\r\n\r\n');
  const lf = buf.indexOf('\n\n');
  if (crlf === -1 && lf === -1) return null;
  if (crlf !== -1 && (lf === -1 || crlf <= lf)) return { at: crlf, len: 4 };
  return { at: lf, len: 2 };
}

function parseCgiHeaders(text) {
  let status = null;
  const headers = {};
  for (const line of text.split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    const lower = key.toLowerCase();
    if (lower === 'status') {
      status = parseInt(value, 10) || 200;
    } else if (lower === 'set-cookie') {
      (headers['Set-Cookie'] = headers['Set-Cookie'] || []).push(value);
    } else {
      headers[key] = value;
    }
  }
  if (!status) status = Object.keys(headers).some((k) => k.toLowerCase() === 'location') ? 302 : 200;
  return { status, headers };
}

/** Runs one request through php-cgi. Resolves with the status code sent. */
function runCgi(req, res, ctx, route) {
  const { phpCgi, timeoutSec, maxBodyBytes, logger } = ctx;
  return new Promise((resolve) => {
    let settled = false;
    const finish = (code) => {
      if (!settled) {
        settled = true;
        resolve(code);
      }
    };

    const declared = Number(req.headers['content-length'] || 0);
    if (declared > maxBodyBytes) {
      finish(sendError(res, 413, 'The upload is larger than this server allows.'));
      req.resume();
      return;
    }

    const child = spawn(phpCgi, [], {
      cwd: path.dirname(route.file),
      env: buildEnv(req, ctx, route),
      windowsHide: true
    });

    let headerBuf = Buffer.alloc(0);
    let headersDone = false;
    let status = 200;
    let stderr = '';

    const timer = setTimeout(() => {
      logger && logger.warn('php', `${route.scriptName} ran longer than ${timeoutSec}s and was stopped.`);
      child.kill();
      if (!res.headersSent) finish(sendError(res, 504, 'The PHP script took too long to respond.'));
      else res.destroy();
    }, timeoutSec * 1000);

    res.on('close', () => {
      if (child.exitCode === null) child.kill();
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      finish(sendError(res, 500, `Could not start PHP (${err.message}).`));
    });

    child.stderr.on('data', (d) => {
      if (stderr.length < 8000) stderr += d.toString();
    });

    child.stdout.on('data', (chunk) => {
      if (headersDone) {
        res.write(chunk);
        return;
      }
      headerBuf = Buffer.concat([headerBuf, chunk]);
      const end = findHeaderEnd(headerBuf);
      if (!end) {
        if (headerBuf.length > 64 * 1024) {
          child.kill();
          finish(sendError(res, 502, 'PHP returned an invalid response.'));
        }
        return;
      }
      headersDone = true;
      const parsed = parseCgiHeaders(headerBuf.subarray(0, end.at).toString('latin1'));
      status = parsed.status;
      res.writeHead(status, parsed.headers);
      const rest = headerBuf.subarray(end.at + end.len);
      if (rest.length && req.method !== 'HEAD') res.write(rest);
      headerBuf = null;
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (stderr.trim()) logger && logger.warn('php', `${route.scriptName}: ${stderr.trim().slice(0, 500)}`);
      if (settled) return;
      if (!headersDone) {
        if (headerBuf && headerBuf.length) {
          // No header block at all: treat the whole output as an HTML body.
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(headerBuf);
          finish(200);
        } else {
          finish(sendError(res, 502, `PHP exited with code ${code} without producing a page.${stderr ? ' Details are in the HawHost log.' : ''}`));
        }
        return;
      }
      res.end();
      finish(status);
    });

    // Request body -> php stdin (with a size cap even when chunked).
    child.stdin.on('error', () => { /* PHP may exit without reading the body */ });
    let received = 0;
    req.on('data', (chunk) => {
      received += chunk.length;
      if (received > maxBodyBytes) {
        child.kill();
        req.unpipe?.();
        if (!res.headersSent) finish(sendError(res, 413, 'The upload is larger than this server allows.'));
        return;
      }
      child.stdin.write(chunk);
    });
    req.on('end', () => child.stdin.end());
    req.on('error', () => child.kill());
  });
}

/**
 * ctx: { site, pathname, rawPathname, search, localPort, tls, phpCgi, timeoutSec,
 *        maxBodyBytes, hideDotfiles, logger }
 */
async function handlePhp(req, res, ctx) {
  const route = await routePhp(ctx.site, ctx.pathname, ctx.rawPathname, ctx.search, ctx.hideDotfiles);
  if (route.kind === 'redirect') return redirect(res, route.to);
  if (route.kind === 'static') return handleStatic(req, res, ctx);
  if (route.kind === 'error') {
    if (route.status === 404) return (require('./static-handler').notFound)(req, res, ctx.site, ctx.hideDotfiles);
    return sendError(res, route.status);
  }
  if (!ctx.phpCgi) {
    return sendError(res, 503,
      'PHP is not installed or HawHost cannot find <code>php-cgi.exe</code>. Install PHP (or XAMPP) and set its folder in HawHost &rarr; Settings.');
  }
  return runCgi(req, res, ctx, route);
}

module.exports = { handlePhp, routePhp, resolvePhpCgi, findPhpCgiCandidates, phpVersion, parseCgiHeaders, buildEnv };
