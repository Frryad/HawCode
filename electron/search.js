'use strict';

const fs = require('fs');
const path = require('path');
const { patternToRegex } = require('./ignore');
const { isTextFile } = require('./transfer');

// Guard rails so a search across a big workspace cannot lock up the window.
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_RESULTS = 2000;
const MAX_FILES = 1000;
const MAX_LINE_LENGTH = 400;

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Build the matcher for the query itself. */
function buildQueryRegex({ query, isRegex, caseSensitive, wholeWord }) {
  let source = isRegex ? query : escapeRegex(query);
  if (wholeWord) source = `\\b(?:${source})\\b`;
  const flags = caseSensitive ? 'g' : 'gi';
  return new RegExp(source, flags);
}

/** Turn a comma-separated glob list into a predicate, or null when empty. */
function buildGlobFilter(patterns) {
  const list = String(patterns || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (!list.length) return null;
  const regexes = list.map((pattern) => patternToRegex(pattern)).filter(Boolean);
  if (!regexes.length) return null;
  return (relPath) => regexes.some((regex) => regex.test(relPath));
}

/**
 * Search every shared text file.
 *
 * Walks `engine.manifest` rather than the disk: the manifest is already in
 * memory, already excludes everything `.hawignore` covers, and already knows
 * each file's size — so this never stats or reads a path it will discard.
 */
function search(engine, options = {}) {
  const query = String(options.query || '');
  if (!query) return { results: [], totalMatches: 0, truncated: false, filesSearched: 0 };
  if (!engine || !engine.manifest || !engine.rootPath) {
    return { error: 'No folder is open' };
  }

  let regex;
  try {
    regex = buildQueryRegex({
      query,
      isRegex: Boolean(options.isRegex),
      caseSensitive: Boolean(options.caseSensitive),
      wholeWord: Boolean(options.wholeWord)
    });
  } catch (error) {
    return { error: `Invalid pattern: ${error.message}` };
  }

  const include = buildGlobFilter(options.include);
  const exclude = buildGlobFilter(options.exclude);

  const results = [];
  let totalMatches = 0;
  let filesSearched = 0;
  let truncated = false;

  for (const [relPath, entry] of engine.manifest.entries) {
    if (entry.isDir) continue;
    if (entry.size > MAX_FILE_BYTES) continue;
    if (include && !include(relPath)) continue;
    if (exclude && exclude(relPath)) continue;
    if (results.length >= MAX_FILES || totalMatches >= MAX_RESULTS) {
      truncated = true;
      break;
    }

    const absolute = engine.resolve(relPath);
    if (!absolute) continue;

    let buffer;
    try {
      buffer = fs.readFileSync(absolute);
    } catch {
      continue;
    }
    if (!isTextFile(relPath, buffer)) continue;

    filesSearched += 1;
    const lines = buffer.toString('utf-8').split(/\r?\n/);
    const matches = [];

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      regex.lastIndex = 0;
      let match = regex.exec(line);
      while (match) {
        matches.push({
          line: index + 1,
          column: match.index + 1,
          length: match[0].length,
          // Long minified lines would bloat the payload; show a window instead.
          preview: line.length > MAX_LINE_LENGTH
            ? `${line.slice(0, MAX_LINE_LENGTH)}…`
            : line
        });
        totalMatches += 1;
        if (totalMatches >= MAX_RESULTS) {
          truncated = true;
          break;
        }
        // A zero-width match (e.g. the regex `a*`) would loop forever.
        if (match.index === regex.lastIndex) regex.lastIndex += 1;
        match = regex.exec(line);
      }
      if (truncated) break;
    }

    if (matches.length) results.push({ path: relPath, matches });
  }

  results.sort((a, b) => a.path.localeCompare(b.path));
  return { results, totalMatches, filesSearched, truncated };
}

/**
 * Replace across the workspace.
 *
 * Each edited file is written through `engine.writeFromEditor`, which updates
 * the manifest and pushes the change to peers — so a replace propagates over
 * the network through the ordinary sync path with no special handling.
 */
function replaceAll(engine, options = {}) {
  const found = search(engine, options);
  if (found.error) return found;

  const replacement = String(options.replacement ?? '');
  const only = Array.isArray(options.paths) && options.paths.length
    ? new Set(options.paths)
    : null;

  let filesChanged = 0;
  let replacements = 0;
  const failures = [];

  for (const result of found.results) {
    if (only && !only.has(result.path)) continue;

    const absolute = engine.resolve(result.path);
    if (!absolute) continue;

    let original;
    try {
      original = fs.readFileSync(absolute, 'utf-8');
    } catch {
      continue;
    }

    // Rebuild the regex per file: it is stateful with the /g flag.
    let regex;
    try {
      regex = buildQueryRegex({
        query: options.query,
        isRegex: Boolean(options.isRegex),
        caseSensitive: Boolean(options.caseSensitive),
        wholeWord: Boolean(options.wholeWord)
      });
    } catch (error) {
      return { error: `Invalid pattern: ${error.message}` };
    }

    // A plain-text replacement must not have $1 and friends interpreted.
    const updated = options.isRegex
      ? original.replace(regex, replacement)
      : original.replace(regex, () => replacement);

    if (updated === original) continue;

    const write = engine.writeFromEditor(result.path, updated);
    if (write && write.error) {
      failures.push({ path: result.path, error: write.error });
      continue;
    }
    filesChanged += 1;
    replacements += result.matches.length;
  }

  return { filesChanged, replacements, failures };
}

/** Fuzzy file finder backing Ctrl+P, also served from the manifest. */
function quickOpen(engine, query, limit = 50) {
  if (!engine || !engine.manifest) return [];
  const needle = String(query || '').toLowerCase();
  const scored = [];

  for (const [relPath, entry] of engine.manifest.entries) {
    if (entry.isDir) continue;
    if (!needle) {
      scored.push({ path: relPath, score: 0, name: path.basename(relPath) });
      continue;
    }
    const score = fuzzyScore(relPath.toLowerCase(), needle);
    if (score !== null) scored.push({ path: relPath, score, name: path.basename(relPath) });
  }

  scored.sort((a, b) => (b.score - a.score) || a.path.localeCompare(b.path));
  return scored.slice(0, limit);
}

/**
 * Subsequence match with a bonus for consecutive characters and for hits in the
 * file name rather than the directory, which is what makes "apjs" find
 * "src/app.js" ahead of "a/p/j/s.txt". Returns null when it does not match.
 */
function fuzzyScore(haystack, needle) {
  let score = 0;
  let position = 0;
  let previous = -1;
  const nameStart = haystack.lastIndexOf('/') + 1;

  for (const char of needle) {
    const index = haystack.indexOf(char, position);
    if (index === -1) return null;
    score += 1;
    if (index === previous + 1) score += 4;
    if (index >= nameStart) score += 3;
    if (index === nameStart) score += 2;
    previous = index;
    position = index + 1;
  }
  // Prefer shorter paths when the match quality is otherwise equal.
  return score - haystack.length * 0.01;
}

module.exports = { search, replaceAll, quickOpen, MAX_RESULTS };
