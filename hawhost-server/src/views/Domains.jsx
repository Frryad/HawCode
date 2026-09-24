import React, { useState } from 'react';
import { Plus, RefreshCw, Pencil, Trash2, Search, ShieldCheck, Radio, PauseCircle } from 'lucide-react';

import { useHawhost, useTick } from '../lib/store';
import { api } from '../lib/bridge';
import { ago, dateTime } from '../lib/format';
import {
  PageHeader, Card, Button, IconButton, Badge, Field, TextInput, Select, Toggle, Modal, Callout, Empty,
  ExtLink, Dot, useConfirm, useBusy, StatRow, cx
} from '../components/ui';
import NatNotice from '../components/NatNotice';

const PROVIDER_HELP = {
  duckdns: <>Sign in at duckdns.org (free, up to 5 subdomains), create a subdomain, and copy the <b>token</b> shown at the top of the page.</>,
  noip: <>Create a free hostname (e.g. <span className="mono">myserver.ddns.net</span>). No-IP free hostnames must be confirmed every 30 days by e-mail. You can use a <b>DDNS key</b> instead of your account password.</>,
  dynu: <>Create a free hostname (e.g. <span className="mono">myname.dynu.net</span>). Under Control Panel → My Account you can set a separate <b>IP update password</b>.</>,
  custom: <>Any provider with an HTTP update URL (dyndns2-compatible services, FreeDNS, deSEC…). Placeholders: <span className="mono">{'{hostname} {ip} {username} {token}'}</span>. An empty <span className="mono">{'{ip}'}</span> lets the provider use the address the request comes from.</>
};

function RecordEditor({ record, onClose }) {
  const { data, call } = useHawhost();
  const isNew = !record.id;
  const [form, setForm] = useState({ provider: 'duckdns', hostname: '', username: '', updateUrl: '', enabled: true, ...record, token: '' });
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const p = data.providers[form.provider];
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      let rec;
      if (isNew) rec = await call('POST', '/api/ddns/records', form, { quiet: true });
      else rec = await call('PUT', `/api/ddns/records/${record.id}`, form, { quiet: true });
      onClose(true);
      call('POST', '/api/ddns/update', { recordId: rec.id }, { quiet: true }).catch(() => {});
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open width={640} title={isNew ? 'Add a DDNS hostname' : `Edit ${record.hostname}`}
      subtitle="HawHost keeps this hostname pointed at your home connection, even when your ISP changes the IP."
      onClose={() => onClose(false)}
      footer={(<><Button onClick={() => onClose(false)}>Cancel</Button><Button variant="primary" loading={saving} onClick={save}>{isNew ? 'Add and update now' : 'Save and update now'}</Button></>)}>
      <div className="space-y-4">
        {error && <Callout tone="error">{error}</Callout>}
        <Field label="Provider">
          <div className="grid grid-cols-4 gap-2">
            {Object.values(data.providers).map((pr) => (
              <button key={pr.id} type="button" onClick={() => set({ provider: pr.id })}
                className={cx('rounded-lg border px-3 py-2.5 text-left', form.provider === pr.id ? 'border-brand-400/60 bg-brand-500/10' : 'border-white/[0.08] hover:border-white/20')}>
                <div className="font-medium text-ink-100">{pr.label.replace(' (free)', '')}</div>
                <div className="text-[11.5px] text-ink-400 mono mt-0.5">{pr.suffix || 'any'}</div>
              </button>
            ))}
          </div>
        </Field>
        <Callout tone="info">
          {PROVIDER_HELP[form.provider]}{' '}
          {p.signupUrl && <ExtLink href={p.signupUrl}>Open {p.label.replace(' (free)', '')}</ExtLink>}
        </Callout>
        <Field label="Hostname" hint={form.provider === 'duckdns' ? 'Just the subdomain works too: "mysite" becomes mysite.duckdns.org.' : null}>
          <TextInput mono value={form.hostname} onChange={(e) => set({ hostname: e.target.value })} placeholder={form.provider === 'noip' ? 'myserver.ddns.net' : form.provider === 'dynu' ? 'myname.dynu.net' : 'mysite.duckdns.org'} />
        </Field>
        {p.fields.username && (
          <Field label={p.fields.username}>
            <TextInput value={form.username} onChange={(e) => set({ username: e.target.value })} autoComplete="off" />
          </Field>
        )}
        <Field label={p.fields.token} hint={!isNew && record.hasToken ? 'Saved. Leave empty to keep it.' : 'Stored only in your HawHost settings on this PC.'}>
          <TextInput type="password" value={form.token} onChange={(e) => set({ token: e.target.value })} autoComplete="new-password" placeholder={!isNew && record.hasToken ? '••••••••••' : ''} />
        </Field>
        {form.provider === 'custom' && (
          <Field label="Update URL">
            <TextInput mono value={form.updateUrl} onChange={(e) => set({ updateUrl: e.target.value })} placeholder="https://provider.example/nic/update?hostname={hostname}&myip={ip}" />
          </Field>
        )}
        <Toggle checked={form.enabled} onChange={(v) => set({ enabled: v })} label="Keep this hostname updated" />
      </div>
    </Modal>
  );
}

function RecordRow({ rec, onEdit }) {
  const { data, call } = useHawhost();
  const confirm = useConfirm();
  const [busy, run] = useBusy();
  const [dns, setDns] = useState(null);
  const provider = data.providers[rec.provider];
  const tone = rec.blocked ? 'red' : rec.lastOk ? 'green' : rec.lastOk === false ? 'amber' : 'neutral';

  const check = () => run('dns', async () => setDns(await api('GET', `/api/ddns/resolve?hostname=${encodeURIComponent(rec.hostname)}`)));
  const matches = dns && data.ddns.publicIp && dns.addresses.includes(data.ddns.publicIp);

  return (
    <div className="py-4 border-b border-white/[0.06] last:border-0">
      <div className="flex items-start gap-4">
        <Dot tone={tone} />
        <div className="flex-1 min-w-0 -mt-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="mono text-[14px] font-semibold text-white">{rec.hostname}</span>
            <Badge>{provider.label}</Badge>
            {!rec.enabled && <Badge>Paused</Badge>}
            {rec.blocked && <Badge tone="red"><PauseCircle size={11} /> stopped</Badge>}
          </div>
          <div className="text-[12.5px] mt-1 text-ink-400">
            <span className={rec.lastOk === false ? 'text-amber-300' : rec.blocked ? 'text-rose-300' : ''}>{rec.blocked || rec.lastResult}</span>
            {rec.lastIp && <> · points to <span className="mono text-ink-200">{rec.lastIp}</span></>}
            {rec.lastUpdate && <> · {ago(rec.lastUpdate)}</>}
          </div>
          {rec.blocked && <div className="text-[12px] text-ink-400 mt-1">Automatic updates are paused so the provider does not block the account. Fix the details, then press Update.</div>}
          {dns && (
            <div className="text-[12.5px] mt-1.5">
              {dns.addresses.length
                ? <>DNS answers <span className="mono text-ink-200">{dns.addresses.join(', ')}</span> {data.ddns.publicIp && (matches ? <span className="text-emerald-300">— matches your public IP ✓</span> : <span className="text-amber-300">— your public IP is {data.ddns.publicIp}; DNS caches can take a few minutes.</span>)}</>
                : <span className="text-amber-300">The hostname does not resolve yet ({dns.error}).</span>}
            </div>
          )}
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          <Button size="sm" icon={Search} loading={busy === 'dns'} onClick={check}>Check DNS</Button>
          <Button size="sm" icon={RefreshCw} loading={busy === 'up'} onClick={() => run('up', () => call('POST', '/api/ddns/update', { recordId: rec.id }))}>Update</Button>
          <IconButton icon={Pencil} title="Edit" onClick={onEdit} />
          <IconButton icon={Trash2} title="Remove" className="hover:text-rose-300" onClick={async () => {
            if (await confirm({ title: `Remove ${rec.hostname}?`, message: 'HawHost stops updating it. The hostname itself stays in your provider account.', confirmLabel: 'Remove', danger: true })) {
              call('DELETE', `/api/ddns/records/${rec.id}`).catch(() => {});
            }
          }} />
        </div>
      </div>
    </div>
  );
}

export default function Domains({ go }) {
  useTick(15000);
  const { data, call } = useHawhost();
  const [editing, setEditing] = useState(null);
  const [busy, run] = useBusy();
  const ddns = data.ddns;
  const cfg = data.config.ddns;

  const setDdns = (patch) => call('PUT', '/api/settings/ddns', patch).catch(() => {});

  return (
    <div className="space-y-6">
      <PageHeader
        title="Domains (Dynamic DNS)"
        description="A free DDNS hostname gives your home connection a permanent name. When your ISP changes your public IP, HawHost updates the hostname automatically."
        actions={(
          <>
            <Button icon={RefreshCw} loading={busy === 'all' || ddns.busy} onClick={() => run('all', () => call('POST', '/api/ddns/update', {}, { success: 'DDNS check finished.' }))}>Update all now</Button>
            <Button variant="primary" icon={Plus} onClick={() => setEditing({})}>Add hostname</Button>
          </>
        )}
      />

      <NatNotice data={data} onGuide={() => go('router')} />

      <div className="grid grid-cols-3 gap-6">
        <Card title="Your hostnames" className="col-span-2" icon={Radio}>
          {ddns.records.length === 0 ? (
            <Empty icon={Radio} title="No DDNS hostname yet" action={<Button variant="primary" icon={Plus} onClick={() => setEditing({})}>Add hostname</Button>}>
              Pick DuckDNS for the quickest setup (sign in, choose a name, copy the token), or No-IP / Dynu.
            </Empty>
          ) : ddns.records.map((r) => <RecordRow key={r.id} rec={r} onEdit={() => setEditing(r)} />)}
        </Card>

        <div className="space-y-6">
          <Card title="Public IP">
            <div className="mono text-[22px] font-semibold text-white">{ddns.publicIp || '—'}</div>
            <div className="text-[12.5px] text-ink-400 mt-1">{ddns.publicIp ? `from ${ddns.publicIpSource}, checked ${ago(ddns.publicIpCheckedAt)}` : 'Not known yet'}</div>
            <div className="mt-3">
              <StatRow label="Router's WAN address">{ddns.routerWanIp ? <span className="mono">{ddns.routerWanIp}</span> : 'unknown (no UPnP)'}</StatRow>
            </div>
          </Card>

          <Card title="Automatic updates">
            <div className="space-y-4">
              <Toggle checked={cfg.enabled} onChange={(v) => setDdns({ enabled: v })} label="Keep hostnames updated" description="Checks in the background, also right after a network change." />
              <Field label="Check every">
                <Select value={cfg.intervalMinutes} onChange={(e) => setDdns({ intervalMinutes: Number(e.target.value) })}>
                  {[1, 5, 10, 15, 30, 60].map((m) => <option key={m} value={m}>{m} minute{m > 1 ? 's' : ''}</option>)}
                </Select>
              </Field>
              <Field label="Find the public IP by asking" hint="No third-party “what is my IP” service is ever used.">
                <Select value={cfg.ipSource} onChange={(e) => setDdns({ ipSource: e.target.value })}>
                  <option value="auto">Router first, then the DDNS provider</option>
                  <option value="router">Only the router (UPnP, stays on your LAN)</option>
                  <option value="provider">Only the DDNS provider</option>
                </Select>
              </Field>
            </div>
          </Card>

          <Callout tone="success" title="Privacy">
            HawHost only contacts the DDNS providers you add here, and only to update your hostname or learn your public IP.
          </Callout>
        </div>
      </div>

      <Card title="Update history" icon={ShieldCheck}>
        {ddns.history.length === 0 ? <p className="text-ink-400">No updates yet.</p> : (
          <table className="w-full text-[12.5px]">
            <thead><tr className="text-left text-ink-400"><th className="font-medium pb-2">When</th><th className="font-medium pb-2">Hostname</th><th className="font-medium pb-2">IP</th><th className="font-medium pb-2">Result</th></tr></thead>
            <tbody>
              {ddns.history.slice(0, 20).map((h, i) => (
                <tr key={`${h.t}-${i}`} className="border-t border-white/[0.05]">
                  <td className="py-1.5 pr-4 text-ink-400 whitespace-nowrap">{dateTime(h.t)}</td>
                  <td className="py-1.5 pr-4 mono">{h.hostname}</td>
                  <td className="py-1.5 pr-4 mono text-ink-300">{h.ip || '—'}</td>
                  <td className={cx('py-1.5', h.ok ? 'text-emerald-300' : 'text-amber-300')}>{h.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {editing && <RecordEditor record={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
