'use strict';

const crypto = require('crypto');
const os = require('os');
const path = require('path');

const { createPunchWindow } = require('./punch-window');
const { createChannelLink } = require('./channel-link');
const { createJoinLink } = require('./peer-join');
const { createApi } = require('../api');
const invite = require('./invite');

// Address reflection only: these servers tell this machine what its public
// address looks like from outside and relay nothing. Replaceable in Settings.
const DEFAULT_STUN = ['stun.l.google.com:19302', 'stun1.l.google.com:19302'];

/**
 * Direct peer-to-peer hosting.
 *
 * This is the answer to being stuck behind carrier-grade NAT: no port can be
 * forwarded and no name can be pointed here, so instead each friend punches a
 * hole straight to this machine and the files travel over that. Nothing is
 * rented, nothing is registered, and no third party ever sees a byte of the
 * folder — the one outside contact is a STUN lookup that reports this
 * machine's own address back to it.
 *
 * Signalling happens by hand: an invite code out, a reply code back, both
 * carried by whatever chat app the two friends already use. That is the cost of
 * having no server in the middle, and it is charged once per friend.
 */
function createP2PHost({ engine, onPeerChange, onPeerState, onJoinStatus, getDomain }) {
  const api = createApi({ engine, getDomain });
  const punch = createPunchWindow();
  const links = new Map();
  // Connections where we are the one joining somebody else's folder, rather
  // than serving our own. Same window, same channels, opposite role.
  const joins = new Map();
  const pending = new Map();
  const routes = new Map();

  let roomCode = null;
  let stunServers = DEFAULT_STUN;
  let running = false;

  function peerList() {
    return Array.from(links.values())
      .map((link) => ({ ...link.info, route: routes.get(link.peerId) || null }))
      .filter((peer) => peer.authed);
  }

  function announce() {
    if (onPeerChange) onPeerChange(peerList());
  }

  function dropPeer(peerId, reason) {
    const link = links.get(peerId);
    if (link) {
      links.delete(peerId);
      link.close(reason);
    }
    const join = joins.get(peerId);
    if (join) {
      joins.delete(peerId);
      join.close(reason);
    }
    routes.delete(peerId);
    pending.delete(peerId);
    punch.post('close', { peerId });
    announce();
  }

  punch.on('offer', ({ peerId, sdp }) => {
    const waiting = pending.get(peerId);
    if (waiting) waiting.resolve(sdp);
  });

  punch.on('answer', ({ peerId, sdp }) => {
    const waiting = pending.get(peerId);
    if (waiting) waiting.resolve(sdp);
  });

  punch.on('error', ({ peerId, message }) => {
    const waiting = pending.get(peerId);
    if (waiting) waiting.reject(new Error(message));
    if (onPeerState) onPeerState({ peerId, state: 'error', message });
  });

  punch.on('open', ({ peerId, route }) => {
    if (route) routes.set(peerId, route);

    const join = joins.get(peerId);
    if (join) {
      join.start();
      if (onPeerState) onPeerState({ peerId, state: 'open', route: route || null });
      return;
    }

    if (!links.has(peerId)) {
      links.set(peerId, createChannelLink({
        peerId,
        api,
        engine,
        roomCode,
        sendFrame: (frame) => punch.post('send', { peerId, frame }),
        onAuthed: () => announce(),
        onClose: (reason) => dropPeer(peerId, reason)
      }));
    }
    if (onPeerState) onPeerState({ peerId, state: 'open', route: route || null });
  });

  punch.on('message', ({ peerId, frame }) => {
    const link = links.get(peerId) || joins.get(peerId);
    if (link) link.feed(frame);
  });

  punch.on('state', ({ peerId, state, route }) => {
    if (route) routes.set(peerId, route);
    if (onPeerState) onPeerState({ peerId, state, route: route || null });
  });

  punch.on('closed', ({ peerId, reason }) => {
    if (!links.has(peerId) && !joins.has(peerId) && !routes.has(peerId)) return;
    dropPeer(peerId, reason);
  });

  return {
    async start(options = {}) {
      roomCode = options.roomCode || null;
      if (Array.isArray(options.stunServers) && options.stunServers.length) {
        stunServers = options.stunServers;
      }
      await punch.ensure();
      running = true;
    },

    /**
     * Mint an invite for one friend. One code, one friend: the answer has to
     * match this offer's ICE credentials, so a shared code would only work for
     * whoever replied first and would fail confusingly for everybody else.
     */
    async createInvite() {
      if (!running) return { error: 'Direct sharing is not running' };
      const peerId = crypto.randomUUID();
      const sdp = await new Promise((resolve, reject) => {
        pending.set(peerId, { resolve, reject });
        punch.post('create-offer', { peerId, stunServers });
        setTimeout(
          () => reject(new Error('Could not work out this computer\u2019s address in time. Check the STUN servers in Settings.')),
          25000
        );
      }).finally(() => pending.delete(peerId));

      return {
        peerId,
        sdp,
        code: invite.encode({
          t: 'offer',
          sdp,
          code: roomCode,
          folder: engine.rootPath ? path.basename(engine.rootPath) : null,
          host: os.hostname()
        })
      };
    },

    /** Feed back the reply code the friend sent. */
    acceptAnswer(peerId, answerCode) {
      if (!running) return { error: 'Direct sharing is not running' };
      const decoded = invite.decode(answerCode);
      if (decoded.error) return { error: decoded.error };
      if (decoded.payload.t !== 'answer') {
        return { error: 'That is an invite code, not a reply code. Ask your friend for the code their side produced.' };
      }
      punch.post('accept-answer', { peerId, sdp: decoded.payload.sdp });
      return { ok: true };
    },

    /**
     * Join somebody else's folder from an invite code they sent us. Returns the
     * reply code to send back — until they paste it, nothing is connected.
     */
    async join(inviteCode, options = {}) {
      // A computer that only ever joins never calls start(), so the configured
      // servers have to arrive here too rather than only through hosting.
      if (Array.isArray(options.stunServers) && options.stunServers.length) {
        stunServers = options.stunServers;
      }
      const decoded = invite.decode(inviteCode);
      if (decoded.error) return { error: decoded.error };
      if (decoded.payload.t !== 'offer') {
        return { error: 'That is a reply code, not an invite. Ask for the code their HawCode showed.' };
      }

      await punch.ensure();
      const peerId = crypto.randomUUID();

      joins.set(peerId, createJoinLink({
        peerId,
        engine,
        code: decoded.payload.code,
        sendFrame: (frame) => punch.post('send', { peerId, frame }),
        onStatus: (status) => {
          if (onJoinStatus) onJoinStatus(status);
        }
      }));

      try {
        const sdp = await new Promise((resolve, reject) => {
          pending.set(peerId, { resolve, reject });
          punch.post('create-answer', { peerId, sdp: decoded.payload.sdp, stunServers });
          setTimeout(() => reject(new Error('Could not work out this computer’s address in time')), 25000);
        }).finally(() => pending.delete(peerId));

        return {
          peerId,
          folder: decoded.payload.folder || null,
          host: decoded.payload.host || null,
          answerCode: invite.encode({ t: 'answer', sdp })
        };
      } catch (error) {
        dropPeer(peerId, 'answer-failed');
        return { error: error.message };
      }
    },

    /** Mirror of server.broadcastToBrowsers, for friends on a data channel. */
    notifyBrowsers(event, payload) {
      for (const link of links.values()) link.notify(event, payload);
    },

    peers: peerList,
    count: () => peerList().length,
    isRunning: () => running,

    async stop() {
      running = false;
      const everyone = new Set([...links.keys(), ...joins.keys()]);
      for (const peerId of everyone) dropPeer(peerId, 'stopped');
      punch.post('close-all', {});
      links.clear();
      joins.clear();
      routes.clear();
      pending.clear();
    },

    destroy() {
      punch.destroy();
    }
  };
}

module.exports = { createP2PHost, DEFAULT_STUN };
