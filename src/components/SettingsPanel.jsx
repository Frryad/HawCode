import React, { useState, useEffect } from 'react';
import {
  X, RotateCcw, Save, FileCode2, Check, Globe, Shield, ShieldCheck,
  ShieldAlert, RefreshCw, Key, Activity, Loader2, Copy, Link, ExternalLink, Wifi, Router,
  Globe2, AlertTriangle, CircleDashed
} from 'lucide-react';

import ProviderHelp from './ProviderHelp';
import { DirectPanel } from './ConnectionModeDialog';

const api = window.electronAPI;

function Row({ label, hint, children }) {
  return (
    <div className="flex items-start gap-4 py-2.5 border-b border-white/[0.04]">
      <div className="flex-1 min-w-0">
        <div className="text-[13px] text-slate-200">{label}</div>
        {hint && <div className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">{hint}</div>}
      </div>
      <div className="flex-shrink-0">{children}</div>
    </div>
  );
}

function Switch({ checked, onChange }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      role="switch"
      aria-checked={checked}
      className={`w-9 h-5 rounded-full transition-colors relative ${
        checked ? 'bg-indigo-500' : 'bg-white/10'
      }`}
    >
      <span
        className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${
          checked ? 'left-[18px]' : 'left-0.5'
        }`}
      />
    </button>
  );
}

function NumberInput({ value, onChange, min, max, suffix }) {
  return (
    <div className="flex items-center gap-1.5">
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(event) => {
          const next = Number(event.target.value);
          if (Number.isFinite(next)) onChange(Math.min(max, Math.max(min, next)));
        }}
        className="w-16 bg-[#0d1117] border border-white/10 rounded px-2 py-1 text-[12px] text-white text-right focus:outline-none focus:border-indigo-500"
      />
      {suffix && <span className="text-[11px] text-slate-500">{suffix}</span>}
    </div>
  );
}

export default function SettingsPanel({ onClose, onChanged, rootPath }) {
  const [values, setValues] = useState(null);
  const [shells, setShells] = useState([]);
  const [ignore, setIgnore] = useState('');
  const [ignoreSaved, setIgnoreSaved] = useState(false);
  const [ignoreDirty, setIgnoreDirty] = useState(false);
  const [stun, setStun] = useState('');
  const [dnsStatus, setDnsStatus] = useState(null);

  // DDNS & Port Forwarding State
  const [ddnsConfig, setDdnsConfig] = useState(null);
  const [ddnsStatus, setDdnsStatus] = useState(null);
  const [ddnsToken, setDdnsToken] = useState('');
  const [ddnsTokenSaved, setDdnsTokenSaved] = useState(false);
  const [ddnsTesting, setDdnsTesting] = useState(false);
  const [ddnsTestResult, setDdnsTestResult] = useState(null);

  // Firewall State
  const [firewallPlan, setFirewallPlan] = useState(null);
  const [firewallBusy, setFirewallBusy] = useState(false);

  // XAMPP's Apache
  const [xamppState, setXamppState] = useState(null);
  const [xamppBusy, setXamppBusy] = useState(false);
  const [xamppMessage, setXamppMessage] = useState('');

  // Network reachability
  const [networkDiagnostics, setNetworkDiagnostics] = useState(null);
  const [checkingNetwork, setCheckingNetwork] = useState(false);

  // Wi-Fi router and static IP
  const [router, setRouter] = useState(null);
  const [routerLoading, setRouterLoading] = useState(false);

  const refreshRouter = async () => {
    if (!api.routerInfo) return;
    setRouterLoading(true);
    try {
      setRouter(await api.routerInfo());
    } finally {
      setRouterLoading(false);
    }
  };

  // The share that is running now, so friends elsewhere can be invited from here.
  const [sync, setSync] = useState(null);
  useEffect(() => {
    if (api.getSyncStatus) api.getSyncStatus().then(setSync);
    return api.onSyncStatus ? api.onSyncStatus(setSync) : undefined;
  }, []);

  useEffect(() => {
    if (api.routerInfo) api.routerInfo().then(setRouter);
    api.getSettings().then((loaded) => {
      setValues(loaded);
      setStun((loaded.stunServers || []).join('\n'));
    });
    api.terminalShells().then((info) => setShells(info.shells || []));
    api.readIgnoreFile().then((result) => setIgnore(result.content || ''));
    if (api.domainSetup) api.domainSetup().then(setDnsStatus);
    if (api.ddnsConfig) api.ddnsConfig().then(setDdnsConfig);
    if (api.ddnsStatus) api.ddnsStatus().then(setDdnsStatus);
    if (api.firewallPlan) api.firewallPlan().then(setFirewallPlan);
    if (api.networkCheck) api.networkCheck().then(setNetworkDiagnostics);
    if (api.xamppStatus) api.xamppStatus().then(setXamppState);
  }, []);

  const refreshXampp = async () => {
    if (api.xamppStatus) setXamppState(await api.xamppStatus());
  };

  const startApache = async () => {
    if (!api.xamppStart) return;
    setXamppBusy(true);
    setXamppMessage('');
    try {
      const result = await api.xamppStart();
      setXamppMessage(result && result.ok
        ? `Apache is running on port ${result.port}.`
        : (result && result.error) || 'Apache did not start.');
    } catch (error) {
      setXamppMessage(error.message);
    }
    await refreshXampp();
    setXamppBusy(false);
  };

  const patch = async (change) => {
    const next = await api.updateSettings(change);
    setValues(next);
    if (onChanged) onChanged(next);
  };

  const saveDdnsField = async (patchObj) => {
    if (!api.ddnsSave) return;
    const updated = await api.ddnsSave(patchObj);
    setDdnsConfig(updated);
    if (api.ddnsStatus) api.ddnsStatus().then(setDdnsStatus);
  };

  const saveDdnsToken = async () => {
    if (!api.ddnsSetToken) return;
    const updated = await api.ddnsSetToken(ddnsToken);
    setDdnsConfig(updated);
    setDdnsToken('');
    setDdnsTokenSaved(true);
    setTimeout(() => setDdnsTokenSaved(false), 2000);
  };

  const runDdnsTest = async () => {
    if (!api.ddnsTest) return;
    setDdnsTesting(true);
    setDdnsTestResult(null);
    try {
      const result = await api.ddnsTest({
        provider: ddnsConfig?.provider,
        hostname: ddnsConfig?.hostname,
        username: ddnsConfig?.username,
        customUrl: ddnsConfig?.customUrl,
        token: ddnsToken || undefined
      });
      setDdnsTestResult(result);
    } catch (err) {
      setDdnsTestResult({ ok: false, error: err.message });
    }
    setDdnsTesting(false);
    if (api.ddnsStatus) api.ddnsStatus().then(setDdnsStatus);
  };

  const [firewallMessage, setFirewallMessage] = useState(null); // { ok, text, log }

  const applyFirewall = async (enable) => {
    if (!api.firewallApply || !api.firewallRevert) return;
    setFirewallBusy(true);
    setFirewallMessage(null);
    try {
      const result = enable
        ? await api.firewallApply({ internet: true, remember: true })
        : await api.firewallRevert();
      setFirewallMessage(describeElevated(result, enable ? 'Firewall rules added.' : 'Firewall rules removed.'));
      if (result && result.ok) patch({ firewallAutoApply: Boolean(enable) });
      setFirewallPlan(await api.firewallPlan());
    } catch (error) {
      setFirewallMessage({ ok: false, text: error.message || String(error) });
    }
    setFirewallBusy(false);
  };

  const checkNetwork = async () => {
    if (!api.networkCheck) return;
    setCheckingNetwork(true);
    try {
      const res = await api.networkCheck();
      setNetworkDiagnostics(res);
    } catch (e) {
      console.error(e);
    }
    setCheckingNetwork(false);
  };

  const saveIgnore = async () => {
    const result = await api.writeIgnoreFile(ignore);
    if (result && result.error) {
      window.alert(result.error);
      return;
    }
    setIgnoreDirty(false);
    setIgnoreSaved(true);
    setTimeout(() => setIgnoreSaved(false), 2000);
  };

  const reset = async () => {
    if (!window.confirm('Reset all settings to their defaults?')) return;
    const next = await api.resetSettings();
    setValues(next);
    if (onChanged) onChanged(next);
  };

  if (!values) return null;

  const providerInfo = (ddnsConfig?.providers || []).find((entry) => entry.id === ddnsConfig?.provider) || null;
  const needsUsername = Boolean(providerInfo && providerInfo.needsUsername);
  const firewallRulesOn = Boolean(firewallPlan?.installed || firewallPlan?.applied);
  const firewallReady = (firewallRulesOn || Boolean(firewallPlan?.webOpen)) && !firewallPlan?.blockedRules;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl max-h-[88vh] bg-[#161b22] border border-white/10 rounded-2xl shadow-2xl flex flex-col"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-6 py-4 border-b border-white/5 flex-shrink-0">
          <h2 className="text-base font-bold text-white flex-1">Settings &amp; Network</h2>
          <button
            onClick={reset}
            title="Reset to defaults"
            className="p-1.5 rounded-md text-slate-500 hover:text-white hover:bg-white/5 transition-colors"
          >
            <RotateCcw size={14} />
          </button>
          <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar px-6 py-2">
          {/* Local domain served entirely by this PC */}
          {api.pcSetupStatus && (
            <LocalDomainSetup
              sync={sync}
              values={values}
              router={router}
              onChanged={async () => {
                if (api.firewallPlan) setFirewallPlan(await api.firewallPlan());
                refreshRouter();
                refreshXampp();
              }}
            />
          )}

          {/* Wi-Fi router (TP-Link) and static IP */}
          {api.routerInfo && (
            <RouterStaticIpGuide
              info={router}
              loading={routerLoading}
              onRefresh={refreshRouter}
              reach={networkDiagnostics}
              sync={sync}
            />
          )}

          {/* Windows DDNS System */}
          <div className="mt-3 mb-5 p-4 rounded-xl bg-gradient-to-br from-indigo-500/10 via-purple-500/5 to-transparent border border-indigo-500/20">
            <div className="flex items-center gap-2 mb-1">
              <Globe size={16} className="text-indigo-400" />
              <h3 className="text-sm font-bold text-white">Free Windows Dynamic DNS (DDNS)</h3>
              <span className="text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded bg-white/10 text-slate-300">
                optional · outside service
              </span>
            </div>
            <p className="text-[11px] text-amber-200/80 leading-relaxed mb-2">
              Not needed for a local domain: the name above is answered by this PC itself. DDNS uses an
              outside provider and only helps once your internet provider gives you a public IP.
            </p>
            <p className="text-[11px] text-slate-400 leading-relaxed mb-3">
              Points a free, human-readable domain name straight at your computer&rsquo;s public address.
              Visitors connect directly to your PC without third-party proxy tunnels.
            </p>

            {ddnsConfig && (
              <div className="space-y-3">
                <Row
                  label="Enable Free DDNS"
                  hint="Keeps your chosen domain updated with this computer's public IP automatically."
                >
                  <Switch
                    checked={ddnsConfig.enabled}
                    // Switching on with nothing chosen yet picks DuckDNS, so the
                    // provider shown is the provider saved.
                    onChange={(checked) => saveDdnsField(
                      checked && !ddnsConfig.provider ? { enabled: true, provider: 'duckdns' } : { enabled: checked }
                    )}
                  />
                </Row>

                {ddnsConfig.enabled && (
                  <>
                    <Row label="DDNS Provider" hint={providerInfo ? providerInfo.hint : 'Choose where your free name lives.'}>
                      <select
                        value={ddnsConfig.provider || ''}
                        onChange={(event) => saveDdnsField({ provider: event.target.value })}
                        className="bg-[#0d1117] border border-white/10 rounded px-3 py-1.5 text-[12px] text-white focus:outline-none focus:border-indigo-500"
                      >
                        {!ddnsConfig.provider && <option value="" disabled>Choose…</option>}
                        <option value="duckdns">DuckDNS (free at duckdns.org)</option>
                        <option value="noip">No-IP (free at noip.com)</option>
                        <option value="dynu">Dynu (free at dynu.com)</option>
                        <option value="custom">Custom update URL</option>
                      </select>
                    </Row>

                    <Row
                      label="Domain / Hostname"
                      hint={
                        ddnsConfig.provider === 'duckdns'
                          ? 'Your subdomain label on duckdns.org (e.g. "myproject")'
                          : ddnsConfig.provider === 'noip'
                            ? 'The full hostname you created at No-IP (e.g. myname.ddns.net)'
                            : ddnsConfig.provider === 'dynu'
                              ? 'The full hostname you created at Dynu (e.g. myname.dynu.net)'
                              : 'Full FQDN that your custom update URL targets'
                      }
                    >
                      <input
                        type="text"
                        value={ddnsConfig.hostname || ''}
                        placeholder={{ duckdns: 'myname', noip: 'myname.ddns.net', dynu: 'myname.dynu.net' }[ddnsConfig.provider] || 'myname.example.com'}
                        onChange={(event) => saveDdnsField({ hostname: event.target.value })}
                        className="w-48 bg-[#0d1117] border border-white/10 rounded px-2.5 py-1 text-[12px] text-white font-mono focus:outline-none focus:border-indigo-500"
                      />
                    </Row>

                    {ddnsConfig.provider === 'custom' && (
                      <Row
                        label="Update URL"
                        hint="Must start with https://. Use <HOST> and <IP> placeholders."
                      >
                        <input
                          type="text"
                          value={ddnsConfig.customUrl || ''}
                          placeholder="https://update.example.com/nic/update?hostname=<HOST>&myip=<IP>"
                          onChange={(event) => saveDdnsField({ customUrl: event.target.value })}
                          className="w-full max-w-xs bg-[#0d1117] border border-white/10 rounded px-2.5 py-1 text-[12px] text-white font-mono focus:outline-none focus:border-indigo-500"
                        />
                      </Row>
                    )}

                    {needsUsername && (
                      <Row label="Username" hint={`Your ${providerInfo.label} account name (or its DDNS key username).`}>
                        <input
                          type="text"
                          value={ddnsConfig.username || ''}
                          placeholder="username"
                          onChange={(event) => saveDdnsField({ username: event.target.value })}
                          className="w-48 bg-[#0d1117] border border-white/10 rounded px-2.5 py-1 text-[12px] text-white font-mono focus:outline-none focus:border-indigo-500"
                        />
                      </Row>
                    )}

                    <Row
                      label={needsUsername ? 'Password' : 'Account Token / Secret Key'}
                      hint={
                        ddnsConfig.tokenSet
                          ? 'Token is securely encrypted on this PC. Enter a new one to replace it.'
                          : 'Paste your provider token. It is encrypted and never sent to external servers.'
                      }
                    >
                      <div className="flex items-center gap-2">
                        <input
                          type="password"
                          value={ddnsToken}
                          placeholder={ddnsConfig.tokenSet ? '••••••••••••••••' : 'Enter token'}
                          onChange={(event) => setDdnsToken(event.target.value)}
                          className="w-36 bg-[#0d1117] border border-white/10 rounded px-2 py-1 text-[12px] text-white font-mono focus:outline-none focus:border-indigo-500"
                        />
                        <button
                          onClick={saveDdnsToken}
                          disabled={!ddnsToken.trim()}
                          className="px-2.5 py-1 rounded bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-[11px] font-semibold transition-colors flex items-center gap-1"
                        >
                          {ddnsTokenSaved ? <Check size={12} className="text-emerald-300" /> : <Key size={12} />}
                          {ddnsTokenSaved ? 'Saved' : 'Save'}
                        </button>
                      </div>
                    </Row>

                    <Row
                      label="Update Interval"
                      hint="How often to verify public IP address (minimum 5 minutes)."
                    >
                      <NumberInput
                        value={ddnsConfig.intervalMinutes || 15}
                        min={5}
                        max={120}
                        suffix="min"
                        onChange={(value) => saveDdnsField({ intervalMinutes: value })}
                      />
                    </Row>

                    {/* Status & Test */}
                    <div className="pt-2 flex items-center justify-between border-t border-white/[0.04]">
                      <div className="text-[11px] text-slate-400">
                        {(ddnsStatus?.lastIp || ddnsStatus?.publicIp || networkDiagnostics?.publicIp) ? (
                          <span>
                            Pointed at: <span className="font-mono text-emerald-300">{ddnsStatus?.lastIp || ddnsStatus?.publicIp || networkDiagnostics?.publicIp}</span>
                            {ddnsStatus?.lastAt && ` · ${new Date(ddnsStatus.lastAt).toLocaleTimeString()}`}
                          </span>
                        ) : (
                          <span>Status: {ddnsConfig.tokenSet ? 'Ready' : 'Requires token'}</span>
                        )}
                        {ddnsStatus?.lastError && (
                          <div className="text-rose-400 mt-0.5">{ddnsStatus.lastError}</div>
                        )}
                      </div>
                      <button
                        onClick={runDdnsTest}
                        disabled={ddnsTesting}
                        className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-white text-[11px] font-medium transition-colors flex items-center gap-1.5"
                      >
                        {ddnsTesting ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                        Test &amp; Update Now
                      </button>
                    </div>

                    {ddnsTestResult && (
                      <div
                        className={`p-2.5 rounded-lg text-[11px] leading-relaxed border ${
                          ddnsTestResult.ok
                            ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-200'
                            : 'bg-rose-500/10 border-rose-500/20 text-rose-200'
                        }`}
                      >
                        {ddnsTestResult.ok
                          ? `Success! Reply: "${ddnsTestResult.reply}" · IP: ${ddnsTestResult.ip || ddnsTestResult.publicIp || 'recorded'}`
                            + (ddnsTestResult.resolved
                              ? (ddnsTestResult.pointsHere
                                ? ' · Public DNS already points here.'
                                : ' · Public DNS does not show this address yet; it can take a few minutes.')
                              : '')
                          : `Failed: ${ddnsTestResult.error || ddnsTestResult.reply || 'Check hostname and token.'}`}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>

          {/* Windows Firewall & Active Port Forwarding */}
          <div className="mb-5 p-4 rounded-xl bg-white/[0.02] border border-white/10">
            <div className="flex items-center gap-2 mb-1">
              <Shield size={16} className="text-emerald-400" />
              <h3 className="text-sm font-bold text-white">Windows Firewall &amp; Port Forwarding</h3>
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed mb-3">
              To allow other computers to reach your server directly through port forwarding, Windows Firewall
              must permit incoming connections on TCP ports 80, 3000-3010, and your custom forwarded port.
            </p>

            <div className="space-y-3">
              <Row
                label="Share an XAMPP Apache website"
                hint="Leaves Apache in control of its port and uses your DDNS hostname for the XAMPP site. Start Apache in XAMPP first."
              >
                <Switch
                  checked={Boolean(values.xamppEnabled)}
                  onChange={async (checked) => {
                    await patch({ xamppEnabled: checked });
                    refreshXampp();
                  }}
                />
              </Row>

              {values.xamppEnabled && xamppState && (
                <div className="p-3 rounded-lg bg-[#0d1117] border border-white/5 space-y-2 text-[11px]">
                  {!xamppState.installed ? (
                    <div className="text-amber-300">XAMPP was not found on this computer (looked in C:\xampp).</div>
                  ) : (
                    <>
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-slate-300">
                          Apache ({xamppState.root}) listens on port{' '}
                          <strong className="font-mono text-white">{xamppState.listenPorts.join(', ') || '?'}</strong>
                          {' · '}
                          {xamppState.running
                            ? <span className="text-emerald-400 font-semibold">running</span>
                            : <span className="text-amber-400 font-semibold">not running</span>}
                        </span>
                        {!xamppState.running && (
                          <button
                            onClick={startApache}
                            disabled={xamppBusy}
                            className="px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-[11px] font-semibold flex items-center gap-1"
                          >
                            {xamppBusy && <Loader2 size={12} className="animate-spin" />}
                            Start Apache
                          </button>
                        )}
                      </div>
                      {xamppState.mismatch && (
                        <div className="flex items-center justify-between gap-3 text-amber-200">
                          <span>
                            The port below says {xamppState.configuredPort}, but httpd.conf says {xamppState.port}.
                            HawCode uses {xamppState.port}.
                          </span>
                          <button
                            onClick={async () => { await patch({ xamppPort: xamppState.port }); refreshXampp(); }}
                            className="px-2 py-0.5 rounded bg-white/10 hover:bg-white/20 text-white text-[10px] font-semibold whitespace-nowrap"
                          >
                            Use {xamppState.port}
                          </button>
                        </div>
                      )}
                      {xamppState.lanUrl && (
                        <div className="text-slate-400">
                          On your Wi-Fi: <span className="font-mono text-emerald-300">{xamppState.lanUrl}</span>
                          {xamppState.port === 80 && ' (HawCode leaves port 80 to Apache while this is on)'}
                        </div>
                      )}
                      {xamppMessage && <div className="text-slate-300">{xamppMessage}</div>}
                    </>
                  )}
                </div>
              )}

              {values.xamppEnabled && (
                <Row
                  label="XAMPP Apache Port"
                  hint="Use 80 if Apache listens on port 80, or 8080/another Apache port. Forward this same TCP port in your router."
                >
                  <NumberInput
                    value={values.xamppPort || 80}
                    min={1}
                    max={65535}
                    suffix="TCP"
                    onChange={(value) => patch({ xamppPort: value })}
                  />
                </Row>
              )}

              <div className="flex items-center justify-between p-3 rounded-lg bg-[#0d1117] border border-white/5">
                <div className="flex items-center gap-2.5">
                  {firewallReady ? (
                    <ShieldCheck size={18} className="text-emerald-400" />
                  ) : (
                    <ShieldAlert size={18} className="text-amber-400" />
                  )}
                  <div>
                    <div className="text-[12px] font-semibold text-white">
                      {firewallPlan?.blockedRules
                        ? 'Windows Firewall is blocking HawCode'
                        : firewallRulesOn
                          ? 'Windows Firewall Rules Active'
                          : firewallReady ? 'Web ports already allowed by Windows' : 'Rules Not Yet Applied in Windows'}
                    </div>
                    <div className="text-[10px] text-slate-400">
                      {firewallPlan?.blockedRules
                        ? `${firewallPlan.blockedRules} block rule(s) from a cancelled Windows prompt override every allow rule. "Fix Firewall" removes them.`
                        : firewallRulesOn
                          ? `${firewallPlan.count || 'All'} rules configured for local network and internet port forwarding`
                          : firewallReady
                            ? 'Windows already lets HawCode in on every port. Activate the rules too so the local name server (port 53) answers other devices.'
                            : 'Click below to automatically create rules via Windows netsh (prompts UAC elevation)'}
                    </div>
                  </div>
                </div>

                <div className="flex gap-2">
                  {firewallPlan?.blockedRules > 0 && (
                    <button
                      onClick={() => applyFirewall(true)}
                      disabled={firewallBusy}
                      className="px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-colors flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white"
                    >
                      {firewallBusy && <Loader2 size={12} className="animate-spin" />}
                      Fix Firewall
                    </button>
                  )}
                  <button
                    onClick={() => applyFirewall(!(firewallPlan?.installed || firewallPlan?.applied))}
                    disabled={firewallBusy}
                    className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-colors flex items-center gap-1.5 ${
                      (firewallPlan?.installed || firewallPlan?.applied)
                        ? 'bg-rose-500/20 hover:bg-rose-500/30 text-rose-200'
                        : 'bg-emerald-600 hover:bg-emerald-500 text-white'
                    }`}
                  >
                    {firewallBusy && <Loader2 size={12} className="animate-spin" />}
                    {(firewallPlan?.installed || firewallPlan?.applied) ? 'Revert Rules' : 'Activate Firewall Rules'}
                  </button>
                </div>
              </div>
              <ElevatedMessage message={firewallMessage} />

              <Row
                label="Auto-apply Firewall Rules"
                hint="Automatically ensure Windows Firewall rules are enabled whenever hosting starts."
              >
                <Switch
                  checked={Boolean(values.firewallAutoApply)}
                  onChange={(checked) => {
                    patch({ firewallAutoApply: checked });
                    if (checked && !firewallRulesOn) applyFirewall(true);
                  }}
                />
              </Row>

              <Row
                label="Open Router Port Automatically (UPnP)"
                hint="When sharing online, ask your router to forward the port to this PC. Needs UPnP turned on in the router. Removed again when you stop."
              >
                <Switch
                  checked={values.upnpAutoForward !== false}
                  onChange={(checked) => patch({ upnpAutoForward: checked })}
                />
              </Row>

              <Row
                label="Custom Forwarded Port"
                hint="If your ISP or router blocks port 80, set an alternate port (e.g. 8080) and forward that."
              >
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    value={values.firewallExtraPort || ''}
                    placeholder="8080"
                    min={1024}
                    max={65535}
                    onChange={(event) => {
                      const val = event.target.value ? Number(event.target.value) : null;
                      patch({ firewallExtraPort: val });
                    }}
                    className="w-24 bg-[#0d1117] border border-white/10 rounded px-2.5 py-1 text-[12px] text-white text-right font-mono focus:outline-none focus:border-indigo-500"
                  />
                  <span className="text-[11px] text-slate-500">TCP</span>
                </div>
              </Row>

              {/* Network reachability check */}
              <div className="pt-2 flex items-center justify-between border-t border-white/[0.04]">
                <div className="text-[11px] text-slate-400">
                  Detect public IP, carrier NAT type, and port forwarding feasibility.
                </div>
                <button
                  onClick={checkNetwork}
                  disabled={checkingNetwork}
                  className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-white text-[11px] font-medium transition-colors flex items-center gap-1.5"
                >
                  {checkingNetwork ? <Loader2 size={13} className="animate-spin" /> : <Activity size={13} />}
                  Run Network Diagnostics
                </button>
              </div>

              {networkDiagnostics && (
                <div className="p-3 rounded-lg bg-[#0d1117] border border-white/10 space-y-1.5 text-[11px]">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">Public IP:</span>
                    <span className="text-emerald-300 font-mono font-bold">
                      {networkDiagnostics.reflexive || networkDiagnostics.publicIp || 'Undetected'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">NAT Status:</span>
                    <span className="text-white font-medium">
                      {networkDiagnostics.label || networkDiagnostics.verdict || 'Unknown'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">Port Forwarding:</span>
                    <span
                      className={`font-semibold ${
                        networkDiagnostics.canForward === false ? 'text-amber-400' : 'text-emerald-400'
                      }`}
                    >
                      {networkDiagnostics.canForward === false
                        ? `Not possible: ${networkDiagnostics.label || 'blocked by provider'}`
                        : 'Supported / Ready'}
                    </span>
                  </div>
                  {networkDiagnostics.summary && (
                    <div className="text-[10px] text-slate-400 pt-1 border-t border-white/5 leading-relaxed">
                      {networkDiagnostics.summary} {networkDiagnostics.advice}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* How to Connect From the Internet / Website Link */}
          <div className="mb-5 p-4 rounded-xl bg-white/[0.02] border border-white/10">
            <div className="flex items-center gap-2 mb-1">
              <Link size={16} className="text-blue-400" />
              <h3 className="text-sm font-bold text-white">Connect from the Internet &amp; Website Link</h3>
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed mb-3">
              Share this link with anyone on the internet to let them open your workspace in a browser —
              no account, no install, completely direct to your PC.
            </p>

            <InternetLinkGuide
              networkDiagnostics={networkDiagnostics}
              ddnsConfig={ddnsConfig}
              ddnsStatus={ddnsStatus}
              dnsStatus={dnsStatus}
              values={values}
              firewallPlan={firewallPlan}
              onApplyFirewall={() => applyFirewall(true)}
              sync={sync}
            />
          </div>

          {/* Local domain names */}
          <h3 className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mt-5 mb-1">
            Local Domain Names &amp; DNS Server
          </h3>
          <p className="text-[11px] text-slate-500 mb-2">
            This computer answers for the names it issues locally, so nothing is registered and
            nothing is bought. Zero external services are contacted.
          </p>

          <Row
            label="Run local name server"
            hint="Answers for your custom .box / .internal domains and forwards others to your router."
          >
            <Switch checked={values.dnsEnabled} onChange={(value) => patch({ dnsEnabled: value })} />
          </Row>

          <Row
            label="Default ending"
            hint=".internal and .home.arpa are reserved forever; anything else works fine at home."
          >
            <input
              type="text"
              value={values.domainEnding}
              onChange={(event) => patch({ domainEnding: event.target.value })}
              className="w-28 bg-[#0d1117] border border-white/10 rounded px-2 py-1 text-[12px] text-white text-right font-mono focus:outline-none focus:border-indigo-500"
            />
          </Row>

          {dnsStatus && (
            <Row
              label="Passing other lookups to"
              hint={
                dnsStatus.running
                  ? 'Read-only. Upstream gateway DNS addresses.'
                  : 'The name server is not running.'
              }
            >
              <span className="text-[12px] text-slate-400 font-mono">
                {dnsStatus.upstream && dnsStatus.upstream.length
                  ? dnsStatus.upstream.join(', ')
                  : '—'}
              </span>
            </Row>
          )}

          {/* Direct P2P WebRTC */}
          <h3 className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mt-5 mb-1">
            Direct Peer-to-Peer Sharing
          </h3>
          <p className="text-[11px] text-slate-500 mb-2">
            Address reflection servers for computer-to-computer connections. They report what
            your public IP/port looks like to punch through NAT — no account, and none of your files
            pass through them. Leave empty to keep direct sharing on your local network only.
          </p>
          <textarea
            value={stun}
            onChange={(event) => setStun(event.target.value)}
            onBlur={() =>
              patch({
                stunServers: stun
                  .split('\n')
                  .map((line) => line.trim())
                  .filter(Boolean)
              })
            }
            spellCheck={false}
            placeholder="stun.l.google.com:19302"
            className="w-full h-16 bg-[#0d1117] border border-white/10 rounded-lg px-3 py-2 text-[12px] text-white font-mono resize-none focus:outline-none focus:border-indigo-500 placeholder:text-slate-600"
          />

          {/* Editor Preferences */}
          <h3 className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mt-5 mb-1">Editor</h3>

          <Row label="Font size">
            <NumberInput
              value={values.fontSize}
              min={9}
              max={32}
              suffix="px"
              onChange={(value) => patch({ fontSize: value })}
            />
          </Row>
          <Row label="Tab size" hint="Spaces inserted by the Tab key.">
            <NumberInput
              value={values.tabSize}
              min={1}
              max={8}
              onChange={(value) => patch({ tabSize: value })}
            />
          </Row>
          <Row label="Word wrap" hint="Wrap long lines instead of scrolling sideways.">
            <Switch checked={values.wordWrap} onChange={(value) => patch({ wordWrap: value })} />
          </Row>
          <Row label="Minimap" hint="The overview strip on the right of the editor.">
            <Switch checked={values.minimap} onChange={(value) => patch({ minimap: value })} />
          </Row>
          <Row label="Auto-save delay" hint="How long after you stop typing an edit is written and synced.">
            <NumberInput
              value={values.autoSaveDelayMs}
              min={50}
              max={3000}
              suffix="ms"
              onChange={(value) => patch({ autoSaveDelayMs: value })}
            />
          </Row>

          {/* Terminal */}
          <h3 className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mt-5 mb-1">Terminal</h3>

          <Row label="Default shell" hint="Used for new terminals and script runs.">
            <select
              value={values.defaultShellId || ''}
              onChange={(event) => patch({ defaultShellId: event.target.value || null })}
              className="bg-[#0d1117] border border-white/10 rounded px-2 py-1 text-[12px] text-white focus:outline-none focus:border-indigo-500"
            >
              <option value="">First available</option>
              {shells.map((shell) => (
                <option key={shell.id} value={shell.id}>
                  {shell.label}
                </option>
              ))}
            </select>
          </Row>
          <Row label="Terminal font size">
            <NumberInput
              value={values.terminalFontSize}
              min={8}
              max={24}
              suffix="px"
              onChange={(value) => patch({ terminalFontSize: value })}
            />
          </Row>

          {/* Collaboration */}
          <h3 className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mt-5 mb-1">
            Collaboration
          </h3>

          <Row label="Show peer presence" hint="See which file each connected computer has open.">
            <Switch checked={values.showPresence} onChange={(value) => patch({ showPresence: value })} />
          </Row>
          <Row label="Confirm before delete" hint="Ask before removing a file from every computer.">
            <Switch
              checked={values.confirmBeforeDelete}
              onChange={(value) => patch({ confirmBeforeDelete: value })}
            />
          </Row>

          {/* Ignore Rules */}
          <h3 className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mt-5 mb-1">
            Ignore rules
          </h3>
          <p className="text-[11px] text-slate-500 mb-2">
            Paths listed here are never shared, watched or searched. This file lives in the workspace, so saving it
            updates every connected computer.
          </p>
          <textarea
            value={ignore}
            disabled={!rootPath}
            onChange={(event) => {
              setIgnore(event.target.value);
              setIgnoreDirty(true);
            }}
            rows={5}
            spellCheck={false}
            placeholder={'build/\n*.tmp\nsecrets/**\n!secrets/README.md'}
            className="w-full bg-[#0d1117] border border-white/10 rounded-lg px-3 py-2 text-[12px] font-mono text-slate-200 focus:outline-none focus:border-indigo-500 resize-none disabled:opacity-40 placeholder:text-slate-600"
          />
          <div className="flex items-center gap-2 mt-2 mb-6">
            <button
              onClick={saveIgnore}
              disabled={!rootPath || !ignoreDirty}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-[11px] font-semibold transition-colors"
            >
              {ignoreSaved ? <Check size={12} /> : <Save size={12} />}
              {ignoreSaved ? 'Saved' : 'Save .hawignore'}
            </button>
            <span className="text-[10px] text-slate-600 flex items-center gap-1">
              <FileCode2 size={10} />
              node_modules, .git and dist are always excluded
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Shows the internet-accessible link for this workspace and a setup checklist.
 */
function InternetLinkGuide({ networkDiagnostics, ddnsConfig, ddnsStatus, dnsStatus, values, firewallPlan, onApplyFirewall, sync }) {
  const [copiedInternet, setCopiedInternet] = useState(false);
  const [copiedLocal, setCopiedLocal] = useState(false);

  const port = dnsStatus && dnsStatus.port ? dnsStatus.port : 3000;
  const publicPort = dnsStatus && dnsStatus.publicPort;
  const extraPort = dnsStatus && dnsStatus.extraPort;
  const activePort = (publicPort === 80) ? 80 : (extraPort || port);
  const portSuffix = activePort === 80 ? '' : `:${activePort}`;

  const ddnsHost = ddnsConfig && ddnsConfig.enabled && ddnsConfig.hostname
    ? (ddnsStatus && ddnsStatus.fqdn ? ddnsStatus.fqdn : (ddnsConfig.hostname.includes('.') ? ddnsConfig.hostname : `${ddnsConfig.hostname}.duckdns.org`))
    : null;

  const publicIp = (ddnsStatus && ddnsStatus.lastIp)
    || (networkDiagnostics && (networkDiagnostics.reflexive || networkDiagnostics.publicIp));

  const hostPart = ddnsHost || publicIp || null;
  const internetLink = hostPart ? `http://${hostPart}${portSuffix}` : null;
  const localLink = `http://localhost:${activePort}`;
  const lanLink = dnsStatus && dnsStatus.dnsAddress ? `http://${dnsStatus.dnsAddress}:${activePort}` : null;

  const copyInternet = async () => {
    if (!internetLink) return;
    try {
      await navigator.clipboard.writeText(internetLink);
      setCopiedInternet(true);
      setTimeout(() => setCopiedInternet(false), 1600);
    } catch { /* fallback */ }
  };

  const copyLocal = async () => {
    if (!localLink) return;
    try {
      await navigator.clipboard.writeText(localLink);
      setCopiedLocal(true);
      setTimeout(() => setCopiedLocal(false), 1600);
    } catch { /* fallback */ }
  };

  // 'cgnat-hidden' is carrier NAT behind a normal-looking public address, found by traceroute.
  const cgnat = networkDiagnostics && ['cgnat', 'cgnat-hidden'].includes(networkDiagnostics.verdict);
  const doubleNat = networkDiagnostics && networkDiagnostics.verdict === 'double-nat';
  const firewallOk = Boolean(firewallPlan && (firewallPlan.installed || firewallPlan.applied || firewallPlan.webOpen)
    && !firewallPlan.blockedRules);

  // On a shared (carrier NAT) line a browser link from outside cannot work, so
  // DDNS and router forwarding are not steps towards anything; say so instead of
  // listing them as unfinished work.
  const checks = [
    cgnat ? {
      ok: true,
      label: 'Free DDNS: not needed on this line',
      hint: 'A name for your public IP only helps once your provider gives you your own address.'
    } : {
      ok: Boolean(ddnsConfig && ddnsConfig.ready && ddnsConfig.ready.ok),
      label: 'Free DDNS configured',
      hint: 'Settings -> Free Windows DDNS -> enable, choose a provider, add hostname and token, click Test'
    },
    {
      ok: firewallOk,
      warn: !firewallOk,
      label: firewallOk ? 'Windows Firewall permits incoming traffic' : 'Windows Firewall rules not applied yet',
      hint: 'Click "Apply Rules" to open ports in Windows Firewall',
      action: !firewallOk && onApplyFirewall ? { label: 'Apply Rules', run: onApplyFirewall } : null
    },
    {
      ok: !cgnat && !doubleNat && Boolean(networkDiagnostics),
      warn: cgnat || doubleNat,
      label: cgnat
        ? 'Carrier CGNAT - port forwarding impossible'
        : doubleNat
          ? 'Double NAT - forward ports on both routers'
          : 'Public IP reachable (port forwarding supported)',
      hint: cgnat
        ? 'Ask your internet provider for a public (real/static) IPv4 address or IPv6. Until then use Wi-Fi sharing or Direct P2P'
        : doubleNat
          ? 'Put your ISP modem in bridge mode, or use Direct P2P'
          : 'Run Network Diagnostics to confirm'
    },
    cgnat ? {
      ok: true,
      label: 'Router port forwarding: not needed',
      hint: 'Your provider shares your address, so forwarding on the TP-Link cannot bring visitors in. Direct P2P needs no open port.'
    } : {
      ok: false,
      warn: true,
      label: `Router port forwarding: TCP port ${activePort}`,
      hint: values && values.upnpAutoForward !== false
        ? `Opened automatically over UPnP while sharing online. If your router refuses, forward TCP port ${activePort} to ${dnsStatus?.dnsAddress || 'this PC'} by hand.`
        : `Forward TCP port ${activePort} to this PC local IP (${dnsStatus?.dnsAddress || 'this PC'}) in your router admin page.`
    }
  ];

  return (
    <div className="space-y-4">
      {cgnat && (
        <>
          {/* What works today, first: friends elsewhere connect straight to this PC. */}
          <FarFriends
            reach={networkDiagnostics}
            sync={sync}
            heading="Friends on the internet: use Direct P2P (works on your line)"
            note={networkDiagnostics.ipv6
              ? `This PC also has an IPv6 address (${networkDiagnostics.ipv6}); friends whose internet has IPv6 could reach it directly.`
              : 'There is no IPv6 on this line either, so Direct P2P is the way in.'}
          />

          <details className="rounded-xl border border-white/10 bg-white/[0.02]">
            <summary className="cursor-pointer px-3 py-2 text-[11px] text-slate-300 font-semibold">
              Optional, later: get a normal internet link from your provider
            </summary>
            <div className="p-3 pt-0">
              <ProviderHelp reach={networkDiagnostics} />
            </div>
          </details>
        </>
      )}

      {/* Internet address */}
      {internetLink ? (
        <div className={cgnat ? 'opacity-60' : ''}>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px] uppercase tracking-widest text-slate-400 font-bold">
              {cgnat
                ? '1. Internet address (will not open until your provider gives you your own IP)'
                : '1. Internet address (share with friends outside)'}
            </span>
            <span className="text-[10px] text-purple-400 font-mono">Port {activePort} TCP</span>
          </div>
          <div className="flex items-center gap-2 bg-[#0d1117] border border-purple-500/30 rounded-lg px-3 py-2.5">
            <span className="flex-1 truncate text-sm text-purple-200 font-mono font-semibold">{internetLink}</span>
            <button onClick={copyInternet} title="Copy internet link" className="text-slate-400 hover:text-white transition-colors flex-shrink-0">
              {copiedInternet ? <Check size={15} className="text-emerald-400" /> : <Copy size={15} />}
            </button>
            <button
              onClick={() => api && api.openExternal && api.openExternal(internetLink)}
              title="Open internet link"
              className="text-slate-400 hover:text-white transition-colors flex-shrink-0"
            >
              <ExternalLink size={15} />
            </button>
          </div>
          {!cgnat && (
            <p className="text-[10px] text-slate-500 mt-1 leading-relaxed">
              {ddnsHost
                ? 'Using permanent DDNS hostname - stays the same even if your public IP changes.'
                : 'Using raw public IP - set up Free DDNS above for a permanent domain.'}
            </p>
          )}
        </div>
      ) : (
        <div className="p-3 rounded-lg bg-white/[0.02] border border-white/10 text-[11px] text-slate-400">
          Run Network Diagnostics above to detect your public IP and build your internet link.
        </div>
      )}

      {/* Local test address */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[10px] uppercase tracking-widest text-emerald-400 font-bold">
            2. Local address (test on this PC)
          </span>
          <span className="text-[10px] text-emerald-400 font-medium">Bypasses router</span>
        </div>
        <div className="flex items-center gap-2 bg-[#0d1117] border border-emerald-500/30 rounded-lg px-3 py-2.5">
          <span className="flex-1 truncate text-sm text-emerald-300 font-mono font-semibold">{localLink}</span>
          <button onClick={copyLocal} title="Copy local link" className="text-slate-400 hover:text-white transition-colors flex-shrink-0">
            {copiedLocal ? <Check size={15} className="text-emerald-400" /> : <Copy size={15} />}
          </button>
          <button
            onClick={() => api && api.openExternal && api.openExternal(localLink)}
            title="Open in browser on this PC"
            className="px-2.5 py-1 rounded bg-emerald-600/30 hover:bg-emerald-600/50 text-emerald-200 text-[11px] font-semibold transition-colors flex items-center gap-1 flex-shrink-0"
          >
            <ExternalLink size={13} /> Test on this PC
          </button>
        </div>
        {lanLink && (
          <p className="text-[10px] text-slate-500 mt-1">
            Other devices on your Wi-Fi can also open: <span className="text-slate-300 font-mono">{lanLink}</span>
          </p>
        )}
      </div>

      {/* NAT Loopback / "This site can't be reached" Callout */}
      <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-[11px] text-amber-200/90 leading-relaxed space-y-1.5">
        <div className="font-bold text-amber-100 flex items-center gap-1.5">
          <span>⚠️</span> Why you might get &ldquo;This site can&rsquo;t be reached&rdquo; when testing on this PC:
        </div>
        <div>
          Most home Wi-Fi routers block connecting to your own public IP from inside your own house (lack of NAT Loopback/Hairpinning).
        </div>
        <ul className="list-disc list-inside space-y-0.5 text-[10.5px] text-amber-200/80">
          <li><strong>To test on this computer:</strong> Click <strong className="text-white">&ldquo;Test on this PC&rdquo;</strong> ({localLink}). It opens instantly in your browser!</li>
          <li><strong>To test the Internet Link:</strong> Turn Wi-Fi <strong>OFF</strong> on your phone (switch to cellular 4G/5G data), or ask a friend to open your link.</li>
        </ul>
      </div>

      {/* Setup checklist */}
      <div className="space-y-1.5">
        <div className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-1">Setup checklist</div>
        {checks.map((item, idx) => (
          <div key={idx} className="flex items-start gap-2.5">
            <div className={`mt-0.5 w-3.5 h-3.5 rounded-full flex-shrink-0 flex items-center justify-center ${
              item.ok ? 'bg-emerald-500/30' : item.warn ? 'bg-amber-500/20' : 'bg-rose-500/20'
            }`}>
              {item.ok
                ? <Check size={9} className="text-emerald-400" />
                : <span className="text-[8px] font-bold text-amber-400">!</span>}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <span className={`text-[11px] font-medium ${item.ok ? 'text-emerald-300' : item.warn ? 'text-amber-300' : 'text-rose-300'}`}>
                  {item.label}
                </span>
                {item.action && (
                  <button
                    onClick={item.action.run}
                    className="px-2 py-0.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-semibold transition-colors"
                  >
                    {item.action.label}
                  </button>
                )}
              </div>
              {!item.ok && <div className="text-[10px] text-slate-500 leading-relaxed">{item.hint}</div>}
            </div>
          </div>
        ))}
      </div>

      <p className="text-[10px] text-slate-600 leading-relaxed pt-1">
        All connections go directly to this PC - no files pass through external servers.
        Keep HawCode running while sharing.
      </p>
    </div>
  );
}

/** One line of the router details list, with a copy button for values worth typing. */
function DetailRow({ label, value, copy = true }) {
  const [copied, setCopied] = useState(false);
  const copyValue = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be refused; the value is still on screen to read.
    }
  };
  return (
    <div className="flex items-center justify-between gap-3 py-1 border-b border-white/[0.04] last:border-0">
      <span className="text-slate-400 flex-shrink-0">{label}</span>
      <span className="flex items-center gap-1.5 min-w-0">
        <span className={`font-mono truncate ${value ? 'text-white' : 'text-slate-600'}`}>{value || '—'}</span>
        {copy && value && (
          <button onClick={copyValue} title={`Copy ${label}`} className="text-slate-500 hover:text-white transition-colors flex-shrink-0">
            {copied ? <Check size={11} className="text-emerald-400" /> : <Copy size={11} />}
          </button>
        )}
      </span>
    </div>
  );
}

/**
 * The Wi-Fi router and this PC's place on it: the exact values to type into a
 * TP-Link router so the PC keeps the same address, and friends keep the same link.
 */
function RouterStaticIpGuide({ info, loading, onRefresh, reach, sync }) {
  const isTpLink = Boolean(info && info.routerVendor === 'TP-Link');
  const adminUrl = info && info.adminUrls && info.adminUrls[0];
  const port = info && info.port;
  const shareUrl = info && (info.shareUrl || (info.address && port ? `http://${info.address}:${port}` : null));
  const wifi = info && info.wifi;

  return (
    <div className="mt-3 mb-5 p-4 rounded-xl bg-gradient-to-br from-emerald-500/10 via-teal-500/5 to-transparent border border-emerald-500/20">
      <div className="flex items-center gap-2 mb-1">
        <Wifi size={16} className="text-emerald-400" />
        <h3 className="text-sm font-bold text-white flex-1">
          Wi-Fi Router &amp; Static IP{isTpLink ? ' (TP-Link)' : ''}
        </h3>
        <button
          onClick={onRefresh}
          disabled={loading}
          title="Read the network again"
          className="p-1 rounded-md text-slate-400 hover:text-white hover:bg-white/5 transition-colors"
        >
          {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
        </button>
      </div>
      <p className="text-[11px] text-slate-400 leading-relaxed mb-3">
        Give this PC a fixed address on your router so the link you send friends keeps working after a restart.
      </p>

      {!info ? (
        <div className="text-[11px] text-slate-500 flex items-center gap-1.5">
          <Loader2 size={12} className="animate-spin" /> Reading your network…
        </div>
      ) : (
        <div className="space-y-3">
          {info.networkCategory === 'Public' && (
            <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/25 text-[11px] text-amber-200/90 leading-relaxed">
              <div className="font-bold text-amber-100 mb-1">
                Windows treats {wifi ? `“${wifi.ssid}”` : 'this network'} as a Public network
              </div>
              On a Public network Windows blocks the local name server, <span className="font-mono">hawcode.local</span> and
              auto-discovery, so friends on this Wi-Fi cannot find this PC by name. For your home or office Wi-Fi,
              set <strong className="text-white">Network profile type</strong> to <strong className="text-white">Private</strong>,
              then press the refresh button above.
              <button
                onClick={() => api.openExternal('ms-settings:network-status')}
                className="mt-2 w-full py-1.5 rounded-md bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/30 text-amber-100 text-[11px] font-semibold transition-colors"
              >
                Open Windows network settings
              </button>
            </div>
          )}

          {/* Details list */}
          <div className="p-3 rounded-lg bg-[#0d1117] border border-white/10 text-[11px]">
            <div className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-1">Network details</div>
            <DetailRow label="Wi-Fi network (SSID)" value={wifi && wifi.ssid} />
            <DetailRow
              label="Signal"
              value={wifi ? [wifi.signal, wifi.band, wifi.radio, wifi.channel && `ch ${wifi.channel}`].filter(Boolean).join(' · ') : null}
              copy={false}
            />
            <DetailRow label="Router brand" value={info.routerVendor || 'Unknown'} copy={false} />
            <DetailRow label="Router admin page" value={adminUrl} />
            <DetailRow label="Router IP (gateway)" value={info.gateway} />
            <DetailRow label="Router MAC" value={info.routerMac} />
            <DetailRow label="Adapter" value={info.adapter} copy={false} />
            <DetailRow label="Windows network profile" value={info.networkCategory} copy={false} />
            <DetailRow label="This PC's IP address" value={info.address} />
            <DetailRow label="Subnet mask" value={info.netmask && `${info.netmask}${info.prefix ? ` (/${info.prefix})` : ''}`} />
            <DetailRow label="DNS server" value={info.dns && info.dns.join(', ')} />
            <DetailRow label="This PC's MAC address" value={info.mac} />
            <DetailRow
              label="IP mode"
              value={info.dhcp === true ? 'Automatic (DHCP) — can change' : info.dhcp === false ? 'Static (fixed)' : null}
              copy={false}
            />
            <DetailRow label="Link for friends on this Wi-Fi" value={shareUrl} />
          </div>

          {/* TP-Link address reservation */}
          <div className="p-3 rounded-lg bg-white/[0.02] border border-white/10 text-[11px] text-slate-300 leading-relaxed">
            <div className="font-bold text-white flex items-center gap-1.5 mb-1.5">
              <Router size={13} className="text-emerald-400" />
              1. Reserve a static IP on the {isTpLink ? 'TP-Link ' : ''}router (recommended)
            </div>
            <ol className="list-decimal list-inside space-y-1 text-[10.5px]">
              <li>
                Open <span className="font-mono text-emerald-300">{adminUrl || 'http://192.168.0.1'}</span>
                {isTpLink && <> (or <span className="font-mono text-emerald-300">http://tplinkwifi.net</span>)</>} and log in
                with the router password.
              </li>
              <li>
                Go to <strong className="text-white">Advanced → Network → DHCP Server</strong>
                {' '}(older firmware: <strong className="text-white">DHCP → Address Reservation</strong>).
              </li>
              <li>Under <strong className="text-white">Address Reservation</strong>, click <strong className="text-white">Add</strong>.</li>
              <li>
                MAC address: <span className="font-mono text-emerald-300">{info.mac || 'this PC’s MAC'}</span>
                {' '}· Reserved IP: <span className="font-mono text-emerald-300">{info.address || '—'}</span>
              </li>
              <li>Tick <strong className="text-white">Enable</strong>, click <strong className="text-white">Save</strong>, then reconnect this PC to Wi-Fi.</li>
            </ol>
          </div>

          {/* Windows static IP, for when router access is not available */}
          <div className="p-3 rounded-lg bg-white/[0.02] border border-white/10 text-[11px] text-slate-300 leading-relaxed">
            <div className="font-bold text-white mb-1.5">2. Or set a static IP in Windows</div>
            <p className="text-[10.5px] mb-1.5">
              Settings → Network &amp; internet → Wi-Fi → {wifi ? wifi.ssid : 'your network'} properties → IP assignment → Edit → Manual → IPv4 on:
            </p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 font-mono text-[10.5px]">
              <span className="text-slate-500">IP address</span><span className="text-emerald-300">{info.address || '—'}</span>
              <span className="text-slate-500">Subnet mask</span><span className="text-emerald-300">{info.netmask || '255.255.255.0'}</span>
              <span className="text-slate-500">Gateway</span><span className="text-emerald-300">{info.gateway || '—'}</span>
              <span className="text-slate-500">Preferred DNS</span><span className="text-emerald-300">{(info.dns && info.dns[0]) || info.gateway || '—'}</span>
            </div>
            <p className="text-[10px] text-amber-300/80 mt-1.5">
              Only use an address the router will not hand to another device. Reserving it on the router (step 1) avoids conflicts.
            </p>
          </div>

          {/* Sharing the site */}
          <div className="p-3 rounded-lg bg-white/[0.02] border border-white/10 text-[11px] text-slate-300 leading-relaxed">
            <div className="font-bold text-white mb-1.5">3. Share the website with friends</div>
            <ul className="list-disc list-inside space-y-1 text-[10.5px]">
              <li>
                <strong className="text-white">Same Wi-Fi{wifi ? ` (${wifi.ssid})` : ''}:</strong> send them
                {' '}<span className="font-mono text-emerald-300">{shareUrl || 'the link above (start sharing a folder first)'}</span>.
                Allow HawCode through Windows Firewall if they cannot connect.
              </li>
              {reach && reach.canForward === false ? (
                <li>
                  <strong className="text-white">Over the internet:</strong> port forwarding cannot work on this
                  connection ({reach.label || 'your provider shares your address'}). Use Direct P2P under
                  {' '}<strong className="text-white">Connect from the Internet</strong> below.
                </li>
              ) : (
                <li>
                  <strong className="text-white">Over the internet:</strong> on the router go to
                  {' '}<strong className="text-white">Advanced → NAT Forwarding → Virtual Servers → Add</strong>
                  {' '}(older firmware such as TL-WR940N: <strong className="text-white">Forwarding → Virtual Servers → Add New</strong>):
                  External port <span className="font-mono text-emerald-300">{port || 80}</span>,
                  Internal IP <span className="font-mono text-emerald-300">{info.address || '—'}</span>,
                  Internal port <span className="font-mono text-emerald-300">{port || 80}</span>,
                  Protocol <span className="font-mono text-emerald-300">TCP</span>.
                  Then use the internet link in the section below.
                </li>
              )}
            </ul>
          </div>

          {/* On a shared line the internet section below carries this instead. */}
          {!(reach && reach.canForward === false) && <FarFriends reach={reach} sync={sync} />}
        </div>
      )}
    </div>
  );
}

/**
 * Friends on another Wi-Fi, in another city. Behind carrier NAT nothing can be
 * forwarded, so the share switches to Direct P2P: each friend connects straight
 * to this PC and no outside server carries the files.
 */
function FarFriends({ reach, sync, heading = '4. Friends on another Wi-Fi or in another city', note = null }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const hosting = Boolean(sync && sync.mode === 'host' && sync.rootPath);
  const direct = hosting && sync.provider === 'direct';
  const cgnat = Boolean(reach && reach.canForward === false);

  const switchToDirect = async () => {
    setBusy(true);
    setError('');
    try {
      const result = await api.startHost({
        folderPath: sync.rootPath,
        exposure: 'online',
        online: 'direct',
        serveAs: sync.serveAs || 'editor'
      });
      if (result && (result.error || result.startError)) setError(result.error || result.startError);
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-3 rounded-lg bg-purple-500/[0.06] border border-purple-500/25 text-[11px] text-slate-300 leading-relaxed">
      <div className="font-bold text-white flex items-center gap-1.5 mb-1.5">
        <Globe size={13} className="text-purple-400" />
        {heading}
      </div>

      {cgnat && (
        <p className="text-[10.5px] text-amber-300/90 mb-2">
          Your internet provider shares your public address with other customers ({reach.label || 'carrier NAT'}),
          so a link with your IP or a domain cannot reach this PC. Direct P2P works anyway: each friend connects
          straight to this computer, and the files never pass through any outside server.
          {note && <> {note}</>}
        </p>
      )}

      {direct ? (
        <DirectPanel result={sync} />
      ) : hosting ? (
        <>
          <p className="text-[10.5px] mb-2">
            Switch this share to Direct P2P, then create one invite per friend and send it by any chat app.
            Friends on this Wi-Fi reconnect using the new room code.
          </p>
          <button
            onClick={switchToDirect}
            disabled={busy}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-gradient-to-r from-purple-500 to-indigo-600 hover:from-purple-400 hover:to-indigo-500 disabled:opacity-60 text-white font-bold text-[12px] transition-all"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Globe size={14} />}
            Share with friends in another city
          </button>
          {error && <p className="text-[10.5px] text-rose-300 mt-2">{error}</p>}
        </>
      ) : (
        <p className="text-[10.5px]">
          Host a folder first, then come back here, or choose <strong className="text-white">Host Online → Direct P2P</strong> when you start sharing.
        </p>
      )}
    </div>
  );
}

/**
 * Turn the result of anything that ran behind a UAC prompt into one line to
 * show: done, cancelled, or which steps failed (with netsh's own log).
 */
function describeElevated(result, doneText) {
  if (!result) return { ok: false, text: 'Nothing came back from Windows.' };
  if (result.cancelled) {
    return { ok: false, text: 'The Windows permission prompt was cancelled, so nothing was changed. Press the button again and choose Yes.' };
  }
  if (result.error) return { ok: false, text: result.error };
  if (result.alreadyApplied) return { ok: true, text: 'Everything was already in place.' };
  const failed = [...(result.steps || []), ...(result.extra || [])].filter((step) => !step.ok);
  if (!result.ok || failed.length) {
    return {
      ok: false,
      text: failed.length
        ? `Windows refused: ${failed.map((step) => step.name || step.id).join('; ')}.`
        : 'The change did not finish.',
      log: result.log
    };
  }
  return { ok: true, text: doneText };
}

function ElevatedMessage({ message }) {
  if (!message) return null;
  return (
    <div
      className={`p-2.5 rounded-lg border text-[11px] leading-relaxed ${
        message.ok
          ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-200'
          : 'bg-rose-500/10 border-rose-500/25 text-rose-200'
      }`}
    >
      {message.text}
      {message.log && (
        <pre className="mt-1.5 max-h-28 overflow-auto whitespace-pre-wrap text-[10px] text-slate-400 font-mono">{message.log}</pre>
      )}
    </div>
  );
}

function CheckRow({ ok, pending, label, detail, children }) {
  return (
    <div className="flex items-start gap-2.5 py-1.5 border-b border-white/[0.04] last:border-0">
      {pending
        ? <CircleDashed size={14} className="text-slate-500 flex-shrink-0 mt-0.5" />
        : ok
          ? <Check size={14} className="text-emerald-400 flex-shrink-0 mt-0.5" />
          : <AlertTriangle size={14} className="text-amber-400 flex-shrink-0 mt-0.5" />}
      <div className="flex-1 min-w-0">
        <div className={`text-[11.5px] ${ok ? 'text-slate-200' : 'text-white font-semibold'}`}>{label}</div>
        {detail && <div className="text-[10.5px] text-slate-400 leading-relaxed mt-0.5">{detail}</div>}
      </div>
      {children && <div className="flex-shrink-0">{children}</div>}
    </div>
  );
}

/** Folder name → a label a domain can use, the way the share dialog suggests it. */
function suggestedName(sync, ending) {
  const base = String((sync && sync.folderName) || 'mysite').toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'mysite';
  return `${base}.${String(ending || 'box').replace(/^\.+/, '')}`;
}

/**
 * A domain served entirely from this PC, end to end.
 *
 * Every piece is local: HawCode's own name server answers the name, the hosts
 * file makes this PC find it, XAMPP's Apache hands it to HawCode on port 80,
 * and the TP-Link router tells every other device on the Wi-Fi to ask this PC.
 * The Windows parts happen behind one UAC prompt; the router part is shown as
 * exact values because only the router's owner can sign in to it.
 */
function LocalDomainSetup({ sync, values, router, onChanged }) {
  const sharing = Boolean(sync && sync.mode === 'host' && sync.domain);
  const [typed, setTyped] = useState('');
  const domain = sharing ? sync.domain : (typed || suggestedName(sync, values && values.domainEnding));
  const [status, setStatus] = useState(null);
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const [apacheBusy, setApacheBusy] = useState(false);
  const [apacheMessage, setApacheMessage] = useState(null);
  const [makePrivate, setMakePrivate] = useState(true);

  const refresh = async () => {
    setChecking(true);
    try {
      setStatus(await api.pcSetupStatus({ domain }));
    } finally {
      setChecking(false);
    }
  };

  // Debounced: each check reads the firewall and the network through PowerShell.
  const apacheRouted = Boolean(sync && sync.apacheRouted);
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      api.pcSetupStatus({ domain }).then((next) => { if (!cancelled) setStatus(next); });
    }, 600);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [domain, apacheRouted]);

  const setUp = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const result = await api.pcSetupApply({ domain, makePrivate: makePrivate && status && status.networkCategory === 'Public' });
      setMessage(describeElevated(result, `Done. This PC now answers for ${domain}.`));
      if (result && result.status) setStatus(result.status);
      if (onChanged) onChanged();
    } catch (error) {
      setMessage({ ok: false, text: error.message || String(error) });
    }
    setBusy(false);
  };

  const routeApache = async (remove) => {
    setApacheBusy(true);
    setApacheMessage(null);
    try {
      const result = remove ? await api.xamppVhostRemove() : await api.xamppVhostApply();
      setApacheMessage(result && result.ok
        ? { ok: true, text: remove ? 'Apache no longer routes the name.' : `Apache now sends http://${domain} to HawCode; localhost still opens htdocs.` }
        : { ok: false, text: (result && result.error) || 'Apache could not be changed.' });
      await refresh();
      if (onChanged) onChanged();
    } catch (error) {
      setApacheMessage({ ok: false, text: error.message || String(error) });
    }
    setApacheBusy(false);
  };

  const checks = status ? status.checks : null;
  const ip = (status && status.localIp) || (router && router.address) || '—';
  const needsWindows = checks && (!checks.hostsFile.ok || !checks.firewall.ok || !checks.privateNetwork.ok);
  const adminUrl = (router && router.adminUrls && router.adminUrls[0]) || 'http://192.168.0.1';

  return (
    <div className="mt-3 mb-5 p-4 rounded-xl bg-gradient-to-br from-emerald-500/10 via-cyan-500/5 to-transparent border border-emerald-500/25">
      <div className="flex items-center gap-2 mb-1">
        <Globe2 size={16} className="text-emerald-400" />
        <h3 className="text-sm font-bold text-white flex-1">Local Domain on This PC (100% local)</h3>
        <button
          onClick={refresh}
          disabled={checking}
          title="Check again"
          className="p-1 rounded-md text-slate-400 hover:text-white hover:bg-white/5 transition-colors"
        >
          {checking ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
        </button>
      </div>
      <p className="text-[11px] text-slate-400 leading-relaxed mb-3">
        This computer answers for the name itself. No website, account or outside service is involved.
        Friends on your Wi-Fi open it in any browser; friends elsewhere use Direct P2P.
      </p>

      <div className="flex items-center gap-2 mb-3">
        <span className="text-[11px] text-slate-400">Name</span>
        {sharing ? (
          <span className="font-mono text-sm text-emerald-300">http://{domain}</span>
        ) : (
          <input
            type="text"
            value={typed || domain}
            onChange={(event) => setTyped(event.target.value.trim().toLowerCase())}
            className="flex-1 bg-[#0d1117] border border-white/10 rounded px-2.5 py-1 text-[12px] text-emerald-300 font-mono focus:outline-none focus:border-emerald-500"
          />
        )}
      </div>

      {!checks ? (
        <div className="text-[11px] text-slate-500 flex items-center gap-1.5">
          <Loader2 size={12} className="animate-spin" /> Checking this PC…
        </div>
      ) : (
        <div className="p-3 rounded-lg bg-[#0d1117] border border-white/10">
          <CheckRow
            ok={checks.nameServer.ok}
            label="HawCode name server (port 53)"
            detail={checks.nameServer.ok
              ? 'Running. Answers the name and passes every other lookup to your router.'
              : (checks.nameServer.error || 'Starts by itself when you share a folder.')}
          />
          <CheckRow
            ok={checks.hostsFile.ok}
            label="This PC knows the name (Windows hosts file)"
            detail={checks.hostsFile.ok ? `${domain} → this PC.` : 'Added by "Set up this PC" below.'}
          />
          {!checks.apache.notNeeded && (
            <CheckRow
              ok={checks.apache.ok}
              label="XAMPP Apache routes the name to HawCode"
              detail={checks.apache.ok
                ? `http://${domain} → HawCode; http://localhost and http://${ip} → your htdocs site.`
                : sharing
                  ? 'Apache holds port 80, so it has to pass the name on. Checked with httpd -t before Apache restarts.'
                  : 'Done automatically when you share a folder with XAMPP sharing on.'}
            >
              {sharing && (
                <div className="flex gap-1">
                  <button
                    onClick={() => routeApache(false)}
                    disabled={apacheBusy}
                    className="px-2 py-0.5 rounded bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-[10px] font-semibold flex items-center gap-1"
                  >
                    {apacheBusy && <Loader2 size={11} className="animate-spin" />}
                    {checks.apache.ok ? 'Re-apply' : 'Route now'}
                  </button>
                  {checks.apache.ok && (
                    <button
                      onClick={() => routeApache(true)}
                      disabled={apacheBusy}
                      className="px-2 py-0.5 rounded bg-white/10 hover:bg-white/20 text-white text-[10px] font-semibold"
                    >
                      Remove
                    </button>
                  )}
                </div>
              )}
            </CheckRow>
          )}
          <CheckRow
            ok={checks.firewall.ok}
            label="Windows Firewall"
            detail={checks.firewall.blockedRules
              ? `${checks.firewall.blockedRules} block rule(s) stop HawCode; "Set up this PC" removes them.`
              : `Web ports: ${checks.firewall.webOpen ? 'open' : 'closed'} · Name server (53): ${checks.firewall.dnsOpen ? 'open' : 'closed'}.`}
          />
          <CheckRow
            ok={checks.privateNetwork.ok}
            label={`Wi-Fi is a Private network${status.networkCategory ? ` (now: ${status.networkCategory})` : ''}`}
            detail={checks.privateNetwork.ok
              ? 'Windows lets the name server and discovery answer devices on this Wi-Fi.'
              : 'On a Public network Windows hides this PC from the Wi-Fi, so friends’ devices cannot ask it for the name.'}
          />
          <CheckRow
            ok={checks.routerDns.ok}
            label="Router tells every device to ask this PC (TP-Link DHCP DNS)"
            detail={checks.routerDns.ok
              ? 'Phones and laptops on the Wi-Fi find the name with nothing set on them.'
              : 'Set once on the router — see the steps below.'}
          />
          {checks.siteAnswers && (
            <CheckRow
              ok={checks.siteAnswers.ok}
              label={`http://${domain} opens the shared folder on this PC`}
              detail={checks.siteAnswers.ok ? 'Tested just now.' : `Not yet (${checks.siteAnswers.error || `HTTP ${checks.siteAnswers.status}`}).`}
            />
          )}
        </div>
      )}

      {checks && (
        <div className="mt-3 space-y-2">
          {checks.privateNetwork && !checks.privateNetwork.ok && (
            <label className="flex items-center gap-2 text-[11px] text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={makePrivate}
                onChange={(event) => setMakePrivate(event.target.checked)}
                className="accent-emerald-500"
              />
              Also set {status.adapter ? `"${status.adapter}"` : 'this Wi-Fi'} to Private (only for your own home or office Wi-Fi)
            </label>
          )}
          <button
            onClick={setUp}
            disabled={busy}
            className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-[12px] font-bold transition-colors ${
              needsWindows
                ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                : 'bg-white/5 hover:bg-white/10 text-slate-200 border border-white/10'
            } disabled:opacity-60`}
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
            {needsWindows ? 'Set up this PC (one Windows prompt)' : 'Re-apply Windows setup'}
          </button>
          <p className="text-[10px] text-slate-500 leading-relaxed">
            One UAC prompt adds HawCode&rsquo;s firewall rules, puts {domain} in the hosts file
            {checks.privateNetwork && !checks.privateNetwork.ok && makePrivate ? ' and switches the Wi-Fi to Private' : ''}. Choose
            {' '}<strong className="text-slate-300">Yes</strong> when Windows asks.
          </p>
          <ElevatedMessage message={message} />
          <ElevatedMessage message={apacheMessage} />
        </div>
      )}

      {/* The router part: only its owner can sign in, so HawCode shows the exact values. */}
      <div className="mt-3 p-3 rounded-lg bg-white/[0.02] border border-white/10 text-[11px] text-slate-300 leading-relaxed">
        <div className="font-bold text-white flex items-center gap-1.5 mb-1.5">
          <Router size={13} className="text-emerald-400" />
          On the TP-Link router{router && router.routerVendor ? ` (${router.routerVendor})` : ''} — so every device finds {domain}
        </div>
        <ol className="list-decimal list-inside space-y-1 text-[10.5px]">
          <li>
            Open <span className="font-mono text-emerald-300">{adminUrl}</span> and sign in.
            <button
              onClick={() => api.openExternal(adminUrl)}
              className="ml-2 inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-white/10 hover:bg-white/20 text-white text-[10px]"
            >
              <ExternalLink size={10} /> Open
            </button>
          </li>
          <li>
            <strong className="text-white">DHCP → Address Reservation → Add New</strong>: MAC{' '}
            <span className="font-mono text-emerald-300">{(router && router.mac) || 'this PC’s MAC'}</span>, Reserved IP{' '}
            <span className="font-mono text-emerald-300">{ip}</span>, Status Enabled → Save.
            {' '}(Newer firmware: Advanced → Network → DHCP Server.)
          </li>
          <li>
            <strong className="text-white">DHCP → DHCP Settings</strong>: Primary DNS{' '}
            <span className="font-mono text-emerald-300">{ip}</span>, Secondary DNS{' '}
            <span className="font-mono text-emerald-300">0.0.0.0</span> (empty) → Save.
          </li>
          <li>Turn Wi-Fi off and on again on each phone or laptop, then open <span className="font-mono text-emerald-300">http://{domain}</span>.</li>
        </ol>
        <p className="text-[10px] text-amber-300/80 mt-1.5">
          While this PC or HawCode is off, devices that use it as DNS cannot look up any website. To undo, set
          Primary DNS back to <span className="font-mono">0.0.0.0</span> (automatic). No port forwarding is needed for this;
          your provider&rsquo;s shared address (CGNAT) means port forwarding cannot bring in internet visitors anyway.
        </p>
      </div>
    </div>
  );
}
