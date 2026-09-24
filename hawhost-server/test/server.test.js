'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const { PROVIDERS, parseDyndns2 } = require('../backend/ddns-providers');
const { escapeHtml, resolveInside, stripV4Mapped } = require('../backend/http-util');
const { classifyIPv4 } = require('../backend/network-info');
const { apacheConfig, nginxConfig } = require('../backend/config-export');
const { ConfigStore } = require('../backend/config-store');

test('DDNS Provider URL builders', () => {
  // DuckDNS
  const duckRec = { hostname: 'mysite.duckdns.org', token: 'test-token-123' };
  const duckReq = PROVIDERS.duckdns.buildUpdate(duckRec, '203.0.113.24');
  const duckUrl = new URL(duckReq.url);
  assert.equal(duckUrl.hostname, 'www.duckdns.org');
  assert.equal(duckUrl.searchParams.get('domains'), 'mysite');
  assert.equal(duckUrl.searchParams.get('token'), 'test-token-123');
  assert.equal(duckUrl.searchParams.get('ip'), '203.0.113.24');

  // DuckDNS parser
  const duckRes = PROVIDERS.duckdns.parse(200, 'OK\n203.0.113.24\nNOCHANGE\nUPDATED');
  assert.equal(duckRes.ok, true);
  assert.equal(duckRes.ip, '203.0.113.24');

  // No-IP
  const noipRec = { hostname: 'myserver.ddns.net', username: 'user1', token: 'pass1' };
  const noipReq = PROVIDERS.noip.buildUpdate(noipRec, '203.0.113.24');
  const noipUrl = new URL(noipReq.url);
  assert.equal(noipUrl.hostname, 'dynupdate.no-ip.com');
  assert.equal(noipUrl.searchParams.get('hostname'), 'myserver.ddns.net');
  assert.equal(noipUrl.searchParams.get('myip'), '203.0.113.24');
  assert.ok(noipReq.headers.Authorization.startsWith('Basic '));

  // dyndns2 parser
  const parsedGood = parseDyndns2(200, 'good 203.0.113.24');
  assert.equal(parsedGood.ok, true);
  assert.equal(parsedGood.ip, '203.0.113.24');

  const parsedNochg = parseDyndns2(200, 'nochg 203.0.113.24');
  assert.equal(parsedNochg.ok, true);
  assert.equal(parsedNochg.ip, '203.0.113.24');
});

test('HTTP utilities', () => {
  assert.equal(escapeHtml('<script>alert("xss")</script>'), '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
  assert.equal(stripV4Mapped('::ffff:192.168.1.50'), '192.168.1.50');
  assert.equal(stripV4Mapped('127.0.0.1'), '127.0.0.1');

  const root = path.resolve('C:\\sites\\welcome');
  const inside = resolveInside(root, 'images/pic.png');
  assert.equal(inside.error, undefined);
  assert.ok(inside.path.startsWith(root));
});

test('IPv4 Classification (NAT / CGNAT / Public)', () => {
  assert.equal(classifyIPv4('192.168.1.101'), 'private');
  assert.equal(classifyIPv4('10.0.0.5'), 'private');
  assert.equal(classifyIPv4('172.16.0.1'), 'private');
  assert.equal(classifyIPv4('100.64.0.1'), 'cgnat');
  assert.equal(classifyIPv4('100.100.50.2'), 'cgnat');
  assert.equal(classifyIPv4('203.0.113.24'), 'public');
  assert.equal(classifyIPv4('8.8.8.8'), 'public');
});

test('ConfigStore initialization and mutations', () => {
  const tmpFile = path.join(os.tmpdir(), `hawhost-test-${Date.now()}.json`);
  const store = new ConfigStore(tmpFile);

  const initial = store.get();
  assert.equal(initial.server.httpPort, 80);

  const site = store.addWebsite({
    name: 'My Test Site',
    type: 'static',
    hostnames: ['mysite.duckdns.org'],
    root: os.tmpdir()
  });

  assert.equal(site.name, 'My Test Site');
  assert.equal(store.get().websites.length, 1);

  store.updateWebsite(site.id, { name: 'Renamed Site' });
  assert.equal(store.get().websites[0].name, 'Renamed Site');

  store.deleteWebsite(site.id);
  assert.equal(store.get().websites.length, 0);

  try { fs.unlinkSync(tmpFile); } catch {}
});

test('Apache & Nginx config export', () => {
  const cfg = {
    server: { enableHttp: true, httpPort: 80, enableHttps: true, httpsPort: 443, extraPorts: [] },
    websites: [
      {
        id: '1',
        name: 'DuckDNS Site',
        enabled: true,
        type: 'static',
        hostnames: ['mysite.duckdns.org'],
        root: 'C:\\sites\\mysite',
        indexFiles: ['index.html'],
        directoryListing: false,
        spaFallback: false,
        port: null
      }
    ]
  };

  const apache = apacheConfig(cfg, []);
  assert.ok(apache.includes('<VirtualHost *:80>'));
  assert.ok(apache.includes('ServerName mysite.duckdns.org'));
  assert.ok(apache.includes('DocumentRoot "C:/sites/mysite"'));

  const nginx = nginxConfig(cfg, []);
  assert.ok(nginx.includes('server {'));
  assert.ok(nginx.includes('listen 80;'));
  assert.ok(nginx.includes('server_name mysite.duckdns.org;'));
  assert.ok(nginx.includes('root "C:/sites/mysite";'));
});

test('dyndns2 answers', () => {
  assert.equal(parseDyndns2(200, 'good 203.0.113.9').ok, true);
  assert.equal(parseDyndns2(200, 'good 203.0.113.9').ip, '203.0.113.9');
  assert.equal(parseDyndns2(200, 'nochg 203.0.113.9').ok, true);
  const bad = parseDyndns2(200, 'badauth');
  assert.equal(bad.ok, false);
  assert.equal(bad.fatal, true);
  assert.equal(parseDyndns2(401, '').fatal, true);
  assert.equal(parseDyndns2(200, '911').fatal, undefined);
});

test('Custom DDNS update URL must be https', () => {
  const tmpFile = path.join(os.tmpdir(), `hawhost-test-http-${Date.now()}.json`);
  const store = new ConfigStore(tmpFile);
  assert.throws(() => store.addDdnsRecord({
    provider: 'custom', hostname: 'me.example.com', updateUrl: 'http://update.example.com/?h={hostname}'
  }), /https:\/\//);
  assert.match(PROVIDERS.custom.validate({ updateUrl: 'http://x.example/' }), /https:\/\//);
  assert.equal(PROVIDERS.custom.validate({ updateUrl: 'https://x.example/' }), null);
  try { fs.unlinkSync(tmpFile); } catch {}
});

test('DDNS tokens are encrypted on disk and migrated from plain text', { skip: process.platform !== 'win32' }, () => {
  const tmpFile = path.join(os.tmpdir(), `hawhost-test-secret-${Date.now()}.json`);
  // A config written before encryption existed.
  const legacy = new ConfigStore(tmpFile);
  legacy.addDdnsRecord({ provider: 'duckdns', hostname: 'mysite', token: 'plain-token-1' });
  const onDisk = JSON.parse(fs.readFileSync(tmpFile, 'utf-8'));
  assert.ok(onDisk.ddns.records[0].token.startsWith('enc:dpapi:'));
  assert.ok(!fs.readFileSync(tmpFile, 'utf-8').includes('plain-token-1'));

  // Hand-edit back to plain text, as an old version would have left it.
  onDisk.ddns.records[0].token = 'plain-token-2';
  fs.writeFileSync(tmpFile, JSON.stringify(onDisk));
  const reopened = new ConfigStore(tmpFile);
  assert.equal(reopened.get().ddns.records[0].token, 'plain-token-2');
  assert.ok(JSON.parse(fs.readFileSync(tmpFile, 'utf-8')).ddns.records[0].token.startsWith('enc:dpapi:'));

  // And it reads back after a restart.
  assert.equal(new ConfigStore(tmpFile).get().ddns.records[0].token, 'plain-token-2');
  try { fs.unlinkSync(tmpFile); } catch {}
});
