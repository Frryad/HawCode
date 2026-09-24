import React, { useEffect, useMemo, useState } from 'react';
import {
  Plus, FileCode2, FileText, Boxes, Shuffle, FolderOpen, Pencil, Trash2, ArrowUp, ArrowDown,
  ExternalLink, Download, Lock, Terminal, Folder, Globe2 as Globe
} from 'lucide-react';

import { useHawhost } from '../lib/store';
import { api, bridge } from '../lib/bridge';
import { siteUrls } from '../lib/urls';
import {
  PageHeader, Card, Button, IconButton, Badge, Field, TextInput, TextArea, Select, Toggle, Segmented,
  Modal, Callout, Empty, CopyText, Dot, useConfirm, cx
} from '../components/ui';

const TYPES = {
  static: { label: 'Static', icon: FileText, tone: 'blue', description: 'HTML, CSS, JS, images, React/Vue builds' },
  php: { label: 'PHP', icon: FileCode2, tone: 'violet', description: 'WordPress, Laravel, plain .php via php-cgi' },
  node: { label: 'Node.js app', icon: Boxes, tone: 'green', description: 'HawHost starts your app and forwards to it' },
  proxy: { label: 'Reverse proxy', icon: Shuffle, tone: 'amber', description: 'Apache, Nginx, IIS, Docker, any local server' }
};

const BLANK = {
  name: '', type: 'static', enabled: true, hostnames: ['*'], port: null, root: '',
  indexFiles: ['index.html', 'index.htm', 'index.php'], spaFallback: false, directoryListing: false, phpFrontController: false,
  proxyTarget: 'http://127.0.0.1:8081', proxyPreserveHost: true, nodeCommand: '', nodeEntry: 'server.js', nodePort: 3001, nodeEnv: {},
  forceHttps: false, certId: null
};

function envToText(env) {
  return Object.entries(env || {}).map(([k, v]) => `${k}=${v}`).join('\n');
}
function textToEnv(text) {
  const env = {};
  for (const line of String(text || '').split(/\r?\n/)) {
    const i = line.indexOf('=');
    if (i > 0) env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return env;
}

// ------------------------------------------------------------------ editor

function SiteEditor({ site, onClose }) {
  const { data, call } = useHawhost();
  const isNew = !site.id;
  const [form, setForm] = useState(() => ({ ...BLANK, ...site }));
  const [hostText, setHostText] = useState(() => (site.hostnames || ['*']).join(', '));
  const [envText, setEnvText] = useState(() => envToText(site.nodeEnv));
  const [certs, setCerts] = useState([]);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  useEffect(() => {
    api('GET', '/api/certs').then(setCerts).catch(() => {});
  }, []);

  const ddnsHosts = data.ddns.records.map((r) => r.hostname);
  const hostList = hostText.split(/[\s,;]+/).filter(Boolean);
  const addHost = (h) => {
    const next = hostList.filter((x) => x !== '*' && x !== h).concat(h);
    setHostText(next.join(', '));
  };

  const pickFolder = async () => {
    const dir = await (await bridge()).pickFolder({ title: 'Choose the website folder', defaultPath: form.root || undefined });
    if (dir) set({ root: dir, name: form.name || dir.split(/[\\/]/).pop() });
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    const body = {
      ...form,
      hostnames: hostList.length ? hostList : ['*'],
      port: form.port ? Number(form.port) : null,
      nodePort: Number(form.nodePort),
      nodeEnv: textToEnv(envText),
      indexFiles: typeof form.indexFiles === 'string' ? form.indexFiles.split(/[\s,]+/).filter(Boolean) : form.indexFiles
    };
    try {
      if (isNew) await call('POST', '/api/sites', body, { quiet: true, success: `${body.name || 'Website'} added.` });
      else await call('PUT', `/api/sites/${site.id}`, body, { quiet: true, success: 'Website saved.' });
      onClose(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const phpMissing = form.type === 'php' && !data.server.phpCgi;
  const needsRoot = form.type !== 'proxy';

  return (
    <Modal
      open
      width={760}
      title={isNew ? 'Add a website' : `Edit ${site.name}`}
      subtitle="Each website is a folder (or an app) answered for one or more hostnames."
      onClose={() => onClose(false)}
      footer={(
        <>
          <Button onClick={() => onClose(false)}>Cancel</Button>
          <Button variant="primary" loading={saving} onClick={save}>{isNew ? 'Add website' : 'Save changes'}</Button>
        </>
      )}
    >
      <div className="space-y-5">
        {error && <Callout tone="error">{error}</Callout>}

        <Field label="What kind of website?">
          <Segmented
            value={form.type}
            onChange={(type) => set({ type })}
            options={Object.entries(TYPES).map(([value, t]) => ({ value, label: t.label, icon: t.icon, description: t.description }))}
          />
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Name">
            <TextInput value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="My website" />
          </Field>
          <Field
            label="Hostnames"
            hint={<>Comma-separated. <span className="mono">*</span> answers any address (IP, any hostname). Exact names win over <span className="mono">*</span>.</>}
          >
            <TextInput mono value={hostText} onChange={(e) => setHostText(e.target.value)} placeholder="mysite.duckdns.org, www.mysite.duckdns.org" />
          </Field>
        </div>
        {ddnsHosts.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 -mt-2">
            <span className="text-[12px] text-ink-400">Your DDNS hostnames:</span>
            {ddnsHosts.map((h) => (
              <button key={h} type="button" onClick={() => addHost(h)} className={cx('mono text-[12px] px-2 h-6 rounded-md border', hostList.includes(h) ? 'border-brand-400/50 text-brand-400 bg-brand-500/10' : 'border-white/10 text-ink-300 hover:border-white/25')}>
                + {h}
              </button>
            ))}
          </div>
        )}

        {needsRoot && (
          <Field label={form.type === 'node' ? 'App folder' : 'Website folder'} hint={form.type === 'node' ? 'The folder with package.json.' : 'Files in this folder are published. Hidden files (.env, .git) are never served.'}>
            <div className="flex gap-2">
              <TextInput mono value={form.root} onChange={(e) => set({ root: e.target.value })} placeholder="D:\websites\my-site" />
              <Button icon={Folder} onClick={pickFolder}>Browse…</Button>
            </div>
          </Field>
        )}

        {(form.type === 'static' || form.type === 'php') && (
          <div className="grid grid-cols-2 gap-4">
            <Field label="Index files" hint="Tried in this order for folder addresses.">
              <TextInput mono value={Array.isArray(form.indexFiles) ? form.indexFiles.join(', ') : form.indexFiles} onChange={(e) => set({ indexFiles: e.target.value })} />
            </Field>
            <div className="space-y-3 pt-6">
              {form.type === 'static' && <Toggle checked={form.spaFallback} onChange={(v) => set({ spaFallback: v })} label="Single-page app" description="Unknown paths load index.html (React, Vue, Angular routers)." />}
              {form.type === 'php' && <Toggle checked={form.phpFrontController} onChange={(v) => set({ phpFrontController: v })} label="Pretty URLs (front controller)" description="Unknown paths run index.php — needed for WordPress permalinks, Laravel, Symfony." />}
              <Toggle checked={form.directoryListing} onChange={(v) => set({ directoryListing: v })} label="List folder contents" description="Show a file list for folders without an index file." />
            </div>
          </div>
        )}
        {phpMissing && (
          <Callout tone="warn" title="PHP was not found on this PC">
            Install PHP for Windows (or XAMPP), then set the folder containing <span className="mono">php-cgi.exe</span> in Settings → PHP.
          </Callout>
        )}

        {form.type === 'node' && (
          <div className="grid grid-cols-2 gap-4">
            <Field label="Start command" hint={<>Leave empty to run <span className="mono">node {form.nodeEntry || 'server.js'}</span>. HawHost sets <span className="mono">PORT</span> for your app.</>}>
              <TextInput mono value={form.nodeCommand} onChange={(e) => set({ nodeCommand: e.target.value })} placeholder="npm start" />
            </Field>
            <Field label="Entry file" hint="Used when there is no start command.">
              <TextInput mono value={form.nodeEntry} onChange={(e) => set({ nodeEntry: e.target.value })} placeholder="server.js" />
            </Field>
            <Field label="Internal port" hint="Your app listens here on 127.0.0.1; visitors never see it.">
              <TextInput mono type="number" value={form.nodePort} onChange={(e) => set({ nodePort: e.target.value })} />
            </Field>
            <Field label="Environment variables" hint="One per line: KEY=value">
              <TextArea mono rows={3} value={envText} onChange={(e) => setEnvText(e.target.value)} placeholder="DATABASE_URL=..." />
            </Field>
          </div>
        )}

        {form.type === 'proxy' && (
          <div className="space-y-3">
            <Field label="Forward to" hint="The local server that should answer, e.g. XAMPP Apache moved to port 8081, IIS, a Docker container, or another PC on your network.">
              <TextInput mono value={form.proxyTarget} onChange={(e) => set({ proxyTarget: e.target.value })} placeholder="http://127.0.0.1:8081" />
            </Field>
            <div className="flex flex-wrap gap-2">
              {[['XAMPP Apache on 8081', 'http://127.0.0.1:8081'], ['Nginx on 8082', 'http://127.0.0.1:8082'], ['Dev server 3000', 'http://127.0.0.1:3000'], ['Docker 8000', 'http://127.0.0.1:8000']].map(([label, target]) => (
                <button key={target} type="button" onClick={() => set({ proxyTarget: target })} className="text-[12px] px-2.5 h-7 rounded-md border border-white/10 text-ink-300 hover:border-white/25">{label}</button>
              ))}
            </div>
            <Toggle checked={form.proxyPreserveHost} onChange={(v) => set({ proxyPreserveHost: v })} label="Pass the visitor's hostname through" description="Turn on when the backend has its own virtual hosts (Apache/Nginx ServerName). WebSockets are forwarded either way." />
          </div>
        )}

        <details className="rounded-lg border border-white/[0.07] px-4 py-3">
          <summary className="cursor-pointer font-medium text-ink-200">Ports & HTTPS</summary>
          <div className="grid grid-cols-2 gap-4 mt-4">
            <Field label="Only on port" hint="Optional. Pin this website to one port (e.g. 8081) — HawHost opens it automatically.">
              <TextInput mono type="number" value={form.port || ''} onChange={(e) => set({ port: e.target.value })} placeholder="all ports" />
            </Field>
            <Field label="Certificate" hint="Used for HTTPS. Automatic picks a certificate whose name matches.">
              <Select value={form.certId || ''} onChange={(e) => set({ certId: e.target.value || null })}>
                <option value="">Automatic</option>
                {certs.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.hostnames.slice(0, 2).join(', ')})</option>)}
              </Select>
            </Field>
            <Toggle
              checked={form.forceHttps}
              onChange={(v) => set({ forceHttps: v })}
              disabled={!data.config.server.enableHttps}
              label="Always use HTTPS"
              description={data.config.server.enableHttps ? 'Redirect http:// visitors to https://.' : 'Turn on HTTPS in Ports & Firewall first.'}
            />
            <Toggle checked={form.enabled} onChange={(v) => set({ enabled: v })} label="Website is on" description="Turn off to take it offline without deleting it." />
          </div>
        </details>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ export

function ExportModal({ onClose }) {
  const [out, setOut] = useState(null);
  const [tab, setTab] = useState('nginx');
  useEffect(() => {
    api('POST', '/api/export').then(setOut).catch((err) => setOut({ error: err.message }));
  }, []);
  const current = out && out[tab];
  return (
    <Modal open width={820} title="Use Apache or Nginx instead" subtitle="HawHost wrote your website list as ready-to-include configuration files." onClose={onClose}
      footer={<Button onClick={onClose}>Close</Button>}>
      {!out ? <p className="text-ink-400">Generating…</p> : out.error ? <Callout tone="error">{out.error}</Callout> : (
        <div className="space-y-3">
          <div className="flex gap-2">
            {['nginx', 'apache'].map((k) => (
              <Button key={k} size="sm" variant={tab === k ? 'primary' : 'secondary'} onClick={() => setTab(k)}>{k === 'nginx' ? 'Nginx' : 'Apache (XAMPP)'}</Button>
            ))}
            <div className="flex-1" />
            <Button size="sm" icon={FolderOpen} onClick={async () => (await bridge()).openPath(current.path.replace(/[\\/][^\\/]+$/, ''))}>Open folder</Button>
            <Button size="sm" onClick={async () => (await bridge()).copy(current.content)}>Copy</Button>
          </div>
          <div className="text-[12px] text-ink-400"><CopyText value={current.path} /></div>
          <pre className="mono text-[12px] leading-relaxed bg-ink-950 border border-white/[0.07] rounded-lg p-4 max-h-[420px] overflow-auto text-ink-200 whitespace-pre">{current.content}</pre>
          <p className="text-[12px] text-ink-400 leading-relaxed">
            Only one program can own port 80. To keep HawHost's DDNS, firewall and diagnostics while Apache/Nginx serve the pages, let Apache or Nginx
            listen on another port (e.g. 8081) and add a <b>Reverse proxy</b> website pointing at it.
          </p>
        </div>
      )}
    </Modal>
  );
}

function AppOutput({ site, onClose }) {
  const [lines, setLines] = useState([]);
  useEffect(() => {
    const load = () => api('GET', `/api/sites/${site.id}/output`).then((r) => setLines(r.lines)).catch(() => {});
    load();
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, [site.id]);
  return (
    <Modal open width={820} title={`${site.name} — app output`} onClose={onClose} footer={<Button onClick={onClose}>Close</Button>}>
      <pre className="mono text-[12px] leading-relaxed bg-ink-950 border border-white/[0.07] rounded-lg p-4 h-[420px] overflow-auto text-ink-200 whitespace-pre-wrap">{lines.join('\n') || 'No output yet.'}</pre>
    </Modal>
  );
}

// ------------------------------------------------------------------ list

function SiteCard({ site, index, count, onEdit, onOutput }) {
  const { data, call } = useHawhost();
  const confirm = useConfirm();
  const t = TYPES[site.type];
  const Icon = t.icon;
  const urls = siteUrls(site, data);
  const app = data.server.apps && data.server.apps[site.id];

  const remove = async () => {
    if (await confirm({ title: `Delete ${site.name}?`, message: 'The website is removed from HawHost. Its files stay on disk untouched.', confirmLabel: 'Delete', danger: true })) {
      call('DELETE', `/api/sites/${site.id}`, undefined, { success: `${site.name} deleted.` }).catch(() => {});
    }
  };

  return (
    <div className={cx('rounded-xl border bg-ink-850 px-5 py-4', site.enabled ? 'border-white/[0.07]' : 'border-white/[0.04] opacity-70')}>
      <div className="flex items-start gap-4">
        <div className={cx('w-10 h-10 rounded-lg grid place-items-center shrink-0', site.enabled ? 'bg-white/[0.06]' : 'bg-white/[0.03]')}>
          <Icon size={18} className="text-ink-300" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-white text-[14.5px]">{site.name}</span>
            <Badge tone={t.tone}>{t.label}</Badge>
            {!site.enabled && <Badge>Off</Badge>}
            {site.port && <Badge tone="blue">port {site.port} only</Badge>}
            {site.forceHttps && <Badge tone="green"><Lock size={11} /> HTTPS only</Badge>}
            {app && <Badge tone={app.state === 'running' ? 'green' : 'amber'}><Dot tone={app.state === 'running' ? 'green' : 'amber'} /> app {app.state}{app.restarts ? ` · ${app.restarts} restarts` : ''}</Badge>}
          </div>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {site.hostnames.map((h) => <span key={h} className="mono text-[12px] px-1.5 py-0.5 rounded bg-white/[0.05] text-ink-200">{h === '*' ? '* any address' : h}</span>)}
          </div>
          <div className="text-[12.5px] text-ink-400 mt-2 mono truncate">
            {site.type === 'proxy' ? `→ ${site.proxyTarget}` : site.type === 'node' ? `${site.root}  ·  ${site.nodeCommand || `node ${site.nodeEntry}`} → 127.0.0.1:${site.nodePort}` : site.root}
          </div>
          {site.enabled && urls.length > 0 && (
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2.5">
              {urls.slice(0, 4).map((u) => (
                <button key={u.url} type="button" onClick={async () => (await bridge()).openExternal(u.url)} className="inline-flex items-center gap-1 text-[12.5px] text-brand-400 hover:text-brand-300 mono">
                  {u.url} <ExternalLink size={11} />
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          <Toggle checked={site.enabled} onChange={(v) => call('PUT', `/api/sites/${site.id}`, { enabled: v }).catch(() => {})} />
          <div className="w-2" />
          {site.type === 'node' && <IconButton icon={Terminal} title="App output" onClick={onOutput} />}
          {site.root && <IconButton icon={FolderOpen} title="Open folder" onClick={async () => (await bridge()).openPath(site.root).catch(() => {})} />}
          <IconButton icon={ArrowUp} title="Move up (earlier = higher priority)" disabled={index === 0} onClick={() => call('POST', `/api/sites/${site.id}/move`, { direction: 'up' }).catch(() => {})} />
          <IconButton icon={ArrowDown} title="Move down" disabled={index === count - 1} onClick={() => call('POST', `/api/sites/${site.id}/move`, { direction: 'down' }).catch(() => {})} />
          <IconButton icon={Pencil} title="Edit" onClick={onEdit} />
          <IconButton icon={Trash2} title="Delete" onClick={remove} className="hover:text-rose-300" />
        </div>
      </div>
    </div>
  );
}

export default function Websites() {
  const { data } = useHawhost();
  const [editing, setEditing] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [output, setOutput] = useState(null);
  const [detected, setDetected] = useState(null);
  const sites = data.config.websites;

  useEffect(() => {
    api('GET', '/api/detect').then(setDetected).catch(() => {});
  }, []);

  const templates = useMemo(() => {
    const t = [
      { label: 'Static website', icon: FileText, site: { type: 'static', name: '' } },
      { label: 'PHP website', icon: FileCode2, site: { type: 'php', name: '', indexFiles: ['index.php', 'index.html'] } },
      { label: 'Node.js app', icon: Boxes, site: { type: 'node', name: '', nodeCommand: 'npm start' } },
      { label: 'Reverse proxy', icon: Shuffle, site: { type: 'proxy', name: '' } }
    ];
    if (detected && detected.xampp) {
      t.push({ label: 'XAMPP htdocs (PHP)', icon: FileCode2, site: { type: 'php', name: 'XAMPP htdocs', root: detected.xampp.htdocs, indexFiles: ['index.php', 'index.html'] } });
    }
    return t;
  }, [detected]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Websites"
        description="Host as many websites as you like from different folders. HawHost picks the website by the hostname a visitor typed (virtual hosting), so several domains can share port 80."
        actions={(
          <>
            <Button icon={Download} onClick={() => setExporting(true)}>Apache / Nginx config</Button>
            <Button variant="primary" icon={Plus} onClick={() => setEditing({ ...BLANK })}>Add website</Button>
          </>
        )}
      />

      {sites.length === 0 ? (
        <Card><Empty icon={Globe} title="No websites yet" action={<Button variant="primary" icon={Plus} onClick={() => setEditing({ ...BLANK })}>Add your first website</Button>}>Point HawHost at a folder with an index.html or index.php.</Empty></Card>
      ) : (
        <div className="space-y-3">
          {sites.map((s, i) => <SiteCard key={s.id} site={s} index={i} count={sites.length} onEdit={() => setEditing(s)} onOutput={() => setOutput(s)} />)}
        </div>
      )}

      <Card title="Quick start" subtitle="Templates fill in sensible settings">
        <div className="flex flex-wrap gap-2">
          {templates.map((t) => (
            <Button key={t.label} icon={t.icon} onClick={() => setEditing({ ...BLANK, ...t.site })}>{t.label}</Button>
          ))}
        </div>
        <div className="grid grid-cols-3 gap-4 mt-4 text-[12.5px] text-ink-400 leading-relaxed">
          <div><b className="text-ink-200">Built-in engine.</b> Static and PHP sites are served by HawHost itself (Node.js) with gzip, caching, byte ranges and HTTPS.</div>
          <div><b className="text-ink-200">PHP.</b> {data.server.phpCgi ? <>Using <span className="mono">{data.server.phpCgi}</span>.</> : 'Not found — install PHP or XAMPP.'}</div>
          <div><b className="text-ink-200">Apache / Nginx.</b> Run them on another port and add a reverse proxy website, or export their config.</div>
        </div>
      </Card>

      {editing && <SiteEditor site={editing} onClose={() => setEditing(null)} />}
      {exporting && <ExportModal onClose={() => setExporting(false)} />}
      {output && <AppOutput site={output} onClose={() => setOutput(null)} />}
    </div>
  );
}
