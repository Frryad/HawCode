'use strict';

const fs = require('fs');
const http = require('http');
const { spawn } = require('child_process');
const { EventEmitter } = require('events');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * The control panel's connection to the background server: finds it through
 * <data>\daemon.json, starts it if it is not running, relays API calls and
 * turns its event stream into 'event' emissions.
 */
class DaemonClient extends EventEmitter {
  constructor({ daemonFile, exe, script, dataDir }) {
    super();
    this.daemonFile = daemonFile;
    this.exe = exe;
    this.script = script;
    this.dataDir = dataDir;
    this.connected = false;
    this.events = null;
    this.closing = false;
    this.ensuring = null;
  }

  info() {
    try {
      return JSON.parse(fs.readFileSync(this.daemonFile, 'utf-8'));
    } catch {
      return null;
    }
  }

  request(method, pathname, body, { timeoutMs = 90000 } = {}) {
    const info = this.info();
    if (!info) return Promise.reject(new Error('The HawHost background server is not running.'));
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    return new Promise((resolve, reject) => {
      const req = http.request({
        host: '127.0.0.1',
        port: info.port,
        method,
        path: pathname,
        headers: {
          Authorization: `Bearer ${info.token}`,
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {})
        }
      }, (res) => {
        let data = '';
        res.setEncoding('utf-8');
        res.on('data', (d) => { data += d; });
        res.on('end', () => {
          let json = null;
          try { json = data ? JSON.parse(data) : null; } catch { /* non-JSON */ }
          if (res.statusCode === 200) resolve(json);
          else reject(Object.assign(new Error((json && json.error) || `HTTP ${res.statusCode}`), { status: res.statusCode }));
        });
      });
      req.setTimeout(timeoutMs, () => req.destroy(new Error('The background server did not answer in time.')));
      req.on('error', (err) => reject(err.code === 'ECONNREFUSED' ? new Error('The HawHost background server is not running.') : err));
      if (payload) req.write(payload);
      req.end();
    });
  }

  async healthy() {
    try {
      const h = await this.request('GET', '/api/health', undefined, { timeoutMs: 2500 });
      return Boolean(h && h.ok);
    } catch {
      return false;
    }
  }

  spawnDaemon() {
    const child = spawn(this.exe, [this.script, '--data-dir', this.dataDir], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
    });
    child.unref();
  }

  /** Make sure a background server is running and we are subscribed to it. */
  ensure() {
    if (!this.ensuring) {
      this.ensuring = (async () => {
        if (!(await this.healthy())) {
          this.spawnDaemon();
          const deadline = Date.now() + 20000;
          while (Date.now() < deadline) {
            await sleep(300);
            if (await this.healthy()) break;
          }
          if (!(await this.healthy())) throw new Error('The HawHost background server could not be started. See the log in the data folder.');
        }
        this.subscribe();
        return this.info();
      })().finally(() => { this.ensuring = null; });
    }
    return this.ensuring;
  }

  subscribe() {
    if (this.events) return;
    const info = this.info();
    if (!info) return;
    const req = http.get({
      host: '127.0.0.1',
      port: info.port,
      path: '/api/events',
      headers: { Authorization: `Bearer ${info.token}` }
    }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        return;
      }
      this.setConnected(true);
      let buf = '';
      res.setEncoding('utf-8');
      res.on('data', (chunk) => {
        buf += chunk;
        let idx;
        while ((idx = buf.indexOf('\n\n')) !== -1) {
          const frame = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const type = (/^event: (.+)$/m.exec(frame) || [])[1];
          const data = (/^data: (.+)$/m.exec(frame) || [])[1];
          if (type && data) {
            try {
              this.emit('event', { type, data: JSON.parse(data) });
            } catch { /* ignore malformed */ }
          }
        }
      });
      res.on('end', () => this.lost());
      res.on('error', () => this.lost());
    });
    req.on('error', () => this.lost());
    this.events = req;
  }

  lost() {
    if (!this.events) return;
    this.events.destroy();
    this.events = null;
    this.setConnected(false);
    if (this.closing) return;
    // The background server went away (crash, update, "stop"): bring it back.
    setTimeout(() => {
      if (!this.closing && !this.paused) this.ensure().catch((err) => this.emit('error', err));
    }, 2000);
  }

  setConnected(value) {
    if (this.connected !== value) {
      this.connected = value;
      this.emit('connection', value);
    }
  }

  /** Stop the background server (websites go offline). */
  async shutdown() {
    this.paused = true;
    try {
      await this.request('POST', '/api/shutdown', { reason: 'stopped from the control panel' });
    } catch { /* already gone */ }
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline && (await this.healthy())) await sleep(200);
  }

  async restart() {
    await this.shutdown();
    this.paused = false;
    return this.ensure();
  }

  close() {
    this.closing = true;
    if (this.events) this.events.destroy();
    this.events = null;
  }
}

module.exports = { DaemonClient };
