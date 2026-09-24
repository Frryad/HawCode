import React from 'react';
import { colorForPeer, initialsFor } from '../lib/peers';

/**
 * A peer's badge — their initials in a colour derived from their name.
 * Used in the presence strip and beside files in the tree.
 */
export default function PeerDot({ peer, size = 18, showTooltip = true }) {
  const color = colorForPeer(peer.name);
  return (
    <span
      title={showTooltip
        ? `${peer.name}${peer.path ? ` — ${peer.path}:${peer.line}` : ' — no file open'}`
        : undefined}
      style={{
        width: size,
        height: size,
        backgroundColor: `${color}33`,
        color,
        borderColor: `${color}66`
      }}
      className="inline-flex items-center justify-center rounded-full border text-[9px] font-bold flex-shrink-0"
    >
      {initialsFor(peer.name)}
    </span>
  );
}
