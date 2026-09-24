import React, { useState, useRef, useCallback } from 'react';
import { TerminalSquare, Activity, X, ChevronDown, ChevronUp } from 'lucide-react';
import TerminalPanel from './TerminalPanel';
import ActivityPanel from './ActivityPanel';

const MIN_HEIGHT = 120;
const MAX_FRACTION = 0.8;

/**
 * Declared out here rather than inside the panel: a component defined during
 * render is a brand new type on every render, so React would unmount and
 * remount it — losing any state it held.
 */
function PanelTab({ id, icon: Icon, label, active, onSelect }) {
  return (
    <button
      onClick={() => onSelect(id)}
      className={`flex items-center gap-1.5 px-3 h-full text-[11px] font-medium border-b-2 transition-colors ${
        active
          ? 'border-indigo-400 text-white'
          : 'border-transparent text-slate-500 hover:text-slate-300'
      }`}
    >
      <Icon size={13} />
      {label}
    </button>
  );
}

/**
 * The resizable panel across the bottom of the window.
 *
 * Both tabs stay mounted once opened: unmounting the terminal would kill its
 * xterm instance and lose the viewport, and the sync log would lose its scroll
 * position. Hidden tabs are simply not displayed.
 */
export default function BottomPanel({
  tab,
  onTabChange,
  onClose,
  activityEntries,
  transfers,
  status,
  terminalFontSize,
  onTerminalCount
}) {
  const [height, setHeight] = useState(280);
  const [maximised, setMaximised] = useState(false);
  const dragState = useRef(null);

  // Latches the first time the terminal tab is shown and never goes back, so
  // switching to the sync log hides the terminal instead of destroying it —
  // unmounting would kill the xterm instance and lose the session's viewport.
  // Adjusting state during render is React's documented way to derive state
  // from a prop change; it re-renders immediately without committing the
  // in-between result.
  const [terminalMounted, setTerminalMounted] = useState(tab === 'terminal');
  if (tab === 'terminal' && !terminalMounted) setTerminalMounted(true);

  const startDrag = useCallback((event) => {
    dragState.current = { startY: event.clientY, startHeight: height };
    event.preventDefault();

    const onMove = (moveEvent) => {
      if (!dragState.current) return;
      // Dragging up grows the panel, so the delta is inverted.
      const delta = dragState.current.startY - moveEvent.clientY;
      const next = dragState.current.startHeight + delta;
      const limit = window.innerHeight * MAX_FRACTION;
      setHeight(Math.min(limit, Math.max(MIN_HEIGHT, next)));
    };
    const onUp = () => {
      dragState.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'ns-resize';
    document.body.style.userSelect = 'none';
  }, [height]);

  const effectiveHeight = maximised ? window.innerHeight * MAX_FRACTION : height;

  return (
    <div
      className="flex flex-col bg-[#0b0f16] border-t border-white/10 flex-shrink-0"
      style={{ height: effectiveHeight }}
    >
      <div
        onMouseDown={startDrag}
        className="h-1 -mt-1 cursor-ns-resize hover:bg-indigo-500/40 transition-colors flex-shrink-0"
        role="separator"
        aria-orientation="horizontal"
      />

      <div className="flex items-center h-9 border-b border-white/5 flex-shrink-0">
        <PanelTab id="terminal" icon={TerminalSquare} label="Terminal"
          active={tab === 'terminal'} onSelect={onTabChange} />
        <PanelTab id="activity" icon={Activity} label="Sync Activity"
          active={tab === 'activity'} onSelect={onTabChange} />

        <div className="ml-auto flex items-center gap-0.5 pr-2">
          <button
            onClick={() => setMaximised((value) => !value)}
            title={maximised ? 'Restore panel' : 'Maximise panel'}
            className="p-1.5 rounded text-slate-500 hover:text-white hover:bg-white/5 transition-colors"
          >
            {maximised ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
          </button>
          <button
            onClick={onClose}
            title="Close panel (Ctrl+`)"
            className="p-1.5 rounded text-slate-500 hover:text-white hover:bg-white/5 transition-colors"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      <div className="flex-1 relative min-h-0">
        {terminalMounted && (
          <div
            className="absolute inset-0"
            style={{ visibility: tab === 'terminal' ? 'visible' : 'hidden' }}
          >
            <TerminalPanel
              fontSize={terminalFontSize}
              onSessionsChanged={onTerminalCount}
            />
          </div>
        )}

        {tab === 'activity' && (
          <div className="absolute inset-0 overflow-hidden">
            <ActivityPanel
              entries={activityEntries}
              transfers={transfers}
              status={status}
              onClose={onClose}
            />
          </div>
        )}
      </div>
    </div>
  );
}
