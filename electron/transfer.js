'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Files at or under this size go over the wire in a single message. Anything
// larger is chunked so one big file cannot stall the socket or freeze the UI.
const INLINE_LIMIT = 1024 * 1024;
const CHUNK_SIZE = 256 * 1024;
const PART_SUFFIX = '.hawpart';

const TEXT_EXTENSIONS = new Set([
  'txt', 'md', 'markdown', 'js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'json', 'jsonc',
  'html', 'htm', 'css', 'scss', 'sass', 'less', 'xml', 'svg', 'yml', 'yaml', 'toml',
  'ini', 'cfg', 'conf', 'env', 'py', 'rb', 'php', 'java', 'kt', 'c', 'h', 'cpp',
  'hpp', 'cs', 'go', 'rs', 'swift', 'sh', 'bash', 'zsh', 'ps1', 'bat', 'cmd',
  'sql', 'graphql', 'gql', 'vue', 'svelte', 'lua', 'r', 'pl', 'dart', 'gitignore',
  'hawignore', 'editorconfig', 'lock', 'log', 'csv', 'tsv'
]);

const BINARY_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'tif', 'tiff', 'avif', 'heic',
  'pdf', 'zip', 'gz', 'tgz', 'bz2', 'xz', 'tar', 'rar', '7z',
  'exe', 'dll', 'so', 'dylib', 'bin', 'dat', 'msi', 'app', 'deb', 'rpm', 'dmg',
  'mp3', 'wav', 'flac', 'ogg', 'aac', 'm4a', 'mp4', 'mkv', 'avi', 'mov', 'wmv', 'webm',
  'woff', 'woff2', 'ttf', 'otf', 'eot',
  'class', 'jar', 'wasm', 'pyc', 'o', 'a', 'lib', 'obj',
  'db', 'sqlite', 'sqlite3', 'mdb',
  'psd', 'ai', 'sketch', 'fig', 'blend',
  'docx', 'xlsx', 'pptx', 'doc', 'xls', 'ppt', 'odt', 'ods', 'odp'
]);

function hashBuffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function hashFile(filePath) {
  return hashBuffer(fs.readFileSync(filePath));
}

/**
 * Decide whether the renderer can open this in Monaco. Extension first, then a
 * null-byte sniff of the first 8 KB for files with no or an unknown extension.
 */
function isTextFile(relPath, buffer) {
  const ext = path.extname(relPath).slice(1).toLowerCase();
  // Known binary formats are never opened as text, whatever their bytes happen
  // to look like — a run of printable-looking bytes in a PNG must not tempt the
  // editor into showing it, because saving from there would destroy the file.
  if (ext && BINARY_EXTENSIONS.has(ext)) return false;
  if (ext && TEXT_EXTENSIONS.has(ext)) return true;
  if (!buffer) return false;
  const sample = buffer.subarray(0, 8192);
  if (sample.length === 0) return true;
  if (sample.includes(0)) return false;
  // Control codes other than tab, newline and carriage return do not appear in
  // text; a meaningful share of them means this is binary.
  let suspicious = 0;
  for (const byte of sample) {
    const isAllowedControl = byte === 9 || byte === 10 || byte === 13;
    if (byte < 32 && !isAllowedControl) suspicious += 1;
  }
  return suspicious / sample.length < 0.05;
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}

/**
 * Write bytes through a temp file and rename into place. The rename is atomic
 * on both NTFS and ext4, so a peer reading the folder never sees a half-written
 * file, and our own watcher fires exactly once.
 */
function writeFileAtomic(filePath, buffer, mtimeMs) {
  ensureDir(path.dirname(filePath));
  const tmp = `${filePath}.${process.pid}.${Date.now()}${PART_SUFFIX}`;
  fs.writeFileSync(tmp, buffer);
  fs.renameSync(tmp, filePath);
  if (typeof mtimeMs === 'number' && Number.isFinite(mtimeMs)) {
    try {
      const time = new Date(mtimeMs);
      fs.utimesSync(filePath, time, time);
    } catch {
      // Preserving mtime is best-effort; a failure here only affects which side
      // wins a future conflict comparison, not correctness of the bytes.
    }
  }
}

function timestampSlug(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

/**
 * Build the sibling path a losing version is preserved at, e.g.
 * `notes.md` -> `notes.conflict-DESKTOP-01-20260923-141233.md`.
 */
function conflictPathFor(relPath, peerName, date) {
  const dir = path.posix.dirname(relPath.replace(/\\/g, '/'));
  const base = path.posix.basename(relPath.replace(/\\/g, '/'));
  const ext = path.extname(base);
  const stem = ext ? base.slice(0, -ext.length) : base;
  const safePeer = String(peerName || 'peer').replace(/[^A-Za-z0-9_-]/g, '-');
  const name = `${stem}.conflict-${safePeer}-${timestampSlug(date)}${ext}`;
  return dir === '.' ? name : `${dir}/${name}`;
}

/**
 * Split a buffer into the chunk payloads for one transfer. Returned objects are
 * emitted as-is; `bytes` stays a Buffer so Socket.IO sends it as binary rather
 * than inflating it through base64.
 */
function buildChunks(relPath, buffer, transferId) {
  const total = Math.max(1, Math.ceil(buffer.length / CHUNK_SIZE));
  const chunks = [];
  for (let seq = 0; seq < total; seq += 1) {
    const start = seq * CHUNK_SIZE;
    chunks.push({
      transferId,
      path: relPath,
      seq,
      total,
      bytes: buffer.subarray(start, start + CHUNK_SIZE)
    });
  }
  return chunks;
}

/**
 * Reassembles chunked transfers. Parts are buffered in memory keyed by
 * transferId and only touch disk once every chunk has arrived, so an aborted
 * transfer leaves nothing behind.
 */
function createChunkAssembler() {
  const pending = new Map();

  function accept(chunk) {
    const key = chunk.transferId;
    let entry = pending.get(key);
    if (!entry) {
      entry = { path: chunk.path, total: chunk.total, parts: new Map(), bytes: 0 };
      pending.set(key, entry);
    }
    if (!entry.parts.has(chunk.seq)) {
      const buf = Buffer.isBuffer(chunk.bytes) ? chunk.bytes : Buffer.from(chunk.bytes);
      entry.parts.set(chunk.seq, buf);
      entry.bytes += buf.length;
    }
    const received = entry.parts.size;
    if (received < entry.total) {
      return { done: false, path: entry.path, received, total: entry.total, bytes: entry.bytes };
    }
    const ordered = [];
    for (let i = 0; i < entry.total; i += 1) ordered.push(entry.parts.get(i));
    pending.delete(key);
    return {
      done: true,
      path: entry.path,
      received,
      total: entry.total,
      bytes: entry.bytes,
      buffer: Buffer.concat(ordered)
    };
  }

  function abort(transferId) {
    pending.delete(transferId);
  }

  function clear() {
    pending.clear();
  }

  return { accept, abort, clear, get size() { return pending.size; } };
}

module.exports = {
  INLINE_LIMIT,
  CHUNK_SIZE,
  PART_SUFFIX,
  hashBuffer,
  hashFile,
  isTextFile,
  ensureDir,
  writeFileAtomic,
  conflictPathFor,
  timestampSlug,
  buildChunks,
  createChunkAssembler
};
