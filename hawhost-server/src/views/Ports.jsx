import React, { useState } from 'react';
import {
  ShieldCheck, Activity, RefreshCw, CheckCircle2, XCircle, Play, ArrowRight, Lock, Server
} from 'lucide-react';

import { useHawhost, wantedFirewallPorts } from '../lib/store';
import { useFirewallApply, useDiagnose } from '../lib/actions';
import { api, bridge } from '../lib/bridge';
import {
  PageHeader, Card, Button, Badge, Dot, Callout, Field, TextInput, useConfirm, useBusy, cx
} from '../components/ui';

export default function Ports({ go }) {
  const { data, firewall, firewallBusy, refreshFirewall, call } = useHawhost();
  const [applyFirewall, applying] = useFirewallApply();
  const [diagnose, diagnosing, diagnosis] = useDiagnose();
  const confirm = useConfirm();
  const [busy, run] = useBusy();

  // Custom port tester state
  const [testHost, setTestHost] = useState('127.0.0.1');
  const [testPort, setTestPort] = useState('80');
  const [testResult, setTestResult] = useState(null);
  const [testing, setTesting] = useState(false);

  // Extra firewall ports input
  const [extraPortInput, setExtraPortInput] = useState('');
  const [editingExtra, setEditingExtra] = useState(false);

  if (!data) return null;

  const { server, ddns, network, config } = data;
  const listening = server.listeners.filter((l) => l.state === 'listening');
  const failed = server.listeners.filter((l) => l.state === 'error');
  const wanted = wantedFirewallPorts(data);

  const fwMissing = firewall && firewall.supported ? wanted.filter((p) => !firewall.openPorts.includes(p)) : [];
  const fwBlockedProg = firewall && firewall.blockedProgramRules > 0;
  const fwOk = firewall && firewall.supported && !fwMissing.length && !fwBlockedProg;

  // Run custom test
  const handleTestPort = async (e) => {
    if (e) e.preventDefault();
    const p = parseInt(testPort, 10);
    if (!p || p < 1 || p > 65535) return;
    setTesting(true);
    setTestResult(null);
    try {
      const res = await api('POST', '/api/ports/test', {
        host: testHost.trim() || '127.0.0.1',
        port: p
      });
      setTestResult(res);
    } catch (err) {
      setTestResult({ open: false, error: err.message, detail: err.message });
    } finally {
      setTesting(false);
    }
  };

  // Add extra port
  const handleAddExtraPort = async () => {
    const p = parseInt(extraPortInput, 10);
    if (!p || p < 1 || p > 65535) return;
    const current = config.firewall.extraPorts || [];
    if (current.includes(p)) return;
    const next = [...current, p].sort((a, b) => a - b);
    await call('PUT', '/api/settings/firewall', { extraPorts: next }, { success: `Port ${p} added to firewall list.` });
    setExtraPortInput('');
    setEditingExtra(false);
  };

  // Remove extra port
  const handleRemoveExtraPort = async (p) => {
    const current = config.firewall.extraPorts || [];
    const next = current.filter((x) => x !== p);
    await call('PUT', '/api/settings/firewall', { extraPorts: next }, { success: `Port ${p} removed.` });
  };

  // Remove firewall rules
  const handleRemoveFirewallRules = async () => {
    const ok = await confirm({
      title: 'Remove HawHost Firewall Rules?',
      message: 'This will remove all incoming allow rules for HawHost from Windows Defender Firewall. Visitors outside your PC may no longer be able to reach your websites.',
      danger: true,
      confirmLabel: 'Remove Rules'
    });
    if (!ok) return;
    run('fw-remove', async () => {
      const b = await bridge();
      await b.firewall.remove();
      refreshFirewall();
    });
  };

  // Diagnostics data rows or fallback to active listeners
  const diagnosticRows = diagnosis ? diagnosis.ports : server.planned.map((p) => {
    const active = server.listeners.find((l) => l.port === p.port);
    return {
      port: p.port,
      tls: p.tls,
      state: active ? active.state : (server.running ? 'stopped' : 'offline'),
      error: active ? active.error : null,
      owners: active ? (active.owners || []) : [],
      local: active && active.state === 'listening',
      lan: null,
      firewall: firewall && firewall.supported ? firewall.openPorts.includes(p.port) : null,
      router: null,
      public: null
    };
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Ports & Windows Firewall"
        description="Verify local port listeners, test network accessibility, and manage Windows Defender Firewall rules for seamless self-hosting without external tunnels."
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              icon={RefreshCw}
              loading={diagnosing}
              onClick={() => diagnose()}
            >
              Run Full Diagnostics
            </Button>
            {fwMissing.length > 0 && (
              <Button
                variant="primary"
                icon={ShieldCheck}
                loading={applying}
                onClick={() => applyFirewall()}
              >
                Allow Ports ({fwMissing.length} Missing)
              </Button>
            )}
          </div>
        }
      />

      {/* Status Highlights */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="rounded-xl border border-white/[0.07] bg-ink-850 p-4">
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-medium text-ink-400 uppercase tracking-wider">Web Server Ports</span>
            <Dot tone={server.running ? (failed.length ? 'amber' : 'green') : 'neutral'} pulse={server.running} />
          </div>
          <div className="text-[20px] font-semibold text-white mt-2">
            {listening.length} Listening
          </div>
          <div className="text-[12px] text-ink-400 mt-1">
            {listening.map((l) => `${l.port}${l.tls ? ' (SSL)' : ''}`).join(', ') || 'No active ports'}
            {failed.length > 0 && <span className="text-amber-300 ml-1">({failed.length} conflict)</span>}
          </div>
        </div>

        <div className="rounded-xl border border-white/[0.07] bg-ink-850 p-4">
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-medium text-ink-400 uppercase tracking-wider">Windows Firewall</span>
            {firewallBusy ? (
              <span className="text-[11px] text-ink-400">Checking…</span>
            ) : fwOk ? (
              <Badge tone="green">Protected & Open</Badge>
            ) : (
              <Badge tone="amber">Action Needed</Badge>
            )}
          </div>
          <div className="text-[20px] font-semibold text-white mt-2">
            {firewall && firewall.supported ? `${firewall.openPorts.length} Allowed Ports` : 'Unknown'}
          </div>
          <div className="text-[12px] text-ink-400 mt-1">
            {fwMissing.length > 0 ? (
              <span className="text-amber-300">Ports {fwMissing.join(', ')} not allowed</span>
            ) : (
              'All required ports allowed'
            )}
          </div>
        </div>

        <div className="rounded-xl border border-white/[0.07] bg-ink-850 p-4">
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-medium text-ink-400 uppercase tracking-wider">Router Reachability</span>
            {diagnosis ? (
              diagnosis.ports.some((p) => p.public && p.public.result === 'reached') ? (
                <Badge tone="green">Publicly Reachable</Badge>
              ) : (
                <Badge tone="amber">Check Router</Badge>
              )
            ) : (
              <Badge tone="neutral">Not Checked</Badge>
            )}
          </div>
          <div className="text-[20px] font-semibold text-white mt-2 mono truncate">
            {ddns.publicIp || network.localIp || '—'}
          </div>
          <div className="text-[12px] text-ink-400 mt-1 flex items-center justify-between">
            <span>WAN IP</span>
            <button
              type="button"
              onClick={() => go('router')}
              className="text-brand-400 hover:text-brand-300 text-[11.5px] inline-flex items-center gap-1"
            >
              Router Guide <ArrowRight size={11} />
            </button>
          </div>
        </div>
      </div>

      {/* Warnings & Alerts */}
      {fwBlockedProg && (
        <Callout tone="error" title="Windows Firewall is blocking the HawHost application">
          An explicit inbound Block rule exists for HawHost in Windows Defender Firewall (often created if &ldquo;Cancel&rdquo; was clicked on Windows prompt).
          Click <b>&ldquo;Allow Ports&rdquo;</b> above to automatically clean up the blocking rule and allow your web traffic.
        </Callout>
      )}

      {failed.length > 0 && (
        <Callout tone="warn" title="Port Conflict Detected">
          {failed.map((f, i) => (
            <div key={i} className="mt-1">
              Port <b>{f.port}</b> could not start: {f.error}
              {f.owners && f.owners.length > 0 && (
                <div className="text-[12px] mt-1 opacity-90">
                  Occupied by process: <b>{f.owners.map((o) => `${o.name} (PID ${o.pid})`).join(', ')}</b>
                  {f.owners.some((o) => /w3svc|iis|svchost/i.test(o.name)) && (
                    <span> — This is usually IIS (Windows World Wide Web Publishing Service). You can stop it with <span className="mono bg-black/30 px-1 py-0.5 rounded">net stop w3svc</span>.</span>
                  )}
                </div>
              )}
            </div>
          ))}
        </Callout>
      )}

      {/* Ports Diagnostics Table */}
      <Card
        title="Configured Ports & Access Verification"
        subtitle="End-to-end status of every port: local listener, LAN access, Windows Firewall, and Router Port Forwarding."
        icon={Server}
        actions={
          <Button
            size="sm"
            variant="ghost"
            icon={RefreshCw}
            loading={diagnosing}
            onClick={() => diagnose()}
          >
            Diagnose All
          </Button>
        }
      >
        <div className="overflow-x-auto -mx-5 px-5">
          <table className="w-full text-left border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-white/[0.08] text-ink-400 text-[11.5px] uppercase tracking-wider font-semibold">
                <th className="pb-3 pr-4">Port</th>
                <th className="pb-3 px-3">Protocol</th>
                <th className="pb-3 px-3">Server State</th>
                <th className="pb-3 px-3">Local (127.0.0.1)</th>
                <th className="pb-3 px-3">LAN ({network.localIp || 'Wi-Fi'})</th>
                <th className="pb-3 px-3">Windows Firewall</th>
                <th className="pb-3 px-3">Router (UPnP)</th>
                <th className="pb-3 pl-3">Public WAN</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.05]">
              {diagnosticRows.map((r) => {
                const isListening = r.state === 'listening';
                const isError = r.state === 'error';
                return (
                  <tr key={r.port} className="hover:bg-white/[0.02] transition-colors">
                    <td className="py-3 pr-4 font-semibold text-white mono">
                      {r.port}
                    </td>
                    <td className="py-3 px-3">
                      {r.tls ? (
                        <Badge tone="violet" className="gap-1">
                          <Lock size={10} /> HTTPS
                        </Badge>
                      ) : (
                        <Badge tone="blue">HTTP</Badge>
                      )}
                    </td>
                    <td className="py-3 px-3">
                      {isListening ? (
                        <span className="inline-flex items-center gap-1.5 text-emerald-300 font-medium">
                          <Dot tone="green" /> Listening
                        </span>
                      ) : isError ? (
                        <span className="inline-flex items-center gap-1.5 text-rose-300 font-medium" title={r.error}>
                          <Dot tone="red" /> Conflict
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-ink-400">
                          <Dot tone="neutral" /> Stopped
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-3">
                      {r.local === true ? (
                        <span className="text-emerald-400 inline-flex items-center gap-1"><CheckCircle2 size={14} /> Open</span>
                      ) : r.local === false ? (
                        <span className="text-rose-400 inline-flex items-center gap-1"><XCircle size={14} /> Closed</span>
                      ) : (
                        <span className="text-ink-500">—</span>
                      )}
                    </td>
                    <td className="py-3 px-3">
                      {r.lan === true ? (
                        <span className="text-emerald-400 inline-flex items-center gap-1"><CheckCircle2 size={14} /> Open</span>
                      ) : r.lan === false ? (
                        <span className="text-rose-400 inline-flex items-center gap-1"><XCircle size={14} /> Closed</span>
                      ) : (
                        <span className="text-ink-500">—</span>
                      )}
                    </td>
                    <td className="py-3 px-3">
                      {r.firewall === true ? (
                        <Badge tone="green">Allowed</Badge>
                      ) : r.firewall === false ? (
                        <Badge tone="red">Blocked</Badge>
                      ) : (
                        <span className="text-ink-500">—</span>
                      )}
                    </td>
                    <td className="py-3 px-3">
                      {r.router ? (
                        r.router.mapped ? (
                          <Badge tone={r.router.pointsHere ? 'green' : 'amber'} title={r.router.to}>
                            {r.router.pointsHere ? 'Forwarded' : 'Other PC'}
                          </Badge>
                        ) : (
                          <Badge tone="neutral">Not Mapped</Badge>
                        )
                      ) : (
                        <span className="text-ink-500">—</span>
                      )}
                    </td>
                    <td className="py-3 pl-3">
                      {r.public ? (
                        r.public.result === 'reached' || r.public.result === 'open' ? (
                          <Badge tone="green">Reachable</Badge>
                        ) : (
                          <Badge tone="amber" title={r.public.detail || r.public.result}>
                            Check Router
                          </Badge>
                        )
                      ) : (
                        <span className="text-ink-500">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Built-in Port Checker Tool & Firewall Settings */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Interactive Port Checker */}
        <Card
          title="Built-in Port Reachability Checker"
          subtitle="Test whether any IP address or port is actively responding from this computer."
          icon={Activity}
        >
          <form onSubmit={handleTestPort} className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <Field label="Host or IP">
                  <TextInput
                    mono
                    value={testHost}
                    onChange={(e) => setTestHost(e.target.value)}
                    placeholder="127.0.0.1 or mysite.duckdns.org"
                  />
                </Field>
              </div>
              <div>
                <Field label="Port">
                  <TextInput
                    mono
                    type="number"
                    min="1"
                    max="65535"
                    value={testPort}
                    onChange={(e) => setTestPort(e.target.value)}
                    placeholder="80"
                  />
                </Field>
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 pt-1">
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => { setTestHost('127.0.0.1'); setTestPort('80'); }}
                  className="text-[12px] text-ink-400 hover:text-white bg-white/[0.04] px-2 py-1 rounded"
                >
                  Local 80
                </button>
                {network.localIp && (
                  <button
                    type="button"
                    onClick={() => { setTestHost(network.localIp); setTestPort('80'); }}
                    className="text-[12px] text-ink-400 hover:text-white bg-white/[0.04] px-2 py-1 rounded"
                  >
                    LAN 80
                  </button>
                )}
                {ddns.publicIp && (
                  <button
                    type="button"
                    onClick={() => { setTestHost(ddns.publicIp); setTestPort('80'); }}
                    className="text-[12px] text-ink-400 hover:text-white bg-white/[0.04] px-2 py-1 rounded"
                  >
                    WAN {ddns.publicIp}
                  </button>
                )}
              </div>
              <Button
                type="submit"
                variant="primary"
                loading={testing}
                icon={Play}
              >
                Test Port
              </Button>
            </div>

            {testResult && (
              <div className={cx(
                'rounded-lg border p-3.5 mt-3 fade-in text-[13px]',
                testResult.open
                  ? 'border-emerald-400/30 bg-emerald-400/[0.07] text-emerald-100'
                  : 'border-rose-400/30 bg-rose-400/[0.07] text-rose-100'
              )}>
                <div className="flex items-center gap-2 font-semibold">
                  {testResult.open ? <CheckCircle2 size={16} className="text-emerald-400" /> : <XCircle size={16} className="text-rose-400" />}
                  <span>Port {testPort} is {testResult.open ? 'OPEN and responding' : 'CLOSED or unreachable'}</span>
                </div>
                <div className="text-[12px] opacity-80 mt-1">
                  Target: <span className="mono">{testHost}:{testPort}</span>
                  {testResult.detail && ` — ${testResult.detail}`}
                  {testResult.ms !== undefined && ` (${testResult.ms}ms)`}
                </div>
              </div>
            )}
          </form>
        </Card>

        {/* Windows Defender Firewall Controls */}
        <Card
          title="Windows Defender Firewall"
          subtitle="Manage automated incoming TCP allow rules for your self-hosted ports."
          icon={ShieldCheck}
          actions={
            <Button
              size="sm"
              variant="secondary"
              icon={RefreshCw}
              loading={firewallBusy}
              onClick={() => refreshFirewall()}
            >
              Refresh
            </Button>
          }
        >
          <div className="space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-white/[0.06]">
              <div>
                <div className="font-medium text-white text-[13.5px]">Firewall Rules Group</div>
                <div className="text-[12px] text-ink-400 mt-0.5">Rules managed under Group &ldquo;HawHost&rdquo;</div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="primary"
                  loading={applying}
                  icon={ShieldCheck}
                  onClick={() => applyFirewall()}
                >
                  Apply Rules
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  loading={busy === 'fw-remove'}
                  onClick={handleRemoveFirewallRules}
                >
                  Remove Rules
                </Button>
              </div>
            </div>

            <div>
              <div className="text-[12.5px] font-medium text-ink-200 mb-2">Required Inbound Ports:</div>
              <div className="flex flex-wrap gap-1.5">
                {wanted.map((p) => {
                  const isOpen = firewall && firewall.openPorts.includes(p);
                  return (
                    <span
                      key={p}
                      className={cx(
                        'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[12px] mono border',
                        isOpen
                          ? 'border-emerald-400/30 bg-emerald-400/[0.08] text-emerald-200'
                          : 'border-amber-400/30 bg-amber-400/[0.08] text-amber-200'
                      )}
                    >
                      <Dot tone={isOpen ? 'green' : 'amber'} />
                      TCP {p}
                      {isOpen ? ' (Allowed)' : ' (Not allowed)'}
                    </span>
                  );
                })}
              </div>
            </div>

            {/* Custom Extra Ports */}
            <div className="pt-2 border-t border-white/[0.06]">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[12.5px] font-medium text-ink-200">Extra Ports for Firewall:</span>
                {!editingExtra && (
                  <button
                    type="button"
                    onClick={() => setEditingExtra(true)}
                    className="text-[12px] text-brand-400 hover:text-brand-300"
                  >
                    + Add Custom Port
                  </button>
                )}
              </div>

              {editingExtra && (
                <div className="flex items-center gap-2 mb-3">
                  <TextInput
                    mono
                    type="number"
                    min="1"
                    max="65535"
                    value={extraPortInput}
                    onChange={(e) => setExtraPortInput(e.target.value)}
                    placeholder="e.g. 8080"
                    className="w-32"
                  />
                  <Button size="sm" variant="primary" onClick={handleAddExtraPort}>Add</Button>
                  <Button size="sm" onClick={() => { setEditingExtra(false); setExtraPortInput(''); }}>Cancel</Button>
                </div>
              )}

              <div className="flex flex-wrap gap-1.5">
                {(config.firewall.extraPorts || []).length === 0 ? (
                  <span className="text-[12px] text-ink-500 italic">No extra custom ports added.</span>
                ) : (
                  config.firewall.extraPorts.map((p) => (
                    <span
                      key={p}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[12px] mono border border-white/[0.1] bg-white/[0.04] text-ink-200"
                    >
                      TCP {p}
                      <button
                        type="button"
                        onClick={() => handleRemoveExtraPort(p)}
                        className="text-ink-400 hover:text-rose-400 ml-1"
                        title="Remove"
                      >
                        ×
                      </button>
                    </span>
                  ))
                )}
              </div>
            </div>

            <div className="text-[11.5px] text-ink-400 leading-relaxed pt-1">
              Applying rules executes an elevated PowerShell command that creates inbound TCP allow rules in Windows Defender Firewall without needing external network alterations.
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
