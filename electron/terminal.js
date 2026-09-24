'use strict';

const { spawn } = require('child_process');
const crypto = require('crypto');
const EventEmitter = require('events');
const shells = require('./shells');

// Keep roughly this much output per session so switching tabs restores the
// scrollback without letting a chatty build log grow without bound.
const SCROLLBACK_LIMIT = 256 * 1024;

/**
 * Load the real pseudo-terminal if it is available.
 *
 * `@lydell/node-pty` ships prebuilt N-API binaries, so there is normally no
 * compile step — but npm can skip optional dependencies, and a platform without
 * a prebuild would leave it missing. Everything below works either way; the PTY
 * is simply the better of the two.
 */
function loadPty() {
  try {
    const pty = require('@lydell/node-pty');
    if (pty && typeof pty.spawn === 'function') return pty;
  } catch {
    // Fall through to the pipe-based implementation.
  }
  return null;
}

const pty = loadPty();
const MODE = pty ? 'pty' : 'pipe';

const FALLBACK_NOTICE =
  '\x1b[33mRunning without a pseudo-terminal.\x1b[0m Commands and output work, ' +
  'but interactive prompts and full-screen programs will not.\r\n\r\n';

/**
 * Owns every terminal session.
 *
 * Sessions live in the main process only. Nothing here is exposed through the
 * HTTP or Socket.IO server — a terminal is arbitrary code execution, and
 * HawCode can publish a workspace to the internet, so the only way to reach
 * this is Electron IPC from our own window.
 */
class TerminalManager extends EventEmitter {
  constructor({ getCwd } = {}) {
    super();
    this.sessions = new Map();
    this.getCwd = getCwd || (() => shells.homeDirectory());
  }

  get mode() {
    return MODE;
  }

  /** Start a shell. `cwd` defaults to the shared folder, else the home folder. */
  create({ shellId, cwd, cols = 80, rows = 24, title } = {}) {
    const shell = shells.resolve(shellId);
    const workingDir = cwd || this.getCwd() || shells.homeDirectory();
    const id = crypto.randomUUID();

    const env = { ...process.env };
    // Colour is worth asking for, and Electron's own variables would otherwise
    // confuse tools that inspect them.
    env.TERM = env.TERM || 'xterm-256color';
    env.COLORTERM = 'truecolor';
    delete env.ELECTRON_RUN_AS_NODE;

    const session = {
      id,
      shellId: shell.id,
      label: title || shell.label,
      cwd: workingDir,
      cols,
      rows,
      mode: MODE,
      exited: false,
      exitCode: null,
      scrollback: [],
      scrollbackBytes: 0
    };

    try {
      if (pty) {
        session.pty = pty.spawn(shell.file, shell.args, {
          name: 'xterm-256color',
          cols,
          rows,
          cwd: workingDir,
          env
        });
        session.pty.onData((data) => this.#onData(session, data));
        session.pty.onExit(({ exitCode }) => this.#onExit(session, exitCode));
      } else {
        session.child = spawn(shell.file, shell.args, {
          cwd: workingDir,
          env,
          windowsHide: true,
          stdio: ['pipe', 'pipe', 'pipe']
        });
        session.child.stdout.on('data', (chunk) => this.#onData(session, chunk.toString()));
        session.child.stderr.on('data', (chunk) => this.#onData(session, chunk.toString()));
        session.child.on('error', (error) => {
          this.#onData(session, `\r\n\x1b[31m${error.message}\x1b[0m\r\n`);
          this.#onExit(session, 1);
        });
        session.child.on('exit', (code) => this.#onExit(session, code));
      }
    } catch (error) {
      return { error: `Could not start ${shell.label}: ${error.message}` };
    }

    this.sessions.set(id, session);
    if (!pty) this.#onData(session, FALLBACK_NOTICE);
    return this.describe(session);
  }

  #onData(session, data) {
    session.scrollback.push(data);
    session.scrollbackBytes += data.length;
    while (session.scrollbackBytes > SCROLLBACK_LIMIT && session.scrollback.length > 1) {
      session.scrollbackBytes -= session.scrollback.shift().length;
    }
    this.emit('data', { id: session.id, data });
  }

  #onExit(session, exitCode) {
    if (session.exited) return;
    session.exited = true;
    session.exitCode = exitCode;
    session.pty = null;
    session.child = null;
    this.#onData(session, `\r\n\x1b[90m[process exited with code ${exitCode}]\x1b[0m\r\n`);
    this.emit('exit', { id: session.id, exitCode });
  }

  write(id, data) {
    const session = this.sessions.get(id);
    if (!session || session.exited) return { error: 'That terminal is not running' };
    if (session.pty) {
      session.pty.write(data);
    } else if (session.child && session.child.stdin.writable) {
      // A pipe does not echo the way a real terminal does, so reflect the
      // keystrokes back or the user types into a void.
      this.#onData(session, data === '\r' ? '\r\n' : data);
      session.child.stdin.write(data === '\r' ? '\n' : data);
    }
    return { ok: true };
  }

  resize(id, cols, rows) {
    const session = this.sessions.get(id);
    if (!session || session.exited) return { ok: false };
    session.cols = cols;
    session.rows = rows;
    // Only a real PTY has a window size to set.
    if (session.pty) {
      try {
        session.pty.resize(Math.max(2, cols), Math.max(1, rows));
      } catch {
        // The process can exit between the check and the call.
      }
    }
    return { ok: true };
  }

  /** Send a command as if it had been typed, used by the script runner. */
  run(id, command) {
    return this.write(id, `${command}\r`);
  }

  kill(id) {
    const session = this.sessions.get(id);
    if (!session) return { ok: true };
    try {
      if (session.pty) session.pty.kill();
      else if (session.child) session.child.kill();
    } catch {
      // Already gone.
    }
    this.sessions.delete(id);
    this.emit('closed', { id });
    return { ok: true };
  }

  killAll() {
    for (const id of Array.from(this.sessions.keys())) this.kill(id);
  }

  describe(session) {
    return {
      id: session.id,
      shellId: session.shellId,
      label: session.label,
      cwd: session.cwd,
      mode: session.mode,
      exited: session.exited,
      exitCode: session.exitCode
    };
  }

  list() {
    return Array.from(this.sessions.values()).map((session) => this.describe(session));
  }

  /** Replayed into xterm when a tab is re-mounted. */
  getScrollback(id) {
    const session = this.sessions.get(id);
    return session ? session.scrollback.join('') : '';
  }
}

module.exports = { TerminalManager, TERMINAL_MODE: MODE };
