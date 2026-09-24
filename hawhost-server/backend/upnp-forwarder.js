'use strict';

/**
 * Optional automatic router port forwarding over UPnP. While the web server
 * runs, every listening port is mapped to this PC and renewed before the
 * lease runs out; when the server stops (or the option is turned off) the
 * mappings HawHost created are removed again.
 */
class UpnpForwarder {
  constructor({ store, engine, upnp, logger, getLocalIp }) {
    this.store = store;
    this.engine = engine;
    this.upnp = upnp;
    this.logger = logger;
    this.getLocalIp = getLocalIp;
    this.mapped = new Map(); // port -> { ok, error, at }
    this.timer = null;
    this.pending = Promise.resolve();
  }

  wantedPorts() {
    const router = this.store.get().router;
    if (!router.upnpEnabled || !router.upnpAutoForward || !this.engine.running) return [];
    return this.engine.status().listeners.filter((l) => l.state === 'listening').map((l) => l.port);
  }

  sync() {
    this.pending = this.pending.then(() => this._sync()).catch((err) => this.logger.warn('upnp', err.message));
    return this.pending;
  }

  async _sync() {
    const wanted = this.wantedPorts();
    const router = this.store.get().router;
    const localAddress = await this.getLocalIp();

    for (const port of [...this.mapped.keys()]) {
      if (!wanted.includes(port)) {
        try {
          await this.upnp.deleteMapping({ externalPort: port, localAddress });
          this.logger.info('upnp', `Removed router forwarding for port ${port}.`);
        } catch { /* already gone */ }
        this.mapped.delete(port);
      }
    }
    for (const port of wanted) {
      try {
        await this.upnp.addMapping({
          externalPort: port,
          internalPort: port,
          internalClient: localAddress,
          description: `HawHost TCP ${port}`,
          leaseSeconds: router.upnpLeaseSeconds,
          localAddress
        });
        if (!this.mapped.get(port)?.ok) this.logger.info('upnp', `Router now forwards port ${port} to ${localAddress}.`);
        this.mapped.set(port, { ok: true, error: null, at: new Date().toISOString() });
      } catch (err) {
        if (this.mapped.get(port)?.error !== err.message) this.logger.warn('upnp', `Could not forward port ${port}: ${err.message}`);
        this.mapped.set(port, { ok: false, error: err.message, at: new Date().toISOString() });
      }
    }

    clearTimeout(this.timer);
    if (wanted.length) {
      const lease = router.upnpLeaseSeconds || 3600;
      this.timer = setTimeout(() => this.sync(), Math.max(300, Math.floor(lease / 2)) * 1000);
    }
  }

  status() {
    return [...this.mapped.entries()].map(([port, s]) => ({ port, ...s }));
  }

  async shutdown() {
    clearTimeout(this.timer);
    const localAddress = await this.getLocalIp().catch(() => null);
    await Promise.all([...this.mapped.keys()].map((port) => this.upnp.deleteMapping({ externalPort: port, localAddress }).catch(() => {})));
    this.mapped.clear();
  }
}

module.exports = { UpnpForwarder };
