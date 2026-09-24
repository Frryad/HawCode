'use strict';

const { UpnpClient } = require('./upnp');

const LEASE_SECONDS = 3600;
// Plenty of routers keep port 80 on their WAN side for their own admin page and
// refuse to hand it out. 8080 is the port people already expect to type instead.
const FALLBACK_FOR_80 = 8080;

/**
 * Ask the router to forward one port to this computer, over UPnP.
 *
 * This is what makes "Share online" work without anyone opening a router admin
 * page. Everything stays on the local network: SSDP multicast finds the router
 * and SOAP asks it for the mapping. The mapping is leased, renewed at half the
 * lease and deleted again on stop, so nothing is left open on the router after
 * HawCode is closed (a crash leaves at most one lease's worth).
 */
function createPortMapper({ getLocalAddress, onStatus } = {}) {
  const upnp = new UpnpClient();
  let mapping = null; // { externalPort, internalPort, localAddress }
  let renewTimer = null;
  let state = { ok: false, active: false, externalPort: null, externalIp: null, router: null, error: null };

  function report(next) {
    state = { ...state, ...next };
    if (onStatus) onStatus(state);
    return state;
  }

  function clearRenew() {
    if (renewTimer) clearTimeout(renewTimer);
    renewTimer = null;
  }

  async function tryMap(externalPort, internalPort, localAddress) {
    await upnp.addMapping({
      externalPort,
      internalPort,
      internalClient: localAddress,
      description: `HawCode TCP ${internalPort}`,
      leaseSeconds: LEASE_SECONDS,
      localAddress
    });
    return externalPort;
  }

  /** Map `internalPort` (80 or the extra port) on the router to this computer. */
  async function start(internalPort) {
    clearRenew();
    const localAddress = getLocalAddress ? getLocalAddress() : null;
    if (!internalPort || !localAddress) {
      return report({ ok: false, active: false, error: 'No local address or port to forward.' });
    }
    if (mapping && (mapping.internalPort !== internalPort || mapping.localAddress !== localAddress)) {
      await stop();
    }

    const gateway = await upnp.discover({ localAddress, force: !mapping }).catch(() => null);
    if (!gateway) {
      return report({
        ok: false,
        active: false,
        externalPort: null,
        error: upnp.lastError || 'No UPnP router answered. Turn on UPnP in the router, or forward the port by hand.'
      });
    }

    let externalPort = null;
    let lastError = null;
    const candidates = mapping
      ? [mapping.externalPort]
      : (internalPort === 80 ? [80, FALLBACK_FOR_80] : [internalPort]);
    for (const candidate of candidates) {
      try {
        externalPort = await tryMap(candidate, internalPort, localAddress);
        break;
      } catch (error) {
        lastError = error;
      }
    }

    const externalIp = await upnp.getExternalIp({ localAddress }).catch(() => null);
    const info = upnp.info();
    if (!externalPort) {
      mapping = null;
      return report({
        ok: false,
        active: false,
        externalPort: null,
        externalIp,
        router: info.friendlyName || info.routerAddress || null,
        error: `The router refused to forward port ${internalPort}: ${lastError ? lastError.message : 'unknown error'}.`
      });
    }

    mapping = { externalPort, internalPort, localAddress };
    renewTimer = setTimeout(() => { start(internalPort).catch(() => {}); }, (LEASE_SECONDS / 2) * 1000);
    if (renewTimer.unref) renewTimer.unref();
    return report({
      ok: true,
      active: true,
      externalPort,
      externalIp,
      router: info.friendlyName || info.routerAddress || null,
      error: null
    });
  }

  /** Take the mapping back. Safe to call when nothing is mapped. */
  async function stop() {
    clearRenew();
    if (!mapping) return report({ ok: false, active: false, externalPort: null, error: null });
    const current = mapping;
    mapping = null;
    await upnp.deleteMapping({ externalPort: current.externalPort, localAddress: current.localAddress })
      .catch(() => {});
    return report({ ok: false, active: false, externalPort: null, error: null });
  }

  return {
    start,
    stop,
    /** Re-map after this computer's LAN address changed. */
    async refresh() {
      if (!mapping) return state;
      const port = mapping.internalPort;
      await stop();
      return start(port);
    },
    isActive: () => Boolean(mapping),
    get status() {
      return state;
    }
  };
}

module.exports = { createPortMapper };
