import React from 'react';
import { Users } from 'lucide-react';
import PeerDot from './PeerDot';

/**
 * Who else is in this workspace and what they are looking at.
 *
 * Presence is transient and per-connection: when a peer disconnects the engine
 * drops it, so this never shows a stale computer.
 */
export default function PresenceBar({ peers, onOpenFile }) {
  if (!peers || !peers.length) return null;

  return (
    <div className="flex items-center gap-2 px-3 h-8 bg-[#0d1117] border-b border-white/5 flex-shrink-0 overflow-x-auto custom-scrollbar">
      <Users size={12} className="text-slate-600 flex-shrink-0" />
      {peers.map((peer) => (
        <button
          key={peer.peerId}
          onClick={() => peer.path && onOpenFile(peer.path)}
          disabled={!peer.path}
          className="flex items-center gap-1.5 px-1.5 py-0.5 rounded-md hover:bg-white/5 disabled:hover:bg-transparent transition-colors flex-shrink-0"
        >
          <PeerDot peer={peer} size={16} showTooltip={false} />
          <span className="text-[11px] text-slate-300">{peer.name}</span>
          {peer.path ? (
            <span className="text-[10px] text-slate-600 font-mono">
              {peer.path.split('/').pop()}:{peer.line}
            </span>
          ) : (
            <span className="text-[10px] text-slate-700">idle</span>
          )}
        </button>
      ))}
    </div>
  );
}
