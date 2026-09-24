'use strict';

const fs = require('fs');
const path = require('path');

// Patterns that are always ignored, whatever .hawignore says. These are either
// noise (build output, VCS metadata) or HawCode's own scratch files, which would
// otherwise bounce between peers forever.
const DEFAULT_PATTERNS = [
  'node_modules',
  '.git',
  '.svn',
  '.hg',
  'dist',
  'dist-ssr',
  '.idea',
  '.vscode',
  '*.log',
  '.DS_Store',
  'Thumbs.db',
  '*.hawpart',
  '*.conflict-*',
  '.hawcode'
];

const IGNORE_FILE = '.hawignore';

function escapeRegex(str) {
  return str.replace(/[.+^${}()|[\]\\]/g, '\\$&');
}

// Translate one gitignore-style pattern into a RegExp tested against a POSIX
// relative path. Supports `*`, `?`, `**`, a leading `/` to anchor at the root,
// a trailing `/` to match directories only, and a leading `!` for negation
// (handled by the caller).
function patternToRegex(pattern) {
  let body = pattern;
  const anchored = body.startsWith('/');
  if (anchored) body = body.slice(1);
  if (body.endsWith('/')) body = body.slice(0, -1);
  if (!body) return null;

  let out = '';
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (ch === '*') {
      if (body[i + 1] === '*') {
        // `**/` spans any number of directories, including none.
        if (body[i + 2] === '/') {
          out += '(?:.*/)?';
          i += 2;
        } else {
          out += '.*';
          i += 1;
        }
      } else {
        out += '[^/]*';
      }
    } else if (ch === '?') {
      out += '[^/]';
    } else if (ch === '/') {
      out += '/';
    } else {
      out += escapeRegex(ch);
    }
  }

  // An unanchored pattern matches at any depth, the way gitignore behaves.
  const prefix = anchored || body.includes('/') ? '^' : '^(?:.*/)?';
  // Matching a directory also matches everything beneath it.
  const suffix = '(?:/.*)?$';
  return new RegExp(prefix + out + suffix);
}

function compile(patterns) {
  const rules = [];
  for (const raw of patterns) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const negated = line.startsWith('!');
    const regex = patternToRegex(negated ? line.slice(1) : line);
    if (regex) rules.push({ regex, negated });
  }
  return rules;
}

function readIgnoreFile(rootPath) {
  try {
    const file = path.join(rootPath, IGNORE_FILE);
    if (!fs.existsSync(file)) return [];
    return fs.readFileSync(file, 'utf-8').split(/\r?\n/);
  } catch {
    return [];
  }
}

function toRelative(rootPath, absolutePath) {
  const rel = path.relative(rootPath, absolutePath);
  if (!rel || rel.startsWith('..')) return null;
  return rel.replace(/\\/g, '/');
}

/**
 * Build the single ignore matcher used by the watcher, the manifest builder and
 * the HTTP file tree. Keeping one instance means those three can never disagree
 * about what is shared.
 */
function createMatcher(rootPath) {
  const userPatterns = readIgnoreFile(rootPath);
  const rules = compile([...DEFAULT_PATTERNS, ...userPatterns]);

  // Last matching rule wins, so a `!pattern` later in .hawignore re-includes a
  // path a broader rule excluded.
  function ignoresRelative(relPath) {
    if (!relPath) return false;
    const normalized = relPath.replace(/\\/g, '/').replace(/^\/+/, '');
    if (normalized === IGNORE_FILE) return false;
    let ignored = false;
    for (const rule of rules) {
      if (rule.regex.test(normalized)) ignored = !rule.negated;
    }
    return ignored;
  }

  function ignoresAbsolute(absolutePath) {
    const rel = toRelative(rootPath, absolutePath);
    if (rel === null) return false;
    return ignoresRelative(rel);
  }

  return {
    rootPath,
    patterns: userPatterns.filter((p) => p.trim() && !p.trim().startsWith('#')),
    ignoresRelative,
    ignoresAbsolute,
    // chokidar calls this with absolute paths.
    chokidarIgnored: (absolutePath) => ignoresAbsolute(absolutePath)
  };
}

// `patternToRegex` is also used by the workspace search, so include/exclude
// boxes there accept exactly the same glob syntax as .hawignore.
module.exports = { createMatcher, patternToRegex, DEFAULT_PATTERNS, IGNORE_FILE };
