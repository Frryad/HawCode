import React, { useEffect, useState } from 'react';
import {
  Lock, Plus, ShieldCheck, Download, Trash2, Key, RefreshCw, FileText, CheckCircle2, FolderOpen
} from 'lucide-react';

import { useHawhost } from '../lib/store';
import { api, bridge } from '../lib/bridge';
import { dateTime } from '../lib/format';
import {
  PageHeader, Card, Button, IconButton, Badge, Callout, Field, TextInput, TextArea, Segmented, Modal, Empty, CopyText, useConfirm, useBusy
} from '../components/ui';

export default function Certificates({ go }) {
  const { data, call } = useHawhost();
  const confirm = useConfirm();
  const [busy, run] = useBusy();

  const [certs, setCerts] = useState([]);
  const [loading, setLoading] = useState(false);

  // Modals
  const [showCreateSelfSigned, setShowCreateSelfSigned] = useState(false);
  const [showImport, setShowImport] = useState(false);

  // Self-signed form
  const [selfName, setSelfName] = useState('HawHost SSL');
  const [selfHostnames, setSelfHostnames] = useState('');
  const [creating, setCreating] = useState(false);

  // Import form
  const [importMode, setImportMode] = useState('pem'); // 'pem' | 'pfx' | 'files'
  const [importName, setImportName] = useState('');
  const [importCertPem, setImportCertPem] = useState('');
  const [importKeyPem, setImportKeyPem] = useState('');
  const [importPfxPath, setImportPfxPath] = useState('');
  const [importPfxPass, setImportPfxPass] = useState('');
  const [importCertFile, setImportCertFile] = useState('');
  const [importKeyFile, setImportKeyFile] = useState('');
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState(null);

  const fetchCerts = async () => {
    setLoading(true);
    try {
      const list = await api('GET', '/api/certs');
      setCerts(list || []);
    } catch {
      setCerts([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCerts();
  }, []);

  // Pre-fill hostnames for self-signed
  useEffect(() => {
    if (data && data.ddns) {
      const ddnsHosts = data.ddns.records.filter((r) => r.enabled).map((r) => r.hostname);
      const hosts = ['localhost', ...ddnsHosts];
      setSelfHostnames(hosts.join(', '));
    }
  }, [data]);

  const handleCreateSelfSigned = async () => {
    const list = selfHostnames.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);
    if (!list.length) return;
    setCreating(true);
    try {
      await call('POST', '/api/certs/self-signed', {
        name: selfName.trim() || 'HawHost Self-Signed',
        hostnames: list
      }, { success: 'Self-signed SSL certificate generated.' });
      setShowCreateSelfSigned(false);
      fetchCerts();
    } catch (err) {
      // Toast shown by call
    } finally {
      setCreating(false);
    }
  };

  const handleImport = async () => {
    setImporting(true);
    setImportError(null);
    try {
      if (importMode === 'pem') {
        if (!importCertPem.trim() || !importKeyPem.trim()) {
          throw new Error('Both Certificate PEM and Private Key PEM are required.');
        }
        await call('POST', '/api/certs/import-pem', {
          name: importName.trim() || 'Imported PEM Certificate',
          certPem: importCertPem,
          keyPem: importKeyPem
        }, { success: 'Certificate imported successfully.' });
      } else if (importMode === 'pfx') {
        if (!importPfxPath.trim()) throw new Error('Please select a .pfx or .p12 certificate file.');
        await call('POST', '/api/certs/import-pfx', {
          name: importName.trim() || 'Imported PFX Certificate',
          pfxPath: importPfxPath,
          passphrase: importPfxPass
        }, { success: 'PFX Certificate imported.' });
      } else if (importMode === 'files') {
        if (!importCertFile.trim() || !importKeyFile.trim()) throw new Error('Select both certificate and key file paths.');
        await call('POST', '/api/certs/import-files', {
          name: importName.trim() || 'Referenced Certificate Files',
          certPath: importCertFile,
          keyPath: importKeyFile
        }, { success: 'Certificate files registered.' });
      }
      setShowImport(false);
      fetchCerts();
    } catch (err) {
      setImportError(err.message);
    } finally {
      setImporting(false);
    }
  };

  const handleTrustCert = async (cert) => {
    run(`trust-${cert.id}`, async () => {
      const b = await bridge();
      await b.trustCert(cert.certPath);
    });
  };

  const handleDeleteCert = async (cert) => {
    const ok = await confirm({
      title: `Delete certificate "${cert.name}"?`,
      message: 'Websites using this certificate will revert to unencrypted HTTP or the default certificate.',
      danger: true,
      confirmLabel: 'Delete Certificate'
    });
    if (!ok) return;
    await call('DELETE', `/api/certs/${cert.id}`, null, { success: 'Certificate removed.' });
    fetchCerts();
  };

  const pickFile = async (setter, title, filter) => {
    const b = await bridge();
    const f = await b.pickFile({ title, filters: filter ? [filter] : undefined });
    if (f) setter(f);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="SSL / TLS Certificates"
        description="Manage HTTPS encryption for your self-hosted websites. Generate free RSA SAN self-signed certificates matching your DDNS domains or import custom Let's Encrypt certificates."
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              icon={RefreshCw}
              loading={loading}
              onClick={fetchCerts}
            >
              Refresh
            </Button>
            <Button
              variant="secondary"
              icon={Download}
              onClick={() => { setShowImport(true); setImportError(null); }}
            >
              Import Certificate
            </Button>
            <Button
              variant="primary"
              icon={Plus}
              onClick={() => setShowCreateSelfSigned(true)}
            >
              Create Self-Signed Cert
            </Button>
          </div>
        }
      />

      {/* Certificates List */}
      {certs.length === 0 ? (
        <Card>
          <Empty
            icon={Lock}
            title="No SSL Certificates Installed"
            action={
              <Button
                variant="primary"
                icon={Plus}
                onClick={() => setShowCreateSelfSigned(true)}
              >
                Create Self-Signed Certificate
              </Button>
            }
          >
            Create a self-signed certificate to enable HTTPS (port 443) on your DDNS domain name, or import existing certificates from Certbot, Win-ACME, or Let&apos;s Encrypt.
          </Empty>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {certs.map((c) => {
            const isSelf = c.selfSigned || c.source === 'self-signed';
            const daysLeft = c.daysLeft !== undefined ? c.daysLeft : 365;
            const isExpired = daysLeft <= 0;
            const isExpiring = daysLeft < 30 && !isExpired;

            // Find websites using this cert
            const usedBy = data ? data.config.websites.filter((w) => w.certId === c.id) : [];

            return (
              <div
                key={c.id}
                className="rounded-xl border border-white/[0.08] bg-ink-850 p-5 space-y-4 hover:border-white/[0.14] transition-colors"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-lg bg-brand-500/10 border border-brand-400/20 grid place-items-center text-brand-400 shrink-0">
                      <Lock size={18} />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-white text-[15px]">{c.name}</span>
                        {isSelf ? (
                          <Badge tone="blue">Self-Signed</Badge>
                        ) : (
                          <Badge tone="violet">Trusted CA / PEM</Badge>
                        )}
                        {isExpired ? (
                          <Badge tone="red">Expired</Badge>
                        ) : isExpiring ? (
                          <Badge tone="amber">Expires soon ({daysLeft}d)</Badge>
                        ) : (
                          <Badge tone="green">Valid ({daysLeft}d left)</Badge>
                        )}
                      </div>
                      <div className="text-[12.5px] text-ink-400 mt-1">
                        Issuer: <span className="text-ink-200">{c.issuer || 'HawHost'}</span> · Valid until: <span className="text-ink-200">{dateTime(c.validTo)}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {isSelf && (
                      <Button
                        size="sm"
                        variant="secondary"
                        icon={ShieldCheck}
                        loading={busy === `trust-${c.id}`}
                        onClick={() => handleTrustCert(c)}
                        title="Add certificate to Windows Trusted Root store so browsers on this PC accept it without warnings"
                      >
                        Trust in Windows
                      </Button>
                    )}
                    <IconButton
                      icon={Trash2}
                      title="Delete Certificate"
                      onClick={() => handleDeleteCert(c)}
                      className="hover:text-rose-400"
                    />
                  </div>
                </div>

                {/* Hostnames */}
                <div>
                  <div className="text-[12px] font-medium text-ink-400 uppercase tracking-wider mb-1.5">
                    Covered Hostnames (SAN):
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {(c.hostnames || []).map((h, i) => (
                      <span
                        key={i}
                        className="inline-flex items-center px-2.5 py-0.5 rounded-md text-[12px] mono border border-white/[0.08] bg-ink-950/60 text-ink-200"
                      >
                        {h}
                      </span>
                    ))}
                  </div>
                </div>

                {/* SHA-256 Fingerprint & Usage */}
                <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-white/[0.05] text-[12px] text-ink-400">
                  <div className="flex items-center gap-2 mono">
                    <span>SHA-256:</span>
                    <span className="text-ink-300 truncate max-w-xs">{c.fingerprint256 || '—'}</span>
                    {c.fingerprint256 && <CopyText value={c.fingerprint256} />}
                  </div>

                  <div className="flex items-center gap-1.5">
                    <span>Assigned to:</span>
                    {usedBy.length === 0 ? (
                      <span className="text-ink-500 italic">No websites (available for assignment)</span>
                    ) : (
                      usedBy.map((w) => (
                        <Badge key={w.id} tone="neutral">{w.name}</Badge>
                      ))
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* SSL Certificate Guide & Trust Explanation */}
      <Card
        title="About HTTPS & SSL Certificates for DDNS"
        subtitle="How SSL certificates work with Dynamic DNS and how to eliminate browser warnings."
        icon={ShieldCheck}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 text-[13px] text-ink-300 leading-relaxed">
          <div className="space-y-2">
            <div className="font-semibold text-white flex items-center gap-1.5">
              <CheckCircle2 size={15} className="text-brand-400" />
              Self-Signed Certificates
            </div>
            <p>
              When you generate a self-signed certificate in HawHost, it is cryptographically 100% secure and encrypted with an RSA 2048-bit key.
              However, because it was not issued by a commercial Certificate Authority (CA), web browsers will display a security warning (&ldquo;Not Secure / Self-signed certificate&rdquo;) until you add it to the trusted store.
            </p>
            <p>
              Click <b>&ldquo;Trust in Windows&rdquo;</b> on any self-signed cert to install it into your local Windows Trusted Root Certification Authorities store. Chrome, Edge, and Windows apps will immediately trust it.
            </p>
          </div>

          <div className="space-y-2">
            <div className="font-semibold text-white flex items-center gap-1.5">
              <Key size={15} className="text-emerald-400" />
              Using Free Let&apos;s Encrypt / Certbot Certificates
            </div>
            <p>
              If you want zero browser warnings on remote phones and computers without installing root certs, use tools like <b>Win-ACME</b> or <b>Certbot for Windows</b>.
            </p>
            <p>
              Under <b>&ldquo;Import Certificate&rdquo;</b>, choose the <b>&ldquo;Live File Reference&rdquo;</b> tab and point HawHost to Certbot&apos;s <span className="mono text-white">fullchain.pem</span> and <span className="mono text-white">privkey.pem</span>. When Certbot auto-renews your certificate every 60 days, HawHost automatically hot-reloads it without stopping your server!
            </p>
          </div>
        </div>
      </Card>

      {/* Create Self-Signed Modal */}
      {showCreateSelfSigned && (
        <Modal
          open
          title="Create Self-Signed SSL Certificate"
          subtitle="HawHost generates an RSA 2048-bit SAN certificate matching your domains."
          onClose={() => setShowCreateSelfSigned(false)}
          footer={
            <>
              <Button onClick={() => setShowCreateSelfSigned(false)}>Cancel</Button>
              <Button variant="primary" loading={creating} onClick={handleCreateSelfSigned}>
                Generate Certificate
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            <Field label="Certificate Name">
              <TextInput
                value={selfName}
                onChange={(e) => setSelfName(e.target.value)}
                placeholder="My DDNS SSL Certificate"
              />
            </Field>

            <Field
              label="Domains / Hostnames (SAN)"
              hint="Comma-separated list of hostnames this certificate will protect."
            >
              <TextInput
                mono
                value={selfHostnames}
                onChange={(e) => setSelfHostnames(e.target.value)}
                placeholder="mysite.duckdns.org, myserver.ddns.net, localhost"
              />
            </Field>

            <Callout tone="info">
              This certificate will be valid for 825 days and supports both HTTP/1.1 and HTTP/2 TLS encryption on port 443.
            </Callout>
          </div>
        </Modal>
      )}

      {/* Import Certificate Modal */}
      {showImport && (
        <Modal
          open
          width={700}
          title="Import SSL / TLS Certificate"
          subtitle="Add an existing certificate from Let's Encrypt, Win-ACME, or your domain registrar."
          onClose={() => setShowImport(false)}
          footer={
            <>
              <Button onClick={() => setShowImport(false)}>Cancel</Button>
              <Button variant="primary" loading={importing} onClick={handleImport}>
                Import Certificate
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            {importError && <Callout tone="error">{importError}</Callout>}

            <Segmented
              options={[
                { value: 'pem', label: 'Paste PEM', icon: FileText },
                { value: 'pfx', label: 'PFX / PKCS#12', icon: Key },
                { value: 'files', label: 'Live Files (Certbot)', icon: FolderOpen }
              ]}
              value={importMode}
              onChange={setImportMode}
            />

            <Field label="Friendly Name">
              <TextInput
                value={importName}
                onChange={(e) => setImportName(e.target.value)}
                placeholder="e.g. Let's Encrypt Wildcard"
              />
            </Field>

            {importMode === 'pem' && (
              <>
                <Field label="Certificate (PEM)" hint="Must include -----BEGIN CERTIFICATE----- and full chain">
                  <TextArea
                    mono
                    rows={4}
                    value={importCertPem}
                    onChange={(e) => setImportCertPem(e.target.value)}
                    placeholder="-----BEGIN CERTIFICATE-----&#10;...&#10;-----END CERTIFICATE-----"
                  />
                </Field>
                <Field label="Private Key (PEM)" hint="Must include -----BEGIN PRIVATE KEY-----">
                  <TextArea
                    mono
                    rows={4}
                    value={importKeyPem}
                    onChange={(e) => setImportKeyPem(e.target.value)}
                    placeholder="-----BEGIN RSA PRIVATE KEY-----&#10;...&#10;-----END RSA PRIVATE KEY-----"
                  />
                </Field>
              </>
            )}

            {importMode === 'pfx' && (
              <>
                <Field label="PFX / P12 File Path">
                  <div className="flex gap-2">
                    <TextInput
                      mono
                      value={importPfxPath}
                      onChange={(e) => setImportPfxPath(e.target.value)}
                      placeholder="C:\certs\bundle.pfx"
                      className="flex-1"
                    />
                    <Button
                      variant="secondary"
                      onClick={() => pickFile(setImportPfxPath, 'Select .pfx or .p12 certificate file', { name: 'PFX Certificate', extensions: ['pfx', 'p12'] })}
                    >
                      Browse
                    </Button>
                  </div>
                </Field>
                <Field label="Passphrase (optional)">
                  <TextInput
                    type="password"
                    value={importPfxPass}
                    onChange={(e) => setImportPfxPass(e.target.value)}
                    placeholder="Leave empty if not password protected"
                  />
                </Field>
              </>
            )}

            {importMode === 'files' && (
              <>
                <Field label="Certificate File Path (fullchain.pem)">
                  <div className="flex gap-2">
                    <TextInput
                      mono
                      value={importCertFile}
                      onChange={(e) => setImportCertFile(e.target.value)}
                      placeholder="C:\ProgramData\win-acme\acme-v02.api.letsencrypt.org\Certificates\fullchain.pem"
                      className="flex-1"
                    />
                    <Button
                      variant="secondary"
                      onClick={() => pickFile(setImportCertFile, 'Select Certificate File', { name: 'PEM Certificate', extensions: ['pem', 'crt', 'cer'] })}
                    >
                      Browse
                    </Button>
                  </div>
                </Field>
                <Field label="Private Key File Path (privkey.pem)">
                  <div className="flex gap-2">
                    <TextInput
                      mono
                      value={importKeyFile}
                      onChange={(e) => setImportKeyFile(e.target.value)}
                      placeholder="C:\ProgramData\win-acme\acme-v02.api.letsencrypt.org\Certificates\privkey.pem"
                      className="flex-1"
                    />
                    <Button
                      variant="secondary"
                      onClick={() => pickFile(setImportKeyFile, 'Select Private Key File', { name: 'Private Key', extensions: ['pem', 'key'] })}
                    >
                      Browse
                    </Button>
                  </div>
                </Field>
                <Callout tone="info">
                  HawHost will monitor these files and automatically reload them whenever Win-ACME or Certbot renews them.
                </Callout>
              </>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
