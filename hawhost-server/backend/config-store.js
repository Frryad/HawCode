'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const secret = require('./secret');

const CONFIG_VERSION = 2;
const SITE_TYPES = ['static', 'php', 'node', 'proxy'];
const DDNS_PROVIDERS = ['duckdns', 'noip', 'dynu', 'custom'];

function defaults() {
  return {
    version: CONFIG_VERSION,
    server: {
      autoStart: true,          // serve websites as soon as the background server starts
      enableHttp: true,
      httpPort: 80,
      enableHttps: false,
      httpsPort: 443,
      extraPorts: [8080],       // additional plain-HTTP listener ports
      bindAddress: '',          // '' = all IPv4 + IPv6 interfaces
      maxBodyMb: 100,
      phpCgiPath: '',           // '' = auto-detect (PATH, XAMPP, Laragon, WAMP, C:\php)
      phpTimeoutSec: 120,
      hideDotfiles: true
    },
    websites: [],
    ddns: {
      enabled: false,
      intervalMinutes: 5,
      ipSource: 'auto',         // auto | router | provider
      records: [],
      publicIp: null,
      publicIpSource: null,
      publicIpCheckedAt: null,
      routerWanIp: null,
      natWarning: null,
      history: []
    },
    router: {
      upnpEnabled: true,        // talk to the router over UPnP (LAN only)
      upnpAutoForward: true,    // create/renew router port mappings while serving
      upnpLeaseSeconds: 3600
    },
    firewall: {
      autoApply: true,
      extraPorts: [],
      appliedPorts: [],
      appliedAt: null
    },
    ui: {
      closeToTray: true,
      stopServerOnQuit: false,
      onboardingDone: false
    }
  };
}

function newId(prefix) {
  return `${prefix}_${crypto.randomBytes(4).toString('hex')}`;
}

// ------------------------------------------------------------------ validation

class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
    this.status = 400;
  }
}

function toPort(value, field, { optional = false } = {}) {
  if (optional && (value === null || value === undefined || value === '')) return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    throw new ValidationError(`${field} must be a port number between 1 and 65535.`);
  }
  return n;
}

function toPortList(value, field) {
  const list = Array.isArray(value) ? value : String(value || '').split(/[\s,;]+/).filter(Boolean);
  return [...new Set(list.map((v) => toPort(v, field)))].sort((a, b) => a - b);
}

const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;

/** Accepts "https://Mysite.DuckDNS.org:8080/path" and returns "mysite.duckdns.org". */
function normalizeHostname(input, { allowWildcard = true } = {}) {
  let h = String(input || '').trim().toLowerCase();
  h = h.replace(/^[a-z]+:\/\//, '').split('/')[0];
  if (!h.startsWith('[')) h = h.replace(/:\d+$/, '');
  h = h.replace(/\.$/, '');
  if (!h) return null;
  if (h === '*' && allowWildcard) return '*';
  let rest = h;
  if (allowWildcard && h.startsWith('*.')) rest = h.slice(2);
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(rest)) return h; // raw IPv4
  if (/^\[[0-9a-f:]+\]$/.test(rest)) return h;        // raw IPv6
  const labels = rest.split('.');
  if (!labels.every((l) => LABEL.test(l))) {
    throw new ValidationError(`"${input}" is not a valid hostname.`);
  }
  return h;
}

function normalizeHostnames(value) {
  const list = Array.isArray(value) ? value : String(value || '').split(/[\s,;]+/);
  const out = [];
  for (const item of list) {
    if (!String(item || '').trim()) continue;
    const h = normalizeHostname(item);
    if (h && !out.includes(h)) out.push(h);
  }
  return out.length ? out : ['*'];
}

function normalizeTarget(value) {
  const raw = String(value || '').trim();
  let url;
  try {
    url = new URL(/^[a-z]+:\/\//i.test(raw) ? raw : `http://${raw}`);
  } catch {
    throw new ValidationError(`"${raw}" is not a valid proxy target. Use e.g. http://127.0.0.1:3000`);
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new ValidationError('Proxy target must start with http:// or https://');
  }
  return url.toString().replace(/\/$/, '');
}

const SITE_DEFAULTS = {
  name: 'My Website',
  enabled: true,
  type: 'static',
  hostnames: ['*'],
  port: null,
  root: '',
  indexFiles: ['index.html', 'index.htm', 'index.php'],
  spaFallback: false,
  directoryListing: false,
  phpFrontController: false,
  proxyTarget: 'http://127.0.0.1:3000',
  proxyPreserveHost: false,
  nodeCommand: '',
  nodeEntry: 'server.js',
  nodePort: 3001,
  nodeEnv: {},
  forceHttps: false,
  certId: null
};

function sanitizeSite(input, existing = null) {
  const base = existing ? { ...existing } : { ...SITE_DEFAULTS, id: newId('site'), createdAt: new Date().toISOString() };
  const s = { ...base, ...input, id: base.id, createdAt: base.createdAt };

  s.name = String(s.name || '').trim().slice(0, 80) || 'My Website';
  if (!SITE_TYPES.includes(s.type)) throw new ValidationError(`Unknown website type "${s.type}".`);
  s.enabled = s.enabled !== false;
  s.hostnames = normalizeHostnames(s.hostnames);
  s.port = toPort(s.port, 'Website port', { optional: true });
  s.root = String(s.root || '').trim();
  s.indexFiles = (Array.isArray(s.indexFiles) ? s.indexFiles : String(s.indexFiles || '').split(/[\s,;]+/))
    .map((f) => String(f).trim())
    .filter((f) => f && !/[\\/:*?"<>|]/.test(f));
  if (!s.indexFiles.length) s.indexFiles = [...SITE_DEFAULTS.indexFiles];
  for (const key of ['spaFallback', 'directoryListing', 'phpFrontController', 'proxyPreserveHost', 'forceHttps']) {
    s[key] = Boolean(s[key]);
  }
  s.certId = s.certId || null;

  if (['static', 'php', 'node'].includes(s.type) && !s.root) {
    throw new ValidationError('Choose the folder that contains the website files.');
  }
  if (s.type === 'proxy') s.proxyTarget = normalizeTarget(s.proxyTarget);
  if (s.type === 'node') {
    s.nodePort = toPort(s.nodePort, 'Node.js app port');
    s.nodeCommand = String(s.nodeCommand || '').trim();
    s.nodeEntry = String(s.nodeEntry || '').trim() || 'server.js';
    if (!s.nodeCommand && /[\s"&|<>^]/.test(s.nodeEntry)) {
      throw new ValidationError('The entry file must be a plain file name such as server.js (use a start command for anything else).');
    }
  }
  if (s.nodeEnv && typeof s.nodeEnv === 'object' && !Array.isArray(s.nodeEnv)) {
    const env = {};
    for (const [k, v] of Object.entries(s.nodeEnv)) {
      if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) env[k] = String(v);
    }
    s.nodeEnv = env;
  } else {
    s.nodeEnv = {};
  }
  return s;
}

function sanitizeRecord(input, existing = null) {
  const base = existing ? { ...existing } : {
    id: newId('ddns'),
    enabled: true,
    provider: 'duckdns',
    hostname: '',
    username: '',
    token: '',
    updateUrl: '',
    lastIp: null,
    lastUpdate: null,
    lastOk: null,
    lastResult: 'Not updated yet',
    blocked: null
  };
  const r = { ...base, ...input, id: base.id };
  if (!DDNS_PROVIDERS.includes(r.provider)) throw new ValidationError(`Unknown DDNS provider "${r.provider}".`);
  r.enabled = r.enabled !== false;
  r.hostname = normalizeHostname(r.hostname, { allowWildcard: false }) || '';
  if (r.provider === 'duckdns' && r.hostname && !r.hostname.includes('.')) {
    r.hostname = `${r.hostname}.duckdns.org`;
  }
  if (!r.hostname) throw new ValidationError('Enter the DDNS hostname, e.g. mysite.duckdns.org');
  r.username = String(r.username || '').trim();
  r.token = String(r.token || '').trim();
  r.updateUrl = String(r.updateUrl || '').trim();
  // An http:// update URL sends the token in clear text to anyone on the path.
  if (r.provider === 'custom' && !/^https:\/\//i.test(r.updateUrl)) {
    throw new ValidationError('A custom provider needs an update URL starting with https://');
  }
  // Editing credentials clears a provider block (e.g. "badauth") so updates resume.
  if (existing && ['hostname', 'username', 'token', 'provider', 'updateUrl'].some((k) => input[k] !== undefined && input[k] !== existing[k])) {
    r.blocked = null;
    r.lastIp = null;
  }
  return r;
}

// ------------------------------------------------------------------ migration

function migrate(raw) {
  if (!raw || typeof raw !== 'object') return defaults();
  if (raw.version === CONFIG_VERSION) return raw;

  // v1 -> v2
  const d = defaults();
  const s1 = raw.server || {};
  d.server.httpPort = Number(s1.httpPort) || 80;
  d.server.httpsPort = Number(s1.httpsPort) || 443;
  d.server.enableHttp = s1.useHttp !== false;
  d.server.enableHttps = Boolean(s1.useHttps);
  d.server.extraPorts = s1.customPort && ![d.server.httpPort, d.server.httpsPort].includes(Number(s1.customPort))
    ? [Number(s1.customPort)] : [];
  d.server.maxBodyMb = Number(s1.maxUploadMb) || 100;

  d.websites = (raw.websites || []).map((w) => ({
    ...SITE_DEFAULTS,
    id: w.id || newId('site'),
    createdAt: w.createdAt || new Date().toISOString(),
    name: w.name || 'Website',
    enabled: w.enabled !== false,
    type: SITE_TYPES.includes(w.type) ? w.type : 'static',
    hostnames: w.domain ? [String(w.domain).toLowerCase()] : ['*'],
    port: w.port ? Number(w.port) : null,
    root: w.rootPath || '',
    indexFiles: [...new Set([w.indexFile || 'index.html', ...SITE_DEFAULTS.indexFiles])],
    spaFallback: Boolean(w.spaFallback),
    proxyTarget: w.proxyTarget || SITE_DEFAULTS.proxyTarget
  }));

  const dd = raw.ddns || {};
  d.ddns.enabled = Boolean(dd.enabled);
  d.ddns.intervalMinutes = Number(dd.checkIntervalMinutes) || 5;
  if (dd.domain) {
    d.ddns.records.push({
      id: newId('ddns'),
      enabled: true,
      provider: DDNS_PROVIDERS.includes(dd.provider) ? dd.provider : 'duckdns',
      hostname: String(dd.domain).toLowerCase(),
      username: dd.username || '',
      token: dd.token || '',
      updateUrl: dd.customUrl || '',
      lastIp: null,
      lastUpdate: null,
      lastOk: null,
      lastResult: 'Not updated yet',
      blocked: null
    });
  }
  const fw = raw.firewall || {};
  d.firewall.autoApply = fw.autoApply !== false;
  return d;
}

function mergeDefaults(cfg) {
  const d = defaults();
  const out = { ...d, ...cfg, version: CONFIG_VERSION };
  for (const section of ['server', 'ddns', 'router', 'firewall', 'ui']) {
    out[section] = { ...d[section], ...(cfg[section] || {}) };
  }
  out.websites = (cfg.websites || []).map((w) => ({ ...SITE_DEFAULTS, ...w }));
  out.ddns.records = (out.ddns.records || []).map((r) => ({ ...r }));
  return out;
}

// ------------------------------------------------------------------ store

class ConfigStore extends EventEmitter {
  constructor(filePath) {
    super();
    this.filePath = filePath;
    this.data = defaults();
    // plain token -> its stored DPAPI form, so a save does not start PowerShell
    // unless a token actually changed.
    this._sealed = new Map();
    this.secretError = null;
    this.load();
  }

  /** Decrypt DDNS tokens in place after reading the file. True if any were still plain text. */
  _openSecrets() {
    const records = this.data.ddns.records || [];
    const stored = records.map((r) => String(r.token || ''));
    let plain = stored;
    try {
      plain = secret.unprotectAll(stored);
    } catch (err) {
      this.secretError = `Could not decrypt DDNS passwords: ${err.message}`;
      plain = stored.map((v) => (secret.isEncrypted(v) ? '' : v));
    }
    records.forEach((r, i) => {
      r.token = plain[i];
      if (plain[i] && secret.isEncrypted(stored[i])) this._sealed.set(plain[i], stored[i]);
    });
    return stored.some((v) => v && !secret.isEncrypted(v));
  }

  /** The config as written to disk: identical, except DDNS tokens are DPAPI-encrypted. */
  _sealedCopy() {
    const records = this.data.ddns.records || [];
    const missing = [...new Set(records.map((r) => r.token).filter((t) => t && !this._sealed.has(t)))];
    if (missing.length && secret.available()) {
      try {
        const sealed = secret.protectAll(missing);
        missing.forEach((t, i) => { if (secret.isEncrypted(sealed[i])) this._sealed.set(t, sealed[i]); });
        this.secretError = null;
      } catch (err) {
        // Better a working config than none; say so rather than pretend.
        this.secretError = `Could not encrypt DDNS passwords, stored as plain text: ${err.message}`;
      }
    }
    return {
      ...this.data,
      ddns: {
        ...this.data.ddns,
        records: records.map((r) => ({ ...r, token: (r.token && this._sealed.get(r.token)) || r.token }))
      }
    };
  }

  load() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    if (!fs.existsSync(this.filePath)) {
      this.data = defaults();
      this.save();
      return;
    }
    try {
      const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
      const wasVersion = raw.version;
      this.data = mergeDefaults(migrate(raw));
      const hadPlainTokens = this._openSecrets();
      if (wasVersion !== CONFIG_VERSION) {
        fs.copyFileSync(this.filePath, `${this.filePath}.v${wasVersion || 1}.bak`);
        this.save();
      } else if (hadPlainTokens) {
        // Written before encryption existed: re-save so the tokens get sealed.
        this.save();
      }
    } catch (err) {
      // Keep the unreadable file for the user instead of silently overwriting it.
      const backup = `${this.filePath}.broken-${Date.now()}`;
      try { fs.copyFileSync(this.filePath, backup); } catch { /* ignore */ }
      this.data = defaults();
      this.save();
      this.loadError = `Configuration file was unreadable (${err.message}); a copy was kept at ${backup}.`;
    }
  }

  save() {
    const tmp = `${this.filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this._sealedCopy(), null, 2), 'utf-8');
    fs.renameSync(tmp, this.filePath);
  }

  get() {
    return this.data;
  }

  _changed(section) {
    this.save();
    this.emit('change', section);
  }

  // ---- generic sections

  updateSection(section, patch) {
    if (!['server', 'router', 'firewall', 'ui', 'ddns'].includes(section)) {
      throw new ValidationError(`Unknown settings section "${section}".`);
    }
    const next = { ...this.data[section], ...patch };
    if (section === 'server') {
      next.httpPort = toPort(next.httpPort, 'HTTP port');
      next.httpsPort = toPort(next.httpsPort, 'HTTPS port');
      next.extraPorts = toPortList(next.extraPorts, 'Extra port');
      if (next.enableHttp && next.enableHttps && next.httpPort === next.httpsPort) {
        throw new ValidationError('HTTP and HTTPS cannot share the same port.');
      }
      next.extraPorts = next.extraPorts.filter((p) => p !== next.httpPort && p !== next.httpsPort);
      next.maxBodyMb = Math.min(4096, Math.max(1, Number(next.maxBodyMb) || 100));
      next.phpTimeoutSec = Math.min(3600, Math.max(5, Number(next.phpTimeoutSec) || 120));
      next.phpCgiPath = String(next.phpCgiPath || '').trim();
      next.bindAddress = String(next.bindAddress || '').trim();
    }
    if (section === 'ddns') {
      delete next.records; // managed through the record methods
      next.records = this.data.ddns.records;
      next.intervalMinutes = Math.min(1440, Math.max(1, Number(next.intervalMinutes) || 5));
      if (!['auto', 'router', 'provider'].includes(next.ipSource)) next.ipSource = 'auto';
    }
    if (section === 'firewall') {
      next.extraPorts = toPortList(next.extraPorts, 'Firewall port');
    }
    if (section === 'router') {
      next.upnpLeaseSeconds = Math.max(0, Number(next.upnpLeaseSeconds) || 0);
    }
    this.data[section] = next;
    this._changed(section);
    return next;
  }

  /** Internal state writes (DDNS results, applied firewall ports) that should not trigger reloads. */
  patchState(section, patch) {
    this.data[section] = { ...this.data[section], ...patch };
    this.save();
    this.emit('state', section);
  }

  // ---- websites

  addWebsite(input) {
    const site = sanitizeSite(input);
    this.data.websites.push(site);
    this._changed('websites');
    return site;
  }

  updateWebsite(id, patch) {
    const idx = this.data.websites.findIndex((s) => s.id === id);
    if (idx === -1) throw new ValidationError('Website not found.');
    const site = sanitizeSite(patch, this.data.websites[idx]);
    this.data.websites[idx] = site;
    this._changed('websites');
    return site;
  }

  deleteWebsite(id) {
    const before = this.data.websites.length;
    this.data.websites = this.data.websites.filter((s) => s.id !== id);
    if (this.data.websites.length === before) throw new ValidationError('Website not found.');
    this._changed('websites');
    return true;
  }

  moveWebsite(id, direction) {
    const list = this.data.websites;
    const i = list.findIndex((s) => s.id === id);
    const j = i + (direction === 'up' ? -1 : 1);
    if (i === -1 || j < 0 || j >= list.length) return list;
    [list[i], list[j]] = [list[j], list[i]];
    this._changed('websites');
    return list;
  }

  // ---- DDNS records

  addDdnsRecord(input) {
    const rec = sanitizeRecord(input);
    this.data.ddns.records.push(rec);
    this._changed('ddns');
    return rec;
  }

  updateDdnsRecord(id, patch) {
    const idx = this.data.ddns.records.findIndex((r) => r.id === id);
    if (idx === -1) throw new ValidationError('DDNS record not found.');
    const rec = sanitizeRecord(patch, this.data.ddns.records[idx]);
    this.data.ddns.records[idx] = rec;
    this._changed('ddns');
    return rec;
  }

  deleteDdnsRecord(id) {
    this.data.ddns.records = this.data.ddns.records.filter((r) => r.id !== id);
    this._changed('ddns');
    return true;
  }

  patchDdnsRecord(id, patch) {
    const rec = this.data.ddns.records.find((r) => r.id === id);
    if (!rec) return null;
    Object.assign(rec, patch);
    this.save();
    this.emit('state', 'ddns');
    return rec;
  }

  // ---- backup / restore

  exportJson() {
    return JSON.stringify(this.data, null, 2);
  }

  importJson(text) {
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      throw new ValidationError(`Not a valid HawHost configuration file: ${err.message}`);
    }
    const next = mergeDefaults(migrate(parsed));
    next.websites = next.websites.map((w) => sanitizeSite(w, { ...SITE_DEFAULTS, ...w }));
    this.data = next;
    // A backup from this PC carries sealed tokens; open them like a load would.
    this._openSecrets();
    this._changed('all');
    return this.data;
  }
}

module.exports = {
  ConfigStore,
  ValidationError,
  CONFIG_VERSION,
  SITE_TYPES,
  DDNS_PROVIDERS,
  defaults,
  migrate,
  normalizeHostname,
  normalizeHostnames,
  sanitizeSite,
  sanitizeRecord
};
