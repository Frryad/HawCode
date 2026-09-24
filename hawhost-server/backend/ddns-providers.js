'use strict';

const USER_AGENT = 'HawCode HawHost/2.0 (self-hosted web server for Windows)';
const IPV4 = /\b(\d{1,3}(?:\.\d{1,3}){3})\b/;

function basicAuth(user, pass) {
  return `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
}

// dyndns2 protocol answers (No-IP, Dynu and many others).
const DYNDNS2 = {
  good: { ok: true, message: 'Updated' },
  nochg: { ok: true, message: 'Already up to date' },
  nohost: { ok: false, fatal: true, message: 'Hostname not found in this account' },
  badauth: { ok: false, fatal: true, message: 'Wrong username or password' },
  badagent: { ok: false, fatal: true, message: 'Update client rejected by provider' },
  '!donator': { ok: false, fatal: true, message: 'This feature needs a paid account' },
  abuse: { ok: false, fatal: true, message: 'Hostname blocked by the provider for too many updates' },
  notfqdn: { ok: false, fatal: true, message: 'Hostname is not a full domain name' },
  numhost: { ok: false, fatal: true, message: 'Too many hostnames in one update' },
  dnserr: { ok: false, message: 'Provider DNS error, will retry' },
  911: { ok: false, message: 'Provider is having problems, will retry later' }
};

function parseDyndns2(status, body) {
  const text = body.trim();
  const word = text.split(/\s+/)[0] || '';
  const known = DYNDNS2[word.toLowerCase()] || DYNDNS2[word];
  const ip = (IPV4.exec(text) || [])[1] || null;
  if (known) return { ...known, ip, raw: text };
  if (status === 401) return { ...DYNDNS2.badauth, ip: null, raw: text };
  return { ok: false, message: `Unexpected answer: ${text.slice(0, 120) || `HTTP ${status}`}`, ip, raw: text };
}

const PROVIDERS = {
  duckdns: {
    label: 'DuckDNS',
    suffix: '.duckdns.org',
    signupUrl: 'https://www.duckdns.org/',
    fields: { username: false, token: 'Token (from the DuckDNS home page)' },
    // DuckDNS has no separate "what is my IP" address; an update without an
    // IP makes DuckDNS use the address the request came from, and
    // verbose=true returns that address. DuckDNS recommends updating every 5 minutes.
    ipEchoUrl: null,
    updateWithoutIpIsCheap: true,
    buildUpdate(rec, ip) {
      const label = rec.hostname.replace(/\.duckdns\.org$/, '');
      const url = new URL('https://www.duckdns.org/update');
      url.searchParams.set('domains', label);
      url.searchParams.set('token', rec.token);
      url.searchParams.set('ip', ip || '');
      url.searchParams.set('verbose', 'true');
      return { url: url.toString(), headers: { 'User-Agent': USER_AGENT } };
    },
    parse(status, body) {
      const lines = body.trim().split(/\r?\n/);
      if (lines[0] === 'OK') {
        return { ok: true, ip: IPV4.test(lines[1] || '') ? lines[1].trim() : null, message: lines[3] === 'UPDATED' ? 'Updated' : 'Already up to date', raw: body.trim() };
      }
      return { ok: false, fatal: true, message: 'DuckDNS answered KO: check the subdomain and token', raw: body.trim() };
    },
    validate(rec) {
      if (!rec.token) return 'Paste your DuckDNS token.';
      if (!rec.hostname.endsWith('.duckdns.org')) return 'DuckDNS hostnames end in .duckdns.org';
      return null;
    }
  },

  noip: {
    label: 'No-IP (free)',
    suffix: '.ddns.net',
    signupUrl: 'https://www.noip.com/sign-up',
    fields: { username: 'No-IP username or e-mail (or DDNS key username)', token: 'Password (or DDNS key password)' },
    ipEchoUrl: 'http://ip1.dynupdate.no-ip.com/',
    buildUpdate(rec, ip) {
      const url = new URL('https://dynupdate.no-ip.com/nic/update');
      url.searchParams.set('hostname', rec.hostname);
      if (ip) url.searchParams.set('myip', ip);
      return { url: url.toString(), headers: { 'User-Agent': USER_AGENT, Authorization: basicAuth(rec.username, rec.token) } };
    },
    parse: parseDyndns2,
    validate(rec) {
      if (!rec.username || !rec.token) return 'No-IP needs your username and password.';
      return null;
    }
  },

  dynu: {
    label: 'Dynu',
    suffix: '.dynu.net',
    signupUrl: 'https://www.dynu.com/en-US/ControlPanel/CreateAccount',
    fields: { username: 'Dynu username', token: 'Password (or IP update password)' },
    ipEchoUrl: 'http://checkip.dynu.com/',
    buildUpdate(rec, ip) {
      const url = new URL('https://api.dynu.com/nic/update');
      url.searchParams.set('hostname', rec.hostname);
      if (ip) url.searchParams.set('myip', ip);
      return { url: url.toString(), headers: { 'User-Agent': USER_AGENT, Authorization: basicAuth(rec.username, rec.token) } };
    },
    parse: parseDyndns2,
    validate(rec) {
      if (!rec.username || !rec.token) return 'Dynu needs your username and password.';
      return null;
    }
  },

  custom: {
    label: 'Other (custom update URL)',
    suffix: '',
    signupUrl: null,
    fields: { username: 'Username (optional, sent as Basic auth)', token: 'Password / token (optional)' },
    ipEchoUrl: null,
    buildUpdate(rec, ip) {
      const fill = (s) => s
        .replace(/\{hostname\}|<HOST>/g, encodeURIComponent(rec.hostname))
        .replace(/\{ip\}|<IP>/g, encodeURIComponent(ip || ''))
        .replace(/\{username\}|<USER>/g, encodeURIComponent(rec.username))
        .replace(/\{token\}|\{password\}|<TOKEN>|<PASS>/g, encodeURIComponent(rec.token));
      const headers = { 'User-Agent': USER_AGENT };
      if (rec.username && rec.token && !/\{username\}|<USER>/.test(rec.updateUrl)) headers.Authorization = basicAuth(rec.username, rec.token);
      return { url: fill(rec.updateUrl), headers };
    },
    parse(status, body) {
      const d = parseDyndns2(status, body);
      if (d.ok || d.fatal) return d;
      const text = body.trim();
      if (status >= 200 && status < 300 && !/^(ko|error|fail|bad)/i.test(text)) {
        return { ok: true, ip: (IPV4.exec(text) || [])[1] || null, message: 'Updated', raw: text };
      }
      return { ok: false, message: `HTTP ${status}: ${text.slice(0, 120)}`, raw: text };
    },
    validate(rec) {
      // http:// would send the password in clear text to everyone on the path.
      if (!/^https:\/\//i.test(rec.updateUrl)) return 'Enter the https:// update URL your provider gives you.';
      return null;
    }
  }
};

function publicInfo() {
  return Object.fromEntries(Object.entries(PROVIDERS).map(([id, p]) => [id, {
    id, label: p.label, suffix: p.suffix, signupUrl: p.signupUrl, fields: p.fields, hasIpEcho: Boolean(p.ipEchoUrl)
  }]));
}

module.exports = { PROVIDERS, parseDyndns2, publicInfo, USER_AGENT, IPV4 };
