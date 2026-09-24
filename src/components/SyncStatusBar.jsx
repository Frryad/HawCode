import React from 'react';
import {
  Pause, Play, Square, Activity, Users, Gauge, Clock, Server as ServerIcon,
  Wifi, Globe, PauseCircle, AlertTriangle
} from 'lucide-react';
import { formatRate, formatAgo } from '../lib/format';

const STATE_STYLES = {
  running: { label: 'Syncing live', dot: 'bg-emerald-400', text: 'text-emerald-300' },
  paused: { label: 'Paused', dot: 'bg-amber-400', text: 'text-amber-300' },
  stopped: { label: 'Stopped', dot: 'bg-rose-400', text: 'text-rose-300' },
  idle: { label: 'Not sharing', dot: 'bg-slate-500', text: 'text-slate-400' }
};

function Stat({ icon: Icon, label, value, title }) {
  return (
    <div className="flex items-center gap-1.5 text-[11px] text-slate-400" title={title}>
      <Icon size={12} className="text-slate-500 flex-shrink-0" />
      <span className="text-slate-500">{label}</span>
      <span className="text-slate-200 font-medium tabular-nums">{value}</span>
    </div>
  );
}

export default function SyncStatusBar({ status, onPause, onResume, onStop, onToggleActivity, activityOpen }) {
  const state = STATE_STYLES[status.state] || STATE_STYLES.idle;
  const queued = (status.queued?.outbound || 0) + (status.queued?.inbound || 0);
  const isRunning = status.state === 'running';
  const isPaused = status.state === 'paused';
  const canControl = isRunning || isPaused;

  return (
    <div className="flex items-center gap-4 px-4 h-11 bg-[#0b0f16] border-t border-white/5 flex-shrink-0">
      <div className="flex items-center gap-2 flex-shrink-0">
        <span className={`w-2 h-2 rounded-full ${state.dot} ${isRunning ? 'animate-pulse' : ''}`} />
        <span className={`text-xs font-semibold ${state.text}`}>{state.label}</span>
      </div>

      <div className="flex items-center gap-1.5 text-[11px] text-slate-400 flex-shrink-0">
        {status.mode === 'host'
          ? <ServerIcon size={12} className="text-blue-400" />
          : <Wifi size={12} className="text-blue-400" />}
        <span className="text-slate-300 font-medium">
          {status.mode === 'host' ? 'Hosting' : status.mode === 'client' ? 'Joined' : '—'}
        </span>
        {status.exposure === 'online' && (
          status.publicUrl ? (
            <div className="flex items-center gap-1.5 ml-1">
              <button
                onClick={() => window.electronAPI && window.electronAPI.openExternal && window.electronAPI.openExternal(status.localTestUrl || `http://localhost:${status.port || 3000}`)}
                className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 text-[10px] font-medium transition-colors cursor-pointer"
                title={`Open website locally on this PC: ${status.localTestUrl || `http://localhost:${status.port || 3000}`}`}
              >
                Local Web
              </button>
              <button
                onClick={() => window.electronAPI && window.electronAPI.openExternal && window.electronAPI.openExternal(status.publicUrl)}
                className="flex items-center gap-1 text-purple-300 hover:text-purple-200 underline transition-colors cursor-pointer"
                title={`Click to open internet link: ${status.publicUrl} (Note: on this PC, test with Local Web if your router lacks NAT loopback)`}
              >
                <Globe size={11} /> {status.provider === 'ddns' ? 'DDNS link' : 'online link'}
              </button>
            </div>
          ) : (
            <span className="flex items-center gap-1 text-purple-300 ml-1">
              <Globe size={11} /> {status.provider === 'direct' ? 'direct' : 'online'}
            </span>
          )
        )}
        {status.domain && (
          <span
            className="text-emerald-300 font-mono ml-1 truncate"
            title={status.domainUrl || status.domain}
          >
            {status.domain}
          </span>
        )}
      </div>

      <div className="h-4 w-px bg-white/10 flex-shrink-0" />

      <div className="flex items-center gap-4 overflow-hidden">
        <Stat
          icon={Users}
          label="peers"
          value={status.peerCount ?? 0}
          title={(status.peers || []).map((p) => p.name).join(', ') || 'No desktop peers connected'}
        />
        <Stat icon={Gauge} label="speed" value={formatRate(status.stats?.throughput)} />
        <Stat icon={Clock} label="last" value={formatAgo(status.stats?.lastSyncAt)} />
        {queued > 0 && (
          <div className="flex items-center gap-1.5 text-[11px] text-amber-300" title="Changes held until you resume">
            <PauseCircle size={12} />
            <span className="font-medium tabular-nums">{queued} queued</span>
          </div>
        )}
        {status.peerPaused && (
          <div className="flex items-center gap-1.5 text-[11px] text-amber-400/90" title="The other computer paused its sync">
            <AlertTriangle size={12} />
            <span>peer paused</span>
          </div>
        )}
      </div>

      <div className="ml-auto flex items-center gap-2 flex-shrink-0">
        <button
          onClick={onToggleActivity}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-colors ${
            activityOpen
              ? 'bg-indigo-500/20 text-indigo-300'
              : 'text-slate-400 hover:text-white hover:bg-white/5'
          }`}
        >
          <Activity size={13} />
          Activity
        </button>

        {isPaused ? (
          <button
            onClick={onResume}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25 text-[11px] font-semibold transition-colors"
          >
            <Play size={13} />
            Resume
          </button>
        ) : (
          <button
            onClick={onPause}
            disabled={!isRunning}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/15 text-amber-300 hover:bg-amber-500/25 disabled:opacity-35 disabled:hover:bg-amber-500/15 text-[11px] font-semibold transition-colors"
          >
            <Pause size={13} />
            Pause
          </button>
        )}

        <button
          onClick={onStop}
          disabled={!canControl}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-500/15 text-rose-300 hover:bg-rose-500/25 disabled:opacity-35 disabled:hover:bg-rose-500/15 text-[11px] font-semibold transition-colors"
        >
          <Square size={12} />
          Stop
        </button>
      </div>
    </div>
  );
}
