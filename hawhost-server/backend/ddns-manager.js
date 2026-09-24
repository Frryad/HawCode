'use strict';

const dns = require('dns');
const os = require('os');
const { EventEmitter } = require('events');

const { PROVIDERS, IPV4 } = require('./ddns-providers');
const { classifyIPv4 } = require('./network-info');

const DAY = 86400000;

async function fetchText(url, headers = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers, signal: controller.signal, redirect: 'follow' });
    return { status: res.status, body: await res.text() };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Keeps every DDNS hostname pointing at this network's public IPv4 address.
 *
 * Where the public IP comes from — never an unrelated "what is my IP" site:
 *   1. the router itself, over UPnP on the LAN (no internet traffic at all);
 *   2. the configured provider's own IP check (No-IP, Dynu), or the answer to
 *      the update itself (DuckDNS verbose mode, dyndns2 "good/nochg <ip>").
 */
class DdnsManager extends EventEmitter {
  constructor({ store, logger, upnp, getLocalIp }) {
    super();
    this.store = store;
    this.logger = logger;
    this.upnp = upnp;
    this.getLocalIp = getLocalIp;
    this.timer = null;
    this.netTimer = null;
    this.running = false;
    this.cycle = null;
    this.lastInterfaces = this._interfaceSignature();
  }

  cfg() {
    return this.store.get().ddns;
  }

  start() {
    this.stop();
    this.running = true;
    const minutes = this.cfg().intervalMinutes || 5;
    this.timer = setInterval(() => this.run().catch(() => {}), minutes * 60000);
    // A new local network usually means a new public IP: check right away.
    this.netTimer = setInterval(() => {
      const sig = this._interfaceSignature();
      if (sig !== this.lastInterfaces) {
        this.lastInterfaces = sig;
        this.logger.info('ddns', 'Network change detected; checking the public IP.');
        this.run().catch(() => {});
      }
    }, 30000);
    this.run().catch(() => {});
  }

  stop() {
    this.running = false;
    clearInterval(this.timer);
    clearInterval(this.netTimer);
    this.timer = null;
    this.netTimer = null;
  }

  _interfaceSignature() {
    return JSON.stringify(Object.values(os.networkInterfaces()).flat().filter((a) => !a.internal).map((a) => a.address).sort());
  }

  status() {
    const c = this.cfg();
    return {
      enabled: c.enabled,
      running: this.running,
      busy: Boolean(this.cycle),
      publicIp: c.publicIp,
      publicIpSource: c.publicIpSource,
      publicIpCheckedAt: c.publicIpCheckedAt,
      routerWanIp: c.routerWanIp,
      natWarning: c.natWarning,
      records: c.records.map(({ token, ...r }) => ({ ...r, hasToken: Boolean(token) })),
      history: c.history.slice(0, 50)
    };
  }

  /** One pass: detect the public IP, then update every record that needs it. */
  run({ force = false, recordId = null } = {}) {
    if (this.cycle) return this.cycle;
    this.cycle = this._run({ force, recordId }).finally(() => {
      this.cycle = null;
      this.emit('status', this.status());
    });
    this.emit('status', { ...this.status(), busy: true });
    return this.cycle;
  }

  async detectPublicIp() {
    const c = this.cfg();
    const routerAllowed = this.store.get().router.upnpEnabled && c.ipSource !== 'provider';
    const providerAllowed = c.ipSource !== 'router';
    let routerWanIp = null;
    let ip = null;
    let source = null;

    if (routerAllowed) {
      try {
        routerWanIp = await this.upnp.getExternalIp({ localAddress: await this.getLocalIp() });
      } catch (err) {
        this.logger.warn('ddns', `Could not ask the router for its WAN address: ${err.message}`);
      }
      if (routerWanIp && classifyIPv4(routerWanIp) === 'public') {
        ip = routerWanIp;
        source = 'router (UPnP)';
      }
    }

    if (!ip && providerAllowed) {
      const seen = new Set();
      for (const rec of c.records.filter((r) => r.enabled)) {
        const p = PROVIDERS[rec.provider];
        if (!p.ipEchoUrl || seen.has(rec.provider)) continue;
        seen.add(rec.provider);
        try {
          const res = await fetchText(p.ipEchoUrl, { 'User-Agent': 'HawHost' });
          const m = IPV4.exec(res.body);
          if (m && classifyIPv4(m[1]) === 'public') {
            ip = m[1];
            source = `${p.label} IP check`;
            break;
          }
        } catch (err) {
          this.logger.warn('ddns', `${p.label} IP check failed: ${err.message}`);
        }
      }
    }
    return { ip, source, routerWanIp };
  }

  async _run({ force, recordId }) {
    const c = this.cfg();
    const now = Date.now();
    const detected = await this.detectPublicIp();
    let publicIp = detected.ip;
    let publicIpSource = detected.source;
    const results = [];

    const records = c.records.filter((r) => (recordId ? r.id === recordId : r.enabled));
    for (const rec of records) {
      const provider = PROVIDERS[rec.provider];
      const problem = provider.validate(rec);
      if (problem) {
        this._record(rec, { ok: false, message: problem });
        results.push({ id: rec.id, ok: false, message: problem });
        continue;
      }
      if (rec.blocked && !force) {
        results.push({ id: rec.id, ok: false, skipped: true, message: `Paused: ${rec.blocked}. Fix the settings, then press Update now.` });
        continue;
      }

      const ip = publicIp;
      const last = rec.lastUpdate ? Date.parse(rec.lastUpdate) : 0;
      let due;
      if (force || !rec.lastOk) due = true;
      else if (ip) due = ip !== rec.lastIp || now - last > DAY;
      else due = provider.updateWithoutIpIsCheap || now - last > 30 * 60000;

      if (!due) {
        results.push({ id: rec.id, ok: true, skipped: true, message: `Up to date (${rec.lastIp})` });
        continue;
      }

      const outcome = await this.sendUpdate(rec, ip);
      this._record(rec, outcome);
      results.push({ id: rec.id, ...outcome });
      if (outcome.ok && outcome.ip && !publicIp) {
        publicIp = outcome.ip;
        publicIpSource = `${provider.label} update response`;
      }
    }

    // NAT diagnosis: a private or 100.64/10 router WAN address means CGNAT or a
    // second router in front — port forwarding on this router alone will not work.
    let natWarning = null;
    const wanType = detected.routerWanIp ? classifyIPv4(detected.routerWanIp) : null;
    if (wanType === 'cgnat') natWarning = 'cgnat';
    else if (wanType === 'private') natWarning = 'double-nat';
    else if (detected.routerWanIp && publicIp && detected.routerWanIp !== publicIp) natWarning = 'mismatch';

    this.store.patchState('ddns', {
      publicIp: publicIp || c.publicIp,
      publicIpSource: publicIp ? publicIpSource : c.publicIpSource,
      publicIpCheckedAt: new Date().toISOString(),
      routerWanIp: detected.routerWanIp,
      natWarning
    });
    return { publicIp, publicIpSource, routerWanIp: detected.routerWanIp, natWarning, results };
  }

  async sendUpdate(rec, ip) {
    const provider = PROVIDERS[rec.provider];
    const { url, headers } = provider.buildUpdate(rec, ip);
    try {
      const res = await fetchText(url, headers);
      const parsed = provider.parse(res.status, res.body);
      return { ...parsed, ip: parsed.ip || ip || null };
    } catch (err) {
      return { ok: false, message: `Could not reach ${provider.label}: ${err.name === 'AbortError' ? 'timed out' : err.message}` };
    }
  }

  _record(rec, outcome) {
    const now = new Date().toISOString();
    const patch = {
      lastUpdate: now,
      lastOk: Boolean(outcome.ok),
      lastResult: outcome.message
    };
    if (outcome.ok && outcome.ip) patch.lastIp = outcome.ip;
    patch.blocked = outcome.fatal ? outcome.message : null;
    this.store.patchDdnsRecord(rec.id, patch);

    const c = this.cfg();
    const history = [{ t: now, hostname: rec.hostname, provider: rec.provider, ok: Boolean(outcome.ok), ip: outcome.ip || null, message: outcome.message }, ...c.history].slice(0, 100);
    this.store.patchState('ddns', { history });
    const level = outcome.ok ? 'info' : 'warn';
    this.logger[level]('ddns', `${rec.hostname}: ${outcome.message}${outcome.ip ? ` (${outcome.ip})` : ''}`);
  }

  /** What the world currently sees for a hostname (via this PC's normal DNS resolver). */
  async resolve(hostname) {
    try {
      const addrs = await dns.promises.resolve4(hostname);
      return { hostname, addresses: addrs };
    } catch (err) {
      try {
        const { address } = await dns.promises.lookup(hostname, { family: 4 });
        return { hostname, addresses: [address] };
      } catch {
        return { hostname, addresses: [], error: err.code || err.message };
      }
    }
  }
}

module.exports = { DdnsManager };
