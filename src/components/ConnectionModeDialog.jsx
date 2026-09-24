import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import ProviderHelp from './ProviderHelp';
import {
  Wifi, Globe, Network, ShieldCheck, ShieldAlert, Copy, Check, ExternalLink, Loader2, AlertTriangle, X, Ticket, FileDown, Users, Send, Globe2, Router, Search, Shield, Info, ChevronDown, ChevronUp, LayoutTemplate, Code2, RefreshCw
} from 'lucide-react';

const TONES = {
  indigo: {
    card: 'border-indigo-500/60 bg-indigo-500/10',
    chip: 'bg-indigo-500/20',
    icon: 'text-indigo-300'
  },
  purple: {
    card: 'border-purple-500/60 bg-purple-500/10',
    chip: 'bg-purple-500/20',
    icon: 'text-purple-300'
  }
};

const BADGE_TONES = {
  good: 'bg-emerald-500/20 text-emerald-300',
  warn: 'bg-amber-500/20 text-amber-300'
};

function Choice({ icon: Icon, title, subtitle, selected, onClick, badge, badgeTone = 'good', tone = 'indigo' }) {
  const palette = TONES[tone] || TONES.indigo;
  return (
    <button
      onClick={onClick}
      className={`w-full text-left p-4 rounded-xl border transition-all ${
        selected
          ? palette.card
          : 'border-white/10 hover:border-white/25 bg-white/[0.02] hover:bg-white/[0.04]'
      }`}
    >
      <div className="flex items-start gap-3">
        <div className={`p-2 rounded-lg flex-shrink-0 ${selected ? palette.chip : 'bg-white/5'}`}>
          <Icon size={18} className={selected ? palette.icon : 'text-slate-400'} />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-sm text-white">{title}</span>
            {badge && (
              <span className={`text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded ${BADGE_TONES[badgeTone] || BADGE_TONES.good}`}>
                {badge}
              </span>
            )}
          </div>
          <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">{subtitle}</p>
        </div>
      </div>
    </button>
  );
}

function CopyField({ label, value, mono = true }) {
  const [copied, setCopied] = useState(false);
  if (!value) return null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard fallback
    }
  };

  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-1.5">{label}</div>
      <div className="flex items-center gap-2 bg-[#0d1117] border border-white/10 rounded-lg px-3 py-2.5">
        <span
          className={`flex-1 truncate text-sm text-emerald-300 ${
            mono ? 'font-mono' : 'font-bold tracking-[0.3em]'
          }`}
        >
          {value}
        </span>
        <button onClick={copy} className="text-slate-400 hover:text-white transition-colors flex-shrink-0">
          {copied ? <Check size={15} className="text-emerald-400" /> : <Copy size={15} />}
        </button>
      </div>
    </div>
  );
}

/**
 * Shown after a folder is chosen. Step 1 picks how the workspace is reachable;
 * step 2 shows the address, QR code and room code to hand to the other computer.
 */
export default function ConnectionModeDialog({ folderName, folderLabel, hasIndex, onStart, onCancel, onDone }) {
  const [step, setStep] = useState('choose');
  const [exposure, setExposure] = useState('wifi');
  const [online, setOnline] = useState('portforward');
  const [requireCode, setRequireCode] = useState(false);
  // A folder with an index.html is most likely a website to show people.
  const [serveAs, setServeAs] = useState(hasIndex ? 'website' : 'editor');
  const [busy, setBusy] = useState(false);
  const [startError, setStartError] = useState('');
  const [result, setResult] = useState(null);
  const [qr, setQr] = useState(null);

  const [domainLabel, setDomainLabel] = useState(() => folderLabel || 'workspace');
  const [domainEnding, setDomainEnding] = useState('box');

  // The ending chosen in Settings, rather than always .box.
  useEffect(() => {
    if (!window.electronAPI || !window.electronAPI.getSettings) return;
    window.electronAPI.getSettings().then((saved) => {
      if (saved && saved.domainEnding) setDomainEnding(saved.domainEnding);
    });
  }, []);
  const [domainWarning, setDomainWarning] = useState(null);

  // Firewall status in dialog
  const [firewallActive, setFirewallActive] = useState(false);
  const [firewallBusy, setFirewallBusy] = useState(false);
  const [firewallError, setFirewallError] = useState('');

  // Open when HawCode's rules exist, or Windows already lets HawCode in on every
  // port; never while a Block rule from a cancelled prompt overrides them.
  const readFirewall = () => {
    if (!window.electronAPI || !window.electronAPI.firewallPlan) return;
    window.electronAPI.firewallPlan().then((plan) => {
      setFirewallActive(Boolean(plan && (plan.installed || plan.applied || plan.webOpen) && !plan.blockedRules));
    });
  };

  // DDNS configuration check for pre-start hint
  const [ddnsReady, setDdnsReady] = useState(null); // null = loading, true/false = known

  useEffect(() => {
    if (!window.electronAPI || !window.electronAPI.domainPreview) return;
    let cancelled = false;
    window.electronAPI.domainPreview(domainLabel, domainEnding).then((preview) => {
      if (!cancelled && preview) setDomainWarning(preview.warning);
    });
    return () => {
      cancelled = true;
    };
  }, [domainLabel, domainEnding]);

  useEffect(readFirewall, []);

  useEffect(() => {
    if (!window.electronAPI || !window.electronAPI.ddnsConfig) return;
    window.electronAPI.ddnsConfig().then((config) => {
      // The same check the main process makes when sharing starts.
      setDdnsReady(Boolean(config && config.ready && config.ready.ok));
    });
  }, []);

  // Whether this internet line accepts incoming connections at all: the same
  // check as Settings → Network Diagnostics, run as soon as Host Online is picked
  // so a carrier-NAT line is steered to Direct P2P before a dead link is made.
  const [reach, setReach] = useState(null); // null = not asked, 'checking', or the result
  const [onlineTouched, setOnlineTouched] = useState(false);

  const checkLine = (fresh) => {
    if (!window.electronAPI || !window.electronAPI.networkCheck) return;
    setReach('checking');
    window.electronAPI.networkCheck({ fresh })
      .then((checked) => setReach(checked || { verdict: 'unknown' }))
      .catch(() => setReach({ verdict: 'unknown' }));
  };

  const pickExposure = (value) => {
    setExposure(value);
    if (value === 'online' && reach === null) checkLine(false);
  };

  const lineBlocked = Boolean(reach && reach !== 'checking' && reach.canForward === false);

  // Direct P2P until the user picks for themselves, when the line cannot forward.
  const onlineMode = !onlineTouched && lineBlocked ? 'direct' : online;

  const pickOnline = (value) => {
    setOnlineTouched(true);
    setOnline(value);
  };

  // A public address that the provider shares cannot be opened by anyone, so it
  // is never the address the QR code or "Open in browser" point at.
  const publicReachable = !(result && result.reach && result.reach.canForward === false);
  const shareUrl = result
    ? (publicReachable && result.publicUrl) || (result.serveAs === 'website' && result.websiteUrl) || result.url
    : null;

  useEffect(() => {
    if (!shareUrl) return;
    let cancelled = false;
    QRCode.toDataURL(shareUrl, { width: 320, margin: 1, color: { dark: '#0d1117', light: '#ffffff' } })
      .then((dataUrl) => {
        if (!cancelled) setQr(dataUrl);
      })
      .catch(() => {
        if (!cancelled) setQr(null);
      });
    return () => {
      cancelled = true;
    };
  }, [shareUrl]);

  // Firewall rules and the hosts entry for this folder's name, in one UAC prompt.
  const activateFirewall = async () => {
    const electron = window.electronAPI;
    if (!electron || !(electron.pcSetupApply || electron.firewallApply)) return;
    setFirewallBusy(true);
    setFirewallError('');
    try {
      const res = electron.pcSetupApply
        ? await electron.pcSetupApply({ domain: result && result.domain })
        : await electron.firewallApply({ internet: true, remember: true });
      if (res && res.ok) {
        setFirewallActive(true);
      } else if (res && res.cancelled) {
        setFirewallError('The Windows permission prompt was cancelled, so nothing changed. Press the button again and choose Yes.');
      } else {
        const failed = [...((res && res.steps) || []), ...((res && res.extra) || [])].filter((step) => !step.ok);
        setFirewallError((res && res.error)
          || (failed.length ? `Windows refused: ${failed.map((step) => step.name || step.id).join('; ')}.` : 'The rules were not applied.'));
      }
    } catch (error) {
      setFirewallError(error && error.message ? error.message : String(error));
    }
    readFirewall();
    setFirewallBusy(false);
  };

  const start = async (overrides = {}) => {
    setBusy(true);
    setStartError('');
    try {
      const response = await onStart({
        exposure,
        online: exposure === 'online' ? onlineMode : 'portforward',
        requireCode,
        serveAs,
        domainName: domainLabel,
        domainEnding,
        ...overrides
      });
      if (!response) {
        setStartError('Sharing did not start. Try again.');
        return;
      }
      if (response.error) {
        setStartError(response.error);
        return;
      }
      setResult(response);
      setStep('ready');
      // Online sharing wants the internet rules, so read the state again.
      readFirewall();
    } catch (error) {
      setStartError(error && error.message ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const retryUpnp = async () => {
    if (!window.electronAPI || !window.electronAPI.upnpRetry) return;
    const upnp = await window.electronAPI.upnpRetry();
    const latest = window.electronAPI.getSyncStatus ? await window.electronAPI.getSyncStatus() : null;
    setResult((current) => ({ ...current, ...(latest || {}), upnp }));
  };

  if (step === 'ready' && result && result.provider === 'direct') {
    return (
      <Shell onCancel={onDone} title="Sharing directly (P2P)" subtitle={folderName}>
        <div className="space-y-4">
          <DomainPanel result={result} />
          <DirectPanel result={result} onDone={onDone} />
        </div>
      </Shell>
    );
  }

  if (step === 'ready' && result) {
    const isOnline = result.exposure === 'online';
    const isWebsite = result.serveAs === 'website';
    // What the router receives on (outside) and what it forwards to on this PC (inside).
    const forwardedPort = result.outsidePort || result.activePort || result.extraPort || result.publicPort || result.port || 3000;
    const insidePort = result.activePort || forwardedPort;
    const upnp = result.upnp;
    const localTestLink = result.localTestUrl || `http://localhost:${forwardedPort}`;

    return (
      <Shell onCancel={onDone} title="Workspace is live" subtitle={folderName}>
        <div className="space-y-4">
          {isOnline && !publicReachable && (
            <>
              <ProviderHelp
                reach={result.reach}
                routerWanIp={(result.upnp && result.upnp.externalIp) || (result.xamppUpnp && result.xamppUpnp.externalIp) || null}
              />
              <div className="p-3.5 rounded-xl bg-purple-500/10 border border-purple-500/30 space-y-2">
                <p className="text-[11px] text-purple-100 leading-relaxed">
                  <strong className="text-white">Share with friends right now:</strong> Direct P2P needs no port
                  forwarding and works on this connection. Each friend connects straight to this PC; no outside
                  server carries the files.
                </p>
                <button
                  onClick={() => start({ exposure: 'online', online: 'direct' })}
                  disabled={busy}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-gradient-to-r from-purple-500 to-indigo-600 hover:from-purple-400 hover:to-indigo-500 disabled:opacity-60 text-white font-bold text-[12px] transition-all"
                >
                  {busy ? <Loader2 size={14} className="animate-spin" /> : <Network size={14} />}
                  Switch to Direct P2P
                </button>
                {startError && <p className="text-[11px] text-rose-300">{startError}</p>}
              </div>
            </>
          )}

          {Array.isArray(result.sites) && result.sites.length > 0 && (
            <div className="p-3 rounded-xl bg-white/[0.02] border border-white/10 space-y-3">
              <div className="text-[10px] uppercase tracking-widest text-slate-400 font-bold">Your websites</div>
              {result.sites.map((site) => (
                <div key={site.name} className="space-y-1.5">
                  <div className="text-[12px] text-white font-semibold">{site.name}</div>
                  <CopyField label="On your Wi-Fi (works now)" value={site.lanUrl} />
                  {site.internetUrl && (
                    <CopyField
                      label={result.reach && result.reach.canForward === false
                        ? 'On the internet (works after your provider gives you a public IP)'
                        : 'On the internet (send to friends)'}
                      value={site.internetUrl}
                    />
                  )}
                </div>
              ))}
            </div>
          )}

          {result.xamppError && (
            <div className="flex items-start gap-2.5 p-3 rounded-lg bg-amber-500/10 border border-amber-500/25 text-[11px] text-amber-200 leading-relaxed">
              <AlertTriangle size={15} className="text-amber-400 flex-shrink-0 mt-0.5" />
              <span><strong className="text-amber-100">XAMPP:</strong> {result.xamppError}</span>
            </div>
          )}

          {(result.startError || result.ddnsError) && (
            <div className="flex items-start gap-2.5 p-3 rounded-lg bg-amber-500/10 border border-amber-500/25">
              <AlertTriangle size={15} className="text-amber-400 flex-shrink-0 mt-0.5" />
              <div className="text-[11px] text-amber-200 leading-relaxed">
                <strong className="block text-amber-100">Notice for online connection:</strong>
                {result.startError || result.ddnsError}
                <span className="block mt-1 text-amber-200/80">
                  Your Wi-Fi address below still works for computers on this network.
                </span>
              </div>
            </div>
          )}

          {/* Local domain broadcasting info */}
          <DomainPanel result={result} />

          <div className="flex gap-4">
            {qr && (
              <div className="bg-white p-2 rounded-xl flex-shrink-0 self-start">
                <img src={qr} alt="QR code for workspace address" className="w-28 h-28" />
              </div>
            )}
            <div className="flex-1 min-w-0 space-y-3">
              {isOnline && result.publicUrl && (
                <div>
                  <CopyField
                    label={publicReachable
                      ? 'Direct Internet / DDNS Address (share with friends)'
                      : 'Internet address (works only after your provider gives you a public IP)'}
                    value={result.publicUrl}
                  />
                  <div className="flex items-center gap-2 mt-1.5">
                    <button
                      onClick={() => window.electronAPI && window.electronAPI.openExternal && window.electronAPI.openExternal(localTestLink)}
                      className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-emerald-600/30 hover:bg-emerald-600/50 text-emerald-200 border border-emerald-500/30 text-[11px] font-semibold transition-colors"
                      title="Open in your browser on this PC"
                    >
                      <ExternalLink size={12} /> Test website on this PC
                    </button>
                    <button
                      onClick={() => window.electronAPI && window.electronAPI.openExternal && window.electronAPI.openExternal(result.publicUrl)}
                      className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-purple-600/20 hover:bg-purple-600/30 text-purple-200 border border-purple-500/30 text-[11px] font-medium transition-colors"
                      title="Open external internet URL"
                    >
                      <Globe size={12} /> Open Internet link
                    </button>
                  </div>
                </div>
              )}
              {isWebsite && result.websiteUrl && (
                <CopyField label="Website on this Wi-Fi" value={result.websiteUrl} />
              )}
              <CopyField label={isWebsite ? 'Editor on this Wi-Fi (for you and collaborators)' : 'Wi-Fi Address (local network devices)'} value={result.url} />
              {result.code && <CopyField label={isWebsite ? 'Room Code (editor only)' : 'Room Code'} value={result.code} mono={false} />}
            </div>
          </div>

          {isWebsite && (
            <div className="flex items-start gap-2.5 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
              <LayoutTemplate size={15} className="text-emerald-300 flex-shrink-0 mt-0.5" />
              <p className="text-[11px] text-emerald-100 leading-relaxed">
                Visitors see your website ({result.folderName}/index.html) and cannot change any file.
                {' '}The editor stays on port {result.port} for you and anyone with the room code.
              </p>
            </div>
          )}

          {/* NAT Loopback Note for Online Mode */}
          {isOnline && (
            <div className="p-2.5 rounded-lg bg-blue-500/10 border border-blue-500/20 text-[11px] text-blue-200/90 leading-relaxed">
              <div className="font-semibold text-blue-100 flex items-center gap-1 mb-0.5">
                💡 Testing your link on this PC?
              </div>
              Click <strong className="text-white">&ldquo;Test website on this PC&rdquo;</strong> to verify in your browser immediately. Most home Wi-Fi routers block connecting to your own public IP from inside the network (NAT Hairpinning). To test the Internet link, disconnect your phone from Wi-Fi (use 4G/5G data).
            </div>
          )}

          {/* Port Forwarding & Windows Firewall Guidance for Online Mode */}
          {isOnline && (
            <div className="p-3.5 rounded-xl bg-white/[0.02] border border-white/10 space-y-3">
              <div className="flex items-center gap-2">
                <Router size={15} className="text-purple-400" />
                <span className="text-[11px] uppercase tracking-wider font-bold text-white">
                  Active Port Forwarding on Windows Computer
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 text-[11px]">
                <div className="p-2 rounded-lg bg-[#0d1117] border border-white/5">
                  <div className="text-[10px] text-slate-500 uppercase font-bold">Forward Port</div>
                  <div className="text-emerald-300 font-mono font-bold mt-0.5">
                    {forwardedPort} (TCP)
                  </div>
                </div>
                <div className="p-2 rounded-lg bg-[#0d1117] border border-white/5">
                  <div className="text-[10px] text-slate-500 uppercase font-bold">Target Local IP</div>
                  <div className="text-slate-200 font-mono font-bold mt-0.5">
                    {result.localIp}
                  </div>
                </div>
              </div>

              {upnp && upnp.ok ? (
                <div className="flex items-start gap-2 text-[11px] text-emerald-200 bg-emerald-500/10 border border-emerald-500/20 p-2 rounded-lg leading-relaxed">
                  <Check size={13} className="text-emerald-400 flex-shrink-0 mt-0.5" />
                  <span>
                    Router port opened automatically (UPnP{upnp.router ? `, ${upnp.router}` : ''}): outside port
                    {' '}<strong className="font-mono">{upnp.externalPort}</strong> → this PC port <strong className="font-mono">{insidePort}</strong>.
                    {!(result.reach && result.reach.verdict === 'cgnat-hidden') && upnp.externalIp && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(upnp.externalIp) && (
                      <span className="block mt-1 text-amber-200">
                        Your router&rsquo;s own internet address ({upnp.externalIp}) is private, so another box (usually the
                        provider&rsquo;s modem) sits in front of it. Open that modem&rsquo;s page (often
                        {' '}<span className="font-mono">http://{upnp.externalIp.split('.').slice(0, 3).join('.')}.1</span>) and either set
                        {' '}<strong>DMZ host</strong> to <span className="font-mono">{upnp.externalIp}</span>, or forward TCP port
                        {' '}<span className="font-mono">{upnp.externalPort}</span> to <span className="font-mono">{upnp.externalIp}</span>.
                        {' '}Or put the modem in bridge mode. If your provider shares one address between customers (CGNAT), use Direct P2P instead.
                      </span>
                    )}
                  </span>
                </div>
              ) : (
                <div className="text-[11px] text-slate-400 leading-relaxed space-y-1.5">
                  {upnp && upnp.error && (
                    <div className="flex items-start gap-2 text-amber-200 bg-amber-500/10 border border-amber-500/20 p-2 rounded-lg">
                      <AlertTriangle size={13} className="text-amber-400 flex-shrink-0 mt-0.5" />
                      <span className="flex-1">Automatic router setup failed: {upnp.error}</span>
                      <button
                        onClick={retryUpnp}
                        className="flex items-center gap-1 px-2 py-0.5 rounded bg-white/10 hover:bg-white/20 text-white text-[10px] font-semibold"
                      >
                        <RefreshCw size={11} /> Try again
                      </button>
                    </div>
                  )}
                  <div>
                    Configure your router to forward TCP port <strong className="text-white font-mono">{forwardedPort}</strong> to this computer&rsquo;s IP (<strong className="text-white font-mono">{result.localIp}</strong>).
                  </div>
                </div>
              )}

              {/* Windows Firewall Quick Activation */}
              <div className="pt-2 border-t border-white/5 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {firewallActive ? (
                    <ShieldCheck size={16} className="text-emerald-400" />
                  ) : (
                    <ShieldAlert size={16} className="text-amber-400" />
                  )}
                  <span className="text-[11px] text-slate-300">
                    {firewallActive ? 'Windows Firewall allows incoming traffic' : 'Windows Firewall may block incoming traffic'}
                  </span>
                </div>

                {!firewallActive && (
                  <button
                    onClick={activateFirewall}
                    disabled={firewallBusy}
                    className="px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-semibold transition-colors flex items-center gap-1"
                  >
                    {firewallBusy ? <Loader2 size={12} className="animate-spin" /> : <Shield size={12} />}
                    Activate Firewall Rules
                  </button>
                )}
              </div>
              {firewallError && (
                <div className="text-[11px] text-rose-200 bg-rose-500/10 border border-rose-500/25 p-2 rounded-lg leading-relaxed">
                  {firewallError}
                </div>
              )}

              {result.needsDdnsSetup && (
                <div className="text-[10px] text-indigo-300 bg-indigo-500/10 border border-indigo-500/20 p-2 rounded-lg leading-relaxed">
                  Tip: Free DDNS is not configured yet. This address uses your current public IP.
                  You can set up a free permanent domain name (e.g. DuckDNS) in Settings.
                </div>
              )}

              {result.extraPortError && (
                <div className="text-[10px] text-amber-300 bg-amber-500/10 border border-amber-500/20 p-2 rounded-lg leading-relaxed">
                  ⚠ Extra port could not open: {result.extraPortError}. Go to Settings → Custom Forwarded Port to change it.
                </div>
              )}
            </div>
          )}

          {/* Router Port Forwarding Step-by-Step Guide */}
          {isOnline && !(upnp && upnp.ok) && (
            <RouterGuidePanel port={forwardedPort} localIp={result.localIp} publicUrl={result.publicUrl} />
          )}

          {result.xamppLanUrl && (
            <CopyField label="XAMPP / Apache site on this Wi-Fi" value={result.xamppLanUrl} />
          )}
          {result.xamppUrl && (
            <div>
              <CopyField label="XAMPP / Apache site on the internet" value={result.xamppUrl} />
              {result.xamppUpnp && (
                <div className={`text-[10px] mt-1 ${result.xamppUpnp.ok ? 'text-emerald-300' : 'text-amber-300'}`}>
                  {result.xamppUpnp.ok
                    ? `Router forwards outside port ${result.xamppUpnp.externalPort} to Apache automatically (UPnP).`
                    : `Router did not forward Apache's port automatically: ${result.xamppUpnp.error}`}
                </div>
              )}
            </div>
          )}

          {result.code && !isWebsite && (
            <div className="flex items-start gap-2.5 p-3 rounded-lg bg-indigo-500/10 border border-indigo-500/20">
              <ShieldCheck size={15} className="text-indigo-300 flex-shrink-0 mt-0.5" />
              <p className="text-[11px] text-indigo-200 leading-relaxed">
                The other computer needs both the address and this room code. Without the
                code it cannot read or change your folder.
              </p>
            </div>
          )}

          <div className="flex gap-3 pt-1">
            {shareUrl && (
              <button
                onClick={() => window.electronAPI.openExternal(shareUrl)}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg bg-white/5 hover:bg-white/10 text-white text-sm font-medium transition-colors border border-white/10"
              >
                <ExternalLink size={15} />
                Open in browser
              </button>
            )}
            <button
              onClick={onDone}
              className="flex-1 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold transition-colors"
            >
              Start working
            </button>
          </div>
        </div>
      </Shell>
    );
  }

  return (
    <Shell onCancel={onCancel} title="How should this folder be shared?" subtitle={folderName}>
      <div className="space-y-3">
        <DomainField
          name={domainLabel}
          ending={domainEnding}
          onName={setDomainLabel}
          onEnding={setDomainEnding}
          warning={domainWarning}
        />

        <div>
          <div className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-1.5">Visitors see</div>
          <div className="grid grid-cols-2 gap-2">
            <Choice
              icon={LayoutTemplate}
              title="Website"
              subtitle={hasIndex
                ? 'Serve index.html and the rest of the folder as a normal website. Read-only.'
                : 'Serve the folder as a website. No index.html here, so visitors get a file list.'}
              selected={serveAs === 'website'}
              onClick={() => setServeAs('website')}
            />
            <Choice
              icon={Code2}
              title="Editor"
              subtitle="Open the folder in HawCode's live editor so others can read and edit it."
              selected={serveAs === 'editor'}
              onClick={() => setServeAs('editor')}
            />
          </div>
        </div>

        <Choice
          icon={Wifi}
          title="Wi-Fi / Local Router (100% Local)"
          subtitle="Share with computers on the same Wi-Fi or router. 100% local, stays on your own network, zero external websites or domains."
          selected={exposure === 'wifi'}
          onClick={() => pickExposure('wifi')}
          badge="fastest · local"
        />

        <Choice
          icon={Globe}
          title="Host Online (Direct to this PC)"
          subtitle="Share with computers over the internet directly from this Windows computer. Protected by room code."
          selected={exposure === 'online'}
          onClick={() => pickExposure('online')}
          tone="purple"
        />

        {exposure === 'online' && (
          <div className="pl-4 border-l-2 border-purple-500/30 ml-2 space-y-2.5 pt-1">
            <LineCheck reach={reach} onRecheck={() => checkLine(true)} />
            <Choice
              icon={Router}
              title="Port Forwarding & Free Windows DDNS"
              subtitle={lineBlocked
                ? 'Will not work on this connection: your provider shares your public address, so no router setting can let friends in.'
                : 'Your computer hosts the server directly. Connections arrive straight at your Windows PC via port forwarding or a free DDNS domain. Zero middleman proxies or external tunnels.'}
              selected={onlineMode === 'portforward'}
              onClick={() => pickOnline('portforward')}
              badge={lineBlocked ? 'needs public IP from provider' : 'direct server'}
              badgeTone={lineBlocked ? 'warn' : 'good'}
              tone="purple"
            />
            <Choice
              icon={Network}
              title="Direct P2P (computer to computer)"
              subtitle="Direct encrypted WebRTC connection straight between two machines. You exchange invite codes with your friend directly."
              selected={onlineMode === 'direct'}
              onClick={() => pickOnline('direct')}
              badge={lineBlocked ? 'works on your line' : null}
              tone="purple"
            />
          </div>
        )}

        {exposure === 'wifi' && (
          <label className="flex items-center gap-3 p-3 rounded-xl bg-white/[0.02] border border-white/10 cursor-pointer hover:border-white/20 transition-colors">
            <input
              type="checkbox"
              checked={requireCode}
              onChange={(event) => setRequireCode(event.target.checked)}
              className="w-4 h-4 accent-indigo-500"
            />
            <ShieldCheck size={16} className="text-slate-400" />
            <div>
              <div className="text-sm text-white font-medium">Require a room code</div>
              <div className="text-[11px] text-slate-500">
                Anyone on your Wi-Fi can join without this.
              </div>
            </div>
          </label>
        )}

        {exposure === 'online' && onlineMode === 'portforward' && (
          <DdnsPreStartHint ddnsReady={ddnsReady} />
        )}

        {startError && (
          <div className="flex items-start gap-2.5 p-3 rounded-lg bg-rose-500/10 border border-rose-500/25 text-[11px] text-rose-200 leading-relaxed">
            <AlertTriangle size={15} className="text-rose-400 flex-shrink-0 mt-0.5" />
            {startError}
          </div>
        )}

        <button
          onClick={() => start()}
          disabled={busy}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-gradient-to-r from-indigo-500 to-blue-600 hover:from-indigo-400 hover:to-blue-500 disabled:opacity-60 text-white font-bold text-sm transition-all shadow-lg shadow-indigo-500/20 mt-2"
        >
          {busy ? (
            <>
              <Loader2 size={16} className="animate-spin" />
              Starting server…
            </>
          ) : (
            'Start sharing'
          )}
        </button>
      </div>
    </Shell>
  );
}

/**
 * Direct sharing, after it has started.
 */
export function DirectPanel({ result, onDone }) {
  const [invite, setInvite] = useState(null);
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState('');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(null);
  const [copied, setCopied] = useState(false);
  const [states, setStates] = useState({});

  useEffect(() => {
    if (!window.electronAPI || !window.electronAPI.onDirectPeerState) return undefined;
    return window.electronAPI.onDirectPeerState((update) => {
      setStates((current) => ({ ...current, [update.peerId]: update }));
    });
  }, []);

  const entries = Object.values(states);
  const connected = entries.filter((entry) => entry.state === 'connected' || entry.state === 'open');
  const failed = entries.some((entry) => entry.state === 'failed');

  const newInvite = async () => {
    setBusy(true);
    setError('');
    const created = await window.electronAPI.createInvite();
    setBusy(false);
    if (created && created.error) setError(created.error);
    else setInvite(created);
  };

  const copyInvite = async () => {
    if (!invite || !invite.code) return;
    try {
      await navigator.clipboard.writeText(invite.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Manual copy fallback
    }
  };

  const savePage = async () => {
    const written = await window.electronAPI.saveInvitePage(invite.peerId);
    if (written && written.error) setError(written.error);
    else if (written && written.filePath) setSaved(written.filePath);
  };

  const connect = async () => {
    setBusy(true);
    setError('');
    const outcome = await window.electronAPI.acceptAnswer(invite.peerId, reply.trim());
    setBusy(false);
    if (outcome && outcome.error) setError(outcome.error);
    else setReply('');
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2.5 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
        <ShieldCheck size={15} className="text-emerald-300 flex-shrink-0 mt-0.5" />
        <p className="text-[11px] text-emerald-100 leading-relaxed">
          This computer is the server. Friends connect straight to it and the files never
          pass through any third-party company. Keep HawCode open while sharing.
        </p>
      </div>

      {result.localName && <CopyField label="On your own Wi-Fi" value={result.localName} />}

      {!invite && (
        <button
          onClick={newInvite}
          disabled={busy}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-gradient-to-r from-purple-500 to-indigo-600 hover:from-purple-400 hover:to-indigo-500 disabled:opacity-60 text-white font-bold text-sm transition-all"
        >
          {busy ? <Loader2 size={16} className="animate-spin" /> : <Ticket size={16} />}
          Create an invite for a friend
        </button>
      )}

      {invite && (
        <div className="space-y-3 p-3.5 rounded-xl bg-white/[0.02] border border-white/10">
          <div>
            <div className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-1.5">
              Step 1 — send this invite code to your friend
            </div>
            <textarea
              readOnly
              value={invite.code}
              onFocus={(event) => event.target.select()}
              className="w-full h-20 bg-[#0d1117] border border-white/10 rounded-lg px-3 py-2 text-[11px] text-emerald-300 font-mono break-all resize-none focus:outline-none focus:border-indigo-500"
            />
            <div className="flex gap-2 mt-2">
              <button
                onClick={copyInvite}
                className="flex-1 flex items-center justify-center gap-2 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-white text-[12px] font-medium transition-colors border border-white/10"
              >
                {copied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                {copied ? 'Copied' : 'Copy invite code'}
              </button>
              <button
                onClick={savePage}
                className="flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-white text-[12px] font-medium transition-colors border border-white/10"
              >
                <FileDown size={14} />
                Save page for browser
              </button>
            </div>
            {saved && (
              <p className="text-[10px] text-emerald-300/80 mt-1.5 break-all">
                Saved to {saved} — send that file to a friend who does not have HawCode.
              </p>
            )}
          </div>

          <div>
            <div className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-1.5">
              Step 2 — paste the reply code they send back
            </div>
            <textarea
              placeholder="HAW1-…"
              value={reply}
              onChange={(event) => {
                setReply(event.target.value);
                setError('');
              }}
              className="w-full h-20 bg-[#0d1117] border border-white/10 rounded-lg px-3 py-2.5 text-[11px] text-white font-mono break-all resize-none focus:outline-none focus:border-indigo-500 transition-colors placeholder:text-slate-600"
            />
            <div className="flex gap-2 mt-2">
              <button
                onClick={connect}
                disabled={busy || !reply.trim()}
                className="flex-1 flex items-center justify-center gap-2 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-[12px] font-semibold transition-colors"
              >
                <Send size={14} />
                Connect this friend
              </button>
              <button
                onClick={newInvite}
                disabled={busy}
                className="flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-white text-[12px] font-medium transition-colors border border-white/10"
              >
                <Ticket size={14} />
                New invite
              </button>
            </div>
          </div>
        </div>
      )}

      {connected.length > 0 && (
        <div className="flex items-center gap-2.5 p-3 rounded-lg bg-indigo-500/10 border border-indigo-500/20">
          <Users size={15} className="text-indigo-300 flex-shrink-0" />
          <p className="text-[11px] text-indigo-100">
            {connected.length} {connected.length === 1 ? 'friend is' : 'friends are'} connected
            directly to this computer.
          </p>
        </div>
      )}

      {error && <p className="text-rose-400 text-[11px] leading-relaxed">{error}</p>}

      {failed && (
        <div className="flex items-start gap-2.5 p-3 rounded-lg bg-amber-500/10 border border-amber-500/25">
          <AlertTriangle size={15} className="text-amber-400 flex-shrink-0 mt-0.5" />
          <div className="text-[11px] text-amber-200 leading-relaxed">
            <strong className="block text-amber-100">
              That friend&rsquo;s network refused the direct P2P connection.
            </strong>
            Some networks (often mobile data or office networks) use symmetric NAT that prevents
            direct hole punching. Ask the friend to try from a home Wi-Fi, then press
            {' '}<strong>New invite</strong>. Friends on your own Wi-Fi can always use the Wi-Fi address.
          </div>
        </div>
      )}

      {onDone && (
        <div className="flex gap-3 pt-1">
          <button
            onClick={onDone}
            className="flex-1 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold transition-colors"
          >
            Start working
          </button>
        </div>
      )}

      <p className="text-[10px] text-slate-600 leading-relaxed">
        One invite connects one friend. Anyone holding a code can open this folder, so send it
        the way you would send a password.
      </p>
    </div>
  );
}

/**
 * Naming the folder, before anything is shared.
 */
function DomainField({ name, ending, onName, onEnding, warning }) {
  return (
    <div className="p-3 rounded-xl bg-white/[0.02] border border-white/10 space-y-2">
      <div className="flex items-center gap-2">
        <Globe2 size={13} className="text-emerald-300" />
        <span className="text-[10px] uppercase tracking-widest text-slate-400 font-bold">
          Local Domain &amp; Network Name
        </span>
      </div>
      <div className="flex items-center gap-1.5">
        <input
          type="text"
          value={name}
          onChange={(event) => onName(event.target.value)}
          placeholder="notes"
          className="flex-1 min-w-0 bg-[#0d1117] border border-white/10 rounded-lg px-3 py-2 text-sm text-emerald-300 font-mono focus:outline-none focus:border-emerald-500 transition-colors placeholder:text-slate-600"
        />
        <span className="text-slate-500 font-mono text-sm">.</span>
        <input
          type="text"
          value={ending}
          onChange={(event) => onEnding(event.target.value)}
          placeholder="box"
          className="w-28 bg-[#0d1117] border border-white/10 rounded-lg px-3 py-2 text-sm text-emerald-300 font-mono focus:outline-none focus:border-emerald-500 transition-colors placeholder:text-slate-600"
        />
      </div>
      <p className="text-[11px] text-slate-500 leading-relaxed">
        Your computer answers for this name itself via its built-in DNS server — completely local,
        no external registration required.
      </p>
      {warning && (
        <div
          className={`flex items-start gap-2 p-2.5 rounded-lg border ${
            warning.level === 'warn'
              ? 'bg-amber-500/10 border-amber-500/25'
              : 'bg-white/[0.03] border-white/10'
          }`}
        >
          <AlertTriangle
            size={13}
            className={`flex-shrink-0 mt-0.5 ${
              warning.level === 'warn' ? 'text-amber-400' : 'text-slate-500'
            }`}
          />
          <p
            className={`text-[11px] leading-relaxed ${
              warning.level === 'warn' ? 'text-amber-200' : 'text-slate-400'
            }`}
          >
            {warning.message}
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * How to make the local domain work on other devices.
 */
function DomainPanel({ result }) {
  const [setup, setSetup] = useState(null);
  const [checking, setChecking] = useState(false);
  const [checked, setChecked] = useState(null);

  useEffect(() => {
    if (!window.electronAPI || !window.electronAPI.domainSetup) return;
    window.electronAPI.domainSetup().then(setSetup);
  }, []);

  const runCheck = async () => {
    setChecking(true);
    setChecked(await window.electronAPI.domainCheck());
    setChecking(false);
  };

  if (!setup || !setup.domain) return null;

  return (
    <div className="space-y-3">
      <CopyField label="Office address for this folder" value={setup.url || result.url} />

      {setup.apacheRouted ? (
        <p className="text-[10px] text-emerald-300/80 leading-relaxed">
          XAMPP&rsquo;s Apache keeps port 80 and hands this name to HawCode, so the address needs no
          port number. http://localhost still opens your htdocs site.
        </p>
      ) : setup.publicPort !== 80 && (
        <p className="text-[10px] text-amber-300/80 leading-relaxed">
          Another program is using port 80 on this computer, so the address carries a port
          number. Free that port and restart HawCode to drop it.
        </p>
      )}
      {result.apacheError && (
        <p className="text-[10px] text-rose-300 leading-relaxed">
          Apache could not route the name: {result.apacheError}
        </p>
      )}

      <div className="p-3 rounded-xl bg-white/[0.02] border border-white/10 space-y-2.5">
        <div className="flex items-center gap-2">
          <Router size={13} className="text-indigo-300" />
          <span className="text-[10px] uppercase tracking-widest text-slate-400 font-bold">
            Office network name resolution
          </span>
        </div>

        <CopyField label="This computer's DNS server address" value={setup.dnsAddress} />

        <div className="space-y-2 text-[11px] text-slate-400 leading-relaxed">
          <p>
            <strong className="text-slate-200">Same office network:</strong> Keep this computer and
            your coworkers on the same Wi-Fi or wired network. They can open the office address after
            setting their DNS as shown below.
          </p>
          <p>
            <strong className="text-slate-200">Quick local address:</strong> On most devices, you
            can also open <span className="font-mono text-emerald-300">{setup.localName}</span> directly
            without setting DNS!
          </p>
          <p>
            <strong className="text-slate-200">Custom office domain:</strong> In your phone/laptop Wi-Fi
            settings, set DNS to <span className="font-mono text-emerald-300">{setup.dnsAddress}</span> to
            resolve <span className="font-mono text-emerald-300">http://{setup.domain}</span> locally.
          </p>
          <p className="text-amber-200/80">
            Office sharing does not need public DDNS or router port forwarding. Keep HawCode open while
            coworkers use the folder.
          </p>
        </div>

        {setup.upstream && setup.upstream.length > 0 && (
          <p className="text-[10px] text-slate-600">
            Other queries are forwarded to {setup.upstream.join(', ')} and answered normally.
          </p>
        )}
      </div>

      <button
        onClick={runCheck}
        disabled={checking}
        className="w-full flex items-center justify-center gap-2 py-2 rounded-lg bg-white/5 hover:bg-white/10 disabled:opacity-50 text-white text-[12px] font-medium transition-colors border border-white/10"
      >
        {checking ? (
          <>
            <Loader2 size={14} className="animate-spin" />
            Testing local DNS query…
          </>
        ) : (
          <>
            <Search size={14} />
            Verify local DNS is answering
          </>
        )}
      </button>

      {checked && (
        <div
          className={`flex items-start gap-2.5 p-3 rounded-lg border ${
            checked.ok ? 'bg-emerald-500/10 border-emerald-500/20' : 'bg-rose-500/10 border-rose-500/20'
          }`}
        >
          {checked.ok ? (
            <Check size={15} className="text-emerald-400 flex-shrink-0 mt-0.5" />
          ) : (
            <AlertTriangle size={15} className="text-rose-400 flex-shrink-0 mt-0.5" />
          )}
          <p className={`text-[11px] leading-relaxed ${checked.ok ? 'text-emerald-100' : 'text-rose-200'}`}>
            {checked.ok
              ? `${checked.domain} answers with ${checked.address}. The local DNS server is active.`
              : `${checked.reason || checked.error}. Check Windows Firewall permissions for port 53.`}
          </p>
        </div>
      )}
    </div>
  );
}

function Shell({ children, title, subtitle, onCancel }) {
  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-[#161b22] border border-white/10 rounded-2xl w-full max-w-lg shadow-2xl max-h-[92vh] overflow-y-auto custom-scrollbar">
        <div className="flex items-start gap-3 p-6 pb-4">
          <div className="min-w-0 flex-1">
            <h3 className="text-lg font-bold text-white">{title}</h3>
            {subtitle && (
              <p className="text-xs text-slate-400 mt-0.5 truncate font-mono">{subtitle}</p>
            )}
          </div>
          <button onClick={onCancel} className="text-slate-500 hover:text-white transition-colors flex-shrink-0">
            <X size={18} />
          </button>
        </div>
        <div className="px-6 pb-6">{children}</div>
      </div>
    </div>
  );
}

/**
 * The Settings → Network Diagnostics verdict, shown where the online mode is
 * picked: whether friends on the internet can reach this PC through the router.
 */
function LineCheck({ reach, onRecheck }) {
  if (!reach) return null;
  if (reach === 'checking') {
    return (
      <div className="flex items-center gap-2 p-2.5 rounded-lg bg-white/[0.03] border border-white/10 text-[11px] text-slate-400">
        <Loader2 size={13} className="animate-spin flex-shrink-0" />
        Checking whether your internet line accepts incoming connections…
      </div>
    );
  }
  const blocked = reach.canForward === false;
  const open = reach.canForward === true;
  const tone = blocked
    ? 'bg-amber-500/10 border-amber-500/25 text-amber-200'
    : open
      ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-200'
      : 'bg-white/[0.03] border-white/10 text-slate-400';
  return (
    <div className={`flex items-start gap-2 p-2.5 rounded-lg border text-[11px] leading-relaxed ${tone}`}>
      {blocked
        ? <AlertTriangle size={13} className="text-amber-400 flex-shrink-0 mt-0.5" />
        : open
          ? <ShieldCheck size={13} className="text-emerald-400 flex-shrink-0 mt-0.5" />
          : <Info size={13} className="flex-shrink-0 mt-0.5" />}
      <div className="flex-1 min-w-0">
        <strong className="block">
          {blocked
            ? `Your line: ${reach.label || 'no incoming connections'}`
            : open
              ? `Your line: ${reach.label || 'public IP'}${reach.publicIp ? ` (${reach.publicIp})` : ''}`
              : 'Could not check your internet line'}
        </strong>
        {blocked
          ? 'Port forwarding and DDNS cannot reach this PC until your provider gives you a public IP. Direct P2P has been selected because it works anyway.'
          : open
            ? 'Port forwarding can work: forward the port on your router (or turn on UPnP) and friends can open your link.'
            : (reach.summary || 'Port forwarding may or may not work. Direct P2P works on most connections.')}
      </div>
      <button
        onClick={onRecheck}
        title="Check again"
        className="p-1 rounded text-slate-400 hover:text-white hover:bg-white/10 flex-shrink-0"
      >
        <RefreshCw size={12} />
      </button>
    </div>
  );
}

/**
 * Pre-start hint shown when Port Forwarding mode is selected but DDNS is not configured.
 * Reminds the user to set up a free DDNS domain in Settings before they share.
 */
function DdnsPreStartHint({ ddnsReady }) {
  // Still loading — don't flash a warning
  if (ddnsReady === null) return null;
  // Already configured — no need to remind
  if (ddnsReady) {
    return (
      <div className="flex items-center gap-2 p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
        <ShieldCheck size={13} className="text-emerald-400 flex-shrink-0" />
        <p className="text-[11px] text-emerald-200 leading-relaxed">
          Free DDNS is configured — your workspace will get a permanent hostname automatically.
        </p>
      </div>
    );
  }
  return (
    <div className="p-3 rounded-xl bg-indigo-500/10 border border-indigo-500/20 space-y-2">
      <div className="flex items-center gap-2">
        <Info size={13} className="text-indigo-300 flex-shrink-0" />
        <span className="text-[11px] font-semibold text-indigo-200">
          Free DDNS not configured
        </span>
      </div>
      <p className="text-[11px] text-indigo-200/80 leading-relaxed">
        Without DDNS, your workspace link will show your current public IP address. If your ISP
        changes it (common with dynamic IPs), the link will stop working.
      </p>
      <p className="text-[11px] text-indigo-300 leading-relaxed">
        <strong>Recommended:</strong> Sign up for a free account at{' '}
        <button
          onClick={() => window.electronAPI && window.electronAPI.openExternal('https://www.duckdns.org')}
          className="underline hover:text-indigo-100"
        >
          duckdns.org
        </button>
        , create a subdomain, then go to{' '}
        <strong>Settings → Free Windows DDNS</strong> and paste your token.
      </p>
      <p className="text-[10px] text-indigo-300/60">
        You can still start sharing now — you can set up DDNS any time in Settings.
      </p>
    </div>
  );
}

/**
 * Step-by-step router port forwarding guide.
 * Shown after the workspace starts in online (port forward) mode.
 */
function RouterGuidePanel({ port, localIp, publicUrl }) {
  const [open, setOpen] = useState(false);

  if (!port || !localIp) return null;

  const steps = [
    {
      n: 1,
      title: 'Open your router admin panel',
      detail: 'In a browser, go to your gateway address (usually 192.168.1.1 or 192.168.0.1). ' +
              'Log in with your router username and password (often printed on the router label).'
    },
    {
      n: 2,
      title: `Find "Port Forwarding" or "Virtual Server"`,
      detail: 'Look in sections called "Advanced", "NAT", "Firewall", or "Gaming". ' +
              'Different brands use different names — Asus: "WAN → Virtual Server/Port Forwarding", ' +
              'TP-Link: "Advanced → NAT Forwarding → Virtual Servers" (older models such as TL-WR940N: "Forwarding → Virtual Servers"), ' +
              'Netgear: "Advanced Setup → Port Forwarding", ' +
              'D-Link: "Advanced → Port Forwarding".'
    },
    {
      n: 3,
      title: 'Create a new forwarding rule',
      detail: null,
      fields: [
        { label: 'External / WAN Port', value: String(port) },
        { label: 'Internal / LAN Port', value: String(port) },
        { label: 'Protocol', value: 'TCP' },
        { label: 'Internal IP / LAN Host', value: localIp }
      ]
    },
    {
      n: 4,
      title: 'Save and apply',
      detail: 'Click Save. Some routers require a reboot. The rule takes effect immediately on most.'
    },
    {
      n: 5,
      title: 'Verify it works',
      detail: publicUrl && !publicUrl.includes('<your-public-ip>')
        ? `Ask someone outside your network to open: ${publicUrl} in their browser.`
        : 'Ask someone outside your network to open your public IP address with the forwarded port in a browser. ' +
          'You can find your public IP in the network diagnostics in Settings.'
    }
  ];

  return (
    <div className="rounded-xl border border-purple-500/20 bg-purple-500/5 overflow-hidden">
      <button
        onClick={() => setOpen((prev) => !prev)}
        className="w-full flex items-center justify-between p-3.5 hover:bg-purple-500/10 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Router size={14} className="text-purple-400" />
          <span className="text-[11px] font-bold text-purple-200 uppercase tracking-wider">
            Router Port Forwarding Guide
          </span>
          <span className="text-[9px] bg-purple-500/30 text-purple-200 px-1.5 py-0.5 rounded font-bold uppercase">
            Step-by-Step
          </span>
        </div>
        {open ? <ChevronUp size={14} className="text-purple-400" /> : <ChevronDown size={14} className="text-purple-400" />}
      </button>

      {open && (
        <div className="px-3.5 pb-3.5 space-y-3">
          <p className="text-[11px] text-purple-200/80 leading-relaxed">
            Port forwarding tells your router to send incoming internet traffic on port{' '}
            <strong className="text-white font-mono">{port}</strong> directly to this computer
            at <strong className="text-white font-mono">{localIp}</strong>.
          </p>

          <div className="space-y-2">
            {steps.map((step) => (
              <div key={step.n} className="flex gap-3">
                <div className="flex-shrink-0 w-5 h-5 rounded-full bg-purple-500/30 flex items-center justify-center">
                  <span className="text-[9px] font-bold text-purple-200">{step.n}</span>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] font-semibold text-white">{step.title}</div>
                  {step.detail && (
                    <p className="text-[10px] text-slate-400 mt-0.5 leading-relaxed">{step.detail}</p>
                  )}
                  {step.fields && (
                    <div className="mt-1.5 grid grid-cols-2 gap-1">
                      {step.fields.map((field) => (
                        <div key={field.label} className="bg-[#0d1117] border border-white/5 rounded p-1.5">
                          <div className="text-[9px] text-slate-500 uppercase font-bold">{field.label}</div>
                          <div className="text-[11px] text-emerald-300 font-mono font-bold mt-0.5">{field.value}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="pt-2 border-t border-white/5">
            <p className="text-[10px] text-slate-500 leading-relaxed">
              <strong className="text-slate-400">Still not working?</strong> Check that Windows Firewall rules are active (see above), and run Network Diagnostics in Settings to verify your public IP. If your ISP uses CGNAT, port forwarding is not possible — use Direct P2P mode instead.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
