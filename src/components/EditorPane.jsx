import React from 'react';
import {
  File, FileQuestion, Download, Save, Undo2, Redo2, RotateCcw, Zap, PenLine,
  AlertTriangle, Search as SearchIcon, WrapText
} from 'lucide-react';
import FileIcon from './FileIcon';
import { LazyView } from '../lib/lazy-view';
import { lazyView } from '../lib/lazy-import';
import { formatBytes } from '../lib/format';
import { fileMeta } from '../lib/languages';

/**
 * Monaco is by far the largest thing HawCode ships, and the window opens on the
 * welcome screen or an empty editor — no file, no editor, no reason to have
 * paid for it. Loading it with the first file that is opened takes several
 * megabytes off the startup path; `App` warms this chunk once the window is
 * idle, so by the time anyone clicks a file it is usually already here.
 */
const CodeEditor = lazyView(() => import('./CodeEditor'));

function EditorLoading() {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-[#0d1117] text-[11px] text-slate-600">
      Opening editor…
    </div>
  );
}

function ToolButton({ icon: Icon, label, onClick, disabled, tone = 'default', badge }) {
  const tones = {
    default: 'text-slate-400 hover:text-white hover:bg-white/5',
    primary: 'text-emerald-300 bg-emerald-500/15 hover:bg-emerald-500/25',
    warn: 'text-amber-300 hover:text-amber-200 hover:bg-amber-500/10'
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={`relative flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-medium transition-colors disabled:opacity-30 disabled:hover:bg-transparent ${tones[tone]}`}
    >
      <Icon size={13} />
      {badge && <span className="hidden sm:inline">{badge}</span>}
    </button>
  );
}

/**
 * The editor surface: a toolbar, then either Monaco or a placeholder for files
 * that are not text.
 *
 * Sync mode is per file. In **live** mode (the default) a pause in typing is
 * written straight to disk and out to every peer. In **manual** mode the edit
 * stays in this window until Save, which is what you want when a file is
 * half-finished and would break the other machine's build.
 */
export default function EditorPane({
  activeFile,
  file,
  settings,
  editorRef,
  dirty,
  syncMode,
  conflict,
  paused,
  onContentChange,
  onCursorChange,
  onSave,
  onCancel,
  onToggleSyncMode,
  onDownload,
  onResolveConflict,
  onToggleWordWrap
}) {
  if (!activeFile) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-slate-600 bg-gradient-to-b from-[#0d1117] to-[#161b22]">
        <div className="w-20 h-20 bg-white/5 rounded-full flex items-center justify-center mb-5">
          <File size={34} className="text-slate-500" />
        </div>
        <h3 className="text-lg font-medium text-slate-300 mb-1.5">No file selected</h3>
        <p className="text-sm text-slate-500 max-w-sm text-center">
          Pick a file from the sidebar, or press <Kbd>Ctrl</Kbd> <Kbd>P</Kbd> to jump to one.
        </p>
      </div>
    );
  }

  const meta = fileMeta(activeFile);
  const isBinary = Boolean(file && file.binary);

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-[#0d1117]">
      <div className="flex items-center gap-1 px-3 h-9 border-b border-border bg-[#161b22] flex-shrink-0">
        <FileIcon path={activeFile} size={13} />
        <span className="text-[11px] text-slate-500 font-mono truncate max-w-[40%]">{activeFile}</span>
        {dirty && (
          <span className="text-[10px] text-amber-400 flex items-center gap-1 flex-shrink-0">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
            unsaved
          </span>
        )}

        {!isBinary && (
          <div className="ml-auto flex items-center gap-0.5">
            <ToolButton icon={Undo2} label="Undo (Ctrl+Z)" onClick={() => editorRef.current?.undo()} />
            <ToolButton icon={Redo2} label="Redo (Ctrl+Y)" onClick={() => editorRef.current?.redo()} />
            <ToolButton icon={SearchIcon} label="Find (Ctrl+F)" onClick={() => editorRef.current?.find()} />
            <ToolButton
              icon={WrapText}
              label={settings.wordWrap ? 'Turn word wrap off' : 'Turn word wrap on'}
              onClick={onToggleWordWrap}
              tone={settings.wordWrap ? 'primary' : 'default'}
            />

            <span className="w-px h-4 bg-white/10 mx-1" />

            <button
              onClick={onToggleSyncMode}
              title={syncMode === 'live'
                ? 'Live sync — every pause in typing reaches the other computers. Click for manual.'
                : 'Manual — edits stay here until you save. Click for live sync.'}
              className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-medium transition-colors ${
                syncMode === 'live'
                  ? 'text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20'
                  : 'text-amber-300 bg-amber-500/10 hover:bg-amber-500/20'
              }`}
            >
              {syncMode === 'live' ? <Zap size={12} /> : <PenLine size={12} />}
              <span className="hidden md:inline">{syncMode === 'live' ? 'Live' : 'Manual'}</span>
            </button>

            <ToolButton
              icon={RotateCcw}
              label="Cancel — throw away your changes and reload from disk"
              onClick={onCancel}
              disabled={!dirty}
              tone="warn"
              badge="Cancel"
            />
            <ToolButton
              icon={Save}
              label="Save (Ctrl+S)"
              onClick={onSave}
              disabled={!dirty && syncMode === 'live'}
              tone="primary"
              badge="Save"
            />
          </div>
        )}
      </div>

      {paused && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-500/10 border-b border-amber-500/20 flex-shrink-0">
          <AlertTriangle size={12} className="text-amber-400 flex-shrink-0" />
          <span className="text-[11px] text-amber-200">
            Sync is paused — your edits are saved here and queued for the other computers.
          </span>
        </div>
      )}

      {conflict && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-rose-500/10 border-b border-rose-500/20 flex-shrink-0">
          <AlertTriangle size={12} className="text-rose-400 flex-shrink-0" />
          <span className="text-[11px] text-rose-200 flex-1">
            Another computer changed this file while you had unsaved edits.
          </span>
          <button
            onClick={() => onResolveConflict('keep')}
            className="px-2 py-0.5 rounded text-[10px] font-semibold bg-white/10 text-white hover:bg-white/20 transition-colors"
          >
            Keep mine
          </button>
          <button
            onClick={() => onResolveConflict('reload')}
            className="px-2 py-0.5 rounded text-[10px] font-semibold bg-rose-500/25 text-rose-100 hover:bg-rose-500/40 transition-colors"
          >
            Reload theirs
          </button>
        </div>
      )}

      {isBinary ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center px-6">
          <div className="w-16 h-16 bg-white/5 rounded-2xl flex items-center justify-center mb-4">
            <FileQuestion size={28} className="text-slate-500" />
          </div>
          <h3 className="text-base font-medium text-slate-300 mb-1">
            {meta.label} file
          </h3>
          <p className="text-xs text-slate-500 max-w-sm mb-5">
            HawCode cannot show {formatBytes(file.size)} of binary content as text, but it
            still syncs this file byte for byte to every connected computer.
          </p>
          {onDownload && (
            <button
              onClick={() => onDownload(activeFile)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-slate-200 text-xs font-medium transition-colors border border-white/10"
            >
              <Download size={14} />
              Open with your system app
            </button>
          )}
        </div>
      ) : (
        <div className="flex-1 relative min-h-0">
          <LazyView label="The editor" fallback={<EditorLoading />}>
            <CodeEditor
              ref={editorRef}
              path={activeFile}
              content={file ? file.content || '' : ''}
              settings={settings}
              onContentChange={onContentChange}
              onCursorChange={onCursorChange}
              onSaveRequest={onSave}
            />
          </LazyView>
        </div>
      )}
    </div>
  );
}

function Kbd({ children }) {
  return (
    <kbd className="mx-0.5 px-1.5 py-0.5 rounded border border-white/15 bg-white/5 text-[10px] text-slate-400">
      {children}
    </kbd>
  );
}
