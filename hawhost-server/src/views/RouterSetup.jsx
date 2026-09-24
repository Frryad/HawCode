import React, { useEffect, useState } from 'react';
import {
  Router as RouterIcon, Globe, ExternalLink, RefreshCw, Plus, Trash2, CheckCircle2, HelpCircle, ShieldCheck, Laptop
} from 'lucide-react';

import { useHawhost } from '../lib/store';
import { useDiagnose } from '../lib/actions';
import { api, bridge } from '../lib/bridge';
import {
  PageHeader, Card, Button, IconButton, Badge, Dot, Callout, Field, TextInput, Toggle, Modal, CopyText, useConfirm, useBusy, cx
} from '../components/ui';
import NatNotice from '../components/NatNotice';

const ROUTER_BRANDS = [
  {
    id: 'tplink',
    name: 'TP-Link',
    steps: [
      'Open your web browser and go to your router admin panel: http://192.168.0.1 (or http://tplinkwifi.net).',
      'Log in with your router administrator username and password (default is usually admin / password or printed on the bottom sticker).',
      'Go to Advanced → NAT Forwarding → Virtual Servers.',
      'Click "+ Add" to create a new port forwarding rule.',
      'Set Service Type: Custom, Service Name: HawHost HTTP.',
      'External Port: 80, Internal IP: your PC local IP, Internal Port: 80, Protocol: TCP.',
      'Click Save. Repeat for port 443 (HTTPS) if using SSL.'
    ]
  },
  {
    id: 'netgear',
    name: 'Netgear',
    steps: [
      'Open your browser and navigate to http://192.168.1.1 (or http://routerlogin.net).',
      'Log in with your administrator credentials.',
      'Go to the Advanced tab → Advanced Setup → Port Forwarding / Port Triggering.',
      'Select "Port Forwarding" and click "Add Custom Service".',
      'Enter Service Name: HawHost HTTP, Service Type: TCP.',
      'External Starting & Ending Port: 80, Internal Starting & Ending Port: 80.',
      'Internal IP Address: your PC local IP.',
      'Click Apply. Repeat for port 443.'
    ]
  },
  {
    id: 'asus',
    name: 'ASUS',
    steps: [
      'Open your browser to http://192.168.1.1 (or http://router.asus.com).',
      'Log into ASUSWRT with your admin credentials.',
      'In the left sidebar, click WAN → Virtual Server / Port Forwarding tab.',
      'Toggle "Enable Port Forwarding" to ON.',
      'Under the Port Forwarding List table, click the "+" button.',
      'Service Name: HawHost HTTP, Port Range: 80, Local IP: your PC local IP, Local Port: 80, Protocol: TCP.',
      'Click Apply. Add a second entry for port 443.'
    ]
  },
  {
    id: 'dlink',
    name: 'D-Link',
    steps: [
      'Navigate to http://192.168.0.1 or http://dlinkrouter.local in your browser.',
      'Log into the router management console.',
      'Go to Features → Port Forwarding (or Advanced → Virtual Server).',
      'Click "Add Rule".',
      'Rule Name: HawHost HTTP, External Port: 80, Internal IP: your PC local IP, Internal Port: 80, Protocol: TCP.',
      'Save settings and reboot the router if prompted.'
    ]
  },
  {
    id: 'huawei',
    name: 'Huawei',
    steps: [
      'Open http://192.168.8.1 or http://192.168.1.1 in your browser.',
      'Log in with your credentials.',
      'Go to Advanced → Security → Virtual Server (or Forwarding).',
      'Click "New" or "+".',
      'Name: HawHost, WAN Port: 80, LAN IP Address: your PC local IP, LAN Port: 80, Protocol: TCP.',
      'Click Save / Apply.'
    ]
  },
  {
    id: 'generic',
    name: 'Other / ISP Routers',
    steps: [
      'Open your default gateway IP (usually http://192.168.1.1 or http://192.168.0.1) in your browser.',
      'Log in using the admin password printed on the sticker underneath your router.',
      'Look for "Port Forwarding", "Virtual Server", "NAT", or "Gaming & Applications" in the router settings.',
      'Create an entry with Protocol: TCP, External Port: 80, Internal Port: 80, Destination IP: your PC local IP.',
      'Create a second entry with Protocol: TCP, External Port: 443, Internal Port: 443.',
      'Save and apply changes.'
    ]
  }
];

export default function RouterSetup({ go }) {
  const { data, call } = useHawhost();
  const [diagnose, diagnosing, diagnosis] = useDiagnose();
  const confirm = useConfirm();
  const [busy, run] = useBusy();

  const [selectedBrand, setSelectedBrand] = useState('tplink');
  const [upnpData, setUpnpData] = useState(null);
  const [loadingUpnp, setLoadingUpnp] = useState(false);

  // Manual UPnP mapping modal state
  const [showAddMapping, setShowAddMapping] = useState(false);
  const [mapExternal, setMapExternal] = useState('80');
  const [mapInternal, setMapInternal] = useState('80');
  const [mapDescription, setMapDescription] = useState('HawHost TCP 80');

  const fetchUpnp = async (refresh = false) => {
    setLoadingUpnp(true);
    try {
      const res = await api('GET', `/api/upnp?refresh=${refresh ? '1' : '0'}`);
      setUpnpData(res);
    } catch {
      // UPnP disabled or unavailable
    } finally {
      setLoadingUpnp(false);
    }
  };

  useEffect(() => {
    fetchUpnp();
  }, []);

  if (!data) return null;

  const { network, ddns, config } = data;
  const routerIp = network.gateway || '192.168.1.1';
  const routerAdminUrl = `http://${routerIp}`;

  const handleToggleUpnp = async (val) => {
    await call('PUT', '/api/settings/router', { upnpEnabled: val }, { success: `UPnP ${val ? 'enabled' : 'disabled'}.` });
    if (val) fetchUpnp(true);
  };

  const handleAddMapping = async () => {
    const ext = parseInt(mapExternal, 10);
    const int = parseInt(mapInternal, 10);
    if (!ext || !int) return;
    await call('POST', '/api/upnp/map', { externalPort: ext, internalPort: int, description: mapDescription }, {
      success: `Port ${ext} successfully forwarded in router via UPnP.`
    });
    setShowAddMapping(false);
    fetchUpnp(true);
  };

  const handleDeleteMapping = async (port) => {
    const ok = await confirm({
      title: 'Remove Router Port Forwarding?',
      message: `Delete UPnP forwarding for port ${port} from your router?`,
      danger: true,
      confirmLabel: 'Delete'
    });
    if (!ok) return;
    await call('POST', '/api/upnp/unmap', { externalPort: port }, { success: `Port ${port} mapping removed.` });
    fetchUpnp(true);
  };

  const currentBrand = ROUTER_BRANDS.find((b) => b.id === selectedBrand) || ROUTER_BRANDS[0];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Router Port Forwarding Setup"
        description="Configure your home router to forward incoming internet traffic to your Windows PC without external tunnels or middleman servers."
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              icon={RefreshCw}
              loading={loadingUpnp}
              onClick={() => fetchUpnp(true)}
            >
              Refresh UPnP
            </Button>
            <Button
              variant="primary"
              icon={ExternalLink}
              onClick={async () => (await bridge()).openExternal(routerAdminUrl)}
            >
              Open Router Admin ({routerIp})
            </Button>
          </div>
        }
      />

      <NatNotice />

      {/* Connection Info Summary */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="rounded-xl border border-white/[0.07] bg-ink-850 p-4">
          <div className="flex items-center justify-between text-ink-400 text-[12px] font-medium uppercase tracking-wider">
            <span>Your PC Local IP</span>
            <Laptop size={14} />
          </div>
          <div className="text-[17px] font-semibold text-white mt-2 mono">
            {network.localIp || '127.0.0.1'}
          </div>
          <div className="text-[11.5px] text-ink-400 mt-1 flex items-center justify-between">
            <span>Enter this in router</span>
            <CopyText value={network.localIp || ''} />
          </div>
        </div>

        <div className="rounded-xl border border-white/[0.07] bg-ink-850 p-4">
          <div className="flex items-center justify-between text-ink-400 text-[12px] font-medium uppercase tracking-wider">
            <span>Router Gateway IP</span>
            <RouterIcon size={14} />
          </div>
          <div className="text-[17px] font-semibold text-white mt-2 mono">
            {routerIp}
          </div>
          <div className="text-[11.5px] text-ink-400 mt-1 flex items-center justify-between">
            <span>Web admin login</span>
            <CopyText value={routerIp} />
          </div>
        </div>

        <div className="rounded-xl border border-white/[0.07] bg-ink-850 p-4">
          <div className="flex items-center justify-between text-ink-400 text-[12px] font-medium uppercase tracking-wider">
            <span>Public WAN IP</span>
            <Globe size={14} />
          </div>
          <div className="text-[17px] font-semibold text-white mt-2 mono truncate">
            {ddns.publicIp || 'Detecting…'}
          </div>
          <div className="text-[11.5px] text-ink-400 mt-1 flex items-center justify-between">
            <span>Internet address</span>
            {ddns.publicIp && <CopyText value={ddns.publicIp} />}
          </div>
        </div>

        <div className="rounded-xl border border-white/[0.07] bg-ink-850 p-4">
          <div className="flex items-center justify-between text-ink-400 text-[12px] font-medium uppercase tracking-wider">
            <span>Primary Domain (DDNS)</span>
            <Badge tone="blue">Free DDNS</Badge>
          </div>
          <div className="text-[16px] font-semibold text-white mt-2 truncate mono">
            {ddns.records && ddns.records[0] ? ddns.records[0].hostname : 'None configured'}
          </div>
          <div className="text-[11.5px] text-ink-400 mt-1 flex items-center justify-between">
            <span>Public Hostname</span>
            <button
              type="button"
              onClick={() => go('domains')}
              className="text-brand-400 hover:text-brand-300"
            >
              Manage DDNS →
            </button>
          </div>
        </div>
      </div>

      {/* UPnP Automatic Router Forwarding */}
      <Card
        title="UPnP Automatic Port Forwarding"
        subtitle="Universal Plug and Play allows HawHost to request port forwards directly from your router automatically."
        icon={RouterIcon}
        actions={
          <div className="flex items-center gap-3">
            <Toggle
              checked={config.router.upnpEnabled}
              onChange={handleToggleUpnp}
              label="Enable UPnP"
            />
            {config.router.upnpEnabled && (
              <Button
                size="sm"
                variant="secondary"
                icon={Plus}
                onClick={() => setShowAddMapping(true)}
              >
                Add UPnP Forward
              </Button>
            )}
          </div>
        }
      >
        <div className="space-y-4">
          {upnpData && upnpData.info && upnpData.info.found ? (
            <div className="flex items-center justify-between p-3 rounded-lg border border-emerald-400/20 bg-emerald-400/[0.05] text-[13px]">
              <div className="flex items-center gap-2.5">
                <CheckCircle2 size={16} className="text-emerald-400 shrink-0" />
                <div>
                  <div className="font-semibold text-emerald-100">
                    UPnP Gateway Detected: {upnpData.info.friendlyName || upnpData.info.modelName || 'Router Gateway'}
                  </div>
                  <div className="text-[12px] text-emerald-200/80">
                    {upnpData.info.manufacturer && `${upnpData.info.manufacturer} · `}
                    Router Address: {upnpData.info.routerAddress || routerIp}
                  </div>
                </div>
              </div>
              <Badge tone="green">UPnP Ready</Badge>
            </div>
          ) : config.router.upnpEnabled ? (
            <Callout tone="warn" title="UPnP Router Not Responding">
              Your router did not reply to UPnP discovery requests, or UPnP is turned off in your router firmware settings.
              Follow the manual port forwarding instructions below.
            </Callout>
          ) : (
            <Callout tone="info">
              UPnP is currently disabled. You can enable it above to let HawHost forward ports automatically, or configure your router manually using the guide below.
            </Callout>
          )}

          {/* UPnP Mappings List */}
          {upnpData && upnpData.mappings && upnpData.mappings.length > 0 && (
            <div>
              <div className="text-[12.5px] font-medium text-ink-200 mb-2">Active Router UPnP Mappings:</div>
              <div className="divide-y divide-white/[0.05] border border-white/[0.07] rounded-lg overflow-hidden bg-ink-900/60">
                {upnpData.mappings.map((m, idx) => {
                  const pointsHere = m.internalClient === network.localIp;
                  return (
                    <div key={idx} className="flex items-center justify-between px-4 py-2.5 text-[13px]">
                      <div className="flex items-center gap-3">
                        <Dot tone={pointsHere ? 'green' : 'amber'} />
                        <div>
                          <span className="font-semibold text-white mono">External TCP {m.externalPort}</span>
                          <span className="text-ink-400 mx-2">→</span>
                          <span className="text-ink-200 mono">{m.internalClient}:{m.internalPort}</span>
                          {m.description && <span className="text-[11.5px] text-ink-400 ml-2">({m.description})</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {pointsHere ? (
                          <Badge tone="green">Points to this PC</Badge>
                        ) : (
                          <Badge tone="amber">Other device</Badge>
                        )}
                        <IconButton
                          icon={Trash2}
                          title="Delete UPnP Mapping"
                          onClick={() => handleDeleteMapping(m.externalPort)}
                          className="hover:text-rose-400"
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </Card>

      {/* Manual Port Forwarding Guide for Router Brands */}
      <Card
        title="Manual Router Port Forwarding Guide"
        subtitle="Follow these exact steps for your router brand to direct internet traffic to your PC."
        icon={HelpCircle}
      >
        <div className="space-y-4">
          {/* Brand Selector Buttons */}
          <div className="flex flex-wrap gap-2 pb-2 border-b border-white/[0.06]">
            {ROUTER_BRANDS.map((b) => (
              <button
                key={b.id}
                type="button"
                onClick={() => setSelectedBrand(b.id)}
                className={cx(
                  'px-3.5 py-1.5 rounded-lg text-[13px] font-medium transition-colors',
                  selectedBrand === b.id
                    ? 'bg-brand-500 text-white shadow-sm'
                    : 'bg-white/[0.04] text-ink-300 hover:text-white hover:bg-white/[0.08]'
                )}
              >
                {b.name}
              </button>
            ))}
          </div>

          {/* Values To Enter Box */}
          <div className="rounded-lg border border-brand-400/20 bg-brand-500/[0.07] p-4 text-[13px]">
            <div className="font-semibold text-white mb-2 flex items-center gap-2">
              <CheckCircle2 size={16} className="text-brand-400" />
              Copy these values into your router&apos;s Port Forwarding page:
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-[12.5px] mt-2">
              <div className="rounded-md bg-ink-950/70 p-2.5 border border-white/[0.06]">
                <div className="text-ink-400 text-[11px] uppercase font-semibold">Rule 1 (HTTP Web Traffic):</div>
                <div className="mt-1 space-y-0.5 mono text-ink-200">
                  <div>Name: <span className="text-white">HawHost HTTP</span></div>
                  <div>Protocol: <span className="text-white">TCP</span></div>
                  <div>External Port: <span className="text-emerald-300 font-bold">80</span></div>
                  <div>Internal IP: <span className="text-emerald-300 font-bold">{network.localIp}</span></div>
                  <div>Internal Port: <span className="text-emerald-300 font-bold">80</span></div>
                </div>
              </div>

              <div className="rounded-md bg-ink-950/70 p-2.5 border border-white/[0.06]">
                <div className="text-ink-400 text-[11px] uppercase font-semibold">Rule 2 (HTTPS Encrypted Traffic):</div>
                <div className="mt-1 space-y-0.5 mono text-ink-200">
                  <div>Name: <span className="text-white">HawHost HTTPS</span></div>
                  <div>Protocol: <span className="text-white">TCP</span></div>
                  <div>External Port: <span className="text-emerald-300 font-bold">443</span></div>
                  <div>Internal IP: <span className="text-emerald-300 font-bold">{network.localIp}</span></div>
                  <div>Internal Port: <span className="text-emerald-300 font-bold">443</span></div>
                </div>
              </div>
            </div>
          </div>

          {/* Step-by-Step Instructions */}
          <div className="space-y-2 pt-1">
            <div className="font-semibold text-ink-100 text-[14px]">
              Instructions for {currentBrand.name} Routers:
            </div>
            <ol className="space-y-2 text-[13px] text-ink-300 leading-relaxed list-decimal list-inside">
              {currentBrand.steps.map((st, i) => (
                <li key={i} className="pl-1">
                  <span>{st}</span>
                </li>
              ))}
            </ol>
          </div>

          {/* Troubleshooting Advice */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-3 border-t border-white/[0.06] text-[12.5px]">
            <div className="space-y-1">
              <div className="font-semibold text-white flex items-center gap-1.5">
                <HelpCircle size={14} className="text-amber-400" />
                Why does my website not open from my own Wi-Fi?
              </div>
              <p className="text-ink-400 leading-relaxed">
                Many home routers do not support <b>NAT Loopback (Hairpinning)</b>. When you type your public DDNS domain from inside the same Wi-Fi network, the router might not redirect it back to your PC. To test properly, <b>turn off Wi-Fi on your mobile phone and test over 4G/5G mobile data</b>.
              </p>
            </div>

            <div className="space-y-1">
              <div className="font-semibold text-white flex items-center gap-1.5">
                <ShieldCheck size={14} className="text-brand-400" />
                Reserve a Static Local IP
              </div>
              <p className="text-ink-400 leading-relaxed">
                If your PC restarts, your router might assign it a different local IP address (e.g. 192.168.1.102). In your router settings under <b>DHCP → Address Reservation</b>, bind your PC MAC address to <span className="mono text-white">{network.localIp}</span> so it stays permanent.
              </p>
            </div>
          </div>
        </div>
      </Card>

      {/* Manual Add UPnP Modal */}
      {showAddMapping && (
        <Modal
          open
          title="Add Router UPnP Forwarding"
          subtitle="HawHost will ask your router to open and forward this port to this computer."
          onClose={() => setShowAddMapping(false)}
          footer={
            <>
              <Button onClick={() => setShowAddMapping(false)}>Cancel</Button>
              <Button variant="primary" onClick={handleAddMapping}>Add Forwarding</Button>
            </>
          }
        >
          <div className="space-y-4">
            <Field label="External Port (Public)">
              <TextInput
                mono
                type="number"
                value={mapExternal}
                onChange={(e) => setMapExternal(e.target.value)}
                placeholder="80"
              />
            </Field>
            <Field label="Internal Port (This PC)">
              <TextInput
                mono
                type="number"
                value={mapInternal}
                onChange={(e) => setMapInternal(e.target.value)}
                placeholder="80"
              />
            </Field>
            <Field label="Description">
              <TextInput
                value={mapDescription}
                onChange={(e) => setMapDescription(e.target.value)}
                placeholder="HawHost Web Server"
              />
            </Field>
            <div className="text-[12px] text-ink-400">
              Traffic sent to port {mapExternal} on your public IP will be forwarded to {network.localIp}:{mapInternal}.
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
