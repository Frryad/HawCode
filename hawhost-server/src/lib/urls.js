import { url } from './format';

function isLocalHost(h, localIp) {
  return h === localIp || h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || /^(10|127|192\.168|172\.(1[6-9]|2\d|3[01]))\./.test(h);
}

/**
 * The addresses a website can be opened at, e.g.
 *   LAN      http://192.168.1.101/
 *   Internet http://mysite.duckdns.org/
 */
export function siteUrls(site, data) {
  const s = data.config.server;
  const localIp = data.network.localIp;
  const claimed = new Set(data.config.websites.filter((w) => w.enabled && w.id !== site.id).flatMap((w) => w.hostnames));
  const ddnsHosts = (data.ddns.records || []).filter((r) => r.enabled).map((r) => r.hostname);

  let hosts;
  if (site.hostnames.includes('*')) hosts = [localIp, ...ddnsHosts.filter((h) => !claimed.has(h))];
  else hosts = site.hostnames.filter((h) => !h.startsWith('*.'));

  const targets = [];
  if (site.port) targets.push({ port: site.port, tls: s.enableHttps && site.port === s.httpsPort });
  else {
    if (s.enableHttp) targets.push({ port: s.httpPort, tls: false });
    if (s.enableHttps) targets.push({ port: s.httpsPort, tls: true });
  }

  const out = [];
  for (const h of hosts) {
    for (const t of targets) {
      if (site.forceHttps && !t.tls && s.enableHttps) continue;
      out.push({ url: url(h, t.port, t.tls), kind: isLocalHost(h, localIp) ? 'lan' : 'internet', host: h });
    }
  }
  return out;
}

export function allAddresses(data) {
  const seen = new Set();
  const out = [];
  for (const site of data.config.websites.filter((w) => w.enabled)) {
    for (const u of siteUrls(site, data)) {
      if (seen.has(u.url)) continue;
      seen.add(u.url);
      out.push({ ...u, site: site.name });
    }
  }
  return out;
}
