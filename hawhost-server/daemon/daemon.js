'use strict';

/**
 * HawHost background server.
 *
 * Runs the websites, the DDNS updater and router port forwarding without any
 * window. The desktop control panel starts it when needed and talks to it over
 * a token-protected API on 127.0.0.1; the optional Windows startup task starts
 * it at boot. Closing the control panel does not take websites offline.
 *
 *   node daemon/daemon.js [--data-dir <dir>] [--service] [--verbose]
 *   (or HawHost.exe with ELECTRON_RUN_AS_NODE=1)
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');

const { resolveDataDir, layout, ensureDirs } = require('../backend/paths');
const { ConfigStore } = require('../backend/config-store');
const { Logger } = require('../backend/logger');
const { CertManager } = require('../backend/cert-manager');
const { AppManager } = require('../backend/app-manager');
const { ServerEngine } = require('../backend/server-engine');
const { UpnpClient } = require('../backend/upnp');
const { UpnpForwarder } = require('../backend/upnp-forwarder');
const { DdnsManager } = require('../backend/ddns-manager');
const { getNetworkInfo, classifyIPv4 } = require('../backend/network-info');
const { checkTcp, listeningPorts, probeHttp } = require('../backend/port-checker');
const { firewallStatus } = require('../backend/firewall');
const { writeExports } = require('../backend/config-export');
const { detectAll } = require('../backend/detect');
const { publicInfo } = require('../backend/ddns-providers');
const { ControlApi } = require('./control-api');

const VERSION = require('../package.json').version;
const APP_ROOT = path.resolve(__dirname, '..');

// ------------------------------------------------------------------ single instance

function requestJson(info, method, pathname, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port: info.port, method, path: pathname,
      headers: { Authorization: `Bearer ${info.token}`, Host: `127.0.0.1:${info.port}` }
    }, (res) => {
      let data = '';
      res.on('data', (d) => { data += d; });
      res.on('end', () => (res.statusCode === 200 ? resolve(JSON.parse(data)) : reject(new Error(`HTTP ${res.statusCode}`))));
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end();
  });
}

async function anotherDaemonRunning(daemonFile) {
  try {
    const info = JSON.parse(fs.readFileSync(daemonFile, 'utf-8'));
    const health = await requestJson(info, 'GET', '/api/health');
    return health && health.ok ? info : null;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ first run

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else if (!fs.existsSync(d)) fs.copyFileSync(s, d);
  }
}

function bootstrap(store, paths, logger) {
  const welcome = path.join(paths.sitesDir, 'welcome');
  const phpDemo = path.join(paths.sitesDir, 'php-demo');
  const seed = (name, dest) => {
    const src = path.join(APP_ROOT, 'default-sites', name);
    if (fs.existsSync(src) && !fs.existsSync(dest)) copyDir(src, dest);
  };
  seed('sample-static', welcome);
  seed('sample-php', phpDemo);

  const cfg = store.get();
  let changed = false;
  for (const site of cfg.websites) {
    if (!site.root && ['static', 'php', 'node'].includes(site.type)) {
      site.root = welcome;
      changed = true;
    }
  }
  if (!cfg.websites.length && !cfg.ui.onboardingDone) {
    store.addWebsite({ name: 'Welcome page', type: 'static', hostnames: ['*'], root: welcome });
    logger.info('setup', `Created the Welcome website in ${welcome}.`);
  } else if (changed) {
    store.save();
  }
}

// ------------------------------------------------------------------ main

async function main() {
  const dataDir = resolveDataDir();
  const paths = layout(dataDir);
  ensureDirs(paths);
  const mode = process.argv.includes('--service') ? 'service' : 'app';

  const existing = await anotherDaemonRunning(paths.daemonFile);
  if (existing) {
    console.log(`HawHost background server already running (pid ${existing.pid}).`);
    process.exit(0);
  }

  const logger = new Logger(paths.logsDir, { echo: process.argv.includes('--verbose') });
  logger.info('daemon', `HawHost ${VERSION} starting (${mode} mode, pid ${process.pid}, data ${dataDir}).`);

  const store = new ConfigStore(paths.configFile);
  if (store.loadError) logger.warn('config', store.loadError);
  bootstrap(store, paths, logger);

  const certs = new CertManager({ certsDir: paths.certsDir, logger });
  const apps = new AppManager({ logger });
  const engine = new ServerEngine({ store, logger, certs, apps, paths });
  const upnp = new UpnpClient({ logger });

  let netCache = null;
  let netAt = 0;
  const getNet = async (refresh = false) => {
    if (refresh || !netCache || Date.now() - netAt > 30000) {
      netCache = await getNetworkInfo();
      netAt = Date.now();
    }
    return netCache;
  };
  const getLocalIp = async () => (await getNet()).localIp;

  const ddns = new DdnsManager({ store, logger, upnp, getLocalIp });
  const forwarder = new UpnpForwarder({ store, engine, upnp, logger, getLocalIp });
  const api = new ControlApi({ logger });

  // When DDNS is off, still show the public IP — but only by asking the router.
  const refreshRouterIp = async () => {
    const c = store.get();
    if (c.ddns.enabled || !c.router.upnpEnabled) return;
    try {
      const wan = await upnp.getExternalIp({ localAddress: await getLocalIp() });
      const patch = { routerWanIp: wan || null };
      if (wan && classifyIPv4(wan) === 'public') Object.assign(patch, { publicIp: wan, publicIpSource: 'router (UPnP)', publicIpCheckedAt: new Date().toISOString(), natWarning: null });
      else if (wan) patch.natWarning = classifyIPv4(wan) === 'cgnat' ? 'cgnat' : 'double-nat';
      store.patchState('ddns', patch);
      api.broadcast('ddns', ddns.status());
    } catch { /* router silent */ }
  };

  // ---------------------------------------------------------------- reactions

  store.on('change', (section) => {
    if (['server', 'websites', 'all'].includes(section)) {
      engine.reload().then(() => forwarder.sync()).catch((err) => logger.error('server', err.message));
    }
    if (['ddns', 'all'].includes(section)) {
      if (store.get().ddns.enabled) ddns.start();
      else ddns.stop();
    }
    if (['router', 'all'].includes(section)) forwarder.sync();
    api.broadcast('config', publicConfig());
  });
  store.on('state', (section) => {
    if (section === 'ddns') api.broadcast('ddns', ddns.status());
  });
  engine.on('status', (s) => {
    api.broadcast('server', s);
    forwarder.sync().then(() => api.broadcast('upnp', forwarder.status()));
  });
  engine.on('stats', (s) => api.broadcast('stats', s));
  apps.on('change', () => api.broadcast('apps', apps.status()));
  ddns.on('status', (s) => api.broadcast('ddns', s));
  logger.on('system', (e) => api.broadcast('system', e));
  let accessBatch = [];
  logger.on('access', (e) => {
    accessBatch.push(e);
  });
  setInterval(() => {
    if (accessBatch.length) {
      api.broadcast('access', accessBatch);
      accessBatch = [];
    }
  }, 500).unref();

  // ---------------------------------------------------------------- API

  function publicConfig() {
    const c = store.get();
    return {
      ...c,
      ddns: { ...c.ddns, records: c.ddns.records.map(({ token, ...r }) => ({ ...r, hasToken: Boolean(token) })) }
    };
  }

  async function state() {
    return {
      version: VERSION,
      mode,
      pid: process.pid,
      dataDir,
      paths,
      loadError: store.loadError || null,
      config: publicConfig(),
      server: engine.status(),
      ddns: ddns.status(),
      upnp: { ...upnp.info(), forwarded: forwarder.status() },
      network: await getNet(),
      providers: publicInfo()
    };
  }

  const withSecrets = (patch, existing) => {
    // An empty token field in the form means "keep the saved one".
    const p = { ...patch };
    if (existing && (p.token === '' || p.token === undefined)) delete p.token;
    delete p.hasToken;
    return p;
  };

  api.get('/api/health', () => ({ ok: true, pid: process.pid, version: VERSION, mode, dataDir }));
  api.get('/api/state', () => state());

  api.put('/api/settings/:section', ({ params, body }) => {
    store.updateSection(params.section, body);
    return state();
  });

  api.post('/api/sites', ({ body }) => store.addWebsite(body));
  api.put('/api/sites/:id', ({ params, body }) => store.updateWebsite(params.id, body));
  api.del('/api/sites/:id', ({ params }) => store.deleteWebsite(params.id));
  api.post('/api/sites/:id/move', ({ params, body }) => store.moveWebsite(params.id, body.direction));
  api.get('/api/sites/:id/output', ({ params }) => ({ lines: apps.output(params.id) }));

  api.post('/api/server/start', () => engine.start());
  api.post('/api/server/stop', () => engine.stop());
  api.post('/api/server/restart', () => engine.restart());

  api.get('/api/network', async ({ query }) => {
    const net = await getNet(query.refresh === '1');
    if (query.refresh === '1') await refreshRouterIp();
    return { ...net, ddns: ddns.status() };
  });

  api.post('/api/ddns/records', ({ body }) => store.addDdnsRecord(withSecrets(body)));
  api.put('/api/ddns/records/:id', ({ params, body }) => {
    const current = store.get().ddns.records.find((r) => r.id === params.id);
    return store.updateDdnsRecord(params.id, withSecrets(body, current));
  });
  api.del('/api/ddns/records/:id', ({ params }) => store.deleteDdnsRecord(params.id));
  api.post('/api/ddns/update', ({ body }) => ddns.run({ force: true, recordId: body.recordId || null }));
  api.get('/api/ddns/resolve', ({ query }) => ddns.resolve(String(query.hostname || '')));

  api.get('/api/ports/owners', async () => Object.fromEntries(await listeningPorts()));
  api.post('/api/ports/test', ({ body }) => checkTcp(String(body.host || '127.0.0.1'), Number(body.port), 3000));
  api.post('/api/diagnose', ({ body }) => diagnose(body || {}));
  api.get('/api/firewall', () => firewallStatus(process.execPath));

  api.get('/api/upnp', async ({ query }) => {
    const c = store.get().router;
    if (!c.upnpEnabled) return { info: { found: false, error: 'UPnP is turned off in HawHost.' }, mappings: [], forwarded: [] };
    const localAddress = await getLocalIp();
    await upnp.discover({ localAddress, force: query.refresh === '1' });
    const [externalIp, mappings] = await Promise.all([
      upnp.getExternalIp({ localAddress }).catch(() => null),
      upnp.listMappings({ localAddress }).catch(() => [])
    ]);
    return { info: upnp.info(), externalIp, mappings, localAddress, forwarded: forwarder.status() };
  });
  api.post('/api/upnp/map', async ({ body }) => {
    const localAddress = await getLocalIp();
    const port = Number(body.externalPort);
    await upnp.addMapping({
      externalPort: port,
      internalPort: Number(body.internalPort) || port,
      internalClient: localAddress,
      description: `HawHost TCP ${port}`,
      leaseSeconds: 0,
      localAddress
    });
    logger.info('upnp', `Router now forwards port ${port} to ${localAddress} (added by hand).`);
    return { ok: true };
  });
  api.post('/api/upnp/unmap', async ({ body }) => {
    await upnp.deleteMapping({ externalPort: Number(body.externalPort), localAddress: await getLocalIp() });
    logger.info('upnp', `Removed router forwarding for port ${body.externalPort}.`);
    return { ok: true };
  });

  api.get('/api/certs', () => certs.list());
  api.post('/api/certs/self-signed', ({ body }) => certs.createSelfSigned({ hostnames: body.hostnames, name: body.name }));
  api.post('/api/certs/import-pem', ({ body }) => certs.importPem(body));
  api.post('/api/certs/import-files', ({ body }) => certs.importFiles(body));
  api.post('/api/certs/import-pfx', ({ body }) => certs.importPfx(body));
  api.del('/api/certs/:id', ({ params }) => {
    for (const site of store.get().websites.filter((s) => s.certId === params.id)) store.updateWebsite(site.id, { certId: null });
    return certs.remove(params.id);
  });

  api.post('/api/export', () => writeExports(store.get(), certs.list(), paths.exportsDir));
  api.get('/api/detect', () => detectAll());
  api.get('/api/logs', ({ query }) => logger.recent(query.kind === 'access' ? 'access' : 'system', Math.min(1000, Number(query.limit) || 300)));
  api.get('/api/config/export', () => ({ json: store.exportJson() }));
  api.post('/api/config/import', ({ body }) => {
    store.importJson(String(body.json || ''));
    return state();
  });
  api.post('/api/shutdown', ({ body }) => {
    setTimeout(() => shutdown(body && body.reason ? body.reason : 'requested by the control panel'), 50);
    return { ok: true };
  });

  // ---------------------------------------------------------------- diagnostics

  async function diagnose({ publicHost }) {
    const net = await getNet(true);
    const cfg = store.get();
    const st = engine.status();
    const ports = (st.listeners.length ? st.listeners : st.planned.map((p) => ({ ...p, state: 'stopped' })));
    const extra = cfg.firewall.extraPorts.filter((p) => !ports.some((l) => l.port === p)).map((port) => ({ port, tls: false, state: 'external' }));

    const [fw, owners, mappings] = await Promise.all([
      firewallStatus(process.execPath),
      listeningPorts(),
      cfg.router.upnpEnabled ? upnp.listMappings({ localAddress: net.localIp }).catch(() => []) : Promise.resolve([])
    ]);
    const enabledRecord = cfg.ddns.records.find((r) => r.enabled);
    const target = String(publicHost || (enabledRecord && enabledRecord.hostname) || cfg.ddns.publicIp || '').trim();
    const nonce = crypto.randomBytes(12).toString('hex');
    engine.registerProbe(nonce);

    const rows = await Promise.all([...ports, ...extra].map(async (l) => {
      const [local, lan] = await Promise.all([checkTcp('127.0.0.1', l.port), checkTcp(net.localIp, l.port)]);
      let mapping = mappings.find((m) => m.externalPort === l.port && /tcp/i.test(m.protocol || 'TCP'));
      if (!mapping && cfg.router.upnpEnabled && upnp.gateway) mapping = await upnp.getMapping({ externalPort: l.port, localAddress: net.localIp });
      let publicCheck = null;
      if (target && local.open) {
        publicCheck = l.state === 'listening'
          ? await probeHttp({ host: target, port: l.port, tls: l.tls, nonce })
          : await checkTcp(target, l.port, 4000).then((r) => ({ result: r.open ? 'open' : r.detail, detail: r.open ? 'Port answers from the public address.' : `Not reachable (${r.detail}).` }));
      }
      return {
        port: l.port,
        tls: l.tls,
        state: l.state,
        error: l.error || null,
        owners: owners.get(l.port) || [],
        local: local.open,
        lan: lan.open,
        firewall: fw.supported ? fw.openPorts.includes(l.port) : null,
        router: mapping ? { mapped: true, to: `${mapping.internalClient}:${mapping.internalPort}`, pointsHere: mapping.internalClient === net.localIp && mapping.internalPort === l.port, description: mapping.description } : { mapped: false },
        public: publicCheck
      };
    }));

    return {
      checkedAt: new Date().toISOString(),
      network: net,
      target,
      publicIp: cfg.ddns.publicIp,
      routerWanIp: cfg.ddns.routerWanIp,
      natWarning: cfg.ddns.natWarning,
      upnp: upnp.info(),
      firewall: { supported: fw.supported, error: fw.error || null, blockedProgramRules: fw.blockedProgramRules || 0, profiles: fw.profiles || [] },
      ports: rows
    };
  }

  // ---------------------------------------------------------------- start

  await api.listen();
  const info = { pid: process.pid, port: api.port, token: api.token, version: VERSION, mode, startedAt: new Date().toISOString() };
  fs.writeFileSync(paths.daemonFile, JSON.stringify(info, null, 2), { mode: 0o600 });

  if (store.get().server.autoStart) await engine.start();
  if (store.get().ddns.enabled) ddns.start();
  else refreshRouterIp();

  const hourly = setInterval(() => {
    if (certs.reloadChangedSources()) api.broadcast('server', engine.status());
    refreshRouterIp();
  }, 3600000);
  hourly.unref();

  let stopping = false;
  async function shutdown(reason) {
    if (stopping) return;
    stopping = true;
    logger.info('daemon', `Shutting down (${reason}).`);
    ddns.stop();
    await forwarder.shutdown().catch(() => {});
    await engine.stop().catch(() => {});
    await api.close().catch(() => {});
    try {
      const current = JSON.parse(fs.readFileSync(paths.daemonFile, 'utf-8'));
      if (current.pid === process.pid) fs.unlinkSync(paths.daemonFile);
    } catch { /* ignore */ }
    logger.close();
    setTimeout(() => process.exit(0), 100);
  }

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('uncaughtException', (err) => logger.error('daemon', `Unexpected error: ${err.stack || err.message}`));
  process.on('unhandledRejection', (err) => logger.error('daemon', `Unexpected error: ${err && (err.stack || err.message)}`));
}

main().catch((err) => {
  console.error('HawHost background server failed to start:', err);
  process.exit(1);
});
