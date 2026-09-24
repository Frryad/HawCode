import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { io } from 'socket.io-client';
import {
  FolderOpen, Wifi, Server as ServerIcon, MonitorSmartphone, FilePlus, FolderPlus,
  ExternalLink, Globe, Lock, RotateCw, Trash2, PenLine, Copy, PanelBottom
} from 'lucide-react';

import FileTree from './components/FileTree';
import EditorPane from './components/EditorPane';
import EditorTabs from './components/EditorTabs';
import SyncStatusBar from './components/SyncStatusBar';
import ActivityBar from './components/ActivityBar';
import CommandPalette from './components/CommandPalette';
import QuickOpen from './components/QuickOpen';
import PresenceBar from './components/PresenceBar';
import ContextMenu from './components/ContextMenu';
import { LazyView } from './lib/lazy-view';
import { lazyView } from './lib/lazy-import';

/**
 * Everything below opens on a click rather than with the window: the terminal
 * panel (which carries xterm), the two connection dialogs, settings, and the
 * sidebar views other than the file tree. Fetching each with the click that
 * asks for it keeps the startup bundle to the shell the user actually sees
 * first, and each chunk is small enough that the wait is invisible on a local
 * connection.
 */
const BottomPanel = lazyView(() => import('./components/BottomPanel'));
const SearchPanel = lazyView(() => import('./components/SearchPanel'));
const GitPanel = lazyView(() => import('./components/GitPanel'));
const ScriptRunner = lazyView(() => import('./components/ScriptRunner'));
const SettingsPanel = lazyView(() => import('./components/SettingsPanel'));
const ConnectionModeDialog = lazyView(() => import('./components/ConnectionModeDialog'));
const JoinDialog = lazyView(() => import('./components/JoinDialog'));

import { buildCommands, bindingsFrom } from './lib/commands';
import { useKeybindings } from './lib/keybindings';
import { applyRemoteContent, disposeModel, renameModel } from './lib/editor-models';

const api = window.electronAPI;
const isElectron = api !== undefined;
const ACTIVITY_LIMIT = 200;
const PRESENCE_THROTTLE_MS = 300;

const IDLE_STATUS = { state: 'idle', mode: null, stats: {}, queued: {}, peers: [] };
const FALLBACK_SETTINGS = {
  fontSize: 14,
  fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, monospace",
  wordWrap: true,
  minimap: false,
  tabSize: 2,
  autoSaveDelayMs: 150,
  terminalFontSize: 13,
  showPresence: true,
  confirmBeforeDelete: true
};

export default function App() {
  const [status, setStatus] = useState(IDLE_STATUS);
  const [settings, setSettings] = useState(FALLBACK_SETTINGS);
  const [tree, setTree] = useState([]);

  const [tabs, setTabs] = useState([]);
  const [activeFile, setActiveFile] = useState(null);
  const [fileCache, setFileCache] = useState({});
  const [dirtyPaths, setDirtyPaths] = useState(() => new Set());
  const [syncModes, setSyncModes] = useState({});
  const [conflicts, setConflicts] = useState({});
  const [splitPath, setSplitPath] = useState(null);

  const [sidebar, setSidebar] = useState('files');
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelTab, setPanelTab] = useState('terminal');
  const [terminalCount, setTerminalCount] = useState(0);

  const [paletteOpen, setPaletteOpen] = useState(false);
  const [quickOpenOpen, setQuickOpenOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState(null);

  const [discovered, setDiscovered] = useState([]);
  const [peers, setPeers] = useState([]);
  const [activity, setActivity] = useState([]);
  const [transfers, setTransfers] = useState({});

  const [pendingFolder, setPendingFolder] = useState(null);
  const [showJoin, setShowJoin] = useState(false);
  const [browserCode, setBrowserCode] = useState('');
  const [browserNeedsCode, setBrowserNeedsCode] = useState(false);

  const editorRef = useRef(null);
  const splitEditorRef = useRef(null);
  const socketRef = useRef(null);
  const activeFileRef = useRef(null);
  const writeTimers = useRef({});
  const presenceTimer = useRef(0);
  const stateRef = useRef({ dirtyPaths: new Set(), syncModes: {}, tabs: [] });

  const baseUrl = isElectron ? '' : window.location.origin;
  const isSharing = Boolean(status.rootPath) || !isElectron;

  // Mirrored so the long-lived IPC and socket listeners can read current state
  // without being torn down and re-attached on every keystroke.
  useEffect(() => {
    activeFileRef.current = activeFile;
    stateRef.current = { dirtyPaths, syncModes, tabs };
  }, [activeFile, dirtyPaths, syncModes, tabs]);

  // --------------------------------------------------------------- data load

  const authHeaders = useCallback(
    () => (browserCode ? { 'x-hawcode-code': browserCode } : {}),
    [browserCode]
  );

  const refreshTree = useCallback(async () => {
    if (isElectron) {
      setTree(await api.getFileTree());
      return;
    }
    try {
      const response = await fetch(`${baseUrl}/api/files`, { headers: authHeaders() });
      if (response.status === 401) {
        setBrowserNeedsCode(true);
        return;
      }
      const data = await response.json();
      if (!data.error) setTree(data);
    } catch (error) {
      console.error('Could not load the file list', error);
    }
  }, [authHeaders, baseUrl]);

  const fetchFile = useCallback(async (relPath) => {
    if (isElectron) return api.readFile(relPath);
    try {
      const response = await fetch(
        `${baseUrl}/api/file?path=${encodeURIComponent(relPath)}`,
        { headers: authHeaders() }
      );
      const data = await response.json();
      return data.error ? null : data;
    } catch {
      return null;
    }
  }, [authHeaders, baseUrl]);

  const openFile = useCallback(async (relPath, line) => {
    const data = await fetchFile(relPath);
    if (!data) return;

    setFileCache((previous) => ({ ...previous, [relPath]: data }));
    setTabs((previous) => (previous.includes(relPath) ? previous : [...previous, relPath]));
    setActiveFile(relPath);
    if (isElectron) api.setActiveFile(relPath);

    if (line) {
      // Wait for the model swap, or the jump lands in the file that was open a
      // moment ago.
      setTimeout(() => editorRef.current?.revealLine(line), 60);
    }
  }, [fetchFile]);

  // ------------------------------------------------------------------ saving

  const writeFile = useCallback(async (relPath, content) => {
    if (isElectron) return api.writeFile(relPath, content);
    if (socketRef.current) socketRef.current.emit('file-edit', { path: relPath, content });
    return { ok: true };
  }, []);

  const markClean = useCallback((relPath) => {
    setDirtyPaths((previous) => {
      if (!previous.has(relPath)) return previous;
      const next = new Set(previous);
      next.delete(relPath);
      return next;
    });
  }, []);

  const saveFile = useCallback(async (relPath, ref) => {
    const target = relPath || activeFileRef.current;
    if (!target) return;
    const source = ref || editorRef;
    const value = source.current?.getValue();
    if (typeof value !== 'string') return;

    if (writeTimers.current[target]) {
      clearTimeout(writeTimers.current[target]);
      delete writeTimers.current[target];
    }
    const result = await writeFile(target, value);
    if (result && result.error) {
      window.alert(result.error);
      return;
    }
    markClean(target);
    setConflicts((previous) => {
      if (!previous[target]) return previous;
      const next = { ...previous };
      delete next[target];
      return next;
    });
  }, [writeFile, markClean]);

  /** Throw local edits away and take whatever is on disk. */
  const cancelEdits = useCallback(async (relPath) => {
    const target = relPath || activeFileRef.current;
    if (!target) return;
    const data = await fetchFile(target);
    if (!data || typeof data.content !== 'string') return;
    applyRemoteContent(target, data.content);
    setFileCache((previous) => ({ ...previous, [target]: data }));
    markClean(target);
    setConflicts((previous) => {
      const next = { ...previous };
      delete next[target];
      return next;
    });
  }, [fetchFile, markClean]);

  const handleContentChange = useCallback((relPath, value) => {
    setDirtyPaths((previous) => {
      if (previous.has(relPath)) return previous;
      const next = new Set(previous);
      next.add(relPath);
      return next;
    });

    const mode = stateRef.current.syncModes[relPath] || 'live';
    if (mode !== 'live') return;

    // Live mode: a pause in typing writes to disk and out to every peer.
    if (writeTimers.current[relPath]) clearTimeout(writeTimers.current[relPath]);
    writeTimers.current[relPath] = setTimeout(async () => {
      delete writeTimers.current[relPath];
      const result = await writeFile(relPath, value);
      if (!result || !result.error) markClean(relPath);
    }, settings.autoSaveDelayMs);
  }, [settings.autoSaveDelayMs, writeFile, markClean]);

  const handleCursorChange = useCallback((relPath, line, column) => {
    if (!isElectron || !settings.showPresence) return;
    const now = Date.now();
    if (now - presenceTimer.current < PRESENCE_THROTTLE_MS) return;
    presenceTimer.current = now;
    api.broadcastPresence({ path: relPath, line, column });
  }, [settings.showPresence]);

  const closeTab = useCallback((relPath) => {
    const target = relPath || activeFileRef.current;
    if (!target) return;
    if (stateRef.current.dirtyPaths.has(target)) {
      const discard = window.confirm(
        `"${target}" has unsaved changes.\n\nClose it anyway and lose them?`
      );
      if (!discard) return;
    }
    if (writeTimers.current[target]) {
      clearTimeout(writeTimers.current[target]);
      delete writeTimers.current[target];
    }
    disposeModel(target);
    markClean(target);

    setTabs((previous) => {
      const remaining = previous.filter((path) => path !== target);
      setActiveFile((current) => (current === target
        ? (remaining.length ? remaining[remaining.length - 1] : null)
        : current));
      return remaining;
    });
    setSplitPath((current) => (current === target ? null : current));
  }, [markClean]);

  const toggleSyncMode = useCallback((relPath) => {
    const target = relPath || activeFileRef.current;
    if (!target) return;
    setSyncModes((previous) => ({
      ...previous,
      [target]: (previous[target] || 'live') === 'live' ? 'manual' : 'live'
    }));
  }, []);

  const resolveConflict = useCallback(async (choice, relPath) => {
    const target = relPath || activeFileRef.current;
    if (!target) return;
    if (choice === 'reload') await cancelEdits(target);
    else await saveFile(target);
  }, [cancelEdits, saveFile]);

  // ----------------------------------------------------------------- effects

  // With the window drawn and the app sitting idle, pull in the two heavy
  // chunks in the background. Opening a file or the terminal then costs
  // nothing, and neither one held up startup.
  useEffect(() => {
    const warm = () => {
      // A prefetch that fails is not a problem — the view fetches its own chunk
      // when it is opened, and reports there if that fails too.
      import('./components/CodeEditor').catch(() => {});
      import('./components/BottomPanel').catch(() => {});
    };
    if (typeof window.requestIdleCallback === 'function') {
      const handle = window.requestIdleCallback(warm, { timeout: 2000 });
      return () => window.cancelIdleCallback(handle);
    }
    const timer = window.setTimeout(warm, 800);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!isElectron) return undefined;

    let alive = true;
    api.getSyncStatus().then((current) => { if (alive) setStatus(current); });
    api.getSettings().then((values) => {
      if (alive) setSettings({ ...FALLBACK_SETTINGS, ...values });
    });
    refreshTree();

    const unsubscribers = [
      api.onSyncStatus(setStatus),
      api.onDiscoveredWorkspaces(setDiscovered),
      api.onPeerPresence(setPeers),
      api.onFileTreeChanged(refreshTree),
      api.onSyncActivity((entry) => {
        setActivity((previous) => [entry, ...previous].slice(0, ACTIVITY_LIMIT));
      }),
      api.onTransferProgress((entry) => {
        setTransfers((previous) => {
          const next = { ...previous, [entry.path]: entry };
          if (entry.done) delete next[entry.path];
          return next;
        });
      }),
      api.onFileUpdated((payload) => {
        if (typeof payload.content !== 'string') return;
        const { dirtyPaths: dirty, syncModes: modes, tabs: openTabs } = stateRef.current;
        if (!openTabs.includes(payload.path)) return;

        // Never silently overwrite unsaved work. In manual mode the edit is
        // deliberate and unsent, so ask instead of choosing for the user.
        const isManualAndDirty = dirty.has(payload.path) &&
          (modes[payload.path] || 'live') === 'manual';
        if (isManualAndDirty) {
          setConflicts((previous) => ({ ...previous, [payload.path]: true }));
          return;
        }
        applyRemoteContent(payload.path, payload.content);
        setFileCache((previous) => ({ ...previous, [payload.path]: payload }));
      })
    ];

    return () => {
      alive = false;
      unsubscribers.forEach((off) => { if (off) off(); });
    };
  }, [refreshTree]);

  // Browser client: file tree and editor only, no local tooling.
  useEffect(() => {
    if (isElectron) return undefined;

    let cancelled = false;
    fetch(`${baseUrl}/api/hello`)
      .then((response) => response.json())
      .then((hello) => {
        if (cancelled) return;
        if (hello.requiresCode && !browserCode) {
          setBrowserNeedsCode(true);
          return;
        }
        const socket = io(baseUrl, { auth: { code: browserCode || undefined } });
        socketRef.current = socket;
        socket.on('file-tree-changed', refreshTree);
        socket.on('file-updated', async (payload) => {
          const { tabs: openTabs, dirtyPaths: dirty } = stateRef.current;
          if (!openTabs.includes(payload.path) || dirty.has(payload.path)) return;
          const data = await fetchFile(payload.path);
          if (data && typeof data.content === 'string') {
            applyRemoteContent(payload.path, data.content);
          }
        });
        setBrowserNeedsCode(false);
        setStatus({ state: 'running', mode: 'browser', stats: {}, queued: {}, peers: [] });
        refreshTree();
      })
      .catch((error) => console.error('Could not reach the host', error));

    return () => {
      cancelled = true;
      if (socketRef.current) {
        socketRef.current.close();
        socketRef.current = null;
      }
    };
  }, [browserCode, baseUrl, refreshTree, fetchFile]);

  // ----------------------------------------------------------------- actions

  const openPanel = useCallback((tab) => {
    setPanelTab(tab);
    setPanelOpen(true);
  }, []);

  const toggleTerminal = useCallback(() => {
    setPanelOpen((open) => {
      if (open && panelTab === 'terminal') return false;
      setPanelTab('terminal');
      return true;
    });
  }, [panelTab]);

  const createEntry = useCallback(async (kind) => {
    const name = window.prompt(
      kind === 'file'
        ? 'New file name (folders allowed, e.g. src/app.js)'
        : 'New folder name'
    );
    if (!name || !name.trim()) return;
    const result = kind === 'file'
      ? await api.createFile(name.trim())
      : await api.createDir(name.trim());
    if (result && result.error) {
      window.alert(result.error);
      return;
    }
    if (kind === 'file') openFile(name.trim());
  }, [openFile]);

  const renameEntry = useCallback(async (node) => {
    const next = window.prompt('New name', node.path);
    if (!next || !next.trim() || next.trim() === node.path) return;
    const result = await api.renameItem(node.path, next.trim());
    if (result && result.error) {
      window.alert(result.error);
      return;
    }
    // Carry the open tab across so the file does not appear to close.
    renameModel(node.path, result.path);
    setTabs((previous) => previous.map((p) => (p === node.path ? result.path : p)));
    setActiveFile((current) => (current === node.path ? result.path : current));
  }, []);

  const deleteEntry = useCallback(async (node) => {
    if (settings.confirmBeforeDelete) {
      const confirmed = window.confirm(
        `Delete "${node.path}"?\n\nThis removes it from every connected computer.`
      );
      if (!confirmed) return;
    }
    const result = await api.deleteItem(node.path);
    if (result && result.error) window.alert(result.error);
    closeTab(node.path);
  }, [settings.confirmBeforeDelete, closeTab]);

  const commands = useMemo(() => buildCommands({
    openQuickOpen: () => setQuickOpenOpen(true),
    createEntry: isElectron ? createEntry : undefined,
    closeActiveTab: () => closeTab(),
    revealFolder: isElectron ? () => api.revealFolder() : undefined,
    saveActive: () => saveFile(),
    cancelActive: () => cancelEdits(),
    toggleSyncMode: () => toggleSyncMode(),
    undo: () => editorRef.current?.undo(),
    redo: () => editorRef.current?.redo(),
    findInFile: () => editorRef.current?.find(),
    formatDocument: () => editorRef.current?.format(),
    showSidebar: (view) => setSidebar((current) => (current === view ? null : view)),
    openSettings: () => setSettingsOpen(true),
    toggleSplit: () => setSplitPath((current) => (current ? null : activeFile)),
    toggleTerminal,
    newTerminal: () => openPanel('terminal'),
    showSyncActivity: () => openPanel('activity'),
    pauseSync: isElectron ? async () => setStatus(await api.pauseSync()) : undefined,
    resumeSync: isElectron ? async () => setStatus(await api.resumeSync()) : undefined,
    stopSync: isElectron ? async () => setStatus(await api.stopSync()) : undefined
  }), [activeFile, createEntry, closeTab, saveFile, cancelEdits, toggleSyncMode, toggleTerminal, openPanel]);

  useKeybindings(
    useMemo(() => bindingsFrom(commands, {
      'ctrl+shift+p': () => setPaletteOpen(true),
      escape: () => {
        setPaletteOpen(false);
        setQuickOpenOpen(false);
        setContextMenu(null);
      }
    }), [commands]),
    isElectron && isSharing
  );

  // ---------------------------------------------------------------- rendering

  if (!isElectron && browserNeedsCode) {
    return <BrowserCodeGate onSubmit={setBrowserCode} />;
  }

  if (isElectron && !isSharing) {
    return (
      <>
        <Welcome
          discovered={discovered}
          onHost={async () => {
            const chosen = await api.selectFolder();
            if (chosen) setPendingFolder(chosen);
          }}
          onJoin={() => setShowJoin(true)}
        />

        {pendingFolder && (
          <LazyView label="The sharing options">
            <ConnectionModeDialog
              folderName={pendingFolder.folderPath}
              folderLabel={pendingFolder.folderName}
              hasIndex={Boolean(pendingFolder.hasIndex)}
              onStart={async (options) => {
                const result = await api.startHost({
                  folderPath: pendingFolder.folderPath, ...options
                });
                if (result && !result.error) {
                  setStatus(result);
                  refreshTree();
                }
                return result;
              }}
              onCancel={() => setPendingFolder(null)}
              onDone={() => setPendingFolder(null)}
            />
          </LazyView>
        )}
        {showJoin && (
          <LazyView label="The join dialog">
            <JoinDialog
              discovered={discovered}
              onJoin={async (options) => {
                const result = await api.joinWorkspace(options);
                if (result && !result.error) {
                  setStatus(result);
                  setShowJoin(false);
                  refreshTree();
                }
                return result;
              }}
              onJoinInvite={async (options) => {
                // Unlike a URL join this is not finished yet: the dialog stays up
                // showing the reply code until the host pastes it back.
                const result = await api.joinWithInvite(options);
                if (result && !result.error) {
                  setStatus(result);
                  refreshTree();
                }
                return result;
              }}
              onCancel={() => setShowJoin(false)}
            />
          </LazyView>
        )}
      </>
    );
  }

  const shareUrl = status.publicUrl || status.url;
  const openPathSet = new Set(tabs);
  const download = async (relPath) => {
    const query = `path=${encodeURIComponent(relPath)}`;
    if (isElectron) {
      // status.url is this computer's LAN address, where the server accepts the
      // code in the query string.
      const code = status.code ? `&code=${encodeURIComponent(status.code)}` : '';
      api.openExternal(`${status.url}/api/raw?${query}${code}`);
      return;
    }
    // From outside the network the code is only accepted as a header, which a
    // plain link cannot carry, so fetch the bytes and hand them over as a file.
    try {
      const response = await fetch(`${baseUrl}/api/raw?${query}`, {
        headers: browserCode ? { 'x-hawcode-code': browserCode } : {}
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = relPath.split('/').pop();
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (error) {
      window.alert(`Could not download ${relPath}: ${error.message}`);
    }
  };

  const sidebarTitle = sidebar === 'files' ? (status.folderName || 'Explorer')
    : sidebar === 'search' ? 'Search'
      : sidebar === 'git' ? 'Source Control' : 'Scripts';

  return (
    <div className="flex flex-col h-screen bg-background text-foreground overflow-hidden font-sans">
      <div className="flex flex-1 min-h-0">
        {isElectron && (
          <ActivityBar
            active={sidebar}
            onSelect={(view) => setSidebar((current) => (current === view ? null : view))}
            onOpenSettings={() => setSettingsOpen(true)}
          />
        )}

        {sidebar && (
          <aside className="w-72 flex-shrink-0 bg-[#161b22] border-r border-border flex flex-col z-10">
            <div className="flex items-center gap-2 px-4 h-9 border-b border-white/5 flex-shrink-0">
              <h2 className="text-[10px] font-bold uppercase tracking-widest text-slate-400 flex-1 truncate">
                {sidebarTitle}
              </h2>
              {sidebar === 'files' && isElectron && (
                <div className="flex items-center gap-0.5">
                  <IconButton icon={FilePlus} label="New file" onClick={() => createEntry('file')} />
                  <IconButton icon={FolderPlus} label="New folder" onClick={() => createEntry('dir')} />
                  <IconButton icon={FolderOpen} label="Open in Explorer" onClick={() => api.revealFolder()} />
                  <IconButton icon={RotateCw} label="Refresh" onClick={refreshTree} />
                </div>
              )}
            </div>

            <div className="flex-1 min-h-0 flex flex-col">
              {sidebar === 'files' && (
                <div className="flex-1 overflow-y-auto p-2 custom-scrollbar">
                  <FileTree
                    tree={tree}
                    activeFile={activeFile}
                    openPaths={openPathSet}
                    peers={settings.showPresence ? peers : []}
                    onOpenFile={openFile}
                    onContextMenu={(event, node) => {
                      event.preventDefault();
                      if (!isElectron) return;
                      setContextMenu({ x: event.clientX, y: event.clientY, node });
                    }}
                  />
                </div>
              )}
              {sidebar === 'search' && isElectron && (
                <LazyView label="Search">
                  <SearchPanel onOpenResult={(path, line) => openFile(path, line)} />
                </LazyView>
              )}
              {sidebar === 'git' && isElectron && (
                <LazyView label="Source control">
                  <GitPanel rootPath={status.rootPath} onOpenFile={openFile} />
                </LazyView>
              )}
              {sidebar === 'run' && isElectron && (
                <LazyView label="The scripts list">
                  <ScriptRunner rootPath={status.rootPath} onRan={() => openPanel('terminal')} />
                </LazyView>
              )}
            </div>

            {sidebar === 'files' && isElectron && shareUrl && (
              <div className="p-3 bg-[#0d1117] border-t border-white/5">
                <div className="flex items-center gap-2 text-[10px] text-slate-400 mb-2 font-bold uppercase tracking-widest">
                  {status.provider === 'direct'
                    ? <><Globe size={11} className="text-purple-400" />Shared directly</>
                    : status.exposure === 'online'
                      ? <><Globe size={11} className="text-purple-400" />Shared online</>
                      : <><Wifi size={11} className="text-green-400" />Wi-Fi sharing</>}
                  {status.code && <Lock size={10} className="text-amber-400 ml-auto" />}
                </div>
                <button
                  onClick={() => api.openExternal(shareUrl)}
                  title={shareUrl}
                  className="w-full flex items-center gap-2 bg-white/5 border border-white/10 p-2 rounded-lg hover:bg-white/10 transition-colors"
                >
                  <MonitorSmartphone size={14} className="text-blue-400 flex-shrink-0" />
                  <span className="text-[11px] text-green-400 font-mono truncate flex-1 text-left">
                    {shareUrl}
                  </span>
                  <ExternalLink size={11} className="text-slate-600 flex-shrink-0" />
                </button>
                {status.code && (
                  <div className="mt-2 flex items-center justify-between px-2 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20">
                    <span className="text-[10px] text-amber-300/80 uppercase tracking-wider font-bold">Code</span>
                    <span className="text-sm font-bold text-amber-200 tracking-[0.25em]">{status.code}</span>
                  </div>
                )}
              </div>
            )}
          </aside>
        )}

        <main className="flex-1 flex flex-col min-w-0">
          {isElectron && settings.showPresence && (
            <PresenceBar peers={peers} onOpenFile={openFile} />
          )}

          <EditorTabs
            tabs={tabs}
            activePath={activeFile}
            dirtyPaths={dirtyPaths}
            onSelect={openFile}
            onClose={closeTab}
            onSplit={() => setSplitPath((current) => (current ? null : activeFile))}
            canSplit={Boolean(activeFile)}
          />

          <div className="flex-1 flex min-h-0">
            <EditorPane
              activeFile={activeFile}
              file={fileCache[activeFile]}
              settings={settings}
              editorRef={editorRef}
              dirty={dirtyPaths.has(activeFile)}
              syncMode={syncModes[activeFile] || 'live'}
              conflict={Boolean(conflicts[activeFile])}
              paused={status.state === 'paused'}
              onContentChange={handleContentChange}
              onCursorChange={handleCursorChange}
              onSave={() => saveFile()}
              onCancel={() => cancelEdits()}
              onToggleSyncMode={() => toggleSyncMode()}
              onResolveConflict={(choice) => resolveConflict(choice)}
              onDownload={download}
              onToggleWordWrap={() => {
                const wordWrap = !settings.wordWrap;
                setSettings((previous) => ({ ...previous, wordWrap }));
                if (isElectron) api.updateSettings({ wordWrap });
              }}
            />

            {splitPath && (
              <div className="flex-1 border-l border-border min-w-0 flex flex-col">
                <EditorPane
                  activeFile={splitPath}
                  file={fileCache[splitPath]}
                  settings={settings}
                  editorRef={splitEditorRef}
                  dirty={dirtyPaths.has(splitPath)}
                  syncMode={syncModes[splitPath] || 'live'}
                  conflict={Boolean(conflicts[splitPath])}
                  paused={status.state === 'paused'}
                  onContentChange={handleContentChange}
                  onCursorChange={handleCursorChange}
                  onSave={() => saveFile(splitPath, splitEditorRef)}
                  onCancel={() => cancelEdits(splitPath)}
                  onToggleSyncMode={() => toggleSyncMode(splitPath)}
                  onResolveConflict={(choice) => resolveConflict(choice, splitPath)}
                  onDownload={download}
                  onToggleWordWrap={() => {
                    const wordWrap = !settings.wordWrap;
                    setSettings((previous) => ({ ...previous, wordWrap }));
                    if (isElectron) api.updateSettings({ wordWrap });
                  }}
                />
              </div>
            )}
          </div>
        </main>
      </div>

      {isElectron && panelOpen && (
        <LazyView label="The terminal panel">
          <BottomPanel
            tab={panelTab}
            onTabChange={setPanelTab}
            onClose={() => setPanelOpen(false)}
            activityEntries={activity}
            transfers={transfers}
            status={status}
            terminalFontSize={settings.terminalFontSize}
            onTerminalCount={setTerminalCount}
          />
        </LazyView>
      )}

      {isElectron && (
        <SyncStatusBar
          status={status}
          onPause={async () => setStatus(await api.pauseSync())}
          onResume={async () => setStatus(await api.resumeSync())}
          onStop={async () => {
            const confirmed = window.confirm(
              'Stop syncing this folder?\n\nThe folder stays on this computer, and starting again later only transfers what changed.'
            );
            if (confirmed) setStatus(await api.stopSync());
          }}
          activityOpen={panelOpen}
          onToggleActivity={() => (panelOpen ? setPanelOpen(false) : openPanel('activity'))}
        />
      )}

      {paletteOpen && (
        <CommandPalette commands={commands} onClose={() => setPaletteOpen(false)} />
      )}
      {quickOpenOpen && isElectron && (
        <QuickOpen onOpen={openFile} onClose={() => setQuickOpenOpen(false)} />
      )}
      {settingsOpen && isElectron && (
        <LazyView label="Settings">
          <SettingsPanel
            rootPath={status.rootPath}
            onClose={() => setSettingsOpen(false)}
            onChanged={(values) => setSettings({ ...FALLBACK_SETTINGS, ...values })}
          />
        </LazyView>
      )}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          items={[
            { label: 'Rename…', icon: PenLine, onClick: () => renameEntry(contextMenu.node) },
            {
              label: 'Duplicate',
              icon: Copy,
              disabled: contextMenu.node.type === 'directory',
              onClick: async () => {
                const result = await api.duplicateItem(contextMenu.node.path);
                if (result && result.error) window.alert(result.error);
              }
            },
            { separator: true },
            { label: 'Delete', icon: Trash2, danger: true, onClick: () => deleteEntry(contextMenu.node) }
          ]}
        />
      )}

      {isElectron && !panelOpen && (
        <button
          onClick={() => openPanel('terminal')}
          title="Open terminal (Ctrl+`)"
          className="fixed bottom-14 right-4 z-30 flex items-center gap-1.5 px-3 py-2 rounded-full bg-[#1c2128] border border-white/10 text-slate-300 hover:text-white hover:border-white/25 shadow-lg text-[11px] transition-colors"
        >
          <PanelBottom size={13} />
          Terminal
          {terminalCount > 0 && (
            <span className="text-[9px] bg-emerald-500/20 text-emerald-300 rounded-full px-1.5">
              {terminalCount}
            </span>
          )}
        </button>
      )}
    </div>
  );
}

function IconButton({ icon: Icon, label, onClick }) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      className="p-1 rounded text-slate-500 hover:text-white hover:bg-white/5 transition-colors"
    >
      <Icon size={14} />
    </button>
  );
}

function Welcome({ onHost, onJoin, discovered }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-background text-foreground relative overflow-hidden">
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl" />
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl" />

      <div className="max-w-md w-full bg-secondary/80 backdrop-blur-xl p-10 rounded-3xl shadow-2xl border border-white/10 text-center space-y-7 z-10">
        <div className="w-20 h-20 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-2xl flex items-center justify-center mx-auto shadow-lg shadow-indigo-500/30 rotate-3">
          <ServerIcon size={40} className="text-white -rotate-3" />
        </div>
        <div className="space-y-2.5">
          <h1 className="text-4xl font-extrabold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-blue-400 via-indigo-400 to-purple-500">
            HawCode
          </h1>
          <p className="text-slate-400 text-sm leading-relaxed">
            Keep one folder identical on two or more computers, with a real editor,
            terminal and source control on top.
          </p>
        </div>
        <div className="flex flex-col gap-3">
          <button
            onClick={onHost}
            className="w-full flex items-center justify-center gap-3 bg-gradient-to-r from-indigo-500 to-blue-600 hover:from-indigo-400 hover:to-blue-500 text-white py-3.5 px-6 rounded-xl font-bold transition-all shadow-lg shadow-indigo-500/25 hover:-translate-y-0.5"
          >
            <FolderOpen size={20} />
            Host a folder
          </button>
          <button
            onClick={onJoin}
            className="w-full flex items-center justify-center gap-3 bg-white/5 hover:bg-white/10 text-white py-3.5 px-6 rounded-xl font-bold transition-all border border-white/10 hover:border-white/20"
          >
            <Wifi size={20} />
            Join a folder
            {discovered.length > 0 && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300">
                {discovered.length} nearby
              </span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

function BrowserCodeGate({ onSubmit }) {
  const [value, setValue] = useState('');
  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-background">
      <div className="max-w-sm w-full bg-[#161b22] border border-white/10 p-7 rounded-2xl text-center space-y-5">
        <div className="w-14 h-14 bg-amber-500/15 rounded-2xl flex items-center justify-center mx-auto">
          <Lock size={24} className="text-amber-400" />
        </div>
        <div>
          <h2 className="text-lg font-bold text-white">This workspace is protected</h2>
          <p className="text-xs text-slate-400 mt-1.5">
            Enter the room code shown on the hosting computer.
          </p>
        </div>
        <input
          type="text"
          value={value}
          autoFocus
          maxLength={6}
          placeholder="Room code"
          onChange={(event) => setValue(event.target.value.toUpperCase())}
          onKeyDown={(event) => { if (event.key === 'Enter' && value) onSubmit(value); }}
          className="w-full bg-[#0d1117] border border-white/10 rounded-lg px-4 py-3 text-center text-lg text-amber-200 font-bold tracking-[0.4em] focus:outline-none focus:border-amber-400 placeholder:text-slate-600 placeholder:text-sm placeholder:tracking-normal placeholder:font-normal"
        />
        <button
          onClick={() => value && onSubmit(value)}
          disabled={!value}
          className="w-full py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white font-semibold text-sm transition-colors"
        >
          Unlock
        </button>
      </div>
    </div>
  );
}
