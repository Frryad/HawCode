'use strict';

const { execFile } = require('child_process');
const path = require('path');

const MAX_BUFFER = 8 * 1024 * 1024;
const TIMEOUT_MS = 30000;

/**
 * A thin wrapper around the git CLI.
 *
 * Every call goes through `execFile` with an argument array and never a shell
 * string, so a branch name or a commit message containing quotes, `&&` or `$()`
 * is passed to git as literal text instead of being interpreted. This matters
 * because these values come from the UI.
 */
function run(cwd, args, { allowFailure = false } = {}) {
  return new Promise((resolve) => {
    execFile('git', args, {
      cwd,
      maxBuffer: MAX_BUFFER,
      timeout: TIMEOUT_MS,
      windowsHide: true
    }, (error, stdout, stderr) => {
      if (error && !allowFailure) {
        resolve({ ok: false, error: (stderr || error.message).trim(), stdout: stdout || '' });
        return;
      }
      resolve({ ok: true, stdout: stdout || '', stderr: stderr || '' });
    });
  });
}

async function isRepo(cwd) {
  if (!cwd) return false;
  const result = await run(cwd, ['rev-parse', '--is-inside-work-tree']);
  return result.ok && result.stdout.trim() === 'true';
}

/** Single-letter porcelain codes, expanded for the UI. */
const STATUS_LABELS = {
  M: 'modified',
  A: 'added',
  D: 'deleted',
  R: 'renamed',
  C: 'copied',
  U: 'conflicted',
  '?': 'untracked',
  '!': 'ignored',
  '.': 'unchanged'
};

/**
 * Current branch plus the staged/unstaged/untracked file lists.
 *
 * Uses porcelain v2, which is explicitly designed to be parsed and — unlike v1
 * — reports the staged and unstaged state of each path as separate columns.
 */
async function status(cwd) {
  if (!await isRepo(cwd)) return { isRepo: false };

  const result = await run(cwd, ['status', '--porcelain=v2', '--branch', '--untracked-files=all']);
  if (!result.ok) return { isRepo: true, error: result.error };

  const info = { isRepo: true, branch: null, upstream: null, ahead: 0, behind: 0, files: [] };

  for (const line of result.stdout.split('\n')) {
    if (!line) continue;

    if (line.startsWith('# branch.head ')) {
      info.branch = line.slice('# branch.head '.length).trim();
      continue;
    }
    if (line.startsWith('# branch.upstream ')) {
      info.upstream = line.slice('# branch.upstream '.length).trim();
      continue;
    }
    if (line.startsWith('# branch.ab ')) {
      const match = line.match(/\+(\d+)\s+-(\d+)/);
      if (match) {
        info.ahead = Number(match[1]);
        info.behind = Number(match[2]);
      }
      continue;
    }
    if (line.startsWith('#')) continue;

    // "1 <XY> ... <path>" ordinary, "2 <XY> ... <path>\t<origPath>" renamed,
    // "u ..." unmerged, "? <path>" untracked.
    if (line.startsWith('? ')) {
      info.files.push({
        path: line.slice(2).trim(),
        staged: false,
        index: '.',
        worktree: '?',
        label: 'untracked'
      });
      continue;
    }

    if (line.startsWith('1 ') || line.startsWith('2 ') || line.startsWith('u ')) {
      const parts = line.split(' ');
      const xy = parts[1] || '..';
      const indexState = xy[0];
      const worktreeState = xy[1];
      // The path is the last space-separated field; a rename appends the old
      // path after a tab.
      const tail = line.split('\t');
      const filePath = line.startsWith('2 ')
        ? (tail[0].split(' ').slice(9).join(' ') || '').trim()
        : parts.slice(8).join(' ').trim();
      const original = line.startsWith('2 ') && tail[1] ? tail[1].trim() : null;

      info.files.push({
        path: filePath,
        original,
        staged: indexState !== '.',
        index: indexState,
        worktree: worktreeState,
        label: STATUS_LABELS[worktreeState !== '.' ? worktreeState : indexState] || 'changed'
      });
    }
  }

  return info;
}

async function stage(cwd, paths) {
  const list = Array.isArray(paths) ? paths : [paths];
  if (!list.length) return { ok: true };
  // "--" stops git treating a path that begins with a dash as an option.
  return run(cwd, ['add', '--', ...list]);
}

async function stageAll(cwd) {
  return run(cwd, ['add', '-A']);
}

async function unstage(cwd, paths) {
  const list = Array.isArray(paths) ? paths : [paths];
  if (!list.length) return { ok: true };
  return run(cwd, ['restore', '--staged', '--', ...list]);
}

async function discard(cwd, paths) {
  const list = Array.isArray(paths) ? paths : [paths];
  if (!list.length) return { ok: true };
  return run(cwd, ['restore', '--', ...list]);
}

async function commit(cwd, message) {
  const text = String(message || '').trim();
  if (!text) return { ok: false, error: 'A commit message is required' };
  // The message is one argument; git never sees a shell.
  return run(cwd, ['commit', '-m', text]);
}

async function push(cwd) {
  const current = await run(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
  if (!current.ok) return current;
  const branch = current.stdout.trim();
  const upstream = await run(cwd, ['rev-parse', '--abbrev-ref', `${branch}@{upstream}`], { allowFailure: true });
  const hasUpstream = upstream.ok && upstream.stdout.trim() && !upstream.stderr;
  return hasUpstream
    ? run(cwd, ['push'])
    : run(cwd, ['push', '--set-upstream', 'origin', branch]);
}

async function pull(cwd) {
  return run(cwd, ['pull', '--ff-only']);
}

async function branches(cwd) {
  const result = await run(cwd, ['branch', '--format=%(refname:short)']);
  if (!result.ok) return { ok: false, error: result.error, branches: [] };
  return {
    ok: true,
    branches: result.stdout.split('\n').map((line) => line.trim()).filter(Boolean)
  };
}

async function checkout(cwd, branch, { create = false } = {}) {
  const name = String(branch || '').trim();
  if (!name) return { ok: false, error: 'A branch name is required' };
  return create ? run(cwd, ['checkout', '-b', name]) : run(cwd, ['checkout', name]);
}

/** Diff for one path — staged when `staged` is set, otherwise the worktree. */
async function diff(cwd, filePath, { staged = false } = {}) {
  const args = ['diff', '--no-color'];
  if (staged) args.push('--staged');
  args.push('--', filePath);
  const result = await run(cwd, args);
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, diff: result.stdout };
}

async function log(cwd, limit = 30) {
  const result = await run(cwd, [
    'log', `-${Math.max(1, Math.min(200, limit))}`,
    '--pretty=format:%H%x1f%an%x1f%ar%x1f%s'
  ], { allowFailure: true });
  if (!result.ok || !result.stdout.trim()) return { ok: true, commits: [] };
  const commits = result.stdout.split('\n').filter(Boolean).map((line) => {
    const [hash, author, when, subject] = line.split('\x1f');
    return { hash, author, when, subject };
  });
  return { ok: true, commits };
}

async function init(cwd) {
  if (!cwd) return { ok: false, error: 'No folder is open' };
  return run(cwd, ['init']);
}

/** Is git installed at all? Decides whether the panel offers anything. */
async function available() {
  const result = await run(process.cwd(), ['--version'], { allowFailure: true });
  return result.ok && /git version/i.test(result.stdout);
}

module.exports = {
  available, isRepo, status, stage, stageAll, unstage, discard,
  commit, push, pull, branches, checkout, diff, log, init,
  repoName: (cwd) => (cwd ? path.basename(cwd) : null)
};
