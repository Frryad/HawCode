import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Plus, X, ChevronDown, TerminalSquare, ShieldCheck } from 'lucide-react';
import '@xterm/xterm/css/xterm.css';

const api = window.electronAPI;

// Matches the app chrome rather than xterm's default black, so the panel does
// not look like a hole punched in the window.
const THEME = {
  background: '#0b0f16',
  foreground: '#d4d4d4',
  cursor: '#7aa2f7',
  cursorAccent: '#0b0f16',
  selectionBackground: '#3b4a6b',
  black: '#1f2430',
  red: '#f7768e',
  green: '#9ece6a',
  yellow: '#e0af68',
  blue: '#7aa2f7',
  magenta: '#bb9af7',
  cyan: '#7dcfff',
  white: '#c0caf5',
  brightBlack: '#565f89',
  brightRed: '#ff7a93',
  brightGreen: '#b9f27c',
  brightYellow: '#ff9e64',
  brightBlue: '#7da6ff',
  brightMagenta: '#bb9af7',
  brightCyan: '#0db9d7',
  brightWhite: '#d5d6db'
};

/**
 * One xterm instance bound to a main-process session.
 *
 * Every tab stays mounted and is hidden with CSS rather than unmounted, so
 * switching back does not tear down the terminal or lose its viewport. The
 * scrollback is replayed once on mount from the main process, which is what
 * makes a tab survive the panel being closed and reopened.
 */
function TerminalInstance({ session, active, fontSize, onExit }) {
  const hostRef = useRef(null);
  const termRef = useRef(null);
  const fitRef = useRef(null);

  useEffect(() => {
    if (!hostRef.current || termRef.current) return undefined;

    const term = new Terminal({
      fontSize,
      fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, monospace",
      theme: THEME,
      cursorBlink: true,
      scrollback: 5000,
      allowProposedApi: true,
      // The shell owns echoing; drawing locally too would double every keystroke.
      convertEol: false
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon((event, uri) => api.openExternal(uri)));
    term.open(hostRef.current);

    termRef.current = term;
    fitRef.current = fit;

    // Replay whatever this session printed before the tab existed.
    api.terminalScrollback(session.id).then((scrollback) => {
      if (scrollback) term.write(scrollback);
    });

    const disposable = term.onData((data) => api.terminalWrite(session.id, data));

    const resize = () => {
      try {
        fit.fit();
        api.terminalResize(session.id, term.cols, term.rows);
      } catch {
        // The panel can be mid-animation with a zero-sized box.
      }
    };
    const observer = new ResizeObserver(resize);
    observer.observe(hostRef.current);
    resize();

    return () => {
      observer.disconnect();
      disposable.dispose();
      term.dispose();
      termRef.current = null;
    };
    // Deliberately mount-once: the session id never changes for an instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id]);

  // Output arrives as one broadcast for all sessions; take only ours.
  useEffect(() => {
    const off = api.onTerminalData(({ id, data }) => {
      if (id !== session.id || !termRef.current) return;
      termRef.current.write(data);
    });
    const offExit = api.onTerminalExit(({ id, exitCode }) => {
      if (id === session.id) onExit(session.id, exitCode);
    });
    return () => {
      off();
      offExit();
    };
  }, [session.id, onExit]);

  useEffect(() => {
    if (termRef.current) termRef.current.options.fontSize = fontSize;
  }, [fontSize]);

  // Becoming visible means the box just got a real size; refit and focus.
  useEffect(() => {
    if (!active || !termRef.current || !fitRef.current) return;
    const timer = setTimeout(() => {
      try {
        fitRef.current.fit();
        api.terminalResize(session.id, termRef.current.cols, termRef.current.rows);
        termRef.current.focus();
      } catch {
        // Nothing to do if the panel closed again first.
      }
    }, 30);
    return () => clearTimeout(timer);
  }, [active, session.id]);

  return (
    <div
      ref={hostRef}
      className="absolute inset-0 px-2 py-1"
      style={{ visibility: active ? 'visible' : 'hidden' }}
    />
  );
}

export default function TerminalPanel({ fontSize = 13, onSessionsChanged }) {
  const [sessions, setSessions] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [shells, setShells] = useState([]);
  const [mode, setMode] = useState('pty');
  const [pickerOpen, setPickerOpen] = useState(false);

  const createSession = useCallback(async (shellId) => {
    const created = await api.terminalCreate({ shellId });
    if (created.error) {
      window.alert(created.error);
      return null;
    }
    setSessions((previous) => [...previous, created]);
    setActiveId(created.id);
    return created;
  }, []);

  // Load the shell list, then adopt any sessions that already exist (the script
  // runner creates them outside this component).
  useEffect(() => {
    let alive = true;
    api.terminalShells().then((info) => {
      if (!alive) return;
      setShells(info.shells || []);
      setMode(info.mode);
    });
    api.terminalList().then((existing) => {
      if (!alive) return;
      if (existing.length) {
        setSessions(existing);
        setActiveId((current) => current || existing[existing.length - 1].id);
      } else {
        createSession();
      }
    });
    return () => { alive = false; };
  }, [createSession]);

  // A session started elsewhere (a script run) should appear here too.
  useEffect(() => {
    const poll = setInterval(async () => {
      const live = await api.terminalList();
      setSessions((previous) => {
        if (live.length === previous.length) return previous;
        const known = new Set(previous.map((session) => session.id));
        const added = live.filter((session) => !known.has(session.id));
        if (added.length) setActiveId(added[added.length - 1].id);
        return live;
      });
    }, 1500);
    return () => clearInterval(poll);
  }, []);

  useEffect(() => {
    if (onSessionsChanged) onSessionsChanged(sessions.length);
  }, [sessions.length, onSessionsChanged]);

  const closeSession = async (id) => {
    await api.terminalKill(id);
    setSessions((previous) => {
      const remaining = previous.filter((session) => session.id !== id);
      setActiveId((current) => (current === id
        ? (remaining.length ? remaining[remaining.length - 1].id : null)
        : current));
      return remaining;
    });
  };

  const markExited = useCallback((id) => {
    setSessions((previous) => previous.map((session) => (
      session.id === id ? { ...session, exited: true } : session
    )));
  }, []);

  return (
    <div className="flex flex-col h-full bg-[#0b0f16]">
      <div className="flex items-center gap-1 px-2 h-9 border-b border-white/5 flex-shrink-0">
        <div className="flex items-center gap-1 overflow-x-auto flex-1 custom-scrollbar">
          {sessions.map((session) => (
            <button
              key={session.id}
              onClick={() => setActiveId(session.id)}
              className={`group flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] whitespace-nowrap transition-colors ${
                activeId === session.id
                  ? 'bg-white/10 text-white'
                  : 'text-slate-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <TerminalSquare size={12} className={session.exited ? 'text-slate-600' : 'text-emerald-400'} />
              <span className={session.exited ? 'line-through opacity-60' : ''}>{session.label}</span>
              <span
                role="button"
                tabIndex={-1}
                onClick={(event) => {
                  event.stopPropagation();
                  closeSession(session.id);
                }}
                className="opacity-0 group-hover:opacity-100 hover:text-rose-300 transition-opacity"
                aria-label="Close terminal"
              >
                <X size={11} />
              </span>
            </button>
          ))}
        </div>

        <div className="relative flex-shrink-0">
          <div className="flex items-center">
            <button
              onClick={() => createSession()}
              title="New terminal"
              className="p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-white/5 transition-colors"
            >
              <Plus size={14} />
            </button>
            <button
              onClick={() => setPickerOpen((open) => !open)}
              title="Choose a shell"
              className="p-1 rounded-md text-slate-500 hover:text-white hover:bg-white/5 transition-colors"
            >
              <ChevronDown size={12} />
            </button>
          </div>

          {pickerOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setPickerOpen(false)} />
              <div className="absolute right-0 bottom-full mb-1 z-20 min-w-[180px] bg-[#161b22] border border-white/10 rounded-lg shadow-2xl py-1">
                {shells.map((shell) => (
                  <button
                    key={shell.id}
                    onClick={() => {
                      setPickerOpen(false);
                      createSession(shell.id);
                    }}
                    className="w-full text-left px-3 py-1.5 text-[12px] text-slate-300 hover:bg-white/5 hover:text-white transition-colors"
                  >
                    {shell.label}
                  </button>
                ))}
                <div className="border-t border-white/5 mt-1 pt-1 px-3 py-1">
                  <div className="flex items-center gap-1.5 text-[10px] text-slate-500">
                    <ShieldCheck size={10} className="text-emerald-500" />
                    Runs only on this computer
                  </div>
                  {mode !== 'pty' && (
                    <div className="text-[10px] text-amber-400/80 mt-1">
                      Limited mode — no interactive programs
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="flex-1 relative min-h-0">
        {sessions.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center text-slate-600 text-xs">
            No terminals open.
          </div>
        ) : (
          sessions.map((session) => (
            <TerminalInstance
              key={session.id}
              session={session}
              active={session.id === activeId}
              fontSize={fontSize}
              onExit={markExited}
            />
          ))
        )}
      </div>
    </div>
  );
}
