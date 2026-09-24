import React from 'react';
import {
  Monitor, Globe, Radio, Plug, CheckCircle2, Circle, AlertTriangle, ArrowRight, ExternalLink,
  Activity, ArrowDownUp, Users, AlertOctagon, Loader2
} from 'lucide-react';

import { useHawhost, useTick, wantedFirewallPorts } from '../lib/store';
import { useFirewallApply } from '../lib/actions';
import { allAddresses } from '../lib/urls';
import { bytes, number, duration, ago, time } from '../lib/format';
import { bridge } from '../lib/bridge';
import { PageHeader, Card, Button, Badge, Dot, CopyText, Callout, cx } from '../components/ui';
import NatNotice from '../components/NatNotice';

function InfoTile({ icon: Icon, label, value, sub, tone }) {
  return (
    <div className="rounded-xl border border-white/[0.07] bg-ink-850 px-4 py-3.5 min-w-0">
      <div className="flex items-center gap-2 text-ink-400 text-[12px] font-medium uppercase tracking-wide">
        <Icon size={14} /> {label}
      </div>
      <div className={cx('mt-2 text-[17px] font-semibold truncate', tone || 'text-white')}>{value}</div>
      {sub && <div className="text-[12px] text-ink-400 mt-0.5 truncate">{sub}</div>}
    </div>
  );
}

function Step({ state, title, detail, action }) {
  const icon = state === 'done'
    ? <CheckCircle2 size={18} className="text-emerald-400" />
    : state === 'warn'
      ? <AlertTriangle size={18} className="text-amber-400" />
      : state === 'loading'
        ? <Loader2 size={18} className="text-ink-400 spin" />
        : <Circle size={18} className="text-ink-500" />;
  return (
    <div className="flex items-start gap-3 py-3 border-b border-white/[0.05] last:border-0">
      <div className="mt-0.5">{icon}</div>
      <div className="flex-1 min-w-0">
        <div className={cx('font-medium', state === 'done' ? 'text-ink-300' : 'text-white')}>{title}</div>
        {detail && <div className="text-[12.5px] text-ink-400 mt-0.5 leading-relaxed">{detail}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

function Stat({ icon: Icon, label, value }) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-9 h-9 rounded-lg bg-white/[0.05] grid place-items-center"><Icon size={16} className="text-ink-300" /></div>
      <div>
        <div className="text-[12px] text-ink-400">{label}</div>
        <div className="text-[16px] font-semibold text-white">{value}</div>
      </div>
    </div>
  );
}

export default function Dashboard({ go }) {
  useTick(1000);
  const { data, firewall, firewallBusy, access, diagnosis } = useHawhost();
  const [applyFirewall, applying] = useFirewallApply();
  const { server, ddns, network, config, upnp } = data;
  const listening = server.listeners.filter((l) => l.state === 'listening');
  const failed = server.listeners.filter((l) => l.state === 'error');
  const addresses = allAddresses(data);
  const records = ddns.records.filter((r) => r.enabled);

  // ---- checklist
  const wanted = wantedFirewallPorts(data);
  const fwMissing = firewall && firewall.supported ? wanted.filter((p) => !firewall.openPorts.includes(p)) : [];
  const fwState = !firewall || firewallBusy ? 'loading' : firewall.supported === false ? 'done' : fwMissing.length ? 'todo' : 'done';
  const forwardedOk = (upnp.forwarded || []).some((f) => f.ok);
  const reached = diagnosis && diagnosis.ports.some((p) => p.public && p.public.result === 'reached');
  const routerState = reached ? 'done' : ddns.natWarning ? 'warn' : forwardedOk ? 'done' : 'todo';

  const steps = [
    {
      state: config.websites.some((w) => w.enabled) ? 'done' : 'todo',
      title: 'Add a website',
      detail: `${config.websites.filter((w) => w.enabled).length} active of ${config.websites.length}. Static HTML, PHP, Node.js apps or a reverse proxy to Apache/Nginx.`,
      action: <Button size="sm" variant="ghost" onClick={() => go('websites')}>Websites <ArrowRight size={13} /></Button>
    },
    {
      state: server.running && !failed.length ? 'done' : failed.length ? 'warn' : 'todo',
      title: 'Web server is listening',
      detail: failed.length ? failed.map((f) => f.error).join(' ') : server.running ? `Listening on ${listening.map((l) => `${l.port}${l.tls ? ' (HTTPS)' : ''}`).join(', ')}.` : 'Start the web server from the sidebar.',
      action: failed.length ? <Button size="sm" variant="ghost" onClick={() => go('ports')}>Fix ports <ArrowRight size={13} /></Button> : null
    },
    {
      state: fwState,
      title: 'Windows Firewall lets visitors in',
      detail: fwState === 'loading' ? 'Checking Windows Firewall…' : fwMissing.length ? `Incoming TCP ${fwMissing.join(', ')} is not allowed yet.` : `Allowed: TCP ${wanted.join(', ') || '—'}.`,
      action: fwMissing.length ? <Button size="sm" variant="primary" loading={applying} onClick={() => applyFirewall()}>Allow ports</Button> : null
    },
    {
      state: records.some((r) => r.lastOk) ? (records.some((r) => r.lastOk === false) ? 'warn' : 'done') : 'todo',
      title: 'A free domain name points here (DDNS)',
      detail: records.length
        ? records.map((r) => `${r.hostname}: ${r.lastResult}`).join(' · ')
        : 'Create a free hostname such as mysite.duckdns.org or myserver.ddns.net.',
      action: <Button size="sm" variant="ghost" onClick={() => go('domains')}>Domains <ArrowRight size={13} /></Button>
    },
    {
      state: routerState,
      title: 'Router forwards the ports to this PC',
      detail: reached
        ? 'Verified: a request to your public address reached this computer.'
        : ddns.natWarning
          ? 'Your connection goes through two routers (or carrier-grade NAT). See Router setup.'
          : forwardedOk ? 'Forwarded automatically with UPnP.' : 'Set up port forwarding once in your router, then run the port check.',
      action: <Button size="sm" variant="ghost" onClick={() => go('router')}>Router setup <ArrowRight size={13} /></Button>
    }
  ];

  const recent = access.slice(-8).reverse();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        description="Your PC is the server: websites are served from folders on this computer and reached through your own router and a free DDNS hostname."
      />

      {/* Hero */}
      <div className="relative overflow-hidden rounded-2xl border border-white/[0.08] bg-ink-850">
        <div className="absolute inset-0 opacity-[0.16] brand-gradient pointer-events-none" />
        <div className="relative flex items-center justify-between gap-6 px-6 py-5">
          <div className="flex items-center gap-4 min-w-0">
            <div className={cx('w-12 h-12 rounded-xl grid place-items-center', server.running ? 'bg-emerald-400/15' : 'bg-white/[0.06]')}>
              <Activity size={22} className={server.running ? 'text-emerald-300' : 'text-ink-400'} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-[20px] font-semibold text-white">{server.running ? 'Online' : 'Offline'}</span>
                {server.running && <Badge tone="green"><Dot tone="green" pulse /> up {duration(server.startedAt)}</Badge>}
                {data.mode === 'service' && <Badge tone="violet">background service</Badge>}
              </div>
              <div className="text-ink-300 mt-0.5 truncate">
                {server.running
                  ? `Serving ${config.websites.filter((w) => w.enabled).length} website(s) on port ${listening.map((l) => l.port).join(', ')}`
                  : 'Websites are not reachable until the web server is started.'}
              </div>
            </div>
          </div>
          {addresses[0] && (
            <Button variant="secondary" icon={ExternalLink} onClick={async () => (await bridge()).openExternal(addresses[0].url)}>Open website</Button>
          )}
        </div>
      </div>

      {/* Connection information */}
      <div className="grid grid-cols-4 gap-3">
        <InfoTile icon={Monitor} label="Local IP" value={<span className="mono">{network.localIp}</span>} sub={`${network.adapterName || 'Network'} · router ${network.gateway || '?'}`} />
        <InfoTile
          icon={Globe}
          label="Public IP"
          value={<span className="mono">{ddns.publicIp || 'Unknown'}</span>}
          sub={ddns.publicIp ? `via ${ddns.publicIpSource} · ${ago(ddns.publicIpCheckedAt)}` : 'Turn on UPnP or add a DDNS provider'}
          tone={ddns.publicIp ? 'text-white' : 'text-ink-400'}
        />
        <InfoTile
          icon={Radio}
          label="DDNS hostname"
          value={records[0] ? <span className="mono">{records[0].hostname}</span> : 'Not set up'}
          sub={records.length ? `${records.length > 1 ? `+${records.length - 1} more · ` : ''}${records[0].lastOk ? `points to ${records[0].lastIp || '…'}` : records[0].lastResult}` : 'DuckDNS, No-IP or Dynu — all free'}
          tone={records[0] ? 'text-white' : 'text-ink-400'}
        />
        <InfoTile
          icon={Plug}
          label="Active ports"
          value={<span className="mono">{listening.map((l) => l.port).join(', ') || 'none'}</span>}
          sub={failed.length ? `${failed.map((f) => f.port).join(', ')} could not open` : listening.some((l) => l.tls) ? 'HTTPS enabled' : 'HTTP'}
          tone={failed.length ? 'text-amber-300' : 'text-white'}
        />
      </div>

      <NatNotice data={data} onGuide={() => go('router')} />
      {failed.map((f) => (
        <Callout key={f.port} tone="error" title={`Port ${f.port} could not be opened`} action={<Button size="sm" onClick={() => go('ports')}>Change ports</Button>}>{f.error}</Callout>
      ))}

      <div className="grid grid-cols-5 gap-6">
        <Card title="Get online" subtitle="Five steps from folder to website" className="col-span-3">
          {steps.map((s) => <Step key={s.title} {...s} />)}
        </Card>

        <Card title="Addresses" subtitle="Share the internet ones with visitors" className="col-span-2">
          {addresses.length === 0 ? (
            <p className="text-ink-400">Add a website to see its addresses.</p>
          ) : (
            <div className="space-y-1">
              {addresses.slice(0, 10).map((a) => (
                <div key={a.url} className="flex items-center gap-2 py-1.5 border-b border-white/[0.05] last:border-0">
                  <Badge tone={a.kind === 'internet' ? 'violet' : 'neutral'} className="w-[66px] justify-center">{a.kind === 'internet' ? 'Internet' : 'LAN'}</Badge>
                  <CopyText value={a.url} className="flex-1 text-ink-100" />
                  <button type="button" title="Open" className="text-ink-500 hover:text-white" onClick={async () => (await bridge()).openExternal(a.url)}><ExternalLink size={14} /></button>
                </div>
              ))}
            </div>
          )}
          <p className="text-[12px] text-ink-400 mt-3 leading-relaxed">
            Testing an internet address from this PC only works if your router supports NAT loopback. The reliable test is a phone on mobile data.
          </p>
        </Card>
      </div>

      <Card title="Traffic" subtitle="Since the web server started" actions={<Button size="sm" variant="ghost" onClick={() => go('logs')}>All requests <ArrowRight size={13} /></Button>}>
        <div className="grid grid-cols-4 gap-4 mb-4">
          <Stat icon={Activity} label="Requests" value={number(server.stats.requests)} />
          <Stat icon={ArrowDownUp} label="Data sent" value={bytes(server.stats.bytes)} />
          <Stat icon={Users} label="Open connections" value={number(server.stats.activeConnections)} />
          <Stat icon={AlertOctagon} label="Errors (5xx)" value={number(server.stats.status5xx)} />
        </div>
        {recent.length === 0 ? (
          <p className="text-ink-400">No requests yet.</p>
        ) : (
          <table className="w-full text-[12.5px]">
            <tbody>
              {recent.map((r, i) => (
                <tr key={`${r.t}-${i}`} className="border-t border-white/[0.05]">
                  <td className="py-1.5 pr-3 text-ink-400 mono w-[86px]">{time(r.t)}</td>
                  <td className="py-1.5 pr-3 mono w-[130px] text-ink-300">{r.ip}</td>
                  <td className="py-1.5 pr-3 w-[52px]"><StatusCode code={r.status} /></td>
                  <td className="py-1.5 pr-3 mono truncate max-w-0 w-full text-ink-100">{r.method} {r.host}{r.url}</td>
                  <td className="py-1.5 text-ink-400 text-right whitespace-nowrap">{bytes(r.bytes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

export function StatusCode({ code }) {
  const tone = code >= 500 ? 'text-rose-300' : code >= 400 ? 'text-amber-300' : code >= 300 ? 'text-sky-300' : 'text-emerald-300';
  return <span className={cx('mono font-semibold', tone)}>{code}</span>;
}
