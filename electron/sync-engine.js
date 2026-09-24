'use strict';

const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const chokidar = require('chokidar');

const { createMatcher } = require('./ignore');
const { Manifest, reconcile, normalize } = require('./manifest');
const { HoldQueue } = require('./queue');
const {
  INLINE_LIMIT,
  hashBuffer,
  isTextFile,
  ensureDir,
  writeFileAtomic,
  conflictPathFor,
  buildChunks,
  createChunkAssembler
} = require('./transfer');

// Content at or below this size rides along with the change announcement. Above
// it we announce the hash first and let the peer ask, so a large file is never
// pushed to someone who already has those exact bytes.
const SMALL_FILE_LIMIT = 64 * 1024;
// Coalesce bursts of writes to the same path (editors often save several times
// in quick succession) into a single transfer.
const DEBOUNCE_MS = 80;
// A delete followed this quickly by a create of identical content is a rename.
const RENAME_WINDOW_MS = 400;
const THROUGHPUT_WINDOW_MS = 3000;

const EV = {
  HELLO: 'haw:hello',
  MANIFEST_REQUEST: 'haw:manifest-request',
  MANIFEST: 'haw:manifest',
  CHANGE: 'haw:change',
  NEED: 'haw:need',
  FILE: 'haw:file',
  CHUNK: 'haw:chunk',
  CHUNK_DONE: 'haw:chunk-done',
  DELETE: 'haw:delete',
  MKDIR: 'haw:mkdir',
  RENAME: 'haw:rename',
  PAUSED: 'haw:paused',
  // Who is looking at what. Both server.js and peer-client.js wire their
  // listeners by iterating this map, so adding it here is all the transport
  // work presence needs.
  PRESENCE: 'haw:presence'
};

/**
 * Drives one shared workspace.
 *
 * The engine is deliberately symmetric: a host and a client run the same code
 * and speak the same events. The only difference is how peers arrive — the host
 * gets a link per inbound socket, the client has a single link to its host.
 */
class SyncEngine extends EventEmitter {
  // Chunked transfers that have fully arrived but are still awaiting their
  // CHUNK_DONE hash check before anything touches disk.
  #pendingAssembled = new Map();

  constructor({ stateStore }) {
    super();
    this.stateStore = stateStore;
    this.rootPath = null;
    this.matcher = null;
    this.manifest = null;
    this.mode = null;
    this.state = 'idle';

    this.watcher = null;
    this.links = new Map();
    this.assembler = createChunkAssembler();

    this.outbound = new HoldQueue();
    this.inbound = new HoldQueue();

    // Hash each path had the last time we and a peer agreed on it. Lets us tell
    // "they changed it" from "we changed it" when the two disagree.
    this.syncedHashes = new Map();

    this.debounceTimers = new Map();
    this.pendingUnlinks = new Map();
    this.peerPaused = false;
    // Where each connected peer currently is, keyed by link id.
    this.peerPresence = new Map();

    this.stats = { bytesIn: 0, bytesOut: 0, filesIn: 0, filesOut: 0, lastSyncAt: null };
    this.throughputSamples = [];
  }

  // ---------------------------------------------------------------- lifecycle

  /** Attach to a folder and begin watching. Safe to call again to switch folders. */
  open(rootPath, mode) {
    this.close({ keepFolder: false });
    this.rootPath = path.resolve(rootPath);
    this.mode = mode;
    this.matcher = createMatcher(this.rootPath);
    this.manifest = new Manifest(this.rootPath, this.matcher).build();

    const snapshot = this.stateStore.getSnapshot(this.rootPath);
    this.syncedHashes = new Map();
    if (snapshot) {
      for (const [rel, entry] of Object.entries(snapshot)) {
        if (!entry.isDir) this.syncedHashes.set(rel, entry.hash);
      }
    }

    this.state = 'running';
    this.#startWatcher();
    this.emitStatus();
    this.emit('tree-changed');
    return this.manifest;
  }

  pause() {
    if (this.state !== 'running') return this.getStatus();
    this.state = 'paused';
    this.#broadcast(EV.PAUSED, { paused: true });
    this.#activity('info', '', 0, 'Sync paused — changes are being queued');
    this.emitStatus();
    return this.getStatus();
  }

  /**
   * Apply everything that arrived while paused, re-check against every peer in
   * case something slipped through, then send our own held changes.
   */
  async resume() {
    if (this.state !== 'paused') return this.getStatus();
    this.state = 'running';
    this.#broadcast(EV.PAUSED, { paused: false });

    const incoming = this.inbound.drain();
    for (const op of incoming) {
      try {
        await this.#applyRemoteOp(op, null);
      } catch (error) {
        this.#activity('error', op.path || '', 0, `Could not apply ${op.path}: ${error.message}`);
      }
    }

    const outgoing = this.outbound.drain();
    for (const op of outgoing) {
      this.#sendLocalOp(op);
    }

    // A reconcile after the queues drain catches anything that changed on a peer
    // while we were not listening for it.
    for (const link of this.links.values()) {
      this.requestReconcile(link.id);
    }

    this.#activity('info', '', 0, `Sync resumed — replayed ${incoming.length} incoming, ${outgoing.length} outgoing`);
    this.emitStatus();
    return this.getStatus();
  }

  /**
   * Stop syncing but keep the workspace and its manifest, so hosting or joining
   * again later only moves what genuinely changed in the meantime.
   */
  stop() {
    if (this.state === 'stopped' || this.state === 'idle') return this.getStatus();
    this.persistState();
    this.#teardownTransport();
    this.state = 'stopped';
    this.#activity('info', '', 0, 'Sync stopped');
    this.emitStatus();
    return this.getStatus();
  }

  /** Full teardown: used when switching folders or quitting. */
  close({ keepFolder = true } = {}) {
    if (this.rootPath) this.persistState();
    this.#teardownTransport();
    this.state = 'idle';
    if (!keepFolder) {
      this.rootPath = null;
      this.mode = null;
      this.manifest = null;
      this.matcher = null;
    }
  }

  #teardownTransport() {
    for (const timer of this.debounceTimers.values()) clearTimeout(timer);
    this.debounceTimers.clear();
    for (const pending of this.pendingUnlinks.values()) clearTimeout(pending.timer);
    this.pendingUnlinks.clear();
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    this.links.clear();
    this.assembler.clear();
    this.outbound.clear();
    this.inbound.clear();
    this.peerPaused = false;
    this.peerPresence.clear();
    this.emit('presence', []);
  }

  persistState() {
    if (!this.rootPath || !this.manifest) return;
    this.stateStore.setSnapshot(this.rootPath, this.manifest.toObject());
  }

  // ------------------------------------------------------------------- status

  getStatus() {
    return {
      mode: this.mode,
      state: this.state,
      rootPath: this.rootPath,
      peerCount: this.links.size,
      peers: Array.from(this.links.values()).map((link) => ({ id: link.id, name: link.name })),
      peerPaused: this.peerPaused,
      queued: { outbound: this.outbound.size, inbound: this.inbound.size },
      stats: { ...this.stats, throughput: this.#throughput() },
      ignorePatterns: this.matcher ? this.matcher.patterns : []
    };
  }

  emitStatus() {
    this.emit('status', this.getStatus());
  }

  #throughput() {
    const cutoff = Date.now() - THROUGHPUT_WINDOW_MS;
    this.throughputSamples = this.throughputSamples.filter((s) => s.ts >= cutoff);
    const bytes = this.throughputSamples.reduce((sum, s) => sum + s.bytes, 0);
    return Math.round((bytes / THROUGHPUT_WINDOW_MS) * 1000);
  }

  #activity(op, relPath, bytes = 0, message = '') {
    this.emit('activity', { ts: Date.now(), op, path: relPath, bytes, message });
  }

  #record(direction, bytes) {
    if (direction === 'in') {
      this.stats.bytesIn += bytes;
      this.stats.filesIn += 1;
    } else {
      this.stats.bytesOut += bytes;
      this.stats.filesOut += 1;
    }
    this.stats.lastSyncAt = Date.now();
    this.throughputSamples.push({ ts: Date.now(), bytes });
  }

  // ----------------------------------------------------------------- pathing

  /**
   * Resolve a peer-supplied relative path inside the workspace, or null if it
   * tries to escape. Every write in this file goes through here.
   */
  resolve(relPath) {
    if (!this.rootPath || typeof relPath !== 'string' || relPath.includes('\0')) return null;
    const root = path.resolve(this.rootPath);
    const cleaned = relPath.replace(/^[/\\]+/, '');
    const resolved = path.resolve(root, cleaned);
    if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) return null;
    return resolved;
  }

  readFileForTransfer(relPath) {
    const absolute = this.resolve(relPath);
    if (!absolute || !fs.existsSync(absolute)) return null;
    const stat = fs.statSync(absolute);
    if (stat.isDirectory()) return null;
    const buffer = fs.readFileSync(absolute);
    return { buffer, hash: hashBuffer(buffer), size: stat.size, mtimeMs: stat.mtimeMs };
  }

  // -------------------------------------------------------------------- links

  /**
   * Register a peer. `emit` is how we talk to it; the caller wires the peer's
   * incoming events into `handleRemote`.
   */
  addLink({ id, name, emit }) {
    this.links.set(id, { id, name: name || id, emit });
    this.emitStatus();
    if (this.state === 'paused') {
      try { emit(EV.PAUSED, { paused: true }); } catch { /* peer already gone */ }
    }
    return id;
  }

  removeLink(id) {
    this.links.delete(id);
    if (this.peerPresence.delete(id)) this.emit('presence', this.getPresence());
    this.emitStatus();
  }

  #broadcast(event, payload, exceptId = null) {
    for (const link of this.links.values()) {
      if (exceptId && link.id === exceptId) continue;
      try {
        link.emit(event, payload);
      } catch (error) {
        console.error(`HawCode could not reach peer ${link.id}:`, error.message);
      }
    }
  }

  #emitTo(linkId, event, payload) {
    const link = this.links.get(linkId);
    if (!link) return;
    try {
      link.emit(event, payload);
    } catch (error) {
      console.error(`HawCode could not reach peer ${linkId}:`, error.message);
    }
  }

  // ------------------------------------------------------------ local watcher

  #startWatcher() {
    this.watcher = chokidar.watch(this.rootPath, {
      ignored: (absolutePath) => this.matcher.chokidarIgnored(absolutePath),
      persistent: true,
      ignoreInitial: true,
      // Never ship a file that is still being written.
      awaitWriteFinish: { stabilityThreshold: 120, pollInterval: 30 }
    });

    const rel = (absolutePath) => normalize(path.relative(this.rootPath, absolutePath));

    this.watcher
      .on('add', (p) => this.#onLocalFile(rel(p), 'create'))
      .on('change', (p) => this.#onLocalFile(rel(p), 'change'))
      .on('unlink', (p) => this.#onLocalUnlink(rel(p), false))
      .on('addDir', (p) => this.#onLocalMkdir(rel(p)))
      .on('unlinkDir', (p) => this.#onLocalUnlink(rel(p), true))
      .on('ready', () => this.#catchUpAfterStart())
      .on('error', (error) => console.error('HawCode watcher error:', error.message));
  }

  /**
   * chokidar does not report anything that happens before its first scan
   * finishes, so a file saved in the moment after hosting starts would
   * otherwise sit unsynced. Re-walk once the watcher is live and push anything
   * that moved in that window.
   */
  #catchUpAfterStart() {
    if (!this.rootPath || this.state === 'stopped') return;
    const fresh = new Manifest(this.rootPath, this.matcher).build();
    const missed = [];

    for (const [rel, entry] of fresh.entries) {
      const known = this.manifest.get(rel);
      if (entry.isDir) {
        if (!known) {
          this.manifest.set(rel, entry);
          missed.push({ type: 'mkdir', path: rel });
        }
        continue;
      }
      if (!known || known.isDir || known.hash !== entry.hash) {
        this.manifest.set(rel, entry);
        missed.push({ type: 'change', path: rel });
      }
    }

    for (const rel of Array.from(this.manifest.entries.keys())) {
      if (!fresh.entries.has(rel)) {
        this.manifest.delete(rel);
        missed.push({ type: 'delete', path: rel });
      }
    }

    this.emit('watcher-ready');
    if (!missed.length) return;
    for (const op of missed) this.#queueOrSend(op);
    this.emit('tree-changed');
  }

  #debounce(key, fn) {
    const existing = this.debounceTimers.get(key);
    if (existing) clearTimeout(existing);
    this.debounceTimers.set(key, setTimeout(() => {
      this.debounceTimers.delete(key);
      fn();
    }, DEBOUNCE_MS));
  }

  #onLocalFile(relPath, kind) {
    if (!relPath || this.matcher.ignoresRelative(relPath)) return;
    this.#debounce(relPath, () => {
      const entry = this.manifest.readEntry(relPath);
      if (!entry || entry.isDir) return;

      // The hash already on record means this is the echo of a write we made
      // ourselves while applying a peer's change. No timers, no guessing.
      const known = this.manifest.get(relPath);
      if (known && !known.isDir && known.hash === entry.hash) return;

      this.manifest.set(relPath, entry);

      // A create that matches a just-deleted path of identical content is a
      // rename, and travels as one operation instead of delete + re-upload.
      if (kind === 'create') {
        for (const [oldPath, pending] of this.pendingUnlinks) {
          if (pending.entry && pending.entry.hash === entry.hash && pending.entry.size === entry.size) {
            clearTimeout(pending.timer);
            this.pendingUnlinks.delete(oldPath);
            this.manifest.delete(oldPath);
            this.#queueOrSend({ type: 'rename', from: oldPath, to: relPath });
            this.emit('tree-changed');
            return;
          }
        }
      }

      this.#queueOrSend({ type: kind === 'create' ? 'create' : 'change', path: relPath });
      // Something outside HawCode rewrote this file — another editor, a build,
      // a git checkout. An editor holding the old text would write it straight
      // back over the change on the next keystroke, so say so. Our own writes
      // never reach here: they update the manifest first and are dropped by the
      // hash check above.
      this.emit('local-file-changed', { path: relPath, hash: entry.hash });
      if (kind === 'create') this.emit('tree-changed');
    });
  }

  #onLocalMkdir(relPath) {
    if (!relPath || this.matcher.ignoresRelative(relPath)) return;
    if (this.manifest.get(relPath)) return;
    this.manifest.set(relPath, { isDir: true, size: 0, mtimeMs: Date.now(), hash: '' });
    this.#queueOrSend({ type: 'mkdir', path: relPath });
    this.emit('tree-changed');
  }

  #onLocalUnlink(relPath, isDir) {
    if (!relPath || this.matcher.ignoresRelative(relPath)) return;
    const previous = this.manifest.get(relPath);
    if (!previous) return;

    // Hold a file delete briefly: if matching content reappears elsewhere in
    // that window it was a rename, and #onLocalFile will claim this entry.
    if (!isDir) {
      const timer = setTimeout(() => {
        this.pendingUnlinks.delete(relPath);
        this.manifest.delete(relPath);
        this.#queueOrSend({ type: 'delete', path: relPath });
        this.emit('tree-changed');
      }, RENAME_WINDOW_MS);
      this.pendingUnlinks.set(relPath, { entry: previous, timer });
      return;
    }

    this.manifest.delete(relPath);
    this.#queueOrSend({ type: 'delete', path: relPath });
    this.emit('tree-changed');
  }

  #queueOrSend(op) {
    if (this.state !== 'running') {
      if (this.state === 'paused') {
        this.outbound.push(op.type === 'rename' ? op.to : op.path, op);
        this.emitStatus();
      }
      return;
    }
    this.#sendLocalOp(op);
  }

  #sendLocalOp(op) {
    if (!this.links.size) {
      // Nobody to tell, but keep the record straight for the next reconcile.
      if (op.type === 'change' || op.type === 'create') {
        const entry = this.manifest.get(op.path);
        if (entry) this.syncedHashes.set(op.path, entry.hash);
      }
      return;
    }

    switch (op.type) {
      case 'delete':
        this.#broadcast(EV.DELETE, { path: op.path });
        this.syncedHashes.delete(op.path);
        this.#activity('delete-out', op.path);
        break;
      case 'mkdir':
        this.#broadcast(EV.MKDIR, { path: op.path });
        this.#activity('mkdir-out', op.path);
        break;
      case 'rename':
        this.#broadcast(EV.RENAME, { from: op.from, to: op.to });
        this.syncedHashes.delete(op.from);
        this.#activity('rename-out', `${op.from} → ${op.to}`);
        break;
      default:
        this.#announceFile(op.path);
    }
    this.stats.lastSyncAt = Date.now();
    this.emitStatus();
  }

  /**
   * Tell peers a file changed. Small files carry their content along so the
   * common case (source files) completes in a single message; larger ones
   * announce only the hash and wait to be asked.
   */
  #announceFile(relPath, targetLinkId = null) {
    const file = this.readFileForTransfer(relPath);
    if (!file) return;
    const meta = {
      path: relPath,
      hash: file.hash,
      size: file.size,
      mtimeMs: file.mtimeMs,
      isText: isTextFile(relPath, file.buffer)
    };

    if (file.size <= SMALL_FILE_LIMIT) {
      const payload = { ...meta, bytes: file.buffer };
      if (targetLinkId) this.#emitTo(targetLinkId, EV.CHANGE, payload);
      else this.#broadcast(EV.CHANGE, payload);
      this.syncedHashes.set(relPath, file.hash);
      this.#record('out', file.size);
      this.#activity('send', relPath, file.size);
      return;
    }

    if (targetLinkId) this.#sendFileTo(targetLinkId, relPath);
    else if (this.links.size) this.#broadcast(EV.CHANGE, meta);
  }

  /** Push a file's bytes to one peer, chunking anything large. */
  #sendFileTo(linkId, relPath) {
    const file = this.readFileForTransfer(relPath);
    if (!file) return;
    const meta = {
      path: relPath,
      hash: file.hash,
      size: file.size,
      mtimeMs: file.mtimeMs,
      isText: isTextFile(relPath, file.buffer)
    };

    if (file.size <= INLINE_LIMIT) {
      this.#emitTo(linkId, EV.FILE, { ...meta, bytes: file.buffer });
    } else {
      const transferId = crypto.randomUUID();
      const chunks = buildChunks(relPath, file.buffer, transferId);
      for (const chunk of chunks) this.#emitTo(linkId, EV.CHUNK, chunk);
      this.#emitTo(linkId, EV.CHUNK_DONE, { ...meta, transferId });
    }

    this.syncedHashes.set(relPath, file.hash);
    this.#record('out', file.size);
    this.#activity('send', relPath, file.size);
    this.emitStatus();
  }

  // --------------------------------------------------------- remote handling

  /** Entry point for every event arriving from a peer. */
  async handleRemote(linkId, event, payload) {
    if (!this.rootPath || this.state === 'stopped') return;
    try {
      switch (event) {
        case EV.PAUSED:
          this.peerPaused = Boolean(payload && payload.paused);
          this.emitStatus();
          return;
        case EV.PRESENCE:
          this.#onRemotePresence(linkId, payload);
          return;
        case EV.MANIFEST_REQUEST:
          this.#emitTo(linkId, EV.MANIFEST, { entries: this.manifest.toObject() });
          return;
        case EV.MANIFEST:
          await this.#onRemoteManifest(linkId, payload);
          return;
        case EV.NEED:
          for (const rel of payload.paths || []) this.#sendFileTo(linkId, rel);
          return;
        case EV.CHANGE:
          await this.#onRemoteChange(linkId, payload);
          return;
        case EV.FILE:
          await this.#onRemoteFile(linkId, payload);
          return;
        case EV.CHUNK:
          this.#onRemoteChunk(linkId, payload);
          return;
        case EV.CHUNK_DONE:
          await this.#onRemoteChunkDone(linkId, payload);
          return;
        case EV.DELETE:
          await this.#guard({ type: 'delete', path: payload.path }, linkId);
          return;
        case EV.MKDIR:
          await this.#guard({ type: 'mkdir', path: payload.path }, linkId);
          return;
        case EV.RENAME:
          await this.#guard({ type: 'rename', from: payload.from, to: payload.to }, linkId);
          return;
        default:
      }
    } catch (error) {
      console.error(`HawCode failed handling ${event}:`, error.message);
      this.#activity('error', (payload && payload.path) || '', 0, error.message);
    }
  }

  /** Route an inbound op through the pause queue when we are not running. */
  async #guard(op, linkId) {
    if (this.state === 'paused') {
      this.inbound.push(op.type === 'rename' ? op.to : op.path, op);
      this.emitStatus();
      return;
    }
    await this.#applyRemoteOp(op, linkId);
  }

  async #applyRemoteOp(op, linkId) {
    switch (op.type) {
      case 'delete':
        this.#applyDelete(op.path);
        break;
      case 'mkdir':
        this.#applyMkdir(op.path);
        break;
      case 'rename':
        this.#applyRename(op.from, op.to);
        break;
      case 'write':
        this.#applyFileBytes(op.path, op.bytes, op.hash, op.mtimeMs);
        break;
      case 'fetch':
        if (linkId) this.#emitTo(linkId, EV.NEED, { paths: [op.path] });
        break;
      default:
    }
  }

  async #onRemoteChange(linkId, payload) {
    if (!payload || !payload.path) return;
    const rel = normalize(payload.path);
    if (this.matcher.ignoresRelative(rel)) return;

    // We already have exactly these bytes.
    if (this.manifest.matchesHash(rel, payload.hash)) {
      this.syncedHashes.set(rel, payload.hash);
      return;
    }

    if (payload.bytes) {
      await this.#guard(
        { type: 'write', path: rel, bytes: payload.bytes, hash: payload.hash, mtimeMs: payload.mtimeMs },
        linkId
      );
      return;
    }

    // Announcement only — ask for the content we are missing.
    await this.#guard({ type: 'fetch', path: rel }, linkId);
  }

  async #onRemoteFile(linkId, payload) {
    if (!payload || !payload.path || !payload.bytes) return;
    const rel = normalize(payload.path);
    if (this.matcher.ignoresRelative(rel)) return;
    await this.#guard(
      { type: 'write', path: rel, bytes: payload.bytes, hash: payload.hash, mtimeMs: payload.mtimeMs },
      linkId
    );
  }

  #onRemoteChunk(linkId, payload) {
    if (!payload || !payload.transferId) return;
    const result = this.assembler.accept(payload);
    this.emit('progress', {
      path: result.path,
      received: result.received,
      total: result.total,
      bytes: result.bytes,
      done: result.done
    });
    if (result.done) {
      // Park the assembled buffer until CHUNK_DONE confirms the hash.
      this.#pendingAssembled.set(payload.transferId, result.buffer);
    }
  }

  async #onRemoteChunkDone(linkId, payload) {
    if (!payload || !payload.transferId) return;
    const buffer = this.#pendingAssembled.get(payload.transferId);
    if (!buffer) return;
    this.#pendingAssembled.delete(payload.transferId);

    const rel = normalize(payload.path);
    // A mismatch means chunks were lost or reordered; ask for the file again
    // rather than writing corrupt bytes.
    if (hashBuffer(buffer) !== payload.hash) {
      this.#activity('error', rel, 0, 'Chunked transfer failed its hash check — re-requesting');
      this.#emitTo(linkId, EV.NEED, { paths: [rel] });
      return;
    }
    await this.#guard(
      { type: 'write', path: rel, bytes: buffer, hash: payload.hash, mtimeMs: payload.mtimeMs },
      linkId
    );
  }

  // ------------------------------------------------------------ disk writers

  /**
   * Write a peer's bytes. If we hold unsent local changes to the same path, the
   * local version is preserved as a `.conflict-` sibling first, so no work is
   * ever silently lost.
   */
  #applyFileBytes(relPath, rawBytes, hash, mtimeMs) {
    const absolute = this.resolve(relPath);
    if (!absolute) return;
    const buffer = Buffer.isBuffer(rawBytes) ? rawBytes : Buffer.from(rawBytes);
    const effectiveHash = hash || hashBuffer(buffer);

    if (this.manifest.matchesHash(relPath, effectiveHash)) return;

    const local = this.manifest.get(relPath);
    const lastAgreed = this.syncedHashes.get(relPath);
    if (local && !local.isDir && local.hash !== effectiveHash && lastAgreed !== local.hash) {
      this.#backupConflict(relPath, local);
    }

    writeFileAtomic(absolute, buffer, mtimeMs);
    // Record the hash before the watcher sees the write, so the resulting event
    // is recognised as ours and never echoed back to the peer.
    this.manifest.set(relPath, {
      isDir: false,
      size: buffer.length,
      mtimeMs: mtimeMs || Date.now(),
      hash: effectiveHash
    });
    this.syncedHashes.set(relPath, effectiveHash);
    this.#record('in', buffer.length);
    this.#activity('receive', relPath, buffer.length);
    this.emit('file-written', { path: relPath, hash: effectiveHash });
    this.emit('tree-changed');
    this.emitStatus();
  }

  #backupConflict(relPath, localEntry) {
    try {
      const source = this.resolve(relPath);
      const backupRel = conflictPathFor(relPath, os.hostname());
      const backupAbs = this.resolve(backupRel);
      if (!source || !backupAbs || !fs.existsSync(source)) return;
      fs.copyFileSync(source, backupAbs);
      this.#activity('conflict', backupRel, localEntry.size,
        `Both sides edited ${relPath}; your version was kept as ${backupRel}`);
      this.emit('tree-changed');
    } catch (error) {
      console.error('HawCode could not write a conflict backup:', error.message);
    }
  }

  #applyDelete(relPath) {
    const absolute = this.resolve(relPath);
    if (!absolute || !fs.existsSync(absolute)) {
      this.manifest.delete(relPath);
      return;
    }
    try {
      const stat = fs.statSync(absolute);
      if (stat.isDirectory()) fs.rmSync(absolute, { recursive: true, force: true });
      else fs.unlinkSync(absolute);
      this.manifest.delete(relPath);
      this.syncedHashes.delete(relPath);
      this.#activity('delete-in', relPath);
      this.emit('tree-changed');
      this.emitStatus();
    } catch (error) {
      console.error(`HawCode could not delete ${relPath}:`, error.message);
    }
  }

  #applyMkdir(relPath) {
    const absolute = this.resolve(relPath);
    if (!absolute) return;
    ensureDir(absolute);
    this.manifest.set(relPath, { isDir: true, size: 0, mtimeMs: Date.now(), hash: '' });
    this.#activity('mkdir-in', relPath);
    this.emit('tree-changed');
  }

  #applyRename(fromRel, toRel) {
    const from = this.resolve(fromRel);
    const to = this.resolve(toRel);
    if (!from || !to) return;
    try {
      if (!fs.existsSync(from)) {
        // The source never arrived here; treat it as a new file instead.
        return;
      }
      ensureDir(path.dirname(to));
      fs.renameSync(from, to);
      const entry = this.manifest.get(fromRel);
      this.manifest.delete(fromRel);
      if (entry) this.manifest.set(toRel, entry);
      const agreed = this.syncedHashes.get(fromRel);
      this.syncedHashes.delete(fromRel);
      if (agreed) this.syncedHashes.set(toRel, agreed);
      this.#activity('rename-in', `${fromRel} → ${toRel}`);
      this.emit('tree-changed');
    } catch (error) {
      console.error(`HawCode could not rename ${fromRel}:`, error.message);
    }
  }

  // ------------------------------------------------------------ reconciliation

  /** Ask a peer for its manifest so we can diff against ours. */
  requestReconcile(linkId) {
    this.#emitTo(linkId, EV.MANIFEST_REQUEST, {});
  }

  async #onRemoteManifest(linkId, payload) {
    if (!payload || !payload.entries) return;
    const local = this.manifest.toObject();
    const lastSynced = {};
    for (const [rel, hash] of this.syncedHashes) {
      lastSynced[rel] = { isDir: false, hash, size: 0, mtimeMs: 0 };
    }

    const plan = reconcile(local, payload.entries, lastSynced);
    const moves = plan.pull.length + plan.push.length + plan.deleteLocal.length +
      plan.deleteRemote.length + plan.mkdirLocal.length + plan.mkdirRemote.length;

    if (moves === 0) {
      this.#activity('info', '', 0, 'Already in sync with peer — nothing to transfer');
      this.emitStatus();
      return;
    }
    this.#activity('info', '', 0,
      `Reconciling with peer: ${plan.pull.length} in, ${plan.push.length} out, ` +
      `${plan.deleteLocal.length + plan.deleteRemote.length} removed`);

    for (const rel of plan.mkdirLocal) this.#applyMkdir(rel);
    for (const rel of plan.mkdirRemote) this.#emitTo(linkId, EV.MKDIR, { path: rel });
    if (plan.pull.length) this.#emitTo(linkId, EV.NEED, { paths: plan.pull });
    for (const rel of plan.push) this.#sendFileTo(linkId, rel);
    for (const rel of plan.deleteLocal) this.#applyDelete(rel);
    for (const rel of plan.deleteRemote) this.#emitTo(linkId, EV.DELETE, { path: rel });

    this.emit('tree-changed');
    this.emitStatus();
  }

  // ---------------------------------------------------------------- tree/IO

  getTree() {
    return this.manifest ? this.manifest.toTree() : [];
  }

  /** Read a file for the editor. Binary content is reported, not mangled. */
  readForEditor(relPath) {
    const file = this.readFileForTransfer(relPath);
    if (!file) return { error: 'File not found' };
    if (!isTextFile(relPath, file.buffer)) {
      return { binary: true, size: file.size, path: relPath };
    }
    return { content: file.buffer.toString('utf-8'), size: file.size, path: relPath };
  }

  /** Apply an edit made in HawCode's own editor. */
  writeFromEditor(relPath, content) {
    const absolute = this.resolve(relPath);
    if (absolute === null) return { error: 'Invalid path' };
    // Never let text from the editor land on top of a binary file — that would
    // destroy it. The UI shows a placeholder instead, but a stale client or a
    // direct API call must be refused too.
    const existing = this.readFileForTransfer(relPath);
    if (existing && !isTextFile(relPath, existing.buffer)) {
      return { error: 'This is a binary file and cannot be edited as text' };
    }
    const buffer = Buffer.from(content, 'utf-8');
    writeFileAtomic(absolute, buffer);
    const entry = this.manifest.readEntry(relPath);
    if (entry) this.manifest.set(relPath, entry);
    this.#queueOrSend({ type: 'change', path: relPath });
    return { ok: true };
  }

  createFile(relPath) {
    const absolute = this.resolve(relPath);
    if (!absolute) return { error: 'Invalid path' };
    if (fs.existsSync(absolute)) return { error: 'That file already exists' };
    writeFileAtomic(absolute, Buffer.alloc(0));
    const entry = this.manifest.readEntry(relPath);
    if (entry) this.manifest.set(relPath, entry);
    this.#queueOrSend({ type: 'create', path: relPath });
    this.emit('tree-changed');
    return { ok: true };
  }

  createDir(relPath) {
    const absolute = this.resolve(relPath);
    if (!absolute) return { error: 'Invalid path' };
    ensureDir(absolute);
    this.manifest.set(relPath, { isDir: true, size: 0, mtimeMs: Date.now(), hash: '' });
    this.#queueOrSend({ type: 'mkdir', path: relPath });
    this.emit('tree-changed');
    return { ok: true };
  }

  deleteItem(relPath) {
    const absolute = this.resolve(relPath);
    if (!absolute) return { error: 'Invalid path' };
    try {
      if (fs.existsSync(absolute)) {
        const stat = fs.statSync(absolute);
        if (stat.isDirectory()) fs.rmSync(absolute, { recursive: true, force: true });
        else fs.unlinkSync(absolute);
      }
      this.manifest.delete(relPath);
      this.#queueOrSend({ type: 'delete', path: relPath });
      this.emit('tree-changed');
      return { ok: true };
    } catch (error) {
      return { error: error.message };
    }
  }

  /**
   * Rename in one operation rather than delete-then-create, so peers move the
   * file instead of re-transferring its contents.
   */
  renameItem(fromRel, toRel) {
    const from = this.resolve(fromRel);
    const to = this.resolve(toRel);
    if (!from || !to) return { error: 'Invalid path' };
    if (!fs.existsSync(from)) return { error: 'That item no longer exists' };
    if (fs.existsSync(to)) return { error: 'Something with that name already exists' };
    try {
      ensureDir(path.dirname(to));
      fs.renameSync(from, to);

      const entry = this.manifest.get(fromRel);
      // A directory carries everything recorded beneath it.
      if (entry && entry.isDir) {
        const prefix = `${normalize(fromRel)}/`;
        for (const key of Array.from(this.manifest.entries.keys())) {
          if (!key.startsWith(prefix)) continue;
          const moved = `${normalize(toRel)}/${key.slice(prefix.length)}`;
          this.manifest.set(moved, this.manifest.get(key));
        }
      }
      this.manifest.delete(fromRel);
      if (entry) this.manifest.set(toRel, entry);

      this.#queueOrSend({ type: 'rename', from: normalize(fromRel), to: normalize(toRel) });
      this.emit('tree-changed');
      return { ok: true, path: normalize(toRel) };
    } catch (error) {
      return { error: error.message };
    }
  }

  /** Copy a file beside itself, picking a free "name copy.ext" style name. */
  duplicateItem(relPath) {
    const source = this.resolve(relPath);
    if (!source || !fs.existsSync(source)) return { error: 'That item no longer exists' };
    if (fs.statSync(source).isDirectory()) {
      return { error: 'Only files can be duplicated' };
    }

    const normalized = normalize(relPath);
    const dir = path.posix.dirname(normalized);
    const base = path.posix.basename(normalized);
    const ext = path.extname(base);
    const stem = ext ? base.slice(0, -ext.length) : base;

    let candidate = null;
    for (let n = 1; n < 100; n += 1) {
      const name = n === 1 ? `${stem} copy${ext}` : `${stem} copy ${n}${ext}`;
      const rel = dir === '.' ? name : `${dir}/${name}`;
      if (!fs.existsSync(this.resolve(rel))) {
        candidate = rel;
        break;
      }
    }
    if (!candidate) return { error: 'Too many copies of that file already' };

    try {
      fs.copyFileSync(source, this.resolve(candidate));
      const entry = this.manifest.readEntry(candidate);
      if (entry) this.manifest.set(candidate, entry);
      this.#queueOrSend({ type: 'create', path: candidate });
      this.emit('tree-changed');
      return { ok: true, path: candidate };
    } catch (error) {
      return { error: error.message };
    }
  }

  // ----------------------------------------------------------------- presence

  /** Tell peers which file this computer is looking at. */
  broadcastPresence({ name, path: relPath, line, column }) {
    if (!this.links.size) return;
    this.#broadcast(EV.PRESENCE, {
      name: name || os.hostname(),
      path: relPath || null,
      line: line || 1,
      column: column || 1,
      at: Date.now()
    });
  }

  #onRemotePresence(linkId, payload) {
    if (!payload) return;
    const link = this.links.get(linkId);
    this.peerPresence.set(linkId, {
      peerId: linkId,
      name: payload.name || (link ? link.name : 'peer'),
      path: payload.path || null,
      line: payload.line || 1,
      column: payload.column || 1,
      at: payload.at || Date.now()
    });
    this.emit('presence', this.getPresence());
  }

  getPresence() {
    return Array.from(this.peerPresence.values());
  }
}

module.exports = { SyncEngine, EV, SMALL_FILE_LIMIT };
