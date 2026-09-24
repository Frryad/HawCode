'use strict';

const fs = require('fs');
const path = require('path');

const SETTINGS_VERSION = 1;

const DEFAULTS = {
  fontSize: 14,
  fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, monospace",
  wordWrap: true,
  minimap: false,
  tabSize: 2,
  // How long after the last keystroke an edit is written and synced.
  autoSaveDelayMs: 150,
  defaultShellId: null,
  terminalFontSize: 13,
  showPresence: true,
  confirmBeforeDelete: true,
  // Address reflection for direct peer-to-peer sharing: these are asked what
  // this machine looks like from outside, and are told nothing else. Emptying
  // the list limits direct sharing to the local network.
  stunServers: ['stun.l.google.com:19302', 'stun1.l.google.com:19302'],
  // The ending for domain names this computer issues, and whether it runs a
  // name server for them at all.
  domainEnding: 'box',
  dnsEnabled: true,
  // Reaching this computer from the internet by name. The local name server above
  // needs none of this; these only matter for the opt-in internet mode, where a
  // free provider holds a name pointed at this connection's public address.
  // Credentials survive turning the switch off.
  ddnsEnabled: false,
  ddnsProvider: null,        // null | 'duckdns' | 'noip' | 'dynu' | 'custom'
  ddnsHostname: '',          // the DuckDNS label, or the full name for the others
  ddnsUsername: '',          // No-IP / Dynu account name; the password is ddnsTokenEnc
  ddnsTokenEnc: '',          // through electron/secret.js; never sent to the renderer
  ddnsCustomUrl: '',         // https only, with <HOST> and <IP> placeholders
  ddnsIntervalMinutes: 15,
  // Windows Firewall, and the extra listener for a router that will not forward 80.
  firewallAutoApply: true,
  firewallExtraPort: null,
  // Ask the router over UPnP to forward the port while sharing online.
  upnpAutoForward: true,
  // Set once the file has been through migrateDdnsSwitch (below).
  ddnsSwitchHonoured: true,
  xamppEnabled: false,
  xamppPort: 80
};

/**
 * User settings, persisted in the Electron user-data folder.
 *
 * Same shape as `StateStore` in electron/manifest.js: load on construction,
 * write on every change, and treat a corrupt file as "use the defaults" rather
 * than an error — settings are never worth failing a launch over.
 */
class Settings {
  constructor(filePath) {
    this.filePath = filePath;
    this.values = { ...DEFAULTS };
    this.load();
  }

  load() {
    try {
      if (!fs.existsSync(this.filePath)) return;
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
      if (parsed && parsed.version === SETTINGS_VERSION && parsed.values) {
        // Merge rather than replace, so a setting added in a later version
        // still gets its default.
        this.values = { ...DEFAULTS, ...parsed.values };
        if (!('ddnsSwitchHonoured' in parsed.values)) this.migrateDdnsSwitch();
      }
    } catch {
      this.values = { ...DEFAULTS };
    }
  }

  /**
   * Earlier versions used a configured internet name whatever the on/off switch
   * said, so plenty of settings files have a working name with the switch off.
   * Now that the switch is honoured, carry the old behaviour over once, rather
   * than quietly stop keeping the name pointed at this computer.
   */
  migrateDdnsSwitch() {
    const v = this.values;
    if (!v.ddnsEnabled && v.ddnsProvider && v.ddnsHostname && v.ddnsTokenEnc) v.ddnsEnabled = true;
    v.ddnsSwitchHonoured = true;
    this.save();
  }

  save() {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.writeFileSync(
        this.filePath,
        JSON.stringify({ version: SETTINGS_VERSION, values: this.values }, null, 2),
        'utf-8'
      );
      return { ok: true };
    } catch (error) {
      return { error: error.message };
    }
  }

  all() {
    return { ...this.values };
  }

  get(key) {
    return this.values[key];
  }

  /** Apply a partial update, ignoring keys that are not real settings. */
  update(patch) {
    if (!patch || typeof patch !== 'object') return this.all();
    for (const [key, value] of Object.entries(patch)) {
      if (!(key in DEFAULTS)) continue;
      this.values[key] = value;
    }
    this.save();
    return this.all();
  }

  reset() {
    this.values = { ...DEFAULTS };
    this.save();
    return this.all();
  }
}

module.exports = { Settings, DEFAULTS };
