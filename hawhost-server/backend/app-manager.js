'use strict';

const { spawn, execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const { EventEmitter } = require('events');

let systemNode;
function findSystemNode() {
  if (systemNode !== undefined) return systemNode;
  systemNode = null;
  try {
    const cmd = process.platform === 'win32' ? 'where.exe' : 'which';
    const out = execFileSync(cmd, ['node'], { encoding: 'utf-8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    systemNode = out.split(/\r?\n/).map((s) => s.trim()).find(Boolean) || null;
  } catch { /* not installed */ }
  return systemNode;
}

function killTree(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    try {
      execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    } catch { /* already gone */ }
  } else {
    child.kill('SIGTERM');
  }
}

/**
 * Keeps the Node.js apps behind "node" websites running while the web server
 * runs: starts them with PORT set, restarts them if they crash (with backoff),
 * and keeps the last lines of their output for the control panel.
 */
class AppManager extends EventEmitter {
  constructor({ logger }) {
    super();
    this.logger = logger;
    this.apps = new Map(); // siteId -> state
  }

  signature(site) {
    return JSON.stringify([site.root, site.nodeCommand, site.nodeEntry, site.nodePort, site.nodeEnv]);
  }

  /** Bring running apps in line with the website list. */
  sync(sites, shouldRun) {
    const wanted = new Map(
      shouldRun ? sites.filter((s) => s.enabled && s.type === 'node').map((s) => [s.id, s]) : []
    );
    for (const [id, app] of this.apps) {
      const site = wanted.get(id);
      if (!site || this.signature(site) !== app.signature) this.stop(id);
    }
    for (const [id, site] of wanted) {
      if (!this.apps.has(id)) this.start(site);
    }
  }

  start(site) {
    const app = {
      site,
      signature: this.signature(site),
      child: null,
      state: 'starting',
      restarts: 0,
      backoffMs: 1000,
      startedAt: null,
      lastExit: null,
      output: [],
      wanted: true,
      timer: null
    };
    this.apps.set(site.id, app);
    this._spawn(app);
  }

  _spawn(app) {
    const { site } = app;
    const root = path.resolve(site.root);
    if (!fs.existsSync(root)) {
      app.state = 'error';
      app.lastExit = `Folder not found: ${root}`;
      this.logger.error('node-app', `${site.name}: folder not found (${root}).`);
      this.emit('change');
      return;
    }

    const env = { ...process.env, PORT: String(site.nodePort), HOST: '127.0.0.1', NODE_ENV: 'production', ...site.nodeEnv };
    delete env.ELECTRON_RUN_AS_NODE;
    let child;
    try {
      if (site.nodeCommand) {
        child = spawn(site.nodeCommand, { cwd: root, env, shell: true, windowsHide: true });
      } else {
        const node = findSystemNode();
        if (node) {
          child = spawn(node, [site.nodeEntry], { cwd: root, env, windowsHide: true });
        } else {
          // No Node.js installed: use the runtime built into HawHost itself.
          child = spawn(process.execPath, [site.nodeEntry], { cwd: root, env: { ...env, ELECTRON_RUN_AS_NODE: '1' }, windowsHide: true });
        }
      }
    } catch (err) {
      app.state = 'error';
      app.lastExit = err.message;
      this.emit('change');
      return;
    }

    app.child = child;
    app.state = 'running';
    app.startedAt = Date.now();
    this.logger.info('node-app', `${site.name}: started (pid ${child.pid}) on 127.0.0.1:${site.nodePort}.`);
    this.emit('change');

    const collect = (data) => {
      for (const line of data.toString().split(/\r?\n/)) {
        if (!line) continue;
        app.output.push(line);
        if (app.output.length > 300) app.output.shift();
      }
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.on('error', (err) => collect(Buffer.from(`[HawHost] ${err.message}`)));

    child.on('exit', (code, signal) => {
      app.child = null;
      app.lastExit = signal ? `stopped (${signal})` : `exited with code ${code}`;
      if (!app.wanted) {
        app.state = 'stopped';
        this.emit('change');
        return;
      }
      // Crash: restart with exponential backoff; a long healthy run resets it.
      if (Date.now() - app.startedAt > 60000) app.backoffMs = 1000;
      app.state = 'restarting';
      app.restarts += 1;
      this.logger.warn('node-app', `${site.name} ${app.lastExit}; restarting in ${Math.round(app.backoffMs / 1000)}s.`);
      app.timer = setTimeout(() => this._spawn(app), app.backoffMs);
      app.backoffMs = Math.min(app.backoffMs * 2, 30000);
      this.emit('change');
    });
  }

  stop(id) {
    const app = this.apps.get(id);
    if (!app) return;
    app.wanted = false;
    clearTimeout(app.timer);
    killTree(app.child);
    this.apps.delete(id);
    this.logger.info('node-app', `${app.site.name}: stopped.`);
    this.emit('change');
  }

  stopAll() {
    for (const id of [...this.apps.keys()]) this.stop(id);
  }

  status() {
    const out = {};
    for (const [id, app] of this.apps) {
      out[id] = {
        state: app.state,
        pid: app.child ? app.child.pid : null,
        port: app.site.nodePort,
        restarts: app.restarts,
        startedAt: app.startedAt,
        lastExit: app.lastExit
      };
    }
    return out;
  }

  output(id) {
    const app = this.apps.get(id);
    return app ? app.output.slice() : [];
  }
}

module.exports = { AppManager, findSystemNode };
