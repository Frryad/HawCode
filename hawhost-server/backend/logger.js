'use strict';

const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

const KEEP_DAYS = 14;

function day(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

class DailyFile {
  constructor(dir, prefix) {
    this.dir = dir;
    this.prefix = prefix;
    this.day = null;
    this.stream = null;
  }

  write(line) {
    const today = day();
    if (today !== this.day) {
      if (this.stream) this.stream.end();
      this.day = today;
      this.stream = fs.createWriteStream(path.join(this.dir, `${this.prefix}-${today}.log`), { flags: 'a' });
      this.stream.on('error', () => { this.stream = null; this.day = null; });
    }
    if (this.stream) this.stream.write(`${line}\n`);
  }

  close() {
    if (this.stream) this.stream.end();
    this.stream = null;
  }
}

/**
 * Two logs: `system` (what HawHost did) and `access` (every HTTP request).
 * Both keep the most recent entries in memory for the control panel and are
 * appended to daily files in <data>\logs, pruned after two weeks.
 */
class Logger extends EventEmitter {
  constructor(logsDir, { echo = false } = {}) {
    super();
    this.logsDir = logsDir;
    this.echo = echo;
    fs.mkdirSync(logsDir, { recursive: true });
    this.system = [];
    this.access = [];
    this.systemFile = new DailyFile(logsDir, 'hawhost');
    this.accessFile = new DailyFile(logsDir, 'access');
    this.prune();
  }

  prune() {
    const cutoff = Date.now() - KEEP_DAYS * 86400000;
    try {
      for (const f of fs.readdirSync(this.logsDir)) {
        const full = path.join(this.logsDir, f);
        if (f.endsWith('.log') && fs.statSync(full).mtimeMs < cutoff) fs.unlinkSync(full);
      }
    } catch { /* ignore */ }
  }

  log(level, source, message, extra) {
    const entry = { t: new Date().toISOString(), level, source, message: String(message) };
    if (extra !== undefined) entry.extra = extra;
    this.system.push(entry);
    if (this.system.length > 1000) this.system.splice(0, this.system.length - 1000);
    this.systemFile.write(`${entry.t} [${level.toUpperCase()}] ${source}: ${entry.message}`);
    if (this.echo) console.log(`[${level}] ${source}: ${entry.message}`);
    this.emit('system', entry);
    return entry;
  }

  info(source, message, extra) { return this.log('info', source, message, extra); }
  warn(source, message, extra) { return this.log('warn', source, message, extra); }
  error(source, message, extra) { return this.log('error', source, message, extra); }

  request(entry) {
    this.access.push(entry);
    if (this.access.length > 1000) this.access.splice(0, this.access.length - 1000);
    // Combined-log-like line: ip - - [time] "METHOD host url" status bytes ms "ua"
    this.accessFile.write(
      `${entry.ip} [${entry.t}] "${entry.method} ${entry.host}${entry.url}" ${entry.status} ${entry.bytes} ${entry.ms}ms site=${entry.site || '-'} "${(entry.ua || '').replace(/"/g, "'")}"`
    );
    this.emit('access', entry);
  }

  recent(kind = 'system', limit = 200) {
    const list = kind === 'access' ? this.access : this.system;
    return list.slice(-limit);
  }

  close() {
    this.systemFile.close();
    this.accessFile.close();
  }
}

module.exports = { Logger };
