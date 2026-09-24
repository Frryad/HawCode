'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell, Tray, Menu, nativeImage, clipboard, session } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');

const { resolveDataDir, layout, ensureDirs } = require('./backend/paths');
const { firewallStatus, applyFirewall, removeFirewall } = require('./backend/firewall');
const { DaemonClient } = require('./electron/daemon-client');
const startup = require('./electron/startup');

const isDev = process.argv.includes('--dev');
const startHidden = process.argv.includes('--hidden');
const DEV_URL = 'http://127.0.0.1:5174';

const dataDir = resolveDataDir();
const paths = layout(dataDir);
const DAEMON_SCRIPT = path.join(__dirname, 'daemon', 'daemon.js');
const ICON = path.join(__dirname, 'assets', 'icon.png');
const TRAY_ICON = path.join(__dirname, 'assets', process.platform === 'win32' ? 'tray.ico' : 'tray.png');

let mainWindow = null;
let tray = null;
let quitting = false;
let lastServer = null;
let lastConfig = null;

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}
app.setAppUserModelId('com.hawcode.hawhost');

const client = new DaemonClient({ daemonFile: paths.daemonFile, exe: process.execPath, script: DAEMON_SCRIPT, dataDir });

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

function showWindow(route) {
  if (!mainWindow || mainWindow.isDestroyed()) createWindow();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  if (route) send('app:navigate', route);
}

// ------------------------------------------------------------------ window

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 1000,
    minHeight: 660,
    show: false,
    title: 'HawHost',
    icon: ICON,
    backgroundColor: '#0c1018',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      webSecurity: true
    }
  });
  mainWindow.removeMenu();

  if (isDev) mainWindow.loadURL(DEV_URL);
  else mainWindow.loadFile(path.join(__dirname, 'dist', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    if (!startHidden) mainWindow.show();
  });

  // Links open in the default browser; the app window never navigates away.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (!(isDev && url.startsWith(DEV_URL))) e.preventDefault();
  });

  mainWindow.on('close', (e) => {
    if (quitting) return;
    const ui = (lastConfig && lastConfig.ui) || { closeToTray: true };
    if (ui.closeToTray !== false && tray) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
  mainWindow.on('closed', () => { mainWindow = null; });
}

/** The control panel makes no network requests of its own except to the dev server. */
function lockDownNetwork() {
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (details, cb) => {
    const ok = isDev && (details.url.startsWith(DEV_URL) || details.url.startsWith('ws://127.0.0.1:5174'));
    cb({ cancel: !ok });
  });
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'clipboard-sanitized-write'));
}

// ------------------------------------------------------------------ tray

function trayImage() {
  const img = nativeImage.createFromPath(fs.existsSync(TRAY_ICON) ? TRAY_ICON : ICON);
  return img.isEmpty() ? nativeImage.createEmpty() : img.resize({ width: 16, height: 16 });
}

function updateTray() {
  if (!tray) return;
  const running = Boolean(lastServer && lastServer.running);
  const ports = lastServer ? lastServer.listeners.filter((l) => l.state === 'listening').map((l) => l.port).join(', ') : '';
  tray.setToolTip(`HawHost — ${client.connected ? (running ? `serving on ${ports}` : 'web server stopped') : 'background server offline'}`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open HawHost', click: () => showWindow() },
    { type: 'separator' },
    { label: client.connected ? (running ? `Web server: running (${ports})` : 'Web server: stopped') : 'Background server: offline', enabled: false },
    {
      label: running ? 'Stop web server' : 'Start web server',
      enabled: client.connected,
      click: () => client.request('POST', running ? '/api/server/stop' : '/api/server/start').catch(() => {})
    },
    { label: 'Update DDNS now', enabled: client.connected, click: () => client.request('POST', '/api/ddns/update', {}).catch(() => {}) },
    { label: 'Open websites folder', click: () => shell.openPath(paths.sitesDir) },
    { type: 'separator' },
    { label: 'Close control panel (websites stay online)', click: () => quitApp(false) },
    { label: 'Stop everything and exit', click: () => quitApp(true) }
  ]));
}

async function quitApp(stopServer) {
  quitting = true;
  if (stopServer) await client.shutdown().catch(() => {});
  client.close();
  app.quit();
}

// ------------------------------------------------------------------ daemon wiring

client.on('event', ({ type, data }) => {
  if (type === 'server') {
    lastServer = data;
    updateTray();
  }
  if (type === 'config') lastConfig = data;
  send('daemon:event', { type, data });
});
client.on('connection', (connected) => {
  send('daemon:connection', connected);
  updateTray();
  if (connected) {
    client.request('GET', '/api/state').then((s) => {
      lastServer = s.server;
      lastConfig = s.config;
      updateTray();
    }).catch(() => {});
  }
});
client.on('error', (err) => send('daemon:error', err.message));

// ------------------------------------------------------------------ IPC

function handle(channel, fn) {
  ipcMain.handle(channel, async (_e, ...args) => {
    try {
      return { ok: true, data: await fn(...args) };
    } catch (err) {
      return { ok: false, error: err.message || String(err) };
    }
  });
}

// Calls that can change which ports the web server listens on.
const PORT_CHANGING = /^\/api\/(sites|settings\/(server|firewall))(\/|$)/;
let autoFirewallBusy = false;

/**
 * Keep Windows Firewall in step with the listening ports when "auto apply" is on.
 *
 * Runs here rather than in the background server: that server may be a startup
 * task with no desktop, where a UAC prompt can never appear. Does nothing (and
 * shows no prompt) when every port is already open and nothing blocks HawHost.
 */
async function autoApplyFirewall() {
  if (autoFirewallBusy || process.platform !== 'win32') return;
  autoFirewallBusy = true;
  try {
    const state = await client.request('GET', '/api/state');
    const cfg = state && state.config;
    if (!cfg || !cfg.firewall || !cfg.firewall.autoApply) return;
    const planned = ((state.server && state.server.planned) || []).map((l) => l.port);
    const wanted = [...new Set([...planned, ...(cfg.firewall.extraPorts || [])])]
      .filter(Boolean).sort((a, b) => a - b);
    if (!wanted.length) return;
    const fw = await firewallStatus(process.execPath);
    if (!fw.supported || fw.error) return;
    const missing = wanted.filter((port) => !fw.openPorts.includes(port));
    if (!missing.length && !fw.blockedProgramRules) return;
    const res = await applyFirewall(wanted, process.execPath);
    if (res.ok) {
      await client.request('PUT', '/api/settings/firewall', { appliedPorts: wanted, appliedAt: new Date().toISOString() }).catch(() => {});
    }
    send('firewall:auto', { ok: res.ok, ports: wanted, cancelled: Boolean(res.cancelled), error: res.ok ? null : res.error });
  } catch (err) {
    send('firewall:auto', { ok: false, error: err.message });
  } finally {
    autoFirewallBusy = false;
  }
}

handle('api', async ({ method, path: p, body }) => {
  if (typeof p !== 'string' || !p.startsWith('/api/') || p.startsWith('/api/events')) throw new Error('Invalid API path.');
  if (!['GET', 'POST', 'PUT', 'DELETE'].includes(method)) throw new Error('Invalid method.');
  const result = await client.request(method, p, body);
  // Not awaited: the change is saved either way, and the UAC prompt must not
  // hold the UI's request open.
  if (method !== 'GET' && PORT_CHANGING.test(p)) autoApplyFirewall();
  return result;
});

handle('app:info', () => ({
  version: app.getVersion(),
  isDev,
  isPackaged: app.isPackaged,
  dataDir,
  paths,
  exePath: process.execPath,
  platform: process.platform,
  connected: client.connected
}));

handle('daemon:ensure', () => client.ensure());
handle('daemon:restart', () => client.restart());

handle('dialog:folder', async (opts = {}) => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: opts.title || 'Choose a folder',
    defaultPath: opts.defaultPath || undefined,
    properties: ['openDirectory', 'createDirectory']
  });
  return res.canceled ? null : res.filePaths[0];
});

handle('dialog:file', async (opts = {}) => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: opts.title || 'Choose a file',
    filters: opts.filters || [],
    properties: ['openFile']
  });
  return res.canceled ? null : res.filePaths[0];
});

handle('dialog:save', async ({ title, defaultName, content }) => {
  const res = await dialog.showSaveDialog(mainWindow, { title, defaultPath: defaultName });
  if (res.canceled || !res.filePath) return null;
  fs.writeFileSync(res.filePath, content, 'utf-8');
  return res.filePath;
});

handle('dialog:readText', async ({ title, filters }) => {
  const res = await dialog.showOpenDialog(mainWindow, { title, filters, properties: ['openFile'] });
  if (res.canceled) return null;
  return fs.readFileSync(res.filePaths[0], 'utf-8');
});

handle('shell:openExternal', (url) => {
  if (!/^https?:\/\//i.test(String(url))) throw new Error('Only web addresses can be opened.');
  return shell.openExternal(url);
});

handle('shell:openPath', async (target) => {
  const p = path.resolve(String(target || ''));
  if (!fs.existsSync(p)) throw new Error(`Not found: ${p}`);
  const err = await shell.openPath(p);
  if (err) throw new Error(err);
  return true;
});

handle('clipboard:write', (text) => {
  clipboard.writeText(String(text));
  return true;
});

// Windows Firewall
handle('firewall:status', () => firewallStatus(process.execPath));
handle('firewall:apply', async (ports) => {
  const res = await applyFirewall(ports, process.execPath);
  if (!res.ok) throw new Error(res.error);
  await client.request('PUT', '/api/settings/firewall', { appliedPorts: ports, appliedAt: new Date().toISOString() }).catch(() => {});
  return res.result;
});
handle('firewall:remove', async () => {
  const res = await removeFirewall();
  if (!res.ok) throw new Error(res.error);
  await client.request('PUT', '/api/settings/firewall', { appliedPorts: [], appliedAt: null }).catch(() => {});
  return res.result;
});

// Startup
handle('startup:status', async () => ({
  loginItem: startup.loginItemStatus(app),
  service: await startup.serviceStatus(),
  user: startup.currentUser()
}));
handle('startup:setLoginItem', (enabled) => startup.setLoginItem(app, enabled));
handle('startup:installService', async () => {
  // Hand the websites over to the startup task: stop our own background
  // server, register + start the task, then reconnect to the task's server.
  await client.shutdown();
  const res = await startup.installService({ exe: process.execPath, script: DAEMON_SCRIPT, dataDir, startNow: true });
  client.paused = false;
  await client.ensure();
  if (!res.ok) throw new Error(res.error);
  return startup.serviceStatus();
});
handle('startup:uninstallService', async () => {
  await client.shutdown();
  const res = await startup.uninstallService();
  client.paused = false;
  await client.ensure();
  if (!res.ok) throw new Error(res.error);
  return startup.serviceStatus();
});

// Trust a self-signed certificate on this PC (Windows asks for confirmation itself).
handle('cert:trust', (certPath) => new Promise((resolve, reject) => {
  if (!fs.existsSync(certPath)) return reject(new Error('Certificate file not found.'));
  execFile('certutil.exe', ['-user', '-addstore', 'Root', certPath], { windowsHide: false }, (err, stdout) => {
    if (err) reject(new Error(String(stdout || err.message).trim().split(/\r?\n/).pop()));
    else resolve(true);
  });
}));

handle('app:quit', ({ stopServer }) => quitApp(Boolean(stopServer)));

// ------------------------------------------------------------------ lifecycle

app.on('second-instance', () => showWindow());

app.whenReady().then(async () => {
  ensureDirs(paths);
  lockDownNetwork();
  createWindow();
  try {
    tray = new Tray(trayImage());
    tray.on('click', () => showWindow());
    updateTray();
  } catch (err) {
    console.error('Tray unavailable:', err.message);
  }
  try {
    await client.ensure();
  } catch (err) {
    send('daemon:error', err.message);
  }
});

app.on('window-all-closed', () => {
  if (!tray) quitApp(Boolean(lastConfig && lastConfig.ui && lastConfig.ui.stopServerOnQuit));
});

app.on('before-quit', () => {
  quitting = true;
});
