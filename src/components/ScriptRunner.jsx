import React, { useState, useEffect, useCallback } from 'react';
import { Play, Package, RefreshCw, TerminalSquare, AlertTriangle } from 'lucide-react';

const api = window.electronAPI;

/**
 * Run buttons for the scripts in the workspace's package.json.
 *
 * Starting one opens a terminal tab and types the command into it, rather than
 * spawning a process of its own — so output, scrollback and stopping all behave
 * exactly like anything else the user runs by hand.
 */
export default function ScriptRunner({ rootPath, onRan }) {
  const [info, setInfo] = useState(null);
  const [running, setRunning] = useState(null);

  const refresh = useCallback(async () => {
    setInfo(await api.scriptsList());
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh, rootPath]);

  const run = async (script) => {
    setRunning(script.name);
    const created = await api.scriptsRun({ invocation: script.invocation, name: script.name });
    setRunning(null);
    if (created && created.error) {
      window.alert(created.error);
      return;
    }
    // Bring the terminal into view so the output is not started off-screen.
    if (onRan) onRan(created);
  };

  if (!rootPath) {
    return (
      <div className="p-6 text-center">
        <Package size={28} className="mx-auto text-slate-600 mb-3" />
        <h3 className="text-sm font-medium text-slate-300 mb-1">No folder open</h3>
        <p className="text-[11px] text-slate-500">Host or join a workspace first.</p>
      </div>
    );
  }

  if (!info) {
    return <div className="p-4 text-[11px] text-slate-500">Reading package.json…</div>;
  }

  if (!info.hasPackageJson) {
    return (
      <div className="p-6 text-center">
        <Package size={28} className="mx-auto text-slate-600 mb-3" />
        <h3 className="text-sm font-medium text-slate-300 mb-1">No package.json</h3>
        <p className="text-[11px] text-slate-500">
          This folder has no npm scripts. You can still use the terminal directly.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-3 h-9 border-b border-white/5 flex-shrink-0">
        <span className="text-[10px] uppercase tracking-widest text-slate-400 font-bold">Scripts</span>
        {info.projectName && (
          <span className="text-[10px] text-slate-600 truncate">{info.projectName}</span>
        )}
        <span className="ml-auto text-[10px] text-slate-600 bg-white/5 px-1.5 rounded">
          {info.packageManager}
        </span>
        <button onClick={refresh} title="Refresh"
          className="p-1 rounded text-slate-400 hover:text-white hover:bg-white/5 transition-colors">
          <RefreshCw size={12} />
        </button>
      </div>

      {info.error && (
        <div className="flex items-start gap-2 m-2 p-2 rounded-md bg-rose-500/10 border border-rose-500/20">
          <AlertTriangle size={13} className="text-rose-400 flex-shrink-0 mt-0.5" />
          <span className="text-[11px] text-rose-200">{info.error}</span>
        </div>
      )}

      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {info.scripts.length === 0 ? (
          <div className="text-center text-slate-600 text-[11px] mt-8 px-4">
            package.json has no scripts.
          </div>
        ) : info.scripts.map((script) => (
          <div key={script.name} className="group flex items-center gap-2 px-3 py-2 hover:bg-white/5 border-b border-white/[0.03]">
            <button
              onClick={() => run(script)}
              disabled={running === script.name}
              title={`Run ${script.invocation}`}
              className="p-1.5 rounded-md bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25 disabled:opacity-40 transition-colors flex-shrink-0"
            >
              <Play size={12} />
            </button>
            <div className="min-w-0 flex-1">
              <div className="text-[12px] text-slate-200 font-medium truncate">{script.name}</div>
              <div className="text-[10px] text-slate-600 font-mono truncate" title={script.command}>
                {script.command}
              </div>
            </div>
            <TerminalSquare size={11} className="text-slate-700 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
          </div>
        ))}
      </div>

      <div className="px-3 py-2 border-t border-white/5 text-[10px] text-slate-600">
        Scripts run on this computer only.
      </div>
    </div>
  );
}
