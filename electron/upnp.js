'use strict';

const dgram = require('dgram');
const http = require('http');

const SSDP_ADDR = '239.255.255.250';
const SSDP_PORT = 1900;
const SEARCH_TARGETS = [
  'urn:schemas-upnp-org:device:InternetGatewayDevice:1',
  'urn:schemas-upnp-org:device:InternetGatewayDevice:2',
  'urn:schemas-upnp-org:service:WANIPConnection:1',
  'urn:schemas-upnp-org:service:WANIPConnection:2',
  'urn:schemas-upnp-org:service:WANPPPConnection:1'
];
const SERVICE_PREFERENCE = [
  'urn:schemas-upnp-org:service:WANIPConnection:2',
  'urn:schemas-upnp-org:service:WANIPConnection:1',
  'urn:schemas-upnp-org:service:WANPPPConnection:1'
];

const UPNP_ERRORS = {
  402: 'Invalid arguments',
  501: 'Action failed',
  606: 'Not authorized (UPnP port forwarding is disabled or restricted on the router)',
  713: 'No more entries',
  714: 'No such mapping',
  715: 'Wildcard remote host not supported',
  716: 'Wildcard port not supported',
  718: 'This external port is already forwarded to another device',
  724: 'Router requires the same internal and external port',
  725: 'Router only supports permanent mappings',
  726: 'Remote host must be a wildcard',
  727: 'External port must not be a wildcard',
  728: 'The router mapping table is full'
};

class UpnpError extends Error {
  constructor(code, description) {
    super(UPNP_ERRORS[code] || description || `UPnP error ${code}`);
    this.code = code;
  }
}

function xmlEscape(s) {
  return String(s).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
}

function tag(xml, name) {
  const m = new RegExp(`<(?:[\\w-]+:)?${name}[^>]*>([\\s\\S]*?)</(?:[\\w-]+:)?${name}>`, 'i').exec(xml);
  return m ? m[1].trim().replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&') : null;
}

/** Pull WAN connection services and device info out of an IGD description document. */
function parseDescription(xml, location) {
  const base = tag(xml, 'URLBase') || location;
  const services = [];
  const re = /<service>([\s\S]*?)<\/service>/gi;
  let m;
  while ((m = re.exec(xml))) {
    const type = tag(m[1], 'serviceType');
    const control = tag(m[1], 'controlURL');
    if (type && control && /WAN(IP|PPP)Connection/.test(type)) {
      services.push({ serviceType: type, controlUrl: new URL(control, base).toString() });
    }
  }
  services.sort((a, b) => SERVICE_PREFERENCE.indexOf(a.serviceType) - SERVICE_PREFERENCE.indexOf(b.serviceType));
  return {
    friendlyName: tag(xml, 'friendlyName'),
    manufacturer: tag(xml, 'manufacturer'),
    modelName: tag(xml, 'modelName'),
    services
  };
}

function httpRequest(url, { method = 'GET', headers = {}, body = null, timeoutMs = 4000 } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method, headers, agent: false }, (res) => {
      let data = '';
      res.setEncoding('utf-8');
      res.on('data', (d) => { data += d; });
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error('Router did not answer in time')));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function ssdpSearch(localAddress, timeoutMs) {
  return new Promise((resolve) => {
    const locations = new Set();
    const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    const finish = () => {
      try { sock.close(); } catch { /* ignore */ }
      resolve([...locations]);
    };
    sock.on('error', finish);
    sock.on('message', (msg) => {
      const loc = /^location:\s*(.+)$/im.exec(msg.toString());
      if (loc) locations.add(loc[1].trim());
    });
    sock.bind(0, localAddress || undefined, () => {
      for (const st of SEARCH_TARGETS) {
        const packet = Buffer.from(
          `M-SEARCH * HTTP/1.1\r\nHOST: ${SSDP_ADDR}:${SSDP_PORT}\r\nMAN: "ssdp:discover"\r\nMX: 2\r\nST: ${st}\r\n\r\n`
        );
        sock.send(packet, SSDP_PORT, SSDP_ADDR, () => {});
      }
      setTimeout(finish, timeoutMs);
    });
  });
}

/**
 * Minimal UPnP Internet Gateway Device client (shared with hawhost-server/backend/upnp.js). Everything stays on the local
 * network: SSDP multicast to find the router, then SOAP calls to the router.
 */
class UpnpClient {
  constructor({ logger } = {}) {
    this.logger = logger;
    this.gateway = null;
    this.discoveredAt = 0;
    this.lastError = null;
  }

  async discover({ localAddress, force = false, timeoutMs = 2500 } = {}) {
    if (!force && this.gateway && Date.now() - this.discoveredAt < 10 * 60 * 1000) return this.gateway;
    this.gateway = null;
    const locations = await ssdpSearch(localAddress, timeoutMs);
    for (const location of locations) {
      try {
        const res = await httpRequest(location);
        const desc = parseDescription(res.body, location);
        for (const service of desc.services) {
          // Pick the WAN service that is actually connected (has an external IP).
          const gw = { ...desc, ...service, location, localAddress };
          try {
            const ip = await this._externalIp(gw);
            if (ip) {
              this.gateway = gw;
              this.discoveredAt = Date.now();
              this.lastError = null;
              return gw;
            }
          } catch { /* try next service */ }
          if (!this.gateway) this.gateway = gw;
        }
      } catch { /* not an IGD or unreachable */ }
    }
    if (this.gateway) {
      this.discoveredAt = Date.now();
      return this.gateway;
    }
    this.lastError = 'No UPnP router found. UPnP is probably turned off in the router: on a TP-Link open '
      + 'http://192.168.0.1 (or tplinkwifi.net) and enable it under Forwarding → UPnP (older firmware such as '
      + 'TL-WR940N/TL-WR841N) or Advanced → NAT Forwarding → UPnP, or forward the port by hand under Virtual Servers.';
    return null;
  }

  async soap(gw, action, args = {}) {
    const argXml = Object.entries(args).map(([k, v]) => `<${k}>${xmlEscape(v)}</${k}>`).join('');
    const body = '<?xml version="1.0"?>'
      + '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">'
      + `<s:Body><u:${action} xmlns:u="${gw.serviceType}">${argXml}</u:${action}></s:Body></s:Envelope>`;
    const res = await httpRequest(gw.controlUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset="utf-8"',
        SOAPAction: `"${gw.serviceType}#${action}"`,
        'Content-Length': Buffer.byteLength(body)
      },
      body
    });
    if (res.status !== 200) {
      const code = Number(tag(res.body, 'errorCode'));
      throw new UpnpError(code || res.status, tag(res.body, 'errorDescription') || `HTTP ${res.status}`);
    }
    return res.body;
  }

  async _externalIp(gw) {
    const xml = await this.soap(gw, 'GetExternalIPAddress');
    const ip = tag(xml, 'NewExternalIPAddress');
    return ip && ip !== '0.0.0.0' ? ip : null;
  }

  async getExternalIp(opts) {
    const gw = await this.discover(opts);
    if (!gw) return null;
    return this._externalIp(gw);
  }

  async addMapping({ externalPort, internalPort, internalClient, protocol = 'TCP', description = 'HawCode', leaseSeconds = 3600, localAddress }) {
    const gw = await this.discover({ localAddress });
    if (!gw) throw new Error(this.lastError);
    const args = (lease) => ({
      NewRemoteHost: '',
      NewExternalPort: externalPort,
      NewProtocol: protocol,
      NewInternalPort: internalPort || externalPort,
      NewInternalClient: internalClient || gw.localAddress,
      NewEnabled: 1,
      NewPortMappingDescription: description,
      NewLeaseDuration: lease
    });
    try {
      await this.soap(gw, 'AddPortMapping', args(leaseSeconds));
    } catch (err) {
      if (err.code === 725 && leaseSeconds !== 0) await this.soap(gw, 'AddPortMapping', args(0));
      else throw err;
    }
    return true;
  }

  async deleteMapping({ externalPort, protocol = 'TCP', localAddress }) {
    const gw = await this.discover({ localAddress });
    if (!gw) throw new Error(this.lastError);
    await this.soap(gw, 'DeletePortMapping', { NewRemoteHost: '', NewExternalPort: externalPort, NewProtocol: protocol });
    return true;
  }

  async listMappings({ localAddress, max = 128 } = {}) {
    const gw = await this.discover({ localAddress });
    if (!gw) return [];
    const out = [];
    for (let i = 0; i < max; i += 1) {
      let xml;
      try {
        xml = await this.soap(gw, 'GetGenericPortMappingEntry', { NewPortMappingIndex: i });
      } catch {
        break; // 713 = end of table (or router does not support listing)
      }
      out.push({
        externalPort: Number(tag(xml, 'NewExternalPort')),
        protocol: tag(xml, 'NewProtocol'),
        internalPort: Number(tag(xml, 'NewInternalPort')),
        internalClient: tag(xml, 'NewInternalClient'),
        enabled: tag(xml, 'NewEnabled') === '1',
        description: tag(xml, 'NewPortMappingDescription') || '',
        leaseSeconds: Number(tag(xml, 'NewLeaseDuration') || 0)
      });
    }
    return out;
  }

  async getMapping({ externalPort, protocol = 'TCP', localAddress }) {
    const gw = await this.discover({ localAddress });
    if (!gw) return null;
    try {
      const xml = await this.soap(gw, 'GetSpecificPortMappingEntry', { NewRemoteHost: '', NewExternalPort: externalPort, NewProtocol: protocol });
      return {
        externalPort,
        protocol,
        internalPort: Number(tag(xml, 'NewInternalPort')),
        internalClient: tag(xml, 'NewInternalClient'),
        enabled: tag(xml, 'NewEnabled') === '1',
        description: tag(xml, 'NewPortMappingDescription') || ''
      };
    } catch {
      return null;
    }
  }

  info() {
    const gw = this.gateway;
    return gw ? {
      found: true,
      friendlyName: gw.friendlyName,
      manufacturer: gw.manufacturer,
      modelName: gw.modelName,
      serviceType: gw.serviceType,
      routerAddress: new URL(gw.location).hostname
    } : { found: false, error: this.lastError };
  }
}

module.exports = { UpnpClient, UpnpError, parseDescription, tag };
