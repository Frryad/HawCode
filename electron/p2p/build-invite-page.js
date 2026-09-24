'use strict';

const fs = require('fs');
const path = require('path');

const TEMPLATE = path.join(__dirname, 'browser-client.html');
const WIRE = path.join(__dirname, 'wire.js');

function safeFileName(folderName) {
  const base = String(folderName || 'workspace').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return `hawcode-invite-${base || 'workspace'}.html`;
}

/**
 * Bake one invite into a single self-contained page.
 *
 * It has to survive being sent through a chat app and opened from the
 * Downloads folder, so everything it needs is inlined: no script tags pointing
 * outward, no stylesheet, no build step. The wire protocol is the same source
 * file the host uses rather than a copy, so the two can never drift apart.
 */
function buildInvitePage({ sdp, roomCode, folderName, hostName, stunServers }) {
  const template = fs.readFileSync(TEMPLATE, 'utf-8');
  const wire = fs.readFileSync(WIRE, 'utf-8');

  const invite = {
    v: 1,
    sdp,
    code: roomCode,
    folder: folderName,
    host: hostName,
    stun: (stunServers || []).map((entry) => (/^stuns?:/i.test(entry) ? entry : `stun:${entry}`))
  };

  // JSON.stringify can emit "</script>" inside a string and close the tag early.
  const encoded = JSON.stringify(invite).replace(/</g, '\u003c');

  return template
    .replace('/*__WIRE__*/', () => wire)
    .replace('/*__INVITE__*/ null', () => encoded);
}

function writeInvitePage(targetPath, options) {
  fs.writeFileSync(targetPath, buildInvitePage(options), 'utf-8');
  return targetPath;
}

module.exports = { buildInvitePage, writeInvitePage, safeFileName };
