// Development-only stand-in for the Electron bridge, so the control panel can
// be opened in a normal browser (npm run dev) with believable sample data.
// Never included in the packaged app.

const now = () => new Date().toISOString();
const minsAgo = (m) => new Date(Date.now() - m * 60000).toISOString();

function sampleState() {
  const sites = [
    { id: 'site_welcome', name: 'Welcome page', enabled: true, type: 'static', hostnames: ['*'], port: null, root: 'C:\\Users\\me\\AppData\\Roaming\\HawHost\\sites\\welcome', indexFiles: ['index.html', 'index.htm', 'index.php'], spaFallback: false, directoryListing: false, phpFrontController: false, proxyTarget: 'http://127.0.0.1:3000', proxyPreserveHost: false, nodeCommand: '', nodeEntry: 'server.js', nodePort: 3001, nodeEnv: {}, forceHttps: false, certId: null, createdAt: minsAgo(9000) },
    { id: 'site_blog', name: 'My blog (WordPress)', enabled: true, type: 'php', hostnames: ['mysite.duckdns.org', 'www.mysite.duckdns.org'], port: null, root: 'C:\\xampp\\htdocs\\wordpress', indexFiles: ['index.php', 'index.html'], spaFallback: false, directoryListing: false, phpFrontController: true, proxyTarget: 'http://127.0.0.1:3000', proxyPreserveHost: false, nodeCommand: '', nodeEntry: 'server.js', nodePort: 3001, nodeEnv: {}, forceHttps: false, certId: null, createdAt: minsAgo(5000) },
    { id: 'site_api', name: 'Chat API', enabled: true, type: 'node', hostnames: ['myserver.ddns.net'], port: null, root: 'D:\\projects\\chat-api', indexFiles: ['index.html'], spaFallback: false, directoryListing: false, phpFrontController: false, proxyTarget: '', proxyPreserveHost: false, nodeCommand: 'npm start', nodeEntry: 'server.js', nodePort: 3001, nodeEnv: {}, forceHttps: false, certId: null, createdAt: minsAgo(3000) },
    { id: 'site_apache', name: 'XAMPP Apache', enabled: false, type: 'proxy', hostnames: ['*'], port: 8080, root: '', indexFiles: ['index.html'], spaFallback: false, directoryListing: false, phpFrontController: false, proxyTarget: 'http://127.0.0.1:8081', proxyPreserveHost: true, nodeCommand: '', nodeEntry: 'server.js', nodePort: 3001, nodeEnv: {}, forceHttps: false, certId: null, createdAt: minsAgo(100) }
  ];
  return {
    version: '2.0.0',
    mode: 'app',
    pid: 4242,
    dataDir: 'C:\\Users\\me\\AppData\\Roaming\\HawHost',
    paths: {
      dataDir: 'C:\\Users\\me\\AppData\\Roaming\\HawHost',
      sitesDir: 'C:\\Users\\me\\AppData\\Roaming\\HawHost\\sites',
      logsDir: 'C:\\Users\\me\\AppData\\Roaming\\HawHost\\logs',
      certsDir: 'C:\\Users\\me\\AppData\\Roaming\\HawHost\\certs',
      acmeWebroot: 'C:\\Users\\me\\AppData\\Roaming\\HawHost\\acme-webroot',
      exportsDir: 'C:\\Users\\me\\AppData\\Roaming\\HawHost\\exports'
    },
    loadError: null,
    config: {
      version: 2,
      server: { autoStart: true, enableHttp: true, httpPort: 80, enableHttps: false, httpsPort: 443, extraPorts: [8080], bindAddress: '', maxBodyMb: 100, phpCgiPath: '', phpTimeoutSec: 120, hideDotfiles: true },
      websites: sites,
      ddns: { enabled: true, intervalMinutes: 5, ipSource: 'auto', records: [], publicIp: '203.0.113.24', publicIpSource: 'router (UPnP)', publicIpCheckedAt: minsAgo(2), routerWanIp: '192.168.100.49', natWarning: 'double-nat', history: [] },
      router: { upnpEnabled: true, upnpAutoForward: false, upnpLeaseSeconds: 3600 },
      firewall: { autoApply: true, extraPorts: [], appliedPorts: [80, 8080], appliedAt: minsAgo(60) },
      ui: { closeToTray: true, stopServerOnQuit: false, onboardingDone: true }
    },
    server: {
      running: true,
      startedAt: minsAgo(185),
      listeners: [
        { port: 80, tls: false, state: 'listening', error: null, owners: [] },
        { port: 8080, tls: false, state: 'error', error: 'Port 8080 is already used by httpd.exe. Stop that program or choose a different port.', owners: [{ pid: 11236, name: 'httpd.exe' }] }
      ],
      planned: [{ port: 80, tls: false }, { port: 8080, tls: false }],
      stats: { requests: 18234, bytes: 734003200, activeConnections: 3, status2xx: 17100, status3xx: 800, status4xx: 330, status5xx: 4 },
      phpCgi: 'C:\\xampp\\php\\php-cgi.exe',
      apps: { site_api: { state: 'running', pid: 9120, port: 3001, restarts: 0, startedAt: Date.now() - 3600000, lastExit: null } }
    },
    ddns: {
      enabled: true,
      running: true,
      busy: false,
      publicIp: '203.0.113.24',
      publicIpSource: 'DuckDNS update response',
      publicIpCheckedAt: minsAgo(2),
      routerWanIp: '192.168.100.49',
      natWarning: 'double-nat',
      records: [
        { id: 'ddns_1', enabled: true, provider: 'duckdns', hostname: 'mysite.duckdns.org', username: '', updateUrl: '', lastIp: '203.0.113.24', lastUpdate: minsAgo(2), lastOk: true, lastResult: 'Already up to date', blocked: null, hasToken: true },
        { id: 'ddns_2', enabled: true, provider: 'noip', hostname: 'myserver.ddns.net', username: 'me@example.com', updateUrl: '', lastIp: '203.0.113.24', lastUpdate: minsAgo(300), lastOk: true, lastResult: 'Updated', blocked: null, hasToken: true }
      ],
      history: [
        { t: minsAgo(2), hostname: 'mysite.duckdns.org', provider: 'duckdns', ok: true, ip: '203.0.113.24', message: 'Already up to date' },
        { t: minsAgo(300), hostname: 'myserver.ddns.net', provider: 'noip', ok: true, ip: '203.0.113.24', message: 'Updated' },
        { t: minsAgo(305), hostname: 'mysite.duckdns.org', provider: 'duckdns', ok: true, ip: '203.0.113.24', message: 'Updated' }
      ]
    },
    upnp: { found: true, friendlyName: 'Wireless Router TL-WR940N', manufacturer: 'TP-Link', modelName: 'TL-WR940N', routerAddress: '192.168.1.1', forwarded: [] },
    network: {
      localIp: '192.168.1.101', localIpType: 'private', gateway: '192.168.1.1', adapterName: 'Wi-Fi', hostname: 'DESKTOP-HAW',
      adapters: [{ name: 'Wi-Fi', address: '192.168.1.101', netmask: '255.255.255.0', virtual: false }, { name: 'vEthernet (WSL)', address: '172.28.16.1', netmask: '255.255.240.0', virtual: true }]
    },
    providers: {
      duckdns: { id: 'duckdns', label: 'DuckDNS', suffix: '.duckdns.org', signupUrl: 'https://www.duckdns.org/', fields: { username: false, token: 'Token (from the DuckDNS home page)' }, hasIpEcho: false },
      noip: { id: 'noip', label: 'No-IP (free)', suffix: '.ddns.net', signupUrl: 'https://www.noip.com/sign-up', fields: { username: 'No-IP username or e-mail (or DDNS key username)', token: 'Password (or DDNS key password)' }, hasIpEcho: true },
      dynu: { id: 'dynu', label: 'Dynu', suffix: '.dynu.net', signupUrl: 'https://www.dynu.com/en-US/ControlPanel/CreateAccount', fields: { username: 'Dynu username', token: 'Password (or IP update password)' }, hasIpEcho: true },
      custom: { id: 'custom', label: 'Other (custom update URL)', suffix: '', signupUrl: null, fields: { username: 'Username (optional, sent as Basic auth)', token: 'Password / token (optional)' }, hasIpEcho: false }
    }
  };
}

function sampleAccess() {
  const paths = ['/', '/wp-login.php', '/wp-content/themes/site/style.css', '/api/messages', '/favicon.ico', '/images/hero.jpg', '/about/'];
  const hosts = ['mysite.duckdns.org', 'myserver.ddns.net', '192.168.1.101'];
  const out = [];
  for (let i = 40; i > 0; i -= 1) {
    const p = paths[i % paths.length];
    out.push({
      t: new Date(Date.now() - i * 37000).toISOString(),
      ip: i % 3 ? `198.51.100.${(i * 7) % 250}` : '192.168.1.23',
      method: i % 9 === 0 ? 'POST' : 'GET',
      host: hosts[i % hosts.length],
      url: p,
      port: 80,
      tls: false,
      status: p === '/favicon.ico' ? 404 : i % 13 === 0 ? 304 : 200,
      bytes: (i * 7919) % 90000,
      ms: (i * 13) % 120,
      site: i % 3 === 1 ? 'Chat API' : 'My blog (WordPress)',
      ua: 'Mozilla/5.0'
    });
  }
  return out;
}

function sampleSystem() {
  return [
    { t: minsAgo(185), level: 'info', source: 'daemon', message: 'HawHost 2.0.0 starting (app mode, pid 4242).' },
    { t: minsAgo(185), level: 'info', source: 'server', message: 'Web server started on port 80.' },
    { t: minsAgo(185), level: 'error', source: 'server', message: 'Port 8080: Port 8080 is already used by httpd.exe. Stop that program or choose a different port.' },
    { t: minsAgo(184), level: 'info', source: 'node-app', message: 'Chat API: started (pid 9120) on 127.0.0.1:3001.' },
    { t: minsAgo(300), level: 'info', source: 'ddns', message: 'myserver.ddns.net: Updated (203.0.113.24)' },
    { t: minsAgo(2), level: 'info', source: 'ddns', message: 'mysite.duckdns.org: Already up to date (203.0.113.24)' }
  ];
}

export function createDemoBridge() {
  const state = sampleState();
  const listeners = { event: new Set(), connection: new Set() };
  const emit = (type, data) => listeners.event.forEach((cb) => cb({ type, data }));
  const delay = (ms = 250) => new Promise((r) => setTimeout(r, ms));

  async function api(method, path, body) {
    await delay(120);
    const [p] = path.split('?');
    if (p === '/api/state') return structuredClone(state);
    if (p === '/api/logs') return path.includes('access') ? sampleAccess() : sampleSystem();
    if (p === '/api/server/stop') { state.server.running = false; state.server.listeners = []; emit('server', state.server); return state.server; }
    if (p === '/api/server/start' || p === '/api/server/restart') { state.server = sampleState().server; emit('server', state.server); return state.server; }
    if (p === '/api/detect') return { php: [{ path: 'C:\\xampp\\php\\php-cgi.exe', version: '8.2.12' }], xampp: { root: 'C:\\xampp', httpd: 'C:\\xampp\\apache\\bin\\httpd.exe', listen: [80], htdocs: 'C:\\xampp\\htdocs' }, nginx: null, node: { path: 'C:\\Program Files\\nodejs\\node.exe', version: 'v24.21.0' }, bundledNode: '24.21.0' };
    if (p === '/api/certs') return [{ id: 'default', name: 'HawHost default (self-signed)', source: 'self-signed', hostnames: ['localhost', 'mysite.duckdns.org'], issuer: 'HawHost self-signed', validFrom: minsAgo(9000), validTo: new Date(Date.now() + 800 * 86400000).toISOString(), selfSigned: true, daysLeft: 800, status: 'valid', certPath: 'C:\\...\\certs\\default\\cert.pem' }];
    if (p === '/api/upnp') { await delay(900); return { info: state.upnp, externalIp: '192.168.100.49', mappings: [{ externalPort: 80, protocol: 'TCP', internalPort: 80, internalClient: '192.168.1.101', enabled: true, description: 'HawHost TCP 80', leaseSeconds: 0 }], localAddress: '192.168.1.101', forwarded: [] }; }
    if (p === '/api/network') return { ...state.network, ddns: state.ddns };
    if (p === '/api/diagnose') {
      await delay(1500);
      return {
        checkedAt: now(), network: state.network, target: 'mysite.duckdns.org', publicIp: '203.0.113.24', routerWanIp: '192.168.100.49', natWarning: 'double-nat', upnp: state.upnp,
        firewall: { supported: true, error: null, blockedProgramRules: 0, profiles: [] },
        ports: [
          { port: 80, tls: false, state: 'listening', owners: [{ pid: 4242, name: 'HawHost.exe' }], local: true, lan: true, firewall: true, router: { mapped: true, to: '192.168.1.101:80', pointsHere: true, description: 'HawHost TCP 80' }, public: { result: 'timeout', detail: 'No answer (port not forwarded, blocked by the ISP, or the router does not support NAT loopback).' } },
          { port: 8080, tls: false, state: 'error', error: 'Port 8080 is already used by httpd.exe.', owners: [{ pid: 11236, name: 'httpd.exe' }], local: true, lan: true, firewall: false, router: { mapped: false }, public: null }
        ]
      };
    }
    if (p === '/api/export') return { nginx: { path: 'C:\\...\\exports\\hawhost-sites.nginx.conf', content: '# nginx sample\nserver {\n    listen 80;\n    server_name mysite.duckdns.org;\n}' }, apache: { path: 'C:\\...\\exports\\hawhost-sites.apache.conf', content: '# apache sample\n<VirtualHost *:80>\n    ServerName mysite.duckdns.org\n</VirtualHost>' } };
    if (p === '/api/ddns/resolve') return { hostname: 'mysite.duckdns.org', addresses: ['203.0.113.24'] };
    if (p === '/api/ddns/update') { await delay(800); return { publicIp: '203.0.113.24', results: [] }; }
    if (p.startsWith('/api/settings/')) {
      const section = p.split('/').pop();
      state.config[section] = { ...state.config[section], ...body };
      emit('config', state.config);
      return structuredClone(state);
    }
    if (p === '/api/sites' && method === 'POST') { const s = { ...state.config.websites[0], ...body, id: `site_${Date.now()}` }; state.config.websites.push(s); emit('config', state.config); return s; }
    if (p.startsWith('/api/sites/') && method === 'PUT') { const id = p.split('/')[3]; state.config.websites = state.config.websites.map((w) => (w.id === id ? { ...w, ...body } : w)); emit('config', state.config); return {}; }
    if (p.startsWith('/api/sites/') && method === 'DELETE') { const id = p.split('/')[3]; state.config.websites = state.config.websites.filter((w) => w.id !== id); emit('config', state.config); return true; }
    if (p === '/api/config/export') return { json: JSON.stringify(state.config, null, 2) };
    return { ok: true };
  }

  return {
    api,
    appInfo: async () => ({ version: '2.0.0', isDev: true, isPackaged: false, dataDir: state.dataDir, paths: state.paths, exePath: 'C:\\Program Files\\HawHost\\HawHost.exe', platform: 'win32', connected: true, demo: true }),
    ensureDaemon: async () => ({}),
    restartDaemon: async () => ({}),
    pickFolder: async () => 'D:\\websites\\new-site',
    pickFile: async () => 'C:\\certs\\fullchain.pem',
    saveText: async () => 'C:\\Users\\me\\Desktop\\hawhost-config.json',
    readTextFile: async () => null,
    openExternal: async (u) => window.open(u, '_blank'),
    openPath: async () => true,
    copy: async (t) => navigator.clipboard && navigator.clipboard.writeText(t).catch(() => {}),
    firewall: {
      status: async () => { await delay(600); return { supported: true, rules: [{ name: 'HawHost web server - TCP 80', enabled: 'True', action: 'Allow', direction: 'Inbound', protocol: 'TCP', ports: '80' }], openPorts: [80], blockedProgramRules: 0, profiles: [] }; },
      apply: async (ports) => { await delay(1200); return { ports }; },
      remove: async () => ({})
    },
    startup: {
      status: async () => ({ loginItem: { enabled: true }, service: { supported: true, installed: false }, user: 'DESKTOP-HAW\\me' }),
      setLoginItem: async (v) => ({ enabled: v }),
      installService: async () => ({ installed: true, state: 'Running', user: 'DESKTOP-HAW\\me', logonType: 'S4U' }),
      uninstallService: async () => ({ installed: false })
    },
    trustCert: async () => true,
    quit: async () => true,
    onEvent: (cb) => { listeners.event.add(cb); return () => listeners.event.delete(cb); },
    onConnection: (cb) => { listeners.connection.add(cb); return () => listeners.connection.delete(cb); },
    onError: () => () => {},
    onNavigate: () => () => {}
  };
}
