import React, { useEffect, useState } from 'react';
import {
  LayoutDashboard, Globe2, Radio, ShieldCheck, Router, Lock, ScrollText, Settings as SettingsIcon,
  Play, Square, RotateCw, WifiOff
} from 'lucide-react';

import { useHawhost } from './lib/store';
import { bridge, isDemo } from './lib/bridge';
import { Button, Dot, Spinner, Toasts, cx } from './components/ui';

import Dashboard from './views/Dashboard';
import Websites from './views/Websites';
import Domains from './views/Domains';
import Ports from './views/Ports';
import RouterSetup from './views/RouterSetup';
import Certificates from './views/Certificates';
import Logs from './views/Logs';
import Settings from './views/Settings';

const NAV = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, view: Dashboard },
  { id: 'websites', label: 'Websites', icon: Globe2, view: Websites },
  { id: 'domains', label: 'Domains (DDNS)', icon: Radio, view: Domains },
  { id: 'ports', label: 'Ports & Firewall', icon: ShieldCheck, view: Ports },
  { id: 'router', label: 'Router setup', icon: Router, view: RouterSetup },
  { id: 'certs', label: 'SSL certificates', icon: Lock, view: Certificates },
  { id: 'logs', label: 'Logs', icon: ScrollText, view: Logs },
  { id: 'settings', label: 'Settings', icon: SettingsIcon, view: Settings }
];

function ServerControl() {
  const { data, call } = useHawhost();
  const [busy, setBusy] = useState(null);
  if (!data) return null;
  const s = data.server;
  const listening = s.listeners.filter((l) => l.state === 'listening');
  const failed = s.listeners.filter((l) => l.state === 'error');
  const run = async (key, path) => {
    setBusy(key);
    try { await call('POST', path); } catch { /* toast shown */ } finally { setBusy(null); }
  };
  return (
    <div className="rounded-xl border border-white/[0.07] bg-ink-900/80 p-3">
      <div className="flex items-center gap-2 text-[12.5px]">
        <Dot tone={s.running ? (failed.length ? 'amber' : 'green') : 'neutral'} pulse={s.running && !failed.length} />
        <span className="font-medium text-ink-100">{s.running ? 'Web server online' : 'Web server stopped'}</span>
      </div>
      <div className="text-[11.5px] text-ink-400 mt-1 mono truncate">
        {s.running ? `Ports ${listening.map((l) => l.port).join(', ') || '—'}` : 'Websites are offline'}
        {failed.length > 0 && <span className="text-amber-300"> · {failed.length} failed</span>}
      </div>
      <div className="flex gap-1.5 mt-2.5">
        {s.running ? (
          <>
            <Button size="sm" variant="danger" icon={Square} loading={busy === 'stop'} onClick={() => run('stop', '/api/server/stop')} className="flex-1">Stop</Button>
            <Button size="sm" icon={RotateCw} loading={busy === 'restart'} onClick={() => run('restart', '/api/server/restart')} title="Restart" />
          </>
        ) : (
          <Button size="sm" variant="success" icon={Play} loading={busy === 'start'} onClick={() => run('start', '/api/server/start')} className="flex-1">Start web server</Button>
        )}
      </div>
    </div>
  );
}

export default function App() {
  const [tab, setTab] = useState('dashboard');
  const { data, connected, fatal, appInfo } = useHawhost();

  useEffect(() => {
    let off;
    bridge().then((b) => { off = b.onNavigate((route) => setTab(route)); }).catch(() => {});
    return () => off && off();
  }, []);

  const View = NAV.find((n) => n.id === tab).view;

  return (
    <div className="flex h-full">
      <aside className="w-[232px] shrink-0 flex flex-col border-r border-white/[0.06] bg-ink-950/60">
        <div className="flex items-center gap-2.5 px-5 h-16">
          <img src="./favicon.png" alt="" className="w-8 h-8 rounded-lg" />
          <div>
            <div className="font-semibold text-white leading-tight tracking-tight">HawHost</div>
            <div className="text-[11px] text-ink-400 leading-tight">Self-hosted web server</div>
          </div>
        </div>
        <nav className="flex-1 overflow-y-auto px-3 py-2 space-y-0.5">
          {NAV.map((item) => {
            const Icon = item.icon;
            const active = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={cx(
                  'w-full flex items-center gap-3 h-9 px-3 rounded-lg text-[13px] transition-colors',
                  active ? 'bg-white/[0.08] text-white font-medium' : 'text-ink-300 hover:text-white hover:bg-white/[0.04]'
                )}
              >
                <Icon size={16} className={active ? 'text-brand-400' : 'text-ink-400'} />
                {item.label}
              </button>
            );
          })}
        </nav>
        <div className="p-3 space-y-2">
          <ServerControl />
          <div className="text-[11px] text-ink-500 text-center">
            {appInfo ? `v${appInfo.version}` : ''}{isDemo() ? ' · demo data' : ''} · no tunnels, no cloud
          </div>
        </div>
      </aside>

      <main className="flex-1 min-w-0 overflow-y-auto">
        {!connected && data && (
          <div className="sticky top-0 z-30 flex items-center gap-3 px-8 py-2.5 bg-amber-500/15 border-b border-amber-400/20 text-amber-100 text-[13px]">
            <WifiOff size={15} /> Reconnecting to the HawHost background server…
          </div>
        )}
        <div className="max-w-[1180px] mx-auto px-8 py-7">
          {fatal && !data ? (
            <div className="rounded-xl border border-rose-400/25 bg-rose-400/[0.06] p-6 text-rose-100">
              <div className="font-semibold mb-1">HawHost could not start its background server</div>
              <div className="text-[13px] opacity-90">{fatal}</div>
              <Button className="mt-4" onClick={async () => { (await bridge()).restartDaemon().then(() => window.location.reload()); }}>Try again</Button>
            </div>
          ) : !data ? (
            <div className="grid place-items-center h-[60vh] text-ink-400 gap-3">
              <div className="flex items-center gap-3"><Spinner /> Starting HawHost…</div>
            </div>
          ) : (
            <View go={setTab} />
          )}
        </div>
      </main>
      <Toasts />
    </div>
  );
}
