'use strict';

const path = require('path');

/**
 * The workspace API, with no transport attached.
 *
 * Express routes in electron/server.js and the peer-to-peer data channel in
 * electron/p2p/channel-link.js both go through here, so a browser friend gets
 * exactly the same behaviour whether it reached us over the LAN or through a
 * hole punched in the carrier's NAT.
 *
 * Every method answers `{ ok, status, body }` — close enough to an HTTP reply
 * for the Express adapter to be a one-liner, plain enough for the data channel
 * to serialise as JSON. `raw` is the one exception: it returns an absolute path
 * for the caller to stream or read, because the two transports send bytes
 * differently.
 */
function createApi({ engine, getDomain }) {
  const noFolder = { ok: false, status: 400, body: { error: 'No folder shared' } };

  return {
    hello(requiresCode) {
      return {
        ok: true,
        status: 200,
        body: {
          app: 'hawcode',
          requiresCode: Boolean(requiresCode),
          folderName: engine.rootPath ? path.basename(engine.rootPath) : null,
          state: engine.state,
          // The name this computer issued for the folder. A joining peer adopts
          // it so the same address works on their side too.
          domain: (getDomain && getDomain()) || null
        }
      };
    },

    tree() {
      if (!engine.rootPath) return { ok: true, status: 200, body: { error: 'No folder shared' } };
      return { ok: true, status: 200, body: engine.getTree() };
    },

    read(relativePath) {
      if (!engine.rootPath) return { ok: true, status: 200, body: { error: 'No folder shared' } };
      if (!relativePath) return { ok: false, status: 400, body: { error: 'Path missing' } };
      const result = engine.readForEditor(relativePath);
      if (result.error) return { ok: false, status: 404, body: result };
      return { ok: true, status: 200, body: result };
    },

    /** Resolve a path for raw byte access, refusing anything outside the folder. */
    raw(relativePath) {
      const absolute = engine.resolve(relativePath || '');
      if (!absolute) return { ok: false, status: 400, body: { error: 'Invalid path' } };
      return { ok: true, status: 200, body: { absolute } };
    },

    write(relativePath, content) {
      if (!engine.rootPath) return noFolder;
      if (typeof relativePath !== 'string' || typeof content !== 'string') {
        return {
          ok: false,
          status: 400,
          body: { error: 'A valid path and string content are required' }
        };
      }
      const result = engine.writeFromEditor(relativePath, content);
      if (result.error) return { ok: false, status: 400, body: result };
      return { ok: true, status: 200, body: { ok: true } };
    }
  };
}

module.exports = { createApi };
