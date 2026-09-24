import React, { useState, useEffect, useCallback } from 'react';
import {
  GitBranch, GitCommit, RefreshCw, Plus, Minus, Undo2, ArrowUp, ArrowDown,
  Check, AlertTriangle, Loader2, FolderGit2, ChevronDown, ChevronRight
} from 'lucide-react';
import FileIcon from './FileIcon';

const api = window.electronAPI;
const REFRESH_MS = 4000;

// Single letters from git's porcelain output, and how they should read.
const STATE_STYLES = {
  modified: { letter: 'M', tone: 'text-amber-400' },
  added: { letter: 'A', tone: 'text-emerald-400' },
  deleted: { letter: 'D', tone: 'text-rose-400' },
  renamed: { letter: 'R', tone: 'text-blue-400' },
  copied: { letter: 'C', tone: 'text-blue-400' },
  conflicted: { letter: '!', tone: 'text-orange-400' },
  untracked: { letter: 'U', tone: 'text-slate-400' }
};

function FileRow({ file, onOpen, onStage, onUnstage, onDiscard, staged }) {
  const style = STATE_STYLES[file.label] || STATE_STYLES.modified;
  const name = file.path.split('/').pop();
  const folder = file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/')) : '';

  return (
    <div className="group flex items-center gap-1.5 px-2 py-1 hover:bg-white/5">
      <button onClick={() => onOpen(file.path)} className="flex items-center gap-1.5 min-w-0 flex-1 text-left">
        <FileIcon path={file.path} size={13} />
        <span className="text-[12px] text-slate-200 truncate">{name}</span>
        {folder && <span className="text-[10px] text-slate-600 truncate">{folder}</span>}
      </button>

      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
        {staged ? (
          <button onClick={() => onUnstage(file.path)} title="Unstage"
            className="p-0.5 rounded text-slate-400 hover:text-white hover:bg-white/10">
            <Minus size={12} />
          </button>
        ) : (
          <>
            <button onClick={() => onDiscard(file)} title="Discard changes"
              className="p-0.5 rounded text-slate-400 hover:text-rose-300 hover:bg-white/10">
              <Undo2 size={12} />
            </button>
            <button onClick={() => onStage(file.path)} title="Stage"
              className="p-0.5 rounded text-slate-400 hover:text-emerald-300 hover:bg-white/10">
              <Plus size={12} />
            </button>
          </>
        )}
      </div>
      <span className={`text-[11px] font-bold w-3 text-center flex-shrink-0 ${style.tone}`} title={file.label}>
        {style.letter}
      </span>
    </div>
  );
}

function Section({ title, count, children, defaultOpen = true, action }) {
  const [open, setOpen] = useState(defaultOpen);
  if (!count) return null;
  return (
    <div>
      <div className="flex items-center gap-1 px-2 py-1 sticky top-0 bg-[#161b22] z-10">
        <button onClick={() => setOpen((value) => !value)} className="flex items-center gap-1 flex-1 text-left">
          {open ? <ChevronDown size={12} className="text-slate-500" /> : <ChevronRight size={12} className="text-slate-500" />}
          <span className="text-[10px] uppercase tracking-widest text-slate-400 font-bold">{title}</span>
          <span className="text-[10px] text-slate-600">{count}</span>
        </button>
        {action}
      </div>
      {open && children}
    </div>
  );
}

/**
 * Source control for the shared folder.
 *
 * Every operation runs `git` in the main process with an argument array, so a
 * branch name or commit message is never interpreted by a shell. Like the
 * terminal, this is desktop-only — a joined peer cannot reach it.
 */
export default function GitPanel({ onOpenFile, rootPath }) {
  const [status, setStatus] = useState(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [branchMenu, setBranchMenu] = useState(false);
  const [branches, setBranches] = useState([]);

  const refresh = useCallback(async () => {
    const next = await api.gitStatus();
    setStatus(next);
    if (next && next.error) setError(next.error);
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(timer);
  }, [refresh, rootPath]);

  const guard = async (operation) => {
    setBusy(true);
    setError('');
    const outcome = await operation();
    setBusy(false);
    if (outcome && outcome.error) setError(outcome.error);
    await refresh();
    return outcome;
  };

  const commit = async () => {
    if (!message.trim()) return;
    const outcome = await guard(() => api.gitCommit(message));
    if (outcome && !outcome.error) setMessage('');
  };

  const discard = async (file) => {
    const confirmed = window.confirm(
      `Discard your changes to "${file.path}"?\n\nThis cannot be undone.`
    );
    if (!confirmed) return;
    await guard(() => api.gitDiscard([file.path]));
  };

  const openBranchMenu = async () => {
    const list = await api.gitBranches();
    setBranches(list.branches || []);
    setBranchMenu(true);
  };

  const newBranch = async () => {
    const name = window.prompt('New branch name');
    if (!name || !name.trim()) return;
    setBranchMenu(false);
    await guard(() => api.gitCheckout(name.trim(), true));
  };

  if (!rootPath) {
    return <Empty icon={FolderGit2} title="No folder open" body="Host or join a workspace first." />;
  }

  if (status && status.isRepo === false) {
    return (
      <div className="p-6 text-center">
        <FolderGit2 size={28} className="mx-auto text-slate-600 mb-3" />
        <h3 className="text-sm font-medium text-slate-300 mb-1">Not a git repository</h3>
        <p className="text-[11px] text-slate-500 mb-4">
          Start tracking this folder with git to see changes here.
        </p>
        <button
          onClick={() => guard(() => api.gitInit())}
          disabled={busy}
          className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-semibold transition-colors"
        >
          Initialise repository
        </button>
      </div>
    );
  }

  if (!status) {
    return (
      <div className="flex items-center justify-center gap-2 py-8 text-slate-500 text-[11px]">
        <Loader2 size={13} className="animate-spin" />
        Reading repository…
      </div>
    );
  }

  const staged = status.files.filter((file) => file.staged);
  const changed = status.files.filter((file) => !file.staged);

  return (
    <div className="flex flex-col h-full">
      <div className="p-2 border-b border-white/5 space-y-2">
        <div className="flex items-center gap-1 relative">
          <button
            onClick={openBranchMenu}
            className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] text-slate-300 hover:bg-white/5 transition-colors min-w-0"
          >
            <GitBranch size={12} className="text-indigo-400 flex-shrink-0" />
            <span className="truncate font-medium">{status.branch || 'detached'}</span>
          </button>

          {status.ahead > 0 && (
            <span className="flex items-center text-[10px] text-emerald-400" title={`${status.ahead} to push`}>
              <ArrowUp size={10} />{status.ahead}
            </span>
          )}
          {status.behind > 0 && (
            <span className="flex items-center text-[10px] text-amber-400" title={`${status.behind} to pull`}>
              <ArrowDown size={10} />{status.behind}
            </span>
          )}

          <div className="ml-auto flex items-center gap-0.5">
            <button onClick={() => guard(() => api.gitPull())} disabled={busy} title="Pull"
              className="p-1 rounded text-slate-400 hover:text-white hover:bg-white/5 disabled:opacity-40">
              <ArrowDown size={13} />
            </button>
            <button onClick={() => guard(() => api.gitPush())} disabled={busy} title="Push"
              className="p-1 rounded text-slate-400 hover:text-white hover:bg-white/5 disabled:opacity-40">
              <ArrowUp size={13} />
            </button>
            <button onClick={refresh} disabled={busy} title="Refresh"
              className="p-1 rounded text-slate-400 hover:text-white hover:bg-white/5 disabled:opacity-40">
              <RefreshCw size={13} className={busy ? 'animate-spin' : ''} />
            </button>
          </div>

          {branchMenu && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setBranchMenu(false)} />
              <div className="absolute left-0 top-full mt-1 z-20 min-w-[200px] max-h-64 overflow-y-auto custom-scrollbar bg-[#0d1117] border border-white/10 rounded-lg shadow-2xl py-1">
                {branches.map((branch) => (
                  <button
                    key={branch}
                    onClick={() => {
                      setBranchMenu(false);
                      guard(() => api.gitCheckout(branch, false));
                    }}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-slate-300 hover:bg-white/5 hover:text-white text-left"
                  >
                    {branch === status.branch
                      ? <Check size={11} className="text-emerald-400 flex-shrink-0" />
                      : <span className="w-[11px] flex-shrink-0" />}
                    <span className="truncate">{branch}</span>
                  </button>
                ))}
                <div className="border-t border-white/5 mt-1 pt-1">
                  <button onClick={newBranch}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-indigo-300 hover:bg-white/5 text-left">
                    <Plus size={11} />Create branch…
                  </button>
                </div>
              </div>
            </>
          )}
        </div>

        <textarea
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) commit();
          }}
          rows={2}
          placeholder="Commit message (Ctrl+Enter to commit)"
          className="w-full bg-[#0d1117] border border-white/10 rounded-md px-2 py-1.5 text-[12px] text-white focus:outline-none focus:border-indigo-500 resize-none placeholder:text-slate-600"
        />
        <button
          onClick={commit}
          disabled={busy || !message.trim() || !staged.length}
          className="w-full flex items-center justify-center gap-2 py-1.5 rounded-md bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-[11px] font-semibold transition-colors"
          title={!staged.length ? 'Stage something first' : 'Commit staged changes'}
        >
          <GitCommit size={13} />
          Commit {staged.length > 0 && `(${staged.length})`}
        </button>

        {error && (
          <div className="flex items-start gap-1.5 p-1.5 rounded bg-rose-500/10 border border-rose-500/20">
            <AlertTriangle size={11} className="text-rose-400 flex-shrink-0 mt-0.5" />
            <span className="text-[10px] text-rose-200 break-words">{error}</span>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar">
        <Section title="Staged" count={staged.length}>
          {staged.map((file) => (
            <FileRow key={`s-${file.path}`} file={file} staged onOpen={onOpenFile}
              onUnstage={(p) => guard(() => api.gitUnstage([p]))} />
          ))}
        </Section>

        <Section
          title="Changes"
          count={changed.length}
          action={changed.length > 0 && (
            <button onClick={() => guard(() => api.gitStageAll())} title="Stage everything"
              className="p-0.5 rounded text-slate-400 hover:text-emerald-300 hover:bg-white/10">
              <Plus size={12} />
            </button>
          )}
        >
          {changed.map((file) => (
            <FileRow key={`c-${file.path}`} file={file} onOpen={onOpenFile}
              onStage={(p) => guard(() => api.gitStage([p]))} onDiscard={discard} />
          ))}
        </Section>

        {status.files.length === 0 && (
          <div className="text-center text-slate-600 text-[11px] mt-8 px-4">
            <Check size={20} className="mx-auto mb-2 text-emerald-500/60" />
            Nothing to commit — the folder matches the last commit.
          </div>
        )}
      </div>
    </div>
  );
}

function Empty({ icon: Icon, title, body }) {
  return (
    <div className="p-6 text-center">
      <Icon size={28} className="mx-auto text-slate-600 mb-3" />
      <h3 className="text-sm font-medium text-slate-300 mb-1">{title}</h3>
      <p className="text-[11px] text-slate-500">{body}</p>
    </div>
  );
}
