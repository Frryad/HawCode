'use strict';

const dgram = require('dgram');
const os = require('os');

const UDP_PORT = 41234;
const BEACON_TYPE = 'HAWCODE_WORKSPACE_BEACON';
const BEACON_INTERVAL_MS = 3000;
const PEER_TIMEOUT_MS = 8000;
const SWEEP_INTERVAL_MS = 3000;

/**
 * LAN presence over UDP broadcast: each host announces its workspace every few
 * seconds, and every instance keeps a list of what it has heard recently. This
 * is what lets the Join dialog show nearby workspaces instead of asking the
 * user to type an IP address.
 */
function createDiscovery({ onPeersChanged, getBeacon }) {
  let socket = null;
  let broadcastTimer = null;
  let sweepTimer = null;
  const peers = new Map();
  let selfId = null;

  function list() {
    return Array.from(peers.values());
  }

  function start() {
    if (socket) return;
    try {
      socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

      socket.on('error', (error) => {
        console.error('HawCode discovery socket error:', error.message);
      });

      socket.on('message', (message) => {
        let data;
        try {
          data = JSON.parse(message.toString());
        } catch {
          return;
        }
        if (data.type !== BEACON_TYPE || !data.url || !data.id) return;
        // Ignore our own broadcast coming back to us.
        if (selfId && data.id === selfId) return;
        const previous = peers.get(data.id);
        peers.set(data.id, { ...data, lastSeen: Date.now() });
        // Only repaint the UI when something actually changed, not on every
        // 3-second keepalive.
        if (!previous || previous.url !== data.url || previous.folderName !== data.folderName ||
            previous.peerCount !== data.peerCount || previous.requiresCode !== data.requiresCode) {
          onPeersChanged(list());
        }
      });

      socket.bind(UDP_PORT, () => {
        try {
          socket.setBroadcast(true);
        } catch (error) {
          console.error('HawCode could not enable UDP broadcast:', error.message);
        }
      });

      sweepTimer = setInterval(() => {
        const now = Date.now();
        let changed = false;
        for (const [id, peer] of peers) {
          if (now - peer.lastSeen > PEER_TIMEOUT_MS) {
            peers.delete(id);
            changed = true;
          }
        }
        if (changed) onPeersChanged(list());
      }, SWEEP_INTERVAL_MS);
    } catch (error) {
      console.error('HawCode could not start discovery:', error.message);
    }
  }

  function startBroadcasting(id) {
    stopBroadcasting();
    selfId = id;
    const send = () => {
      if (!socket) return;
      const beacon = getBeacon();
      if (!beacon) return;
      const payload = Buffer.from(JSON.stringify({
        type: BEACON_TYPE,
        id,
        hostName: os.hostname(),
        ...beacon
      }));
      try {
        socket.send(payload, 0, payload.length, UDP_PORT, '255.255.255.255');
      } catch (error) {
        console.error('HawCode beacon send failed:', error.message);
      }
    };
    send();
    broadcastTimer = setInterval(send, BEACON_INTERVAL_MS);
  }

  function stopBroadcasting() {
    if (broadcastTimer) {
      clearInterval(broadcastTimer);
      broadcastTimer = null;
    }
  }

  function stop() {
    stopBroadcasting();
    if (sweepTimer) {
      clearInterval(sweepTimer);
      sweepTimer = null;
    }
    if (socket) {
      try {
        socket.close();
      } catch {
        // Already closed.
      }
      socket = null;
    }
    peers.clear();
  }

  return { start, stop, startBroadcasting, stopBroadcasting, list };
}

module.exports = { createDiscovery, UDP_PORT };
