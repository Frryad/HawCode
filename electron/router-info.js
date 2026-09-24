'use strict';

const { execFile } = require('child_process');
const http = require('http');
const os = require('os');

const LOOKUP_TIMEOUT_MS = 6000;
const SNIFF_TIMEOUT_MS = 2500;

// MAC prefixes registered to TP-Link. Not exhaustive — the admin page is also
// sniffed below — but it names the brand without touching the network.
const TP_LINK_PREFIXES = new Set([
  '00-31-92', '14-CC-20', '18-A6-F7', '1C-3B-F3', '30-B5-C2', '3C-84-6A',
  '50-C7-BF', '54-AF-97', '5C-A6-E6', '5C-E9-31', '60-A4-B7', '60-E3-27',
  '64-70-02', '78-8C-B5', '98-DA-C4', 'A0-F3-C1', 'AC-84-C6', 'B0-4E-26',
  'C0-25-E9', 'C4-6E-1F', 'D8-07-B6', 'E8-48-B8', 'EC-08-6B', 'F4-F2-6D'
]);

function run(file, args) {
  return new Promise((resolve) => {
    execFile(file, args, { windowsHide: true, timeout: LOOKUP_TIMEOUT_MS, encoding: 'utf-8' },
      (error, stdout) => resolve(error ? '' : String(stdout || '')));
  });
}

/** 94:e2:3c:21:2c:49 → 94-E2-3C-21-2C-49, the form TP-Link's pages accept. */
function formatMac(mac) {
  if (!mac) return null;
  const hex = String(mac).replace(/[^0-9a-f]/gi, '').toUpperCase();
  if (hex.length !== 12 || /^0+$/.test(hex)) return null;
  return hex.match(/../g).join('-');
}

function prefixLength(netmask) {
  if (!netmask) return null;
  return netmask.split('.').reduce((bits, octet) => bits + Number(octet).toString(2).split('1').length - 1, 0);
}

/** The adapter carrying `address`, from Node's own view of the interfaces. */
function adapterFor(address) {
  for (const [name, entries] of Object.entries(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family === 'IPv4' && entry.address === address) {
        return { name, netmask: entry.netmask, mac: formatMac(entry.mac) };
      }
    }
  }
  return null;
}

/** SSID, signal and band of the connected Wi-Fi network, if there is one. */
async function wifiDetails() {
  const output = await run('netsh', ['wlan', 'show', 'interfaces']);
  if (!output) return null;
  const field = (label) => {
    const match = output.match(new RegExp(`^\\s*${label}\\s*:\\s*(.+)$`, 'mi'));
    return match ? match[1].trim() : null;
  };
  const ssid = field('SSID');
  if (!ssid) return null;
  return {
    ssid,
    bssid: formatMac(field('BSSID')),
    signal: field('Signal'),
    band: field('Band'),
    radio: field('Radio type'),
    channel: field('Channel')
  };
}

/** Whether Windows got this address from the router (DHCP) or has it typed in. */
async function addressConfig(adapter) {
  const output = await run('netsh', ['interface', 'ipv4', 'show', 'config', `name=${adapter}`]);
  if (!output) return { dhcp: null, dns: [] };
  const dhcpMatch = output.match(/DHCP enabled:\s*(\w+)/i);
  const dnsBlock = output.match(/DNS servers[^:]*:\s*([\s\S]*?)(?:\r?\n\s*Register|\r?\n\s*WINS|$)/i);
  const dns = dnsBlock ? (dnsBlock[1].match(/\d+\.\d+\.\d+\.\d+/g) || []) : [];
  return { dhcp: dhcpMatch ? /^yes$/i.test(dhcpMatch[1]) : null, dns };
}

/**
 * Public or Private, as Windows labels the network. On Public, Windows keeps
 * rules scoped to Private networks closed, so other devices cannot find this PC.
 */
async function networkCategory(adapter) {
  const output = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    `(Get-NetConnectionProfile -InterfaceAlias '${adapter.replace(/'/g, "''")}' | Select-Object -First 1).NetworkCategory`]);
  const match = output.match(/\b(Public|Private|DomainAuthenticated)\b/);
  return match ? match[1] : null;
}

async function gatewayMac(gateway) {
  const output = await run('arp', ['-a', gateway]);
  const match = output.match(/([0-9a-f]{2}[-:]){5}[0-9a-f]{2}/i);
  return match ? formatMac(match[0]) : null;
}

/** Look at the router's own login page for its brand. Local network only. */
function sniffAdminPage(gateway) {
  return new Promise((resolve) => {
    const request = http.get({ host: gateway, port: 80, path: '/', timeout: SNIFF_TIMEOUT_MS }, (response) => {
      let body = `${response.headers.server || ''} ${response.headers['www-authenticate'] || ''}`;
      response.setEncoding('utf-8');
      response.on('data', (chunk) => {
        body += chunk;
        if (body.length > 65536) response.destroy();
      });
      response.on('close', () => resolve(/tp-?link|tplinkwifi/i.test(body) ? 'TP-Link' : null));
    });
    request.on('timeout', () => request.destroy());
    request.on('error', () => resolve(null));
  });
}

/**
 * Everything needed to give this PC a fixed address on the Wi-Fi router and let
 * friends open the shared site: the values to type into the router, read live.
 */
async function inspect({ address, gateway, port, shareUrl }) {
  const adapter = address ? adapterFor(address) : null;
  const windows = process.platform === 'win32';
  const [wifi, config, routerMac, sniffed, category] = await Promise.all([
    windows ? wifiDetails() : null,
    windows && adapter ? addressConfig(adapter.name) : { dhcp: null, dns: [] },
    windows && gateway ? gatewayMac(gateway) : null,
    gateway ? sniffAdminPage(gateway) : null,
    windows && adapter ? networkCategory(adapter.name) : null
  ]);

  const byPrefix = routerMac && TP_LINK_PREFIXES.has(routerMac.slice(0, 8)) ? 'TP-Link' : null;
  const routerVendor = sniffed || byPrefix;

  return {
    adapter: adapter ? adapter.name : null,
    address: address || null,
    netmask: adapter ? adapter.netmask : null,
    prefix: adapter ? prefixLength(adapter.netmask) : null,
    mac: adapter ? adapter.mac : null,
    gateway: gateway || null,
    routerMac,
    routerVendor,
    dns: config.dns,
    dhcp: config.dhcp,
    wifi,
    networkCategory: category,
    port: port || null,
    shareUrl: shareUrl || null,
    adminUrls: [
      gateway ? `http://${gateway}` : null,
      routerVendor === 'TP-Link' ? 'http://tplinkwifi.net' : null
    ].filter(Boolean)
  };
}

module.exports = { inspect, formatMac, prefixLength };
