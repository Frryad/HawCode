/**
 * Presentation helpers for connected peers.
 *
 * Colours are derived from the peer's name rather than assigned, so every
 * computer independently arrives at the same colour for the same peer without
 * anything having to be negotiated over the network.
 */

const COLORS = [
  '#7aa2f7', '#9ece6a', '#e0af68', '#bb9af7',
  '#7dcfff', '#f7768e', '#ff9e64', '#73daca'
];

export function colorForPeer(name) {
  const text = String(name || '');
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }
  return COLORS[hash % COLORS.length];
}

export function initialsFor(name) {
  const text = String(name || '?').replace(/[^A-Za-z0-9]/g, ' ').trim();
  if (!text) return '?';
  const words = text.split(/\s+/);
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

export { COLORS as PEER_COLORS };
