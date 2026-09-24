'use strict';

const path = require('path');
const os = require('os');
const fs = require('fs');

const APP_DIR_NAME = 'HawHost';

function defaultDataDir() {
  const base = process.env.APPDATA || (
    process.platform === 'darwin'
      ? path.join(os.homedir(), 'Library', 'Application Support')
      : path.join(os.homedir(), '.config')
  );
  return path.join(base, APP_DIR_NAME);
}

/** `--data-dir <dir>` wins, then HAWHOST_DATA_DIR, then %APPDATA%\HawHost. */
function resolveDataDir(argv = process.argv) {
  const i = argv.indexOf('--data-dir');
  if (i !== -1 && argv[i + 1]) return path.resolve(argv[i + 1]);
  if (process.env.HAWHOST_DATA_DIR) return path.resolve(process.env.HAWHOST_DATA_DIR);
  return defaultDataDir();
}

function layout(dataDir) {
  const p = {
    dataDir,
    configFile: path.join(dataDir, 'hawhost-config.json'),
    daemonFile: path.join(dataDir, 'daemon.json'),
    certsDir: path.join(dataDir, 'certs'),
    logsDir: path.join(dataDir, 'logs'),
    acmeWebroot: path.join(dataDir, 'acme-webroot'),
    exportsDir: path.join(dataDir, 'exports'),
    sitesDir: path.join(dataDir, 'sites')
  };
  return p;
}

function ensureDirs(p) {
  for (const dir of [p.dataDir, p.certsDir, p.logsDir, p.exportsDir, p.sitesDir,
    path.join(p.acmeWebroot, '.well-known', 'acme-challenge')]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

module.exports = { APP_DIR_NAME, defaultDataDir, resolveDataDir, layout, ensureDirs };
