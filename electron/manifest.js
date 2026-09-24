'use strict';

const fs = require('fs');
const path = require('path');
const { hashBuffer } = require('./transfer');

const STATE_VERSION = 1;

function normalize(relPath) {
  return String(relPath || '').replace(/\\/g, '/').replace(/^\/+/, '');
}

/**
 * A snapshot of every shared path: `relPath -> { isDir, size, mtimeMs, hash }`.
 *
 * This is the single source of truth for three things that used to be handled
 * separately and inconsistently:
 *   1. the file tree served to browser clients (no more walking the disk on
 *      every change),
 *   2. echo suppression — after writing a peer's bytes we record their hash, so
 *      the watcher event that follows is recognised as our own write instead of
 *      being guessed at with a time window,
 *   3. reconnect reconciliation, where matching hashes let both sides skip.
 */
class Manifest {
  constructor(rootPath, matcher) {
    this.rootPath = rootPath;
    this.matcher = matcher;
    this.entries = new Map();
  }

  /** Walk the workspace once and record every non-ignored path. */
  build() {
    this.entries.clear();
    this.#walk(this.rootPath);
    return this;
  }

  #walk(dir) {
    let names;
    try {
      names = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const dirent of names) {
      const absolute = path.join(dir, dirent.name);
      const rel = normalize(path.relative(this.rootPath, absolute));
      if (!rel || this.matcher.ignoresRelative(rel)) continue;
      if (dirent.isDirectory()) {
        this.entries.set(rel, { isDir: true, size: 0, mtimeMs: 0, hash: '' });
        this.#walk(absolute);
      } else if (dirent.isFile()) {
        const entry = this.readEntry(rel);
        if (entry) this.entries.set(rel, entry);
      }
    }
  }

  /** Read one path from disk into an entry, or null if it is gone/unreadable. */
  readEntry(relPath) {
    const rel = normalize(relPath);
    const absolute = path.join(this.rootPath, rel);
    try {
      const stat = fs.statSync(absolute);
      if (stat.isDirectory()) {
        return { isDir: true, size: 0, mtimeMs: stat.mtimeMs, hash: '' };
      }
      const buffer = fs.readFileSync(absolute);
      return {
        isDir: false,
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        hash: hashBuffer(buffer)
      };
    } catch {
      return null;
    }
  }

  get(relPath) {
    return this.entries.get(normalize(relPath)) || null;
  }

  set(relPath, entry) {
    this.entries.set(normalize(relPath), entry);
  }

  delete(relPath) {
    const rel = normalize(relPath);
    this.entries.delete(rel);
    // Deleting a directory removes everything recorded beneath it.
    const prefix = `${rel}/`;
    for (const key of this.entries.keys()) {
      if (key.startsWith(prefix)) this.entries.delete(key);
    }
  }

  /**
   * True when the file on disk already matches `hash`. This is how we tell our
   * own writes apart from a user's edit, with no timers involved.
   */
  matchesHash(relPath, hash) {
    const entry = this.get(relPath);
    return Boolean(entry && !entry.isDir && hash && entry.hash === hash);
  }

  /** Wire format: a plain object, safe to JSON.stringify and send to a peer. */
  toObject() {
    const out = {};
    for (const [rel, entry] of this.entries) out[rel] = entry;
    return out;
  }

  /** Nested tree for the sidebar / `GET /api/files`, built from memory. */
  toTree() {
    const root = [];
    const dirs = new Map([['', root]]);

    const sorted = Array.from(this.entries.keys()).sort();
    for (const rel of sorted) {
      const entry = this.entries.get(rel);
      const slash = rel.lastIndexOf('/');
      const parentPath = slash === -1 ? '' : rel.slice(0, slash);
      const name = slash === -1 ? rel : rel.slice(slash + 1);
      const parent = dirs.get(parentPath);
      // A child whose parent was ignored (or raced away) has nowhere to go.
      if (!parent) continue;
      if (entry.isDir) {
        const node = { name, type: 'directory', path: rel, children: [] };
        parent.push(node);
        dirs.set(rel, node.children);
      } else {
        parent.push({ name, type: 'file', path: rel, size: entry.size });
      }
    }

    const sortNodes = (nodes) => {
      nodes.sort((a, b) => {
        if (a.type === b.type) return a.name.localeCompare(b.name);
        return a.type === 'directory' ? -1 : 1;
      });
      for (const node of nodes) if (node.children) sortNodes(node.children);
      return nodes;
    };
    return sortNodes(root);
  }
}

/**
 * Compare our manifest against a peer's and decide, per path, who sends what.
 *
 * `lastSynced` is the manifest as it stood when the two sides were last in
 * agreement. It is what distinguishes "the peer deleted this" from "the peer
 * has never had this" — without it, joining with an empty folder would delete
 * the other computer's work.
 */
function reconcile(local, remote, lastSynced, options = {}) {
  const conflictWindowMs = options.conflictWindowMs ?? 2000;
  const paths = new Set([...Object.keys(local), ...Object.keys(remote)]);
  const plan = { pull: [], push: [], deleteLocal: [], deleteRemote: [], conflicts: [], mkdirLocal: [], mkdirRemote: [] };

  for (const rel of paths) {
    const ours = local[rel] || null;
    const theirs = remote[rel] || null;
    const known = lastSynced ? lastSynced[rel] || null : null;

    if (ours && theirs) {
      if (ours.isDir || theirs.isDir) continue;
      if (ours.hash === theirs.hash) continue;
      const ourChanged = !known || known.hash !== ours.hash;
      const theirChanged = !known || known.hash !== theirs.hash;
      if (ourChanged && theirChanged) {
        // Both sides moved since the last agreement: newest content wins and
        // the other version is kept as a .conflict- sibling.
        const theirsWins = theirs.mtimeMs > ours.mtimeMs + conflictWindowMs;
        const oursWins = ours.mtimeMs > theirs.mtimeMs + conflictWindowMs;
        if (theirsWins) {
          plan.conflicts.push({ path: rel, keep: 'remote' });
          plan.pull.push(rel);
        } else if (oursWins) {
          plan.conflicts.push({ path: rel, keep: 'local' });
          plan.push.push(rel);
        } else {
          // Effectively simultaneous. Prefer the remote copy so every peer
          // converges on the same bytes, and preserve ours beside it.
          plan.conflicts.push({ path: rel, keep: 'remote' });
          plan.pull.push(rel);
        }
      } else if (theirChanged) {
        plan.pull.push(rel);
      } else {
        plan.push.push(rel);
      }
      continue;
    }

    if (theirs && !ours) {
      // Missing here. A delete only if we knew about it and it has not since
      // changed on their side; otherwise it is simply new to us.
      const weDeleted = known && known.hash === theirs.hash;
      if (weDeleted) plan.deleteRemote.push(rel);
      else if (theirs.isDir) plan.mkdirLocal.push(rel);
      else plan.pull.push(rel);
      continue;
    }

    if (ours && !theirs) {
      const theyDeleted = known && known.hash === ours.hash;
      if (theyDeleted) plan.deleteLocal.push(rel);
      else if (ours.isDir) plan.mkdirRemote.push(rel);
      else plan.push.push(rel);
    }
  }

  // Shallow directories first, so parents exist before their children arrive.
  const byDepth = (a, b) => a.split('/').length - b.split('/').length;
  plan.mkdirLocal.sort(byDepth);
  plan.mkdirRemote.sort(byDepth);
  // Deepest paths first when removing, so directories are empty when we reach them.
  plan.deleteLocal.sort((a, b) => byDepth(b, a));
  plan.deleteRemote.sort((a, b) => byDepth(b, a));
  return plan;
}

/**
 * Persisted last-synced state, keyed by absolute workspace path so several
 * folders can be used over time without re-transferring everything.
 */
class StateStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.data = { version: STATE_VERSION, workspaces: {} };
    this.load();
  }

  load() {
    try {
      if (!fs.existsSync(this.filePath)) return;
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
      if (parsed && parsed.version === STATE_VERSION && parsed.workspaces) {
        this.data = parsed;
      }
    } catch {
      // A corrupt state file costs one full re-sync, not correctness.
    }
  }

  save() {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify(this.data), 'utf-8');
    } catch (error) {
      console.error('Could not persist HawCode sync state:', error.message);
    }
  }

  getSnapshot(workspacePath) {
    const record = this.data.workspaces[workspacePath];
    return record ? record.manifest : null;
  }

  setSnapshot(workspacePath, manifestObject) {
    this.data.workspaces[workspacePath] = {
      manifest: manifestObject,
      updatedAt: Date.now()
    };
    this.save();
  }
}

module.exports = { Manifest, reconcile, StateStore, normalize };
