'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');
const dgram = require('dgram');

const { SyncEngine } = require('./electron/sync-engine');
const { StateStore } = require('./electron/manifest');
const {
  createServer, generateRoomCode, LAN_CODE_LENGTH, INTERNET_CODE_LENGTH,
  PORT_RANGE_START, PORT_RANGE_END
} = require('./electron/server');
const { createDiscovery } = require('./electron/discovery');
const { connectToHost, probeHost, normalizeUrl } = require('./electron/peer-client');
const { createLocalAddress } = require('./electron/local-address');
const { createReachability } = require('./electron/reachability');
const { createDdns, PROVIDERS: DDNS_PROVIDERS } = require('./electron/ddns');
const { createFirewall } = require('./electron/firewall');
const { createPortMapper } = require('./electron/port-mapper');
const xampp = require('./electron/xampp');
const hostsFile = require('./electron/hosts-file');
const { psQuote, powershellCommand } = require('./electron/elevated');
const secret = require('./electron/secret');
const ports = require('./electron/ports');
const routerInfo = require('./electron/router-info');
const { createP2PHost, DEFAULT_STUN } = require('./electron/p2p/host');
const { writeInvitePage, safeFileName } = require('./electron/p2p/build-invite-page');
const { createMdnsResponder, HOSTNAME: MDNS_HOSTNAME } = require('./electron/mdns');
const { createDnsServer } = require('./electron/dns-server');
const domainName = require('./electron/domain-name');
const dnsWire = require('./electron/dns-wire');
const { TerminalManager } = require('./electron/terminal');
const shells = require('./electron/shells');
const git = require('./electron/git');
const search = require('./electron/search');
const scripts = require('./electron/scripts');
const { Settings } = require('./electron/settings');

let mainWindow = null;
let engine = null;
let server = null;
let discovery = null;
let peerClient = null;
let terminals = null;
let settings = null;
let p2p = null;
let mdns = null;
let dnsServer = null;
let netAddress = null;
let reachability = null;
let ddns = null;
let firewall = null;
// Router port forwarding over UPnP, for Share online: HawCode's port, and
// Apache's when an XAMPP site is shared.
let portMapper = null;
let xamppMapper = null;
// The last firewall rule state we read. Refreshed when it changes rather than on
// every status push, because reading it shells out to netsh once per rule.
let firewallState = null;
// Rules this session applied, so teardown only takes back what it put there.
let firewallApplied = false;

// The default gateway, read once in the background at startup. The name server
// needs somewhere to forward to, and this is the answer that survives the user
// later pointing this machine at itself.
let gateway = null;

// Friends connected over a punched data channel rather than the LAN server.
let p2pPeers = [];

// Invites minted this session, kept so the reply code and the standalone page
// can be matched back to the connection that is waiting for them.
const invites = new Map();

/** The STUN list from Settings, falling back to the shipped default. */
function stunServers() {
  const configured = settings ? settings.get('stunServers') : null;
  return Array.isArray(configured) ? configured : DEFAULT_STUN;
}

const instanceId = crypto.randomUUID();

/**
 * This computer's address on the network.
 *
 * Deliberately a variable rather than a constant: a DHCP renewal, a move from
 * Wi-Fi to Ethernet or a VPN coming up all change it, and a name that still
 * answers with the old one is a name that has quietly stopped working.
 * electron/local-address.js owns the watching; everything here reads this.
 */
let localIp = '127.0.0.1';

// How this workspace is being shared, for the status bar and the beacon.
let session = {
  mode: null, exposure: null, publicUrl: null, code: null, domain: null, extraNames: []
};

// The file the editor currently has open. Only this one needs its contents
// pushed to the renderer when a peer changes it.
let activeEditorPath = null;

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

/**
 * The port the local server ended up on. In production the window is loaded
 * from it rather than from file://, because Chromium refuses to start web
 * workers on a file:// page and Monaco needs four of them for HTML, CSS, JSON
 * and JS/TS tooling.
 */
let servedPort = null;

/**
 * Put the window on screen. Creating it is separate from loading it on purpose:
 * the frame can appear in the first few milliseconds, while the port scan, the
 * name server and the discovery sockets are still being set up, and the page is
 * pointed at the server once there is one to point at.
 */
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 940,
    minHeight: 620,
    title: 'HawCode — Wi-Fi Collaborative Sync Editor',
    backgroundColor: '#0d1117',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      // Nothing in HawCode is drawn while the window is in the background, so
      // let Chromium keep the renderer at full speed instead of throttling it
      // when the user tabs away mid-sync.
      backgroundThrottling: false
    }
  });

  // A window that fails to load is the one failure the user cannot see the
  // cause of, so it goes to the terminal rather than nowhere.
  mainWindow.webContents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
    if (isMainFrame) console.error(`HawCode window failed to load ${url}: ${description} (${code})`);
  });

  return mainWindow;
}

/**
 * Fill the window that `createWindow` opened.
 *
 * Retrying matters more than it looks. In development the window is pointed at
 * the Vite dev server, which may still be starting, restarting after a config
 * change, or rebuilding its dependency cache — and a page that is refused once
 * stays blank forever unless something asks again. A window with nothing in it
 * is the least useful thing HawCode can show, so a failed load is retried for a
 * few seconds and then explained on the page itself.
 */
function loadWindow(attempt = 0) {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  const isDev = !app.isPackaged && process.argv.includes('--dev');
  // 127.0.0.1 rather than `localhost`: on Windows the name resolves to ::1
  // first, and a dev server bound only to IPv4 would never be found.
  const target = isDev
    ? 'http://127.0.0.1:5173'
    : (servedPort ? `http://127.0.0.1:${servedPort}/` : null);

  // No free port: the app still opens and still colours code, it just loses the
  // worker-backed extras (completions, validation, format).
  const loading = target
    ? mainWindow.loadURL(target)
    : mainWindow.loadFile(path.join(__dirname, 'dist', 'index.html'));

  loading.catch((error) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (attempt < LOAD_ATTEMPTS) {
      setTimeout(() => loadWindow(attempt + 1), LOAD_RETRY_MS);
      return;
    }
    console.error(`HawCode could not load ${target || 'dist/index.html'}`, error);
    showLoadFailure(target, error);
  });
}

const LOAD_ATTEMPTS = 20;
const LOAD_RETRY_MS = 500;

/** Say why the window is empty, in the window, rather than leaving it empty. */
function showLoadFailure(target, error) {
  const isDev = !app.isPackaged && process.argv.includes('--dev');
  const advice = isDev
    ? 'The development server did not answer. Check the terminal running <code>npm run dev</code> — Vite may have failed to start, or stopped because port 5173 was taken.'
    : 'The local server did not answer. Closing and reopening HawCode usually clears it.';
  const page = `<!doctype html><html><head><meta charset="utf-8"><title>HawCode</title></head>
<body style="margin:0;height:100vh;display:flex;align-items:center;justify-content:center;background:#0d1117;color:#c9d1d9;font:14px system-ui,Segoe UI,sans-serif">
<div style="max-width:30rem;padding:2rem;border:1px solid #30363d;border-radius:1rem;background:#161b22">
<h1 style="margin:0 0 .75rem;font-size:1rem">HawCode could not open its window contents</h1>
<p style="margin:0 0 .75rem;color:#8b949e;font-size:.8rem">${advice}</p>
<p style="margin:0;color:#6e7681;font-size:.7rem;font-family:ui-monospace,Consolas,monospace">${target || 'dist/index.html'} — ${String(error && error.message ? error.message : error)}</p>
</div></body></html>`;
  mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(page)}`).catch(() => {});
}

function computePublicUrl() {
  if (session.exposure !== 'online' || session.mode !== 'host' || !server) {
    return session.publicUrl || null;
  }
  const shown = outsidePort();

  // The name only once it is actually being kept pointed here this session. A
  // Test result or an update from an earlier run proves nothing about now.
  if (ddns && ddns.isRunning() && ddns.fqdn()) {
    return `http://${ddns.fqdn()}${shown === 80 ? '' : `:${shown}`}`;
  }
  const upnpIp = portMapper && portMapper.status.externalIp;
  const cachedIp = (reachability ? reachability.getCachedPublicIp() : null) || upnpIp;
  if (cachedIp) {
    return `http://${cachedIp}${shown === 80 ? '' : `:${shown}`}`;
  }
  return session.publicUrl || null;
}

/** Why the shared XAMPP site would not answer, or null when it would. */
async function xamppProblem() {
  const state = await xampp.inspect(settings.get('xamppPort'));
  if (!state.installed) {
    return 'XAMPP was not found on this computer (looked for C:\\xampp). Install it, or turn off '
      + '"Share an XAMPP Apache website" in Settings.';
  }
  if (!state.running) {
    return `Apache is not running on port ${state.port}. Press "Start Apache" in Settings, or Start `
      + 'next to Apache in the XAMPP Control Panel.';
  }
  return null;
}

/**
 * Start XAMPP's Apache the way its Control Panel does: httpd.exe, detached,
 * so it outlives HawCode. Port 80 is released first when Apache needs it.
 */
async function startApache() {
  const state = await xampp.inspect(settings.get('xamppPort'));
  if (!state.installed) return { ok: false, error: 'XAMPP was not found on this computer.' };
  if (state.running) return { ok: true, alreadyRunning: true, port: state.port };
  if (server) await server.syncPublicPort();
  if (state.port === 80 && server && server.getPublicPort() === 80) {
    return { ok: false, error: 'HawCode still holds port 80. Turn on "Share an XAMPP Apache website" first.' };
  }
  const httpd = path.join(state.root, 'apache', 'bin', 'httpd.exe');
  try {
    // Through `start`, so Apache's parent is a cmd that exits at once. A direct
    // child stays in HawCode's process tree, and `npm run dev` stopping (or any
    // tree kill of HawCode) took Apache down with it.
    // Verbatim, because Node would escape the empty "" window title into
    // something cmd reads as the program name.
    const child = require('child_process').spawn('cmd.exe', [`/d /c start "" /b "${httpd}"`], {
      cwd: state.root, detached: true, stdio: 'ignore', windowsHide: true, windowsVerbatimArguments: true
    });
    child.unref();
  } catch (error) {
    return { ok: false, error: error.message };
  }
  for (let i = 0; i < 20; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    if (await xampp.portOpen(state.port)) {
      session.xamppError = null;
      pushSession();
      return { ok: true, port: state.port };
    }
  }
  return {
    ok: false,
    error: `Apache did not start on port ${state.port}. Open the XAMPP Control Panel and check its log `
      + '(another program may be using the port).'
  };
}

/** The port HawCode itself answers visitors on: 80 when it has it, else the extra port or 3000-3010. */
function insidePort() {
  if (!server) return null;
  return server.getPublicPort() === 80 ? 80 : (server.getExtraPort() || server.getPort());
}

/**
 * The port someone on the internet types. Usually the same as insidePort, but a
 * router that keeps 80 for itself gets 8080 forwarded to 80 instead.
 */
function outsidePort() {
  const mapped = portMapper && portMapper.isActive() ? portMapper.status.externalPort : null;
  return mapped || insidePort();
}

/**
 * The port XAMPP's Apache really serves on.
 *
 * The setting when httpd.conf agrees, otherwise what httpd.conf says: a
 * setting of 8080 with Apache on 80 used to hand out a link to nothing.
 */
function xamppPort() {
  const configured = Number(settings.get('xamppPort')) || null;
  const root = xampp.findInstall();
  const ports = root ? xampp.listenPorts(root) : [];
  return configured && ports.includes(configured) ? configured : (ports[0] || configured || 80);
}

/** HawCode keeps off port 80 while it belongs to the shared XAMPP site. */
function mayClaimPort80() {
  return !(settings && settings.get('xamppEnabled') && xamppPort() === 80);
}

// HawCode's own website port when Apache has port 80: both sites stay up side by
// side on fixed ports, 80 for XAMPP and this one for the shared folder.
const SITE_PORT_BESIDE_XAMPP = 8081;

/** HawCode's extra listener: the user's choice, else 8081 while XAMPP owns 80. */
function hawcodeExtraPort() {
  const chosen = Number(settings && settings.get('firewallExtraPort')) || null;
  if (chosen) return chosen;
  return mayClaimPort80() ? null : SITE_PORT_BESIDE_XAMPP;
}

/** The XAMPP site's address on this network, when one is shared. */
function xamppLanUrl() {
  if (!settings || !settings.get('xamppEnabled') || !localIp) return null;
  const port = xamppPort();
  return `http://${localIp}${port === 80 ? '' : `:${port}`}`;
}

/** Every extra port the firewall has to let through: HawCode's own and XAMPP's. */
function extraFirewallPorts() {
  const wanted = [hawcodeExtraPort()];
  if (settings.get('xamppEnabled')) wanted.push(xamppPort());
  const unique = [...new Set(wanted.map(Number).filter((port) => port > 0 && port < 65536 && port !== 80
    && !(port >= PORT_RANGE_START && port <= PORT_RANGE_END)))];
  return unique.length ? unique.join(',') : null;
}

/**
 * Every website this computer serves while sharing, with its address on the
 * Wi-Fi and, when sharing online, on the internet.
 *
 * The internet address is the DDNS name when it is kept pointed here, else the
 * public IP, with the outside port the router really forwards.
 */
function siteList(publicUrl) {
  if (session.mode !== 'host' || !server || !localIp) return [];
  const withPort = (host, port) => `http://${host}${port === 80 ? '' : `:${port}`}`;
  let internetHost = null;
  if (session.exposure === 'online' && publicUrl) {
    try {
      internetHost = new URL(publicUrl).hostname;
    } catch {
      internetHost = null;
    }
  }
  const sites = [];
  if (settings.get('xamppEnabled')) {
    const port = xamppPort();
    const outside = (xamppMapper && xamppMapper.isActive() && xamppMapper.status.externalPort) || port;
    sites.push({
      name: 'XAMPP website (htdocs)',
      port,
      lanUrl: withPort(localIp, port),
      internetUrl: internetHost ? withPort(internetHost, outside) : null
    });
  }
  const sitePort = session.serveAs === 'website'
    ? (server.getPublicPort() === 80 ? 80 : server.getExtraPort())
    : insidePort();
  if (sitePort) {
    const outside = (portMapper && portMapper.isActive() && portMapper.status.externalPort) || sitePort;
    sites.push({
      name: session.serveAs === 'website' ? 'HawCode shared folder (website)' : 'HawCode shared folder (editor)',
      port: sitePort,
      lanUrl: withPort(localIp, sitePort),
      internetUrl: internetHost ? withPort(internetHost, outside) : null
    });
  }
  return sites;
}

function currentSession() {
  const status = engine ? engine.getStatus() : { state: 'idle', mode: null };
  const dynamicPublicUrl = computePublicUrl();
  const port = server ? server.getPort() : 3000;
  const publicPort = server ? server.getPublicPort() : null;
  const extraPort = server ? server.getExtraPort() : null;
  const activePort = (publicPort === 80) ? 80 : (extraPort || port);

  return {
    ...status,
    exposure: session.exposure,
    // Computed rather than stored, so an address change moves it with everything
    // else instead of leaving a stale URL on screen.
    url: lanUrl(),
    localTestUrl: `http://localhost:${activePort}`,
    publicUrl: dynamicPublicUrl,
    activePort,
    code: session.code,
    port,
    localIp,
    folderName: status.rootPath ? path.basename(status.rootPath) : null,
    browserClients: server ? server.browserCount() : 0,
    localName: server && server.getPort() ? `http://${MDNS_HOSTNAME}:${server.getPort()}` : null,
    directPeers: p2pPeers,
    domain: session.domain || null,
    domainUrl: domainUrl(),
    publicPort,
    extraPort,
    sites: siteList(dynamicPublicUrl),
    xamppUrl: session.xamppUrl || null,
    xamppLanUrl: session.mode === 'host' ? xamppLanUrl() : null,
    xamppUpnp: session.xamppUpnp || null,
    serveAs: session.serveAs || null,
    websiteUrl: websiteUrl(),
    extraPortError: session.extraPortError || null,
    upnp: session.upnp || null,
    reach: session.reach || null,
    xamppError: session.xamppError || null,
    apacheRouted: Boolean(session.apacheRouted),
    apacheError: session.apacheError || null,
    outsidePort: session.exposure === 'online' ? outsidePort() : null,
    provider: session.provider || null,
    needsDdnsSetup: Boolean(session.needsDdnsSetup),
    ddnsConfigured: ddns ? ddns.configured().ok : false,
    ddnsError: session.ddnsError || null,
    dns: dnsServer ? dnsServer.status : { running: false, upstream: [], names: [], error: null },
    ddns: ddns ? ddns.status : null,
    firewall: firewallState,
    seenFromOutside: server ? server.lastPublicHit() : null
  };
}

function pushSession() {
  send('sync-status', currentSession());
}

/**
 * The address to hand out for the workspace. Port 80 is the whole point of
 * claiming it — with it, the name stands alone.
 */
function domainUrl() {
  if (!session.domain || !server) return null;
  // Apache answers the name on port 80 and hands it to HawCode.
  if (session.apacheRouted) return `http://${session.domain}`;
  const port = server.getPublicPort();
  // In Website mode the site lives on the extra port when 80 is Apache's.
  const fallback = (session.serveAs === 'website' && server.getExtraPort()) || server.getPort();
  if (port) return `http://${session.domain}`;
  // Without a port there is nothing to hand out, so say nothing rather than an
  // address ending in a bare colon.
  return fallback ? `http://${session.domain}:${fallback}` : null;
}

/**
 * The website's address on this network, in Website mode.
 *
 * Only port 80 and the extra port serve the site (3000-3010 is the editor), so
 * with neither of them open there is no website address to hand out.
 */
function websiteUrl() {
  if (session.mode !== 'host' || session.serveAs !== 'website' || !server) return null;
  if (server.getPublicPort() === 80) return `http://${localIp}`;
  const extra = server.getExtraPort();
  return extra ? `http://${localIp}:${extra}` : null;
}

/** The plain address on this network, rebuilt from whatever the IP is now. */
function lanUrl() {
  if (session.mode !== 'host' || !server) return session.url || null;
  const port = server.getPort();
  return port ? `http://${localIp}:${port}` : null;
}

/**
 * Read the default gateway, to forward DNS to when nothing else is configured.
 *
 * Asynchronous deliberately: `route print` costs the better part of a second on
 * Windows, and running it synchronously froze the whole main process — window
 * included — before anything was on screen. It is still kicked off in the first
 * tick of startup, so it is known long before the name server can be asked for
 * it, and it still reads the routing table before this machine has pointed
 * itself anywhere.
 */
function findGateway() {
  return new Promise((resolve) => {
    require('child_process').execFile(
      'route',
      ['print', '0.0.0.0'],
      { encoding: 'utf-8', windowsHide: true, timeout: 5000 },
      (error, stdout) => {
        if (error || !stdout) {
          // Not fatal: the name server falls back to whatever the OS has
          // configured.
          resolve(null);
          return;
        }
        const match = stdout.match(/0\.0\.0\.0\s+0\.0\.0\.0\s+(\d+\.\d+\.\d+\.\d+)/);
        resolve(match ? match[1] : null);
      }
    );
  });
}

/**
 * Bring the name server up if the user has not turned it off.
 *
 * `force` is for sharing under a name: a domain nobody can look up is no domain
 * at all, so while a name is being handed out the server runs regardless.
 */
async function ensureDns({ force = false } = {}) {
  if (!dnsServer || (!force && settings.get('dnsEnabled') === false)) return;
  const started = await dnsServer.start();
  if (started.error) console.error('HawCode name server:', started.error);
}

/**
 * The names Apache should hand to HawCode: the shared folder's own name, pointed
 * at HawCode's website port. Only while XAMPP holds port 80, since otherwise
 * HawCode answers the name on port 80 itself.
 */
function apacheSites() {
  if (!settings.get('xamppEnabled') || session.mode !== 'host' || !session.domain || !server) return [];
  if (server.getPublicPort() === 80) return [];
  const port = server.getExtraPort() || server.getPort();
  return port ? [{ domain: session.domain, port }] : [];
}

/**
 * Make XAMPP's Apache route the shared folder's name to HawCode, so
 * http://<name> opens the folder while localhost and the PC's IP keep opening
 * htdocs. Apache is restarted only when its config really changed and passed
 * `httpd -t`; see xampp.writeVhosts.
 */
async function syncApacheRouting({ sites = apacheSites(), restart = true } = {}) {
  const root = xampp.findInstall();
  if (!root) return { ok: false, error: 'XAMPP was not found on this computer.' };
  if (server) await server.syncExtraPort();
  const written = await xampp.writeVhosts(root, sites);
  if (!written.ok) return written;
  if (written.changed && restart) {
    const state = await xampp.inspect(settings.get('xamppPort'));
    if (state.running) {
      await xampp.stopApache();
      const started = await startApache();
      if (!started.ok) {
        return { ok: false, error: `Apache's routing was updated, but Apache did not start again: ${started.error}` };
      }
    }
  }
  session.apacheRouted = sites.length > 0;
  return { ok: true, changed: Boolean(written.changed), sites };
}

/**
 * Start answering for a name.
 *
 * Registered with no address on purpose. The name server falls back to its
 * `getAddress` callback whenever a record has none (see dns-server.js), and that
 * callback reads `localIp` live — so a name claimed once keeps answering with the
 * right address for the rest of its life, through every DHCP renewal and network
 * change, with nothing having to re-register it.
 */
function claimDomain(name) {
  if (!name) return;
  session.domain = name;
  if (dnsServer) dnsServer.register(name, null);
}

/**
 * Also answer for a name that is not the workspace's headline address — the
 * internet name, so that it resolves on this network too and the same link works
 * from inside the house without a round trip to the router.
 */
function claimExtraName(name) {
  if (!name || name === session.domain) return;
  if (!Array.isArray(session.extraNames)) session.extraNames = [];
  if (!session.extraNames.includes(name)) session.extraNames.push(name);
  if (dnsServer) dnsServer.register(name, null);
}

function releaseDomain() {
  if (!dnsServer) {
    session.domain = null;
    session.extraNames = [];
    return;
  }
  if (session.domain) dnsServer.unregister(session.domain);
  for (const name of session.extraNames || []) dnsServer.unregister(name);
  session.domain = null;
  session.extraNames = [];
}

async function chooseFolder(title) {
  const result = await dialog.showOpenDialog(mainWindow, {
    title,
    properties: ['openDirectory', 'createDirectory']
  });
  return result.canceled ? null : result.filePaths[0];
}

/** Stop sharing this workspace without discarding it. */
async function teardownSharing() {
  if (peerClient) {
    peerClient.disconnect();
    peerClient = null;
  }
  if (discovery) discovery.stopBroadcasting();
  if (mdns) mdns.stop();
  releaseDomain();
  if (dnsServer) await dnsServer.stop();
  if (p2p) await p2p.stop();
  p2pPeers = [];
  invites.clear();
  if (ddns) await ddns.stop();
  if (portMapper) await portMapper.stop().catch(() => {});
  if (xamppMapper) await xamppMapper.stop().catch(() => {});
  // Only take back what this session put there, and only if the user did not ask
  // for the rules to stay. Rules left in place expose nothing once sharing stops:
  // the server refuses every file request and socket until the next share.
  if (firewall && firewallApplied && !settings.get('firewallAutoApply')) {
    firewallApplied = false;
    await firewall.revert().catch((error) => {
      console.error('HawCode could not remove its firewall rules:', error.message);
    });
  }
  if (server) server.setRoomCode(null);
  session = {
    mode: null, exposure: null, publicUrl: null, code: null, domain: null, extraNames: [],
    provider: null, needsDdnsSetup: false, ddnsError: null, serveAs: null, upnp: null,
    extraPortError: null, reach: null, xamppError: null, xamppUpnp: null
  };
}

app.whenReady().then(async () => {
  // First thing, before any of the network setup: the window is what the user
  // is waiting for, and it can be on screen while the rest of this runs.
  createWindow();

  const stateStore = new StateStore(path.join(app.getPath('userData'), 'hawcode-state.json'));
  engine = new SyncEngine({ stateStore });

  engine.on('status', pushSession);
  engine.on('tree-changed', () => {
    send('file-tree-changed');
    if (server) server.broadcastToBrowsers('file-tree-changed');
    if (p2p) p2p.notifyBrowsers('file-tree-changed', {});
  });
  engine.on('file-written', ({ path: relPath }) => {
    // Browsers only get the path and re-fetch if it is the file they have open.
    if (server) server.broadcastToBrowsers('file-updated', { path: relPath });
    if (p2p) p2p.notifyBrowsers('file-updated', { path: relPath });
    // Likewise here: syncing a thousand files must not push a thousand file
    // bodies across IPC, so only the one actually on screen carries content.
    if (relPath !== activeEditorPath) return;
    const result = engine.readForEditor(relPath);
    if (result.error) return;
    send('file-updated', { path: relPath, ...result });
  });
  // A file rewritten outside HawCode (another editor, a build step, a git
  // checkout) has to reach the open editor, or its stale buffer would overwrite
  // the change the moment anyone types.
  engine.on('local-file-changed', ({ path: relPath }) => {
    if (server) server.broadcastToBrowsers('file-updated', { path: relPath });
    if (p2p) p2p.notifyBrowsers('file-updated', { path: relPath });
    if (relPath !== activeEditorPath) return;
    const result = engine.readForEditor(relPath);
    if (result.error) return;
    send('file-updated', { path: relPath, ...result });
  });
  engine.on('activity', (entry) => send('sync-activity', entry));
  engine.on('progress', (entry) => send('transfer-progress', entry));
  engine.on('presence', (peers) => send('peer-presence', peers));

  settings = new Settings(path.join(app.getPath('userData'), 'hawcode-settings.json'));

  // Terminals open in the shared folder when there is one. This manager is
  // reachable only through the IPC handlers below — deliberately never through
  // the Express/Socket.IO server, because a terminal is arbitrary code
  // execution and a workspace can be published to the internet.
  terminals = new TerminalManager({
    getCwd: () => engine.rootPath || shells.homeDirectory()
  });
  terminals.on('data', (payload) => send('terminal-data', payload));
  terminals.on('exit', (payload) => send('terminal-exit', payload));

  // Started here, read whenever the name server first needs it — which is only
  // once someone shares a folder, long after this has answered.
  findGateway().then((address) => {
    gateway = address;
    // The gateway is how the address picker tells a real network card from a VPN
    // or a virtual switch, so re-read once it is known.
    if (netAddress) netAddress.refresh();
  });

  /**
   * Follow this computer's address.
   *
   * Everything that announces an address reads `localIp`, so moving them together
   * is the whole of local dynamic DNS: the name server answers from a live
   * callback, mDNS and the beacon are restarted because their sockets were bound
   * to an interface that may have gone away, and the internet name is told the
   * network moved.
   */
  netAddress = createLocalAddress({
    getGateway: () => gateway,
    onChange: (next, previous) => {
      localIp = next;
      console.log(`HawCode address changed from ${previous} to ${next}`);
      if (session.mode === 'host') {
        if (mdns) {
          mdns.stop();
          mdns.start();
        }
        if (discovery) {
          discovery.stopBroadcasting();
          discovery.startBroadcasting(instanceId);
        }
        if (ddns && ddns.isRunning()) {
          ddns.refresh('local-address-changed').catch(() => {});
        }
        // The router forwards to an address; a new one needs a new mapping.
        if (portMapper && portMapper.isActive()) {
          portMapper.refresh().then((state) => {
            session.upnp = state;
            pushSession();
          }).catch(() => {});
        }
        if (xamppMapper && xamppMapper.isActive()) {
          xamppMapper.refresh().then((state) => {
            session.xamppUpnp = state;
            pushSession();
          }).catch(() => {});
        }
      }
      pushSession();
    }
  });
  localIp = netAddress.current;
  netAddress.start();

  reachability = createReachability({
    getStunServers: () => stunServers(),
    getGateway: () => gateway,
    getLocalAddress: () => localIp
  });

  dnsServer = createDnsServer({
    getAddress: () => localIp,
    gateway: () => gateway,
    onStatus: () => pushSession()
  });

  ddns = createDdns({
    settings,
    reachability,
    appVersion: app.getVersion(),
    onStatus: () => pushSession()
  });

  firewall = createFirewall({
    userDataDir: app.getPath('userData'),
    execPath: process.execPath,
    // The extra ports go into the web rules too, so friends on the Wi-Fi reach
    // them (the extra-port rule alone is only added when sharing online).
    getWebPorts: () => ['80', `${PORT_RANGE_START}-${PORT_RANGE_END}`,
      ...String(extraFirewallPorts() || '').split(',').filter(Boolean)],
    getExtraPort: extraFirewallPorts,
    onStatus: (state) => { firewallState = state; }
  });

  portMapper = createPortMapper({ getLocalAddress: () => localIp });
  xamppMapper = createPortMapper({ getLocalAddress: () => localIp });

  server = createServer({
    engine,
    appRoot: __dirname,
    onPeerChange: pushSession,
    getDomain: () => session.domain || null,
    // HawCode's own extra listener. XAMPP's port is Apache's, never bound here.
    getExtraPort: hawcodeExtraPort,
    // Anything shared at all: host, or a joined copy served from this machine.
    getShare: () => (session.mode ? { serveAs: session.serveAs || 'editor' } : null),
    mayClaimPort80
  });

  // Run once the IPC handlers below exist, because the page is loaded from this
  // port and starts calling them the moment it does.
  async function startServer() {
    try {
      const port = await server.start();
      servedPort = port;
      console.log(`HawCode listening on http://${localIp}:${port}`);
      if (server.getPublicPort()) {
        console.log(`HawCode also listening on http://${localIp} (port 80)`);
      }
    } catch (error) {
      dialog.showErrorBox('HawCode could not start',
        `No free port between 3000 and 3010 was available.\n\n${error.message}`);
    }
  }

  p2p = createP2PHost({
    engine,
    onPeerChange: (peers) => {
      p2pPeers = peers;
      pushSession();
    },
    onPeerState: (state) => send('direct-peer-state', state),
    onJoinStatus: (status) => {
      session.connected = status.connected;
      session.joinError = status.error || null;
      // Adopt the host's name locally, pointed at this machine: the folder is
      // already on disk here, so the same address serves the local copy.
      if (status.domain && status.domain !== session.domain) claimDomain(status.domain);
      pushSession();
    },
    getDomain: () => session.domain || null
  });

  mdns = createMdnsResponder({ getAddress: () => localIp });

  discovery = createDiscovery({
    onPeersChanged: (peers) => send('discovered-workspaces', peers),
    getBeacon: () => {
      if (!engine.rootPath || engine.state === 'stopped' || session.mode !== 'host') return null;
      return {
        folderName: path.basename(engine.rootPath),
        ip: localIp,
        port: server.getPort(),
        url: session.url,
        requiresCode: Boolean(session.code),
        peerCount: engine.getStatus().peerCount,
        appVersion: app.getVersion()
      };
    }
  });
  discovery.start();

  // ------------------------------------------------------------------ hosting

  ipcMain.handle('select-folder', async () => {
    const folder = await chooseFolder('Choose the folder to share');
    if (!folder) return null;
    const hasIndex = ['index.html', 'index.htm'].some((name) => fs.existsSync(path.join(folder, name)));
    return { folderPath: folder, folderName: path.basename(folder), hasIndex };
  });

  /**
   * Begin hosting.
   *
   * `exposure` is 'wifi' (this network only) or 'online'. Online mode is either
   * 'direct', where each visitor punches a channel straight to this machine, or
   * 'portforward'/'ddns', where incoming connections reach your Windows PC via
   * port forwarding or a free DDNS domain. Either way this computer is the server
   * and nothing relays the files — completely direct and free of external tunnels.
   */
  async function startHosting(options = {}) {
    const { folderPath, exposure = 'wifi', online = 'portforward', requireCode = false } = options;
    if (!folderPath) return { error: 'No folder was selected' };
    // 'website' serves the folder's own pages on the handed-out addresses;
    // 'editor' serves the collaborative editor there, as before.
    const serveAs = options.serveAs === 'website' ? 'website' : 'editor';

    await teardownSharing();
    engine.open(folderPath, 'host');

    // Name the folder before anything is announced, so the beacon, the
    // handshake and the address on screen all agree from the first moment.
    const ending = options.domainEnding || settings.get('domainEnding');
    const label = options.domainName || path.basename(folderPath);
    const domain = domainName.compose(label, ending);
    await ensureDns({ force: true });

    const code = exposure === 'online'
      ? generateRoomCode(INTERNET_CODE_LENGTH)
      : (requireCode ? generateRoomCode(LAN_CODE_LENGTH) : null);
    server.setRoomCode(code);

    // The name goes into the session as it is built. Claiming it beforehand
    // would not survive this assignment, and the workspace would answer to a
    // name it did not know it had.
    session = {
      mode: 'host', exposure, publicUrl: null, code, domain, extraNames: [],
      provider: null, needsDdnsSetup: false, ddnsError: null, serveAs, upnp: null,
      extraPortError: null
    };
    claimDomain(domain);

    if (serveAs === 'website' && !websiteUrl()) {
      session.startError = 'Port 80 is used by another program, so the website has no address. '
        + 'Set an extra port in Settings (for example 8080), or close the program on port 80.';
    }

    // The local-network rules, so other computers on the Wi-Fi can reach this
    // one at all. Skipped without a prompt when they are already in place.
    if (exposure !== 'online' && settings.get('firewallAutoApply')) {
      const applied = await firewall.apply({ internet: false }).catch((error) => ({ ok: false, error: error.message }));
      firewallApplied = firewallApplied || Boolean(applied.ok && !applied.alreadyApplied);
      if (!applied.ok && !applied.cancelled) console.warn('HawCode firewall:', applied.error);
    }

    /** Hosting on this network still works, so report the reason and carry on. */
    const partial = (message) => {
      discovery.startBroadcasting(instanceId);
      pushSession();
      return { ...currentSession(), startError: message };
    };

    if (exposure === 'online') {
      if (online === 'direct') {
        // No port to forward and no name to register: each friend punches a
        // hole straight to this machine instead. See electron/p2p/host.js.
        try {
          await p2p.start({ roomCode: code, stunServers: stunServers() });
          session.provider = 'direct';
        } catch (error) {
          return partial(error.message);
        }
      } else {
        // Port Forwarding / Free DDNS mode: direct connection to this computer
        const extraResult = await server.syncExtraPort();
        if (extraResult && !extraResult.ok && extraResult.error) {
          // Surface port-binding failures: user needs to know their extra port
          // is taken so they can pick a different one in Settings.
          console.warn('HawCode extra port:', extraResult.error);
          session.extraPortError = extraResult.error;
        }
        if (settings.get('firewallAutoApply')) {
          const applied = await firewall.apply({ internet: true }).catch((error) => ({ ok: false, error: error.message }));
          firewallApplied = firewallApplied || Boolean(applied.ok && !applied.alreadyApplied);
          if (applied.cancelled) {
            session.startError = 'Windows Firewall was not changed (the permission prompt was cancelled), '
              + 'so visitors from outside may be blocked. Use "Allow through firewall" to try again.';
          }
        }

        // Ask the router to forward the port, so no one has to open its admin page.
        if (settings.get('upnpAutoForward') !== false) {
          session.upnp = await portMapper.start(insidePort()).catch((error) => ({ ok: false, error: error.message }));
        }

        const shown = outsidePort();

        const ready = ddns.configured();
        if (ready.ok) {
          const result = await ddns.start();
          if (result.ok) {
            const host = ddns.fqdn();
            session.publicUrl = `http://${host}${shown === 80 ? '' : `:${shown}`}`;
            session.provider = 'ddns';
            claimExtraName(host);
          } else {
            session.provider = 'portforward';
            session.ddnsError = result.error;
            try {
              const pubIp = await reachability.publicAddress();
              // Always set a URL so the UI shows something actionable.
              session.publicUrl = pubIp
                ? `http://${pubIp}${shown === 80 ? '' : `:${shown}`}`
                : `http://<your-public-ip>${shown === 80 ? '' : `:${shown}`}`;
            } catch {
              session.publicUrl = `http://<your-public-ip>${shown === 80 ? '' : `:${shown}`}`;
            }
          }
        } else {
          session.provider = 'portforward';
          session.needsDdnsSetup = true;
          try {
            const pubIp = await reachability.publicAddress();
            // When DDNS is not configured fall back to the detected public IP.
            // If even that fails, show a placeholder the user can replace manually.
            session.publicUrl = pubIp
              ? `http://${pubIp}${shown === 80 ? '' : `:${shown}`}`
              : `http://<your-public-ip>${shown === 80 ? '' : `:${shown}`}`;
          } catch {
            session.publicUrl = `http://<your-public-ip>${shown === 80 ? '' : `:${shown}`}`;
          }
        }

        if (settings.get('xamppEnabled')) {
          const apachePort = xamppPort();
          // Apache's port needs its own router mapping; HawCode's covers only HawCode.
          if (settings.get('upnpAutoForward') !== false) {
            session.xamppUpnp = await xamppMapper.start(apachePort).catch((error) => ({ ok: false, error: error.message }));
          }
          const outside = (session.xamppUpnp && session.xamppUpnp.ok && session.xamppUpnp.externalPort) || apachePort;
          const xamppHost = (ddns && ddns.fqdn() && ddns.isRunning())
            ? ddns.fqdn()
            : (session.publicUrl ? session.publicUrl.replace(/^https?:\/\//, '').replace(/:.*$/, '') : localIp);
          session.xamppUrl = `http://${xamppHost}${outside === 80 ? '' : `:${outside}`}`;
        }

        // Is the public address actually held by a box in this home? Carrier NAT
        // looks exactly like a public address and is the usual reason a shared
        // link times out for everyone, so it is checked rather than assumed.
        const publicIp = reachability.getCachedPublicIp()
          || await reachability.publicAddress().catch(() => null);
        session.reach = await Promise.race([
          reachability.classifyDeep({ reflexive: publicIp, local: localIp }),
          new Promise((resolve) => setTimeout(() => resolve(null), 15000))
        ]).catch(() => null);
      }
    }

    // The shared XAMPP site should answer as soon as sharing starts, not after
    // a trip to Settings to press Start Apache.
    if (settings.get('xamppEnabled')) {
      // The folder's name through Apache, before Apache is started, so a start
      // and a config change cost one launch rather than a launch and a restart.
      const routed = await syncApacheRouting().catch((error) => ({ ok: false, error: error.message }));
      if (!routed.ok) {
        console.warn('HawCode could not route the name through Apache:', routed.error);
        session.apacheError = routed.error;
      }
      const started = await startApache().catch((error) => ({ ok: false, error: error.message }));
      if (!started.ok) console.warn('HawCode could not start Apache:', started.error);
      session.xamppError = await xamppProblem();
    }

    mdns.start();
    discovery.startBroadcasting(instanceId);
    pushSession();
    return { ...currentSession(), startError: session.startError || null };
  }

  ipcMain.handle('start-host', async (_event, options = {}) => {
    try {
      return await startHosting(options);
    } catch (error) {
      console.error('HawCode could not start sharing', error);
      return { error: error.message || String(error) };
    }
  });

  // ----------------------------------------------------------------- naming

  /**
   * Ask our own name server, over the network, for our own name.
   *
   * Deliberately a real UDP query rather than reading the in-memory table: what
   * the user needs to know is whether a device pointed here would get an
   * answer, and only a packet on the wire can tell them that.
   */
  ipcMain.handle('domain-check', async () => {
    if (!session.domain) return { error: 'No folder is being shared yet' };
    const status = dnsServer ? dnsServer.status : null;
    if (!status || !status.running) {
      return { ok: false, reason: status && status.error ? status.error : 'The name server is not running' };
    }

    const resolved = await new Promise((resolve) => {
      const socket = dgram.createSocket('udp4');
      const header = Buffer.alloc(12);
      header.writeUInt16BE(0x4857, 0);
      header.writeUInt16BE(0x0100, 2);
      header.writeUInt16BE(1, 4);
      const tail = Buffer.alloc(4);
      tail.writeUInt16BE(1, 0);
      tail.writeUInt16BE(1, 2);
      const query = Buffer.concat([header, dnsWire.encodeName(session.domain), tail]);

      const timer = setTimeout(() => {
        try { socket.close(); } catch { /* closed */ }
        resolve(null);
      }, 4000);

      socket.on('message', (reply) => {
        clearTimeout(timer);
        try { socket.close(); } catch { /* closed */ }
        if (reply.length < 16 || reply.readUInt16BE(6) < 1) return resolve(null);
        return resolve(Array.from(reply.subarray(reply.length - 4)).join('.'));
      });
      socket.on('error', () => {
        clearTimeout(timer);
        resolve(null);
      });
      socket.send(query, 0, query.length, 53, '127.0.0.1');
    });

    return {
      ok: Boolean(resolved),
      address: resolved,
      expected: localIp,
      upstream: status.upstream,
      dnsAddress: localIp,
      domain: session.domain,
      url: domainUrl(),
      reason: resolved ? null : 'The name server did not answer'
    };
  });

  /**
   * Preview a name as the user types it. The rules live in
   * electron/domain-name.js and stay there — the renderer asks rather than
   * keeping a second copy that could drift.
   */
  ipcMain.handle('domain-preview', async (_event, options = {}) => {
    const ending = options.ending || settings.get('domainEnding');
    return {
      domain: domainName.compose(options.name || '', ending),
      warning: domainName.endingWarning(ending)
    };
  });

  /** What to type into a device or a router, for the setup panel. */
  ipcMain.handle('domain-setup', async () => {
    const publicPort = server ? server.getPublicPort() : null;
    const port = server ? server.getPort() : null;
    return {
      dnsAddress: localIp,
      domain: session.domain,
      url: domainUrl(),
      publicPort,
      // The renderer should not have to know that 80 is the port worth having.
      portless: Boolean(publicPort) || Boolean(session.apacheRouted),
      apacheRouted: Boolean(session.apacheRouted),
      port,
      extraPort: server ? server.getExtraPort() : null,
      gateway,
      localName: `http://${MDNS_HOSTNAME}${publicPort ? '' : `:${port || ''}`}`,
      // Named so the panel can say which program to close, rather than leaving the
      // user hunting for a conflict that is often HawCode itself.
      portEighty: publicPort ? null : await ports.owner(80, 'TCP'),
      upstream: dnsServer ? dnsServer.status.upstream : [],
      running: dnsServer ? dnsServer.status.running : false,
      error: dnsServer ? dnsServer.status.error : null
    };
  });

  // --------------------------------------------- reaching this computer online

  /** The saved internet-name settings, with the token never leaving this process. */
  function ddnsConfigForRenderer() {
    return {
      enabled: Boolean(settings.get('ddnsEnabled')),
      provider: settings.get('ddnsProvider'),
      hostname: settings.get('ddnsHostname') || '',
      username: settings.get('ddnsUsername') || '',
      customUrl: settings.get('ddnsCustomUrl') || '',
      intervalMinutes: settings.get('ddnsIntervalMinutes'),
      tokenSet: secret.isSet(settings.get('ddnsTokenEnc')),
      encryptionAvailable: secret.available(),
      // The same check start-host uses, so the dialog and the start agree.
      ready: ddns ? ddns.configured() : { ok: false },
      providers: Object.values(DDNS_PROVIDERS).map((provider) => ({
        id: provider.id,
        label: provider.label,
        hint: provider.hint,
        needsUsername: Boolean(provider.needsUsername)
      }))
    };
  }

  ipcMain.handle('ddns-config', async () => ddnsConfigForRenderer());

  ipcMain.handle('ddns-save', async (_event, patch = {}) => {
    const clean = {};
    if ('enabled' in patch) clean.ddnsEnabled = Boolean(patch.enabled);
    if ('provider' in patch) {
      clean.ddnsProvider = patch.provider && DDNS_PROVIDERS[patch.provider] ? patch.provider : null;
    }
    if ('hostname' in patch) clean.ddnsHostname = String(patch.hostname || '').trim();
    if ('username' in patch) clean.ddnsUsername = String(patch.username || '').trim();
    if ('customUrl' in patch) clean.ddnsCustomUrl = String(patch.customUrl || '').trim();
    if ('intervalMinutes' in patch) {
      // Below five minutes is rude to a free provider and gains nothing.
      clean.ddnsIntervalMinutes = Math.max(5, Number(patch.intervalMinutes) || 15);
    }
    settings.update(clean);
    return ddnsConfigForRenderer();
  });

  /**
   * Store the token.
   *
   * Its own channel because it only ever travels one way: the renderer can set it
   * and can ask whether one exists, but nothing sends it back out again.
   */
  ipcMain.handle('ddns-set-token', async (_event, token) => {
    settings.update({ ddnsTokenEnc: token ? secret.encrypt(String(token)) : '' });
    return ddnsConfigForRenderer();
  });

  ipcMain.handle('ddns-status', async () => (ddns ? ddns.status : null));

  ipcMain.handle('ddns-test', async (_event, candidate = {}) => ddns.test(candidate));

  ipcMain.handle('ddns-refresh', async () => ddns.refresh('manual'));

  ipcMain.handle('ddns-unpoint', async () => ddns.unpoint());

  /**
   * Everything about whether this computer can be reached from outside.
   *
   * The hairpin probe inside is informative when it succeeds and meaningless when
   * it fails, which is why the renderer is handed the whole picture rather than a
   * single yes or no.
   */
  ipcMain.handle('network-check', async (_event, options = {}) => {
    const hostname = ddns ? ddns.fqdn() : '';
    const port = server
      ? (settings.get('xamppEnabled')
        ? xamppPort()
        : outsidePort())
      : null;
    const fresh = Boolean(options && options.fresh);
    const result = await reachability.inspect(hostname ? { hostname, port, fresh } : { fresh });
    // A global IPv6 address bypasses carrier NAT for friends who have IPv6 too.
    // Link-local (fe80::/10), unique-local (fc00::/7) and loopback do not count.
    result.ipv6 = Object.values(os.networkInterfaces()).flat()
      .filter((entry) => entry && entry.family === 'IPv6' && !entry.internal)
      .map((entry) => entry.address)
      .find((address) => /^[23][0-9a-f]{0,3}:/i.test(address)) || null;
    // A Check again after the provider's change has to show it at once.
    if (session.mode === 'host' && session.exposure === 'online' && result.verdict) {
      session.reach = { verdict: result.verdict, label: result.label, canForward: result.canForward,
        summary: result.summary, advice: result.advice, path: result.path };
      pushSession();
    }
    return { ...result, seenFromOutside: server ? server.lastPublicHit() : null };
  });

  /** The Wi-Fi router and this PC's place on it, for the static IP setup panel. */
  ipcMain.handle('router-info', async () => routerInfo.inspect({
    address: localIp,
    gateway,
    port: server ? server.getPort() : null,
    shareUrl: lanUrl()
  }));

  // -------------------------------------------------------- Windows firewall

  /** The exact commands, so nothing runs that the user has not been shown. */
  ipcMain.handle('firewall-plan', async () => {
    // Port-forward mode is internet-facing even when DDNS is not configured or
    // its update failed. The user may be connecting by public IP.
    const internet = session.exposure === 'online';
    const built = firewall.plan({ internet });
    firewallState = await firewall.status({ internet });
    return {
      ...built,
      ...firewallState,
      internet,
      autoApply: Boolean(settings.get('firewallAutoApply')),
      leftOver: firewall.pendingFromCrash()
    };
  });

  ipcMain.handle('firewall-apply', async (_event, options = {}) => {
    const internet = 'internet' in options
      ? Boolean(options.internet)
      : session.exposure === 'online';
    const result = await firewall.apply({ internet, force: true });
    if (result.ok) firewallApplied = true;
    // Only remember a choice that actually took effect; a cancelled prompt must
    // not leave "apply automatically" on with nothing applied.
    if ('remember' in options && result.ok) settings.update({ firewallAutoApply: Boolean(options.remember) });
    pushSession();
    return { ...result, state: firewallState };
  });

  // ------------------------------------------------ one-prompt PC setup

  /** The name the setup is for: the shared folder's, or the one being typed. */
  function setupDomain(options = {}) {
    if (session.domain) return session.domain;
    const typed = hostsFile.cleanNames([options.domain])[0];
    return typed || null;
  }

  /**
   * Does http://<name>/ on this PC reach HawCode (through Apache or directly)?
   *
   * Judged by Express's own header: Apache's htdocs answers the same request
   * with a PHP redirect when the name is not routed, which must not pass.
   */
  function probeSite(name) {
    return new Promise((resolve) => {
      if (!name) return resolve({ ok: false, error: 'No name yet' });
      const request = require('http').get({
        host: '127.0.0.1', port: 80, path: '/', headers: { Host: name }, timeout: 4000
      }, (response) => {
        response.resume();
        resolve({
          ok: response.statusCode < 400 && /express/i.test(String(response.headers['x-powered-by'] || '')),
          status: response.statusCode
        });
      });
      request.on('timeout', () => request.destroy(new Error('timed out')));
      request.on('error', (error) => resolve({ ok: false, error: error.message }));
    });
  }

  /**
   * Everything a local name needs, as a checklist: the name server, this PC's
   * hosts file, Apache's routing, the firewall, the network profile and whether
   * the router already hands this PC out as everybody's DNS server.
   */
  async function pcSetupStatus(options = {}) {
    const domain = setupDomain(options);
    const net = await routerInfo.inspect({ address: localIp, gateway, port: server ? server.getPort() : null, shareUrl: lanUrl() })
      .catch(() => ({}));
    firewallState = await firewall.status({ internet: session.exposure === 'online' });
    const root = xampp.findInstall();
    const vhosts = root ? xampp.vhostStatus(root) : null;
    const xamppOn = Boolean(settings.get('xamppEnabled'));
    const dns = dnsServer ? dnsServer.status : { running: false };
    const rules = firewallState.rules || {};
    const site = domain && session.mode === 'host' ? await probeSite(domain) : null;
    return {
      domain,
      localIp,
      adapter: net.adapter || null,
      networkCategory: net.networkCategory || null,
      routerDns: net.dns || [],
      checks: {
        nameServer: { ok: Boolean(dns.running), error: dns.error || null },
        hostsFile: { ok: domain ? hostsFile.status([domain]).ok : false },
        apache: xamppOn
          ? { ok: Boolean(domain && vhosts && vhosts.sites.some((entry) => entry.domain === domain)), modules: vhosts && vhosts.modules }
          : { ok: true, notNeeded: true },
        firewall: {
          ok: Boolean(firewallState.webOpen && rules['dns-udp'] && rules['dns-tcp']),
          webOpen: Boolean(firewallState.webOpen),
          dnsOpen: Boolean(rules['dns-udp'] && rules['dns-tcp']),
          blockedRules: firewallState.blockedRules || 0,
          allowedByProgram: firewallState.allowedByProgram || null
        },
        privateNetwork: { ok: net.networkCategory ? net.networkCategory !== 'Public' : false },
        routerDns: { ok: Array.isArray(net.dns) && net.dns.includes(localIp) },
        siteAnswers: site
      }
    };
  }

  ipcMain.handle('pc-setup-status', async (_event, options = {}) => pcSetupStatus(options));

  /**
   * One UAC prompt for every Windows change a local name needs: HawCode's
   * firewall rules, the hosts-file entry, and (when asked) switching this Wi-Fi
   * from Public to Private so the name server and discovery rules apply.
   */
  ipcMain.handle('pc-setup-apply', async (_event, options = {}) => {
    const domain = setupDomain(options);
    const extra = [];
    let files = {};
    if (domain && options.hosts !== false) {
      const step = hostsFile.step([domain]);
      extra.push(step.entry);
      files = { ...files, ...step.files };
    }
    if (options.makePrivate) {
      const net = await routerInfo.inspect({ address: localIp, gateway }).catch(() => ({}));
      if (net.adapter && net.networkCategory === 'Public') {
        extra.push({
          id: 'private-network',
          name: `Treat "${net.adapter}" as a private network`,
          command: powershellCommand("$ErrorActionPreference = 'Stop'; "
            + `Set-NetConnectionProfile -InterfaceAlias ${psQuote(net.adapter)} -NetworkCategory Private`)
        });
      }
    }
    const internet = session.exposure === 'online';
    const result = await firewall.apply({ internet, force: true, extra, files });
    if (result.ok) {
      firewallApplied = true;
      settings.update({ firewallAutoApply: true });
    }
    if (domain) await ensureDns({ force: true });
    pushSession();
    return { ...result, status: await pcSetupStatus({ domain }) };
  });

  /** Route the shared folder's name through XAMPP's Apache now, or remove the routing. */
  ipcMain.handle('xampp-vhost-apply', async () => {
    const result = await syncApacheRouting();
    if (result.ok) session.apacheError = null;
    pushSession();
    return result;
  });

  ipcMain.handle('xampp-vhost-remove', async () => {
    const result = await syncApacheRouting({ sites: [] });
    pushSession();
    return result;
  });

  ipcMain.handle('firewall-revert', async () => {
    const result = await firewall.revert();
    if (result.ok) firewallApplied = false;
    firewallState = await firewall.status({
      internet: session.exposure === 'online'
    });
    pushSession();
    return { ...result, state: firewallState };
  });

  // ------------------------------------------------------------------ XAMPP

  ipcMain.handle('xampp-status', async () => ({
    ...(await xampp.inspect(settings.get('xamppPort'))),
    enabled: Boolean(settings.get('xamppEnabled')),
    lanUrl: xamppLanUrl(),
    hawcodeHoldsPort80: Boolean(server && server.getPublicPort() === 80)
  }));

  ipcMain.handle('xampp-start', async () => startApache());

  /** Retry the router mapping, for the Try again button. */
  ipcMain.handle('upnp-retry', async () => {
    if (session.mode !== 'host' || session.exposure !== 'online' || !insidePort()) {
      return { ok: false, error: 'Share online first.' };
    }
    session.upnp = await portMapper.start(insidePort()).catch((error) => ({ ok: false, error: error.message }));
    pushSession();
    return session.upnp;
  });

  /** Which program holds a port, for the "port 80 is taken" message. */
  ipcMain.handle('port-owner', async (_event, options = {}) =>
    ports.owner(options.port || 80, options.protocol || 'TCP'));

  // --------------------------------------------------------- direct sharing

  /** One invite, one friend — see the note on createInvite in p2p/host.js. */
  ipcMain.handle('p2p-create-invite', async () => {
    if (!p2p || !p2p.isRunning()) return { error: 'Direct sharing is not running' };
    try {
      const result = await p2p.createInvite();
      if (result.error) return result;
      invites.set(result.peerId, { sdp: result.sdp, code: result.code });
      return { peerId: result.peerId, code: result.code };
    } catch (error) {
      return { error: error.message };
    }
  });

  ipcMain.handle('p2p-accept-answer', async (_event, options = {}) => {
    if (!p2p || !p2p.isRunning()) return { error: 'Direct sharing is not running' };
    const { peerId, code } = options;
    if (!peerId || !invites.has(peerId)) return { error: 'That invite is no longer open' };
    return p2p.acceptAnswer(peerId, code);
  });

  /** Write the standalone page for a friend who does not have HawCode. */
  ipcMain.handle('p2p-save-invite-page', async (_event, options = {}) => {
    const stored = invites.get(options.peerId);
    if (!stored) return { error: 'That invite is no longer open' };
    const folderName = engine.rootPath ? path.basename(engine.rootPath) : 'workspace';
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Save the invite page to send to your friend',
      defaultPath: path.join(app.getPath('downloads'), safeFileName(folderName)),
      filters: [{ name: 'Web page', extensions: ['html'] }]
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    try {
      writeInvitePage(result.filePath, {
        sdp: stored.sdp,
        roomCode: session.code,
        folderName,
        hostName: os.hostname(),
        stunServers: stunServers()
      });
      return { ok: true, filePath: result.filePath };
    } catch (error) {
      return { error: error.message };
    }
  });

  // `hawcode <folder>` (or `electron . <folder>`) opens straight into that
  // folder, the way `code .` does, instead of asking for it in a dialog.
  const folderArgument = process.argv.slice(1).find((argument) => {
    if (argument.startsWith('-') || argument === '.') return false;
    try {
      return fs.statSync(argument).isDirectory();
    } catch {
      return false;
    }
  });
  if (folderArgument) {
    mainWindow.webContents.once('did-finish-load', () => {
      startHosting({ folderPath: path.resolve(folderArgument) });
    });
  }

  // ------------------------------------------------------------------ joining

  ipcMain.handle('probe-host', async (_event, url) => probeHost(String(url || '')));

  ipcMain.handle('join-workspace', async (_event, options = {}) => {
    const rawUrl = String(options.url || '').trim();
    if (!rawUrl) return { error: 'A host URL is required' };
    const url = normalizeUrl(rawUrl);

    const probe = await probeHost(url);
    if (!probe.ok) return { error: probe.error };
    if (probe.requiresCode && !options.code) return { error: 'code-required', requiresCode: true };

    const folderPath = options.folderPath || await chooseFolder('Choose where to keep the synced folder');
    if (!folderPath) return null;

    await teardownSharing();
    engine.open(folderPath, 'client');

    session = { mode: 'client', exposure: 'joined', url, publicUrl: null, code: options.code || null };

    await ensureDns();
    mdns.start();

    peerClient = connectToHost({
      url,
      code: options.code,
      engine,
      onStatus: (status) => {
        session.connected = status.connected;
        session.joinError = status.error;
        pushSession();
      }
    });

    // Also share what we just joined over the LAN, so a third computer can find
    // this machine without needing the original host's address.
    discovery.startBroadcasting(instanceId);
    pushSession();
    return currentSession();
  });

  /**
   * Join a folder from an invite code. Unlike joining by URL there is nothing
   * to probe first — the code itself carries the folder name and the room code
   * — and the connection only completes once the host pastes back the reply
   * code this returns.
   */
  ipcMain.handle('join-with-invite', async (_event, options = {}) => {
    const inviteCode = String(options.code || '').trim();
    if (!inviteCode) return { error: 'Paste the invite code you were sent' };

    const folderPath = options.folderPath || await chooseFolder('Choose where to keep the synced folder');
    if (!folderPath) return null;

    await teardownSharing();
    engine.open(folderPath, 'client');

    await ensureDns();
    mdns.start();

    const result = await p2p.join(inviteCode, { stunServers: stunServers() });
    if (result.error) {
      engine.close({ keepFolder: true });
      return { error: result.error };
    }

    session = {
      mode: 'client',
      exposure: 'joined-direct',
      url: null,
      publicUrl: null,
      code: null,
      provider: 'direct',
      hostName: result.host,
      folderLabel: result.folder
    };

    discovery.startBroadcasting(instanceId);
    pushSession();
    return { ...currentSession(), answerCode: result.answerCode, peerId: result.peerId };
  });

  // ----------------------------------------------------------- sync controls

  ipcMain.handle('pause-sync', async () => {
    engine.pause();
    return currentSession();
  });

  ipcMain.handle('resume-sync', async () => {
    await engine.resume();
    return currentSession();
  });

  ipcMain.handle('stop-sync', async () => {
    engine.stop();
    await teardownSharing();
    return currentSession();
  });

  ipcMain.handle('get-sync-status', async () => currentSession());

  ipcMain.handle('disconnect-workspace', async () => {
    engine.close({ keepFolder: false });
    await teardownSharing();
    pushSession();
    return { ok: true };
  });

  // ------------------------------------------------------------ file actions

  ipcMain.handle('create-file', async (_event, relativePath) => engine.createFile(relativePath));
  ipcMain.handle('create-dir', async (_event, relativePath) => engine.createDir(relativePath));
  ipcMain.handle('delete-item', async (_event, relativePath) => engine.deleteItem(relativePath));
  ipcMain.handle('get-file-tree', async () => engine.getTree());
  ipcMain.handle('read-file', async (_event, relativePath) => engine.readForEditor(relativePath));
  ipcMain.handle('set-active-file', async (_event, relativePath) => {
    activeEditorPath = relativePath || null;
    return { ok: true };
  });
  ipcMain.handle('write-file', async (_event, { path: relativePath, content }) =>
    engine.writeFromEditor(relativePath, content));

  ipcMain.handle('open-external', async (_event, url) => {
    // Web pages, plus Windows' own network settings page for the Public/Private switch.
    if (typeof url === 'string' && (/^https?:\/\//i.test(url) || /^ms-settings:network[a-z-]*$/i.test(url))) {
      await shell.openExternal(url);
    }
  });

  ipcMain.handle('reveal-folder', async () => {
    if (engine.rootPath) await shell.openPath(engine.rootPath);
  });

  // --------------------------------------------------------------- terminal
  // Local only. None of these names is ever registered on the socket server,
  // so no browser client or joined peer can reach a shell on this machine.

  ipcMain.handle('terminal-shells', async () => ({
    shells: shells.list().map(({ id, label }) => ({ id, label })),
    mode: terminals.mode,
    defaultShellId: settings.get('defaultShellId') || shells.defaultShellId()
  }));

  ipcMain.handle('terminal-create', async (_event, options = {}) => terminals.create(options));
  ipcMain.handle('terminal-write', async (_event, { id, data }) => terminals.write(id, data));
  ipcMain.handle('terminal-resize', async (_event, { id, cols, rows }) =>
    terminals.resize(id, cols, rows));
  ipcMain.handle('terminal-kill', async (_event, id) => terminals.kill(id));
  ipcMain.handle('terminal-list', async () => terminals.list());
  ipcMain.handle('terminal-scrollback', async (_event, id) => terminals.getScrollback(id));

  // -------------------------------------------------------------------- git

  ipcMain.handle('git-status', async () => {
    if (!engine.rootPath) return { isRepo: false };
    return git.status(engine.rootPath);
  });
  ipcMain.handle('git-stage', async (_event, paths) => git.stage(engine.rootPath, paths));
  ipcMain.handle('git-stage-all', async () => git.stageAll(engine.rootPath));
  ipcMain.handle('git-unstage', async (_event, paths) => git.unstage(engine.rootPath, paths));
  ipcMain.handle('git-discard', async (_event, paths) => git.discard(engine.rootPath, paths));
  ipcMain.handle('git-commit', async (_event, message) => git.commit(engine.rootPath, message));
  ipcMain.handle('git-push', async () => git.push(engine.rootPath));
  ipcMain.handle('git-pull', async () => git.pull(engine.rootPath));
  ipcMain.handle('git-branches', async () => git.branches(engine.rootPath));
  ipcMain.handle('git-checkout', async (_event, { branch, create }) =>
    git.checkout(engine.rootPath, branch, { create }));
  ipcMain.handle('git-diff', async (_event, { path: relPath, staged }) =>
    git.diff(engine.rootPath, relPath, { staged }));
  ipcMain.handle('git-log', async (_event, limit) => git.log(engine.rootPath, limit));
  ipcMain.handle('git-init', async () => git.init(engine.rootPath));

  // ----------------------------------------------------------------- search

  ipcMain.handle('search-workspace', async (_event, options) => search.search(engine, options));
  ipcMain.handle('search-replace', async (_event, options) => search.replaceAll(engine, options));
  ipcMain.handle('quick-open', async (_event, options = {}) =>
    search.quickOpen(engine, options.query, options.limit));

  // ---------------------------------------------------------------- scripts

  ipcMain.handle('scripts-list', async () => scripts.list(engine.rootPath));
  ipcMain.handle('scripts-run', async (_event, { invocation, name }) => {
    const created = terminals.create({
      shellId: settings.get('defaultShellId') || undefined,
      title: name ? `run: ${name}` : 'run'
    });
    if (created.error) return created;
    // A short delay lets the shell print its prompt before the command lands,
    // which keeps the scrollback readable.
    setTimeout(() => terminals.run(created.id, invocation), 400);
    return created;
  });

  // --------------------------------------------------------------- settings

  /**
   * Settings for the renderer.
   *
   * The internet-name token is redacted rather than sent: it lives encrypted in
   * the settings file and is decrypted only here, where it is used. The renderer
   * gets to know that one is stored, which is all it needs to draw the field.
   */
  ipcMain.handle('settings-get', async () => {
    const { ddnsTokenEnc, ...rest } = settings.all();
    return { ...rest, ddnsTokenSet: secret.isSet(ddnsTokenEnc) };
  });
  ipcMain.handle('settings-update', async (_event, patch = {}) => {
    // Never through the general channel; ddns-set-token is the only way in.
    const { ddnsTokenEnc: _ignored, ...clean } = patch;
    const updated = settings.update(clean);
    // An extra port the user just changed should take effect without a restart.
    if (server && ('firewallExtraPort' in clean || 'xamppEnabled' in clean || 'xamppPort' in clean)) {
      // Release port 80 to Apache, or take it back, before anything else.
      await server.syncPublicPort();
      await server.syncExtraPort();
      pushSession();
    }
    const { ddnsTokenEnc: stored, ...rest } = updated;
    return { ...rest, ddnsTokenSet: secret.isSet(stored) };
  });
  ipcMain.handle('settings-reset', async () => {
    const { ddnsTokenEnc, ...rest } = settings.reset();
    return { ...rest, ddnsTokenSet: secret.isSet(ddnsTokenEnc) };
  });

  ipcMain.handle('read-ignore-file', async () => {
    if (!engine.rootPath) return { content: '' };
    const file = path.join(engine.rootPath, '.hawignore');
    try {
      return { content: fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : '' };
    } catch (error) {
      return { error: error.message };
    }
  });
  ipcMain.handle('write-ignore-file', async (_event, content) => {
    if (!engine.rootPath) return { error: 'No folder is open' };
    // Written through the engine so the rules sync to peers like any other file.
    return engine.writeFromEditor('.hawignore', String(content ?? ''));
  });

  // --------------------------------------------------------- files/presence

  ipcMain.handle('rename-item', async (_event, { from, to }) => engine.renameItem(from, to));
  ipcMain.handle('duplicate-item', async (_event, relPath) => engine.duplicateItem(relPath));
  ipcMain.handle('broadcast-presence', async (_event, payload) => {
    engine.broadcastPresence({ ...payload, name: os.hostname() });
    return { ok: true };
  });
  ipcMain.handle('get-presence', async () => engine.getPresence());

  ipcMain.handle('get-host-info', async () => ({
    hostName: os.hostname(),
    localIp,
    port: server ? server.getPort() : null
  }));

  // Every channel the page can call is registered by now, so nothing it does on
  // load can reach a handler that does not exist yet.
  await startServer();
  loadWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
      loadWindow();
    }
  });
}).catch((error) => {
  // The window is opened before this work finishes, so a failure here would
  // otherwise leave an empty frame on screen with nothing to explain it.
  console.error('HawCode failed to start', error);
  dialog.showErrorBox('HawCode could not start', String(error && error.stack ? error.stack : error));
  app.quit();
});

app.on('before-quit', async () => {
  // Kill shells first so no child process outlives the window.
  if (terminals) terminals.killAll();
  if (engine) engine.close({ keepFolder: false });
  if (discovery) discovery.stop();
  if (mdns) mdns.stop();
  if (dnsServer) await dnsServer.stop();
  if (p2p) {
    await p2p.stop();
    p2p.destroy();
  }
  if (netAddress) netAddress.stop();
  if (ddns) await ddns.stop();
  if (portMapper) await portMapper.stop().catch(() => {});
  if (xamppMapper) await xamppMapper.stop().catch(() => {});
  // Firewall rules outlive the process — nothing in Windows would attribute them
  // to HawCode afterwards — so take them back unless the user asked to keep them.
  if (firewall && firewallApplied && !(settings && settings.get('firewallAutoApply'))) {
    await firewall.revert().catch(() => {});
  } else if (firewall && !firewallApplied) {
    firewall.clearRecord();
  }
  if (server) await server.close().catch(() => {});
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
