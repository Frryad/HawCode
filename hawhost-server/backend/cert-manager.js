'use strict';

const fs = require('fs');
const path = require('path');
const tls = require('tls');
const crypto = require('crypto');
const { promisify } = require('util');
const forge = require('node-forge');

const { ValidationError } = require('./config-store');

const generateKeyPair = promisify(crypto.generateKeyPair);
const PEM_CERT = /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g;

function splitChain(pem) {
  return String(pem || '').match(PEM_CERT) || [];
}

function parseSan(x509) {
  const hostnames = [];
  for (const part of String(x509.subjectAltName || '').split(',')) {
    const m = /^\s*(DNS|IP Address):(.+)$/.exec(part);
    if (m) hostnames.push(m[2].trim().toLowerCase());
  }
  if (!hostnames.length) {
    const cn = /CN=([^\n,]+)/.exec(x509.subject || '');
    if (cn) hostnames.push(cn[1].trim().toLowerCase());
  }
  return hostnames;
}

function describe(certPem) {
  const chain = splitChain(certPem);
  if (!chain.length) throw new ValidationError('No PEM certificate found. It must contain "-----BEGIN CERTIFICATE-----".');
  const leaf = new crypto.X509Certificate(chain[0]);
  const issuer = (/O=([^\n]+)/.exec(leaf.issuer) || /CN=([^\n]+)/.exec(leaf.issuer) || [])[1] || leaf.issuer;
  return {
    hostnames: parseSan(leaf),
    subject: leaf.subject,
    issuer: issuer.trim(),
    validFrom: new Date(leaf.validFrom).toISOString(),
    validTo: new Date(leaf.validTo).toISOString(),
    selfSigned: leaf.issuer === leaf.subject,
    fingerprint256: leaf.fingerprint256,
    chainLength: chain.length,
    leaf
  };
}

function hostMatchesCert(hostname, pattern) {
  if (pattern === hostname) return true;
  if (pattern.startsWith('*.')) {
    const suffix = pattern.slice(1); // ".example.org"
    return hostname.endsWith(suffix) && !hostname.slice(0, -suffix.length).includes('.');
  }
  return false;
}

/**
 * Certificates live in <data>\certs\<id>\{cert.pem,key.pem,meta.json}.
 * Imported certificates may remember their source files; when those change
 * (win-acme / certbot renewals) they are re-imported automatically.
 */
class CertManager {
  constructor({ certsDir, logger }) {
    this.certsDir = certsDir;
    this.logger = logger;
    this.entries = new Map(); // id -> { meta, context }
    fs.mkdirSync(certsDir, { recursive: true });
    this.loadAll();
  }

  loadAll() {
    this.entries.clear();
    for (const id of fs.readdirSync(this.certsDir)) {
      const dir = path.join(this.certsDir, id);
      try {
        if (!fs.statSync(dir).isDirectory()) continue;
        this._load(id);
      } catch (err) {
        this.logger && this.logger.warn('certs', `Skipping certificate ${id}: ${err.message}`);
      }
    }
  }

  _load(id) {
    const dir = path.join(this.certsDir, id);
    const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf-8'));
    const cert = fs.readFileSync(path.join(dir, 'cert.pem'), 'utf-8');
    const key = fs.readFileSync(path.join(dir, 'key.pem'), 'utf-8');
    const context = tls.createSecureContext({ cert, key });
    this.entries.set(id, { meta, context });
    return meta;
  }

  _store({ id, certPem, keyPem, name, source, sourceCertPath = null, sourceKeyPath = null }) {
    const info = describe(certPem);
    let keyObject;
    try {
      keyObject = crypto.createPrivateKey(keyPem);
    } catch (err) {
      throw new ValidationError(`The private key could not be read (${err.message}). It must be an unencrypted PEM key.`);
    }
    if (!info.leaf.checkPrivateKey(keyObject)) {
      throw new ValidationError('The private key does not belong to this certificate.');
    }
    const certId = id || `cert_${crypto.randomBytes(4).toString('hex')}`;
    const dir = path.join(this.certsDir, certId);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'cert.pem'), splitChain(certPem).join('\n') + '\n');
    fs.writeFileSync(path.join(dir, 'key.pem'), keyObject.export({ type: 'pkcs8', format: 'pem' }));
    const meta = {
      id: certId,
      name: name || info.hostnames[0] || certId,
      source,
      hostnames: info.hostnames,
      subject: info.subject,
      issuer: info.issuer,
      validFrom: info.validFrom,
      validTo: info.validTo,
      selfSigned: info.selfSigned,
      fingerprint256: info.fingerprint256,
      chainLength: info.chainLength,
      sourceCertPath,
      sourceKeyPath,
      sourceMtime: sourceCertPath ? fs.statSync(sourceCertPath).mtimeMs : null,
      importedAt: new Date().toISOString()
    };
    fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2));
    this._load(certId);
    return this.decorate(meta);
  }

  decorate(meta) {
    const daysLeft = Math.floor((new Date(meta.validTo).getTime() - Date.now()) / 86400000);
    return {
      ...meta,
      daysLeft,
      status: daysLeft < 0 ? 'expired' : daysLeft < 14 ? 'expiring' : 'valid',
      certPath: path.join(this.certsDir, meta.id, 'cert.pem')
    };
  }

  list() {
    return [...this.entries.values()].map((e) => this.decorate(e.meta))
      .sort((a, b) => (a.id === 'default') - (b.id === 'default') || a.name.localeCompare(b.name));
  }

  get(id) {
    const e = this.entries.get(id);
    return e ? this.decorate(e.meta) : null;
  }

  async createSelfSigned({ hostnames, days = 825, id = null, name = null }) {
    const names = [...new Set((hostnames || []).map((h) => String(h).trim().toLowerCase()).filter(Boolean))];
    if (!names.length) names.push('localhost');
    const { privateKey, publicKey } = await generateKeyPair('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    });

    const cert = forge.pki.createCertificate();
    cert.publicKey = forge.pki.publicKeyFromPem(publicKey);
    cert.serialNumber = `01${crypto.randomBytes(15).toString('hex')}`;
    cert.validity.notBefore = new Date(Date.now() - 60000);
    cert.validity.notAfter = new Date(Date.now() + days * 86400000);
    const attrs = [
      { name: 'commonName', value: names[0].replace(/^\*\./, 'wildcard.') },
      { name: 'organizationName', value: 'HawHost self-signed' }
    ];
    cert.setSubject(attrs);
    cert.setIssuer(attrs);
    cert.setExtensions([
      { name: 'basicConstraints', cA: false },
      { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
      { name: 'extKeyUsage', serverAuth: true },
      {
        name: 'subjectAltName',
        altNames: names.map((n) => (/^\d{1,3}(\.\d{1,3}){3}$/.test(n) ? { type: 7, ip: n } : { type: 2, value: n }))
      },
      { name: 'subjectKeyIdentifier' }
    ]);
    cert.sign(forge.pki.privateKeyFromPem(privateKey), forge.md.sha256.create());

    const meta = this._store({
      id,
      certPem: forge.pki.certificateToPem(cert),
      keyPem: privateKey,
      name: name || `Self-signed: ${names[0]}`,
      source: 'self-signed'
    });
    this.logger && this.logger.info('certs', `Created self-signed certificate for ${names.join(', ')}.`);
    return meta;
  }

  importPem({ certPem, keyPem, name }) {
    const meta = this._store({ certPem, keyPem, name, source: 'imported' });
    this.logger && this.logger.info('certs', `Imported certificate for ${meta.hostnames.join(', ')}.`);
    return meta;
  }

  /** Import from files and keep watching them for renewals. */
  importFiles({ certPath, keyPath, name }) {
    if (!certPath || !keyPath) throw new ValidationError('Choose both the certificate file and the private key file.');
    const certPem = fs.readFileSync(certPath, 'utf-8');
    const keyPem = fs.readFileSync(keyPath, 'utf-8');
    const meta = this._store({ certPem, keyPem, name, source: 'file', sourceCertPath: certPath, sourceKeyPath: keyPath });
    this.logger && this.logger.info('certs', `Imported ${certPath}; HawHost will reload it when it is renewed.`);
    return meta;
  }

  importPfx({ pfxPath, pfxBase64, passphrase = '', name }) {
    const der = pfxPath ? fs.readFileSync(pfxPath) : Buffer.from(pfxBase64 || '', 'base64');
    let p12;
    try {
      p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(forge.util.createBuffer(der.toString('binary'))), passphrase);
    } catch (err) {
      throw new ValidationError(`Could not open the .pfx file (${err.message}). Check the password.`);
    }
    const keyBag = (p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] || [])[0]
      || (p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] || [])[0];
    const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] || [];
    if (!keyBag || !certBags.length) throw new ValidationError('The .pfx file does not contain both a certificate and its private key.');
    const keyPem = forge.pki.privateKeyToPem(keyBag.key);
    // Put the certificate that matches the key first.
    const keyObj = crypto.createPrivateKey(keyPem);
    const pems = certBags.map((b) => forge.pki.certificateToPem(b.cert));
    pems.sort((a, b) => Number(new crypto.X509Certificate(b).checkPrivateKey(keyObj)) - Number(new crypto.X509Certificate(a).checkPrivateKey(keyObj)));
    return this._store({ certPem: pems.join('\n'), keyPem, name, source: 'pfx' });
  }

  remove(id) {
    if (!this.entries.has(id)) throw new ValidationError('Certificate not found.');
    fs.rmSync(path.join(this.certsDir, id), { recursive: true, force: true });
    this.entries.delete(id);
    return true;
  }

  /** Re-import file-based certificates whose source changed (renewals). */
  reloadChangedSources() {
    let changed = 0;
    for (const { meta } of [...this.entries.values()]) {
      if (!meta.sourceCertPath) continue;
      try {
        const mtime = fs.statSync(meta.sourceCertPath).mtimeMs;
        if (mtime !== meta.sourceMtime) {
          this._store({
            id: meta.id,
            certPem: fs.readFileSync(meta.sourceCertPath, 'utf-8'),
            keyPem: fs.readFileSync(meta.sourceKeyPath, 'utf-8'),
            name: meta.name,
            source: 'file',
            sourceCertPath: meta.sourceCertPath,
            sourceKeyPath: meta.sourceKeyPath
          });
          changed += 1;
          this.logger && this.logger.info('certs', `Reloaded renewed certificate ${meta.name}.`);
        }
      } catch (err) {
        this.logger && this.logger.warn('certs', `Could not reload ${meta.name}: ${err.message}`);
      }
    }
    return changed;
  }

  /** The fallback certificate for clients without SNI or unknown names. */
  async ensureDefault(hostnames) {
    const want = [...new Set(['localhost', ...hostnames])].sort();
    const existing = this.entries.get('default');
    if (existing) {
      const have = [...existing.meta.hostnames].sort();
      const fresh = new Date(existing.meta.validTo).getTime() - Date.now() > 30 * 86400000;
      if (fresh && want.every((h) => have.includes(h))) return existing;
    }
    await this.createSelfSigned({ hostnames: want, id: 'default', name: 'HawHost default (self-signed)' });
    return this.entries.get('default');
  }

  defaultContext() {
    const e = this.entries.get('default') || this.entries.values().next().value;
    return e ? e.context : null;
  }

  /** Pick the certificate for a TLS handshake: the site's own, then any matching SAN, then the default. */
  contextFor(servername, sites) {
    const host = String(servername || '').toLowerCase();
    if (host) {
      for (const site of sites) {
        if (site.certId && this.entries.has(site.certId) && site.hostnames.some((h) => h === host || (h.startsWith('*.') && hostMatchesCert(host, h)))) {
          return this.entries.get(site.certId).context;
        }
      }
      let best = null;
      for (const e of this.entries.values()) {
        if (e.meta.id === 'default') continue;
        if (e.meta.hostnames.some((p) => hostMatchesCert(host, p))) {
          if (!best || new Date(e.meta.validTo) > new Date(best.meta.validTo)) best = e;
        }
      }
      if (best) return best.context;
    }
    return this.defaultContext();
  }
}

module.exports = { CertManager, describe, hostMatchesCert, splitChain };
