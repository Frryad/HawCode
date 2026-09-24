'use strict';

const fs = require('fs');
const net = require('net');
const path = require('path');

const CANDIDATE_ROOTS = ['C:\\xampp', 'D:\\xampp', 'E:\\xampp', 'C:\\Program Files\\xampp'];

/** Where XAMPP is installed, or null. */
function findInstall() {
  const fromEnv = process.env.XAMPP_HOME ? [process.env.XAMPP_HOME] : [];
  for (const root of [...fromEnv, ...CANDIDATE_ROOTS]) {
    if (fs.existsSync(path.join(root, 'apache', 'conf', 'httpd.conf'))) return root;
  }
  return null;
}

/**
 * The plain-HTTP ports Apache is configured to listen on, from httpd.conf.
 *
 * Only the main file's `Listen` lines: SSL's 443 lives in extra/httpd-ssl.conf
 * and is not what a shared http:// link points at.
 */
function listenPorts(root) {
  try {
    const text = fs.readFileSync(path.join(root, 'apache', 'conf', 'httpd.conf'), 'utf-8');
    const ports = [];
    for (const line of text.split(/\r?\n/)) {
      const match = /^\s*Listen\s+(?:\[[^\]]*\]:|[\d.]+:)?(\d+)\s*$/i.exec(line);
      if (match) ports.push(Number(match[1]));
    }
    return [...new Set(ports)];
  } catch {
    return [];
  }
}

/** Whether something on this computer accepts connections on a port. */
function portOpen(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port: Number(port), timeout: 1500 });
    const done = (open) => {
      socket.destroy();
      resolve(open);
    };
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

/**
 * Everything the app needs to know about the local XAMPP, in one call.
 *
 * `port` is the one to use: the configured port when Apache really listens
 * there, otherwise the port httpd.conf says, so a stale setting in HawCode
 * (8080 when Apache is on 80) does not produce a link that leads nowhere.
 */
async function inspect(configuredPort) {
  const root = findInstall();
  const ports = root ? listenPorts(root) : [];
  const configured = Number(configuredPort) || null;
  const port = configured && ports.includes(configured) ? configured : (ports[0] || configured || 80);
  const running = await portOpen(port);
  return {
    installed: Boolean(root),
    root,
    listenPorts: ports,
    configuredPort: configured,
    port,
    mismatch: Boolean(configured && ports.length && !ports.includes(configured)),
    running,
    controlPanel: root ? path.join(root, 'xampp-control.exe') : null
  };
}

// ------------------------------------------------------------ virtual host

// Everything HawCode writes into Apache's config sits between these lines, so it
// can be replaced or removed without touching anything the user wrote.
const VHOST_BEGIN = '# BEGIN HawCode (routes local names to shared folders; managed by HawCode)';
const VHOST_END = '# END HawCode';

// The modules a reverse proxy with WebSocket support needs, as named in httpd.conf.
const NEEDED_MODULES = [
  { name: 'proxy_module', file: 'modules/mod_proxy.so' },
  { name: 'proxy_http_module', file: 'modules/mod_proxy_http.so' },
  { name: 'proxy_wstunnel_module', file: 'modules/mod_proxy_wstunnel.so' },
  { name: 'rewrite_module', file: 'modules/mod_rewrite.so' }
];
const VHOSTS_INCLUDE = 'conf/extra/httpd-vhosts.conf';

function confPaths(root) {
  return {
    httpd: path.join(root, 'apache', 'conf', 'httpd.conf'),
    vhosts: path.join(root, 'apache', 'conf', 'extra', 'httpd-vhosts.conf'),
    exe: path.join(root, 'apache', 'bin', 'httpd.exe')
  };
}

const escapeRe = (text) => text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

/**
 * One whole line of httpd.conf. Horizontal whitespace only: XAMPP's file mixes
 * LF and CRLF endings, and in multiline mode `^` also matches after a lone \r,
 * so `^\s*` would reach back across a line break and swallow it.
 */
function lineRe(body) {
  return new RegExp(`^[ \\t]*${body}[ \\t]*\\r?$`, 'm');
}

const activeModuleRe = (mod) => lineRe(`LoadModule[ \\t]+${mod.name}[ \\t]+\\S+`);
const includeRe = () => lineRe(`Include[ \\t]+${escapeRe(VHOSTS_INCLUDE)}`);

/** httpd.conf with the proxy modules and the vhosts Include switched on. */
function enableModules(text) {
  let out = text;
  for (const mod of NEEDED_MODULES) {
    if (activeModuleRe(mod).test(out)) continue;
    const commented = new RegExp(`^[ \\t]*#[ \\t]*(LoadModule[ \\t]+${mod.name}[ \\t]+\\S+)`, 'm');
    out = commented.test(out)
      ? out.replace(commented, '$1')
      : `${out.replace(/\s*$/, '')}\r\nLoadModule ${mod.name} ${mod.file}\r\n`;
  }
  if (!includeRe().test(out)) {
    const commented = new RegExp(`^[ \\t]*#[ \\t]*(Include[ \\t]+${escapeRe(VHOSTS_INCLUDE)})`, 'm');
    out = commented.test(out) ? out.replace(commented, '$1') : `${out.replace(/\s*$/, '')}\r\nInclude ${VHOSTS_INCLUDE}\r\n`;
  }
  return out;
}

/** What httpd.conf says about the modules, for the status panel. */
function modulesStatus(root) {
  try {
    const text = fs.readFileSync(confPaths(root).httpd, 'utf-8');
    const missing = NEEDED_MODULES
      .filter((mod) => !activeModuleRe(mod).test(text))
      .map((mod) => mod.name);
    const includesVhosts = includeRe().test(text);
    return { ok: !missing.length && includesVhosts, missing, includesVhosts };
  } catch (error) {
    return { ok: false, missing: [], includesVhosts: false, error: error.message };
  }
}

/** The DocumentRoot httpd.conf serves, so the default site stays exactly as it was. */
function documentRoot(root) {
  try {
    const text = fs.readFileSync(confPaths(root).httpd, 'utf-8');
    const match = /^[ \t]*DocumentRoot\s+"?([^"\r\n]+)"?[ \t]*$/m.exec(text);
    if (match) return match[1];
  } catch { /* fall through */ }
  return `${root.replace(/\\/g, '/')}/htdocs`;
}

function stripBlock(text) {
  const start = text.indexOf(VHOST_BEGIN);
  if (start < 0) return text;
  const end = text.indexOf(VHOST_END, start);
  if (end < 0) return text;
  return (text.slice(0, start) + text.slice(end + VHOST_END.length)).replace(/^(\r?\n)+/, '');
}

/** Any <VirtualHost> the user wrote themselves (outside HawCode's block). */
function hasOwnVhosts(text) {
  return /^[ \t]*<VirtualHost\b/im.test(stripBlock(text));
}

/**
 * The block: a default site first, then one proxy per name.
 *
 * Apache hands any request whose name matches no ServerName to the *first*
 * virtual host on the port, so the default goes first and keeps localhost and the
 * PC's IP opening htdocs exactly as before. It is left out when the user already
 * has virtual hosts of their own, because theirs decides the default then. Each
 * name is proxied to HawCode's website port, and WebSocket upgrades go through
 * too so the live editor keeps working behind the name.
 */
function vhostBlock({ sites, docRoot, includeDefault }) {
  const lines = [VHOST_BEGIN];
  if (includeDefault) {
    lines.push(
      '<VirtualHost *:80>',
      '    ServerName localhost',
      `    DocumentRoot "${docRoot}"`,
      '</VirtualHost>'
    );
  }
  for (const site of sites) {
    const target = `127.0.0.1:${site.port}`;
    lines.push(
      '<VirtualHost *:80>',
      `    ServerName ${site.domain}`,
      '    ProxyRequests Off',
      '    ProxyPreserveHost On',
      '    RewriteEngine On',
      '    RewriteCond %{HTTP:Upgrade} websocket [NC]',
      `    RewriteRule ^/(.*)$ ws://${target}/$1 [P,L]`,
      `    ProxyPass / http://${target}/`,
      `    ProxyPassReverse / http://${target}/`,
      '</VirtualHost>'
    );
  }
  lines.push(VHOST_END);
  return lines.join('\r\n');
}

/** The names HawCode currently routes, read back from the file. */
function vhostStatus(root) {
  if (!root) return { ok: false, installed: false, sites: [] };
  const { vhosts } = confPaths(root);
  let text = '';
  try { text = fs.readFileSync(vhosts, 'utf-8'); } catch { /* none yet */ }
  const start = text.indexOf(VHOST_BEGIN);
  const end = start >= 0 ? text.indexOf(VHOST_END, start) : -1;
  const block = start >= 0 && end >= 0 ? text.slice(start, end) : '';
  const sites = [];
  const re = /ServerName\s+(\S+)[\s\S]*?ProxyPass \/ http:\/\/127\.0\.0\.1:(\d+)\//g;
  let match;
  while ((match = re.exec(block))) sites.push({ domain: match[1].toLowerCase(), port: Number(match[2]) });
  return { installed: Boolean(block), sites, modules: modulesStatus(root) };
}

/** `httpd -t`: Apache's own verdict on the config, before anything is restarted. */
function testConfig(root) {
  return new Promise((resolve) => {
    require('child_process').execFile(confPaths(root).exe, ['-t'],
      { cwd: root, windowsHide: true, timeout: 20000 },
      (error, stdout, stderr) => resolve({
        ok: !error,
        output: `${stdout || ''}${stderr || ''}`.trim()
      }));
  });
}

/**
 * Route `sites` ([{ domain, port }]) through Apache, or remove the routing when
 * the list is empty.
 *
 * Both files are backed up first and put back if Apache rejects the result, so a
 * failed change can never leave XAMPP unable to start. Nothing is restarted here;
 * the caller restarts Apache only after this succeeds.
 */
async function writeVhosts(root, sites) {
  if (!root) return { ok: false, error: 'XAMPP was not found on this computer.' };
  const clean = (sites || []).filter((site) => site && /^[a-z0-9.-]+$/i.test(site.domain) && Number(site.port) > 0);
  const { httpd, vhosts } = confPaths(root);

  let httpdText;
  let vhostsText = '';
  try {
    httpdText = fs.readFileSync(httpd, 'utf-8');
    if (fs.existsSync(vhosts)) vhostsText = fs.readFileSync(vhosts, 'utf-8');
  } catch (error) {
    return { ok: false, error: `Could not read Apache's config: ${error.message}` };
  }

  const nextHttpd = clean.length ? enableModules(httpdText) : httpdText;
  const rest = stripBlock(vhostsText);
  const nextVhosts = clean.length
    ? `${vhostBlock({ sites: clean, docRoot: documentRoot(root), includeDefault: !hasOwnVhosts(vhostsText) })}\r\n\r\n${rest}`
    : rest;
  if (nextHttpd === httpdText && nextVhosts === vhostsText) return { ok: true, changed: false };

  try {
    fs.writeFileSync(`${httpd}.hawcode.bak`, httpdText, 'utf-8');
    fs.writeFileSync(`${vhosts}.hawcode.bak`, vhostsText, 'utf-8');
    fs.writeFileSync(httpd, nextHttpd, 'utf-8');
    fs.writeFileSync(vhosts, nextVhosts, 'utf-8');
  } catch (error) {
    try { fs.writeFileSync(httpd, httpdText, 'utf-8'); } catch { /* best effort */ }
    try { fs.writeFileSync(vhosts, vhostsText, 'utf-8'); } catch { /* best effort */ }
    return { ok: false, error: `Could not write Apache's config: ${error.message}` };
  }

  const verdict = await testConfig(root);
  if (!verdict.ok) {
    fs.writeFileSync(httpd, httpdText, 'utf-8');
    fs.writeFileSync(vhosts, vhostsText, 'utf-8');
    return { ok: false, error: `Apache rejected the change, so it was undone: ${verdict.output}` };
  }
  return { ok: true, changed: true };
}

/** Stop every httpd.exe of this user's, so the caller can start Apache again. */
function stopApache() {
  return new Promise((resolve) => {
    require('child_process').execFile('taskkill.exe', ['/F', '/T', '/IM', 'httpd.exe'],
      { windowsHide: true, timeout: 15000 }, (error) => resolve({ ok: !error }));
  });
}

module.exports = {
  inspect, findInstall, listenPorts, portOpen,
  modulesStatus, vhostStatus, writeVhosts, testConfig, stopApache,
  // Exposed for tests.
  enableModules, vhostBlock, stripBlock, VHOST_BEGIN, VHOST_END
};
