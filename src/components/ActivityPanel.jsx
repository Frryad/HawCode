import React from 'react';
import {
  ArrowUp, ArrowDown, Trash2, FolderPlus, PenLine, Info, AlertTriangle, GitCompare, X
} from 'lucide-react';
import { formatBytes, formatClock } from '../lib/format';

// Each op the engine reports, mapped to how it reads in the log.
const OP_META = {
  send: { icon: ArrowUp, tone: 'text-blue-300', label: 'sent' },
  receive: { icon: ArrowDown, tone: 'text-emerald-300', label: 'received' },
  'delete-out': { icon: Trash2, tone: 'text-rose-300', label: 'deleted here → peer' },
  'delete-in': { icon: Trash2, tone: 'text-rose-300', label: 'deleted by peer' },
  'mkdir-out': { icon: FolderPlus, tone: 'text-indigo-300', label: 'folder → peer' },
  'mkdir-in': { icon: FolderPlus, tone: 'text-indigo-300', label: 'folder from peer' },
  'rename-out': { icon: PenLine, tone: 'text-amber-300', label: 'renamed → peer' },
  'rename-in': { icon: PenLine, tone: 'text-amber-300', label: 'renamed by peer' },
  conflict: { icon: GitCompare, tone: 'text-orange-300', label: 'conflict kept' },
  error: { icon: AlertTriangle, tone: 'text-rose-400', label: 'error' },
  info: { icon: Info, tone: 'text-slate-400', label: '' }
};

function Row({ entry }) {
  const meta = OP_META[entry.op] || OP_META.info;
  const Icon = meta.icon;
  return (
    <div className="flex items-start gap-2.5 px-4 py-1.5 hover:bg-white/[0.03] border-b border-white/[0.03]">
      <Icon size={13} className={`${meta.tone} mt-0.5 flex-shrink-0`} />
      <span className="text-[10px] text-slate-600 tabular-nums mt-0.5 flex-shrink-0 w-[62px]">
        {formatClock(entry.ts)}
      </span>
      <div className="min-w-0 flex-1">
        {entry.path && (
          <div className="text-[12px] text-slate-200 truncate font-mono" title={entry.path}>
            {entry.path}
          </div>
        )}
        {entry.message && (
          <div className={`text-[11px] ${entry.op === 'error' ? 'text-rose-300' : 'text-slate-500'} ${entry.path ? 'mt-0.5' : ''}`}>
            {entry.message}
          </div>
        )}
        {!entry.message && meta.label && (
          <div className="text-[10px] text-slate-600 mt-0.5">{meta.label}</div>
        )}
      </div>
      {entry.bytes > 0 && (
        <span className="text-[10px] text-slate-500 tabular-nums flex-shrink-0 mt-0.5">
          {formatBytes(entry.bytes)}
        </span>
      )}
    </div>
  );
}

export default function ActivityPanel({ entries, transfers, status, onClose }) {
  const inFlight = Object.values(transfers || {}).filter((t) => !t.done);

  return (
    <div className="h-64 flex-shrink-0 bg-[#0b0f16] border-t border-white/10 flex flex-col">
      <div className="flex items-center gap-3 px-4 h-9 border-b border-white/5 flex-shrink-0">
        <h3 className="text-[11px] font-bold uppercase tracking-widest text-slate-400">
          Sync Activity
        </h3>
        <span className="text-[10px] text-slate-600">
          {status.stats?.filesOut ?? 0} sent · {status.stats?.filesIn ?? 0} received ·{' '}
          {formatBytes((status.stats?.bytesOut ?? 0) + (status.stats?.bytesIn ?? 0))} total
        </span>
        <button
          onClick={onClose}
          className="ml-auto text-slate-500 hover:text-white transition-colors"
          aria-label="Close activity panel"
        >
          <X size={14} />
        </button>
      </div>

      {inFlight.length > 0 && (
        <div className="px-4 py-2 border-b border-white/5 space-y-1.5 flex-shrink-0">
          {inFlight.slice(0, 3).map((transfer) => (
            <div key={transfer.path}>
              <div className="flex items-center justify-between text-[10px] text-slate-400 mb-1">
                <span className="truncate font-mono">{transfer.path}</span>
                <span className="tabular-nums flex-shrink-0 ml-2">
                  {transfer.received}/{transfer.total} · {formatBytes(transfer.bytes)}
                </span>
              </div>
              <div className="h-1 bg-white/5 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-blue-500 to-indigo-500 transition-all duration-150"
                  style={{ width: `${Math.round((transfer.received / transfer.total) * 100)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {entries.length === 0 ? (
          <div className="h-full flex items-center justify-center text-slate-600 text-xs">
            Nothing synced yet. Changes will appear here as they happen.
          </div>
        ) : (
          entries.map((entry, index) => <Row key={`${entry.ts}-${index}`} entry={entry} />)
        )}
      </div>
    </div>
  );
}
