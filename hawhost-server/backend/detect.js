'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const { findPhpCgiCandidates, phpVersion } = require('./php-handler');
const { findSystemNode } = require('./app-manager');

function version(cmd, args) {
  try {
    return execFileSync(cmd, args, { encoding: 'utf-8', windowsHide: true, timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (err) {
    return String(err.stderr || '').trim() || null;
  }
}

function detectXampp() {
  for (const root of ['C:\\xampp', 'D:\\xampp']) {
    const httpd = path.join(root, 'apache', 'bin', 'httpd.exe');
    if (!fs.existsSync(httpd)) continue;
    let listen = [];
    let docRoot = path.join(root, 'htdocs');
    try {
      const conf = fs.readFileSync(path.join(root, 'apache', 'conf', 'httpd.conf'), 'utf-8');
      listen = [...conf.matchAll(/^\s*Listen\s+(?:[\d.]+:)?(\d+)/gim)].map((m) => Number(m[1]));
      const dr = /^\s*DocumentRoot\s+"?([^"\r\n]+)"?/im.exec(conf);
      if (dr) docRoot = dr[1].replace(/\//g, '\\');
    } catch { /* ignore */ }
    return { root, httpd, listen, htdocs: docRoot };
  }
  return null;
}

function detectNginx() {
  const candidates = ['C:\\nginx\\nginx.exe', 'C:\\tools\\nginx\\nginx.exe'];
  try {
    const found = execFileSync('where.exe', ['nginx.exe'], { encoding: 'utf-8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    candidates.unshift(...found.split(/\r?\n/).filter(Boolean).map((s) => s.trim()));
  } catch { /* not on PATH */ }
  const exe = candidates.find((p) => fs.existsSync(p));
  if (!exe) return null;
  const v = version(exe, ['-v']);
  return { exe, version: (/nginx\/([\d.]+)/.exec(v || '') || [])[1] || null };
}

function detectAll() {
  const php = findPhpCgiCandidates().map((p) => ({ path: p, version: phpVersion(p) }));
  const nodePath = findSystemNode();
  return {
    php,
    xampp: process.platform === 'win32' ? detectXampp() : null,
    nginx: process.platform === 'win32' ? detectNginx() : null,
    node: nodePath ? { path: nodePath, version: version(nodePath, ['-v']) } : null,
    bundledNode: process.versions.node
  };
}

module.exports = { detectAll, detectXampp };
