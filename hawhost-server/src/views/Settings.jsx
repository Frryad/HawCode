import React, { useEffect, useState } from 'react';
import {
  Server, Power, FolderOpen, Download, Upload, RefreshCw, FileCode
} from 'lucide-react';

import { useHawhost } from '../lib/store';
import { api, bridge } from '../lib/bridge';
import {
  PageHeader, Card, Button, Badge, Field, TextInput, Toggle, Modal, useConfirm, useBusy, cx
} from '../components/ui';

export default function Settings() {
  const { data, call, appInfo } = useHawhost();
  const confirm = useConfirm();
  const [busy, run] = useBusy();

  // Startup and service state
  const [startupStatus, setStartupStatus] = useState(null);
  const [loadingStartup, setLoadingStartup] = useState(false);

  // Server settings form state
  const [serverForm, setServerForm] = useState({
    autoStart: true,
    enableHttp: true,
    httpPort: 80,
    enableHttps: false,
    httpsPort: 443,
    maxBodyMb: 100,
    hideDotfiles: true,
    phpCgiPath: '',
    phpTimeoutSec: 120
  });
  const [savingServer, setSavingServer] = useState(false);

  // UI settings state
  const [uiForm, setUiForm] = useState({
    closeToTray: true,
    stopServerOnQuit: false
  });

  // Export Apache/Nginx modal
  const [exportedConfigs, setExportedConfigs] = useState(null);
  const [exportTab, setExportTab] = useState('apache');
  const [exporting, setExporting] = useState(false);

  // Detect info
  const [detectInfo, setDetectInfo] = useState(null);

  useEffect(() => {
    if (data && data.config) {
      setServerForm({ ...data.config.server });
      setUiForm({ ...data.config.ui });
    }
  }, [data]);

  const fetchStartupStatus = async () => {
    setLoadingStartup(true);
    try {
      const b = await bridge();
      const st = await b.startup.status();
      setStartupStatus(st);
    } catch {
      // Not on Windows or bridge error
    } finally {
      setLoadingStartup(false);
    }
  };

  useEffect(() => {
    fetchStartupStatus();
    api('GET', '/api/detect').then(setDetectInfo).catch(() => {});
  }, []);

  if (!data) return null;

  // Save server config
  const handleSaveServer = async () => {
    setSavingServer(true);
    try {
      await call('PUT', '/api/settings/server', {
        ...serverForm,
        httpPort: Number(serverForm.httpPort) || 80,
        httpsPort: Number(serverForm.httpsPort) || 443,
        maxBodyMb: Number(serverForm.maxBodyMb) || 100,
        phpTimeoutSec: Number(serverForm.phpTimeoutSec) || 120
      }, { success: 'Server settings saved and applied.' });
    } finally {
      setSavingServer(false);
    }
  };

  // Save UI settings
  const handleToggleUi = async (key, val) => {
    const next = { ...uiForm, [key]: val };
    setUiForm(next);
    await call('PUT', '/api/settings/ui', next, { success: 'Preferences updated.' });
  };

  // Service toggle
  const handleInstallService = async () => {
    run('service', async () => {
      const b = await bridge();
      await b.startup.installService();
      await fetchStartupStatus();
    });
  };

  const handleUninstallService = async () => {
    const ok = await confirm({
      title: 'Uninstall Background Service?',
      message: 'HawHost will no longer start at Windows boot before logon. You will need to open HawHost manually to run your websites.',
      confirmLabel: 'Uninstall'
    });
    if (!ok) return;
    run('service', async () => {
      const b = await bridge();
      await b.startup.uninstallService();
      await fetchStartupStatus();
    });
  };

  const handleToggleLoginItem = async (val) => {
    run('loginItem', async () => {
      const b = await bridge();
      await b.startup.setLoginItem(val);
      await fetchStartupStatus();
    });
  };

  // Pick PHP CGI
  const handleBrowsePhp = async () => {
    const b = await bridge();
    const f = await b.pickFile({
      title: 'Select php-cgi.exe',
      filters: [{ name: 'PHP CGI Executable', extensions: ['exe'] }]
    });
    if (f) setServerForm((s) => ({ ...s, phpCgiPath: f }));
  };

  // Export Apache & Nginx configs
  const handleExportWebServers = async () => {
    setExporting(true);
    try {
      const res = await api('POST', '/api/export');
      setExportedConfigs(res);
    } finally {
      setExporting(false);
    }
  };

  // Backup & Restore
  const handleExportConfigJson = async () => {
    const b = await bridge();
    const res = await api('GET', '/api/config/export');
    await b.saveText({
      title: 'Export HawHost Configuration',
      defaultPath: `hawhost-config-${new Date().toISOString().slice(0, 10)}.json`,
      content: res.json
    });
  };

  const handleImportConfigJson = async () => {
    const b = await bridge();
    const json = await b.readTextFile({
      title: 'Select HawHost Configuration JSON File',
      filters: [{ name: 'JSON Config', extensions: ['json'] }]
    });
    if (!json) return;
    const ok = await confirm({
      title: 'Restore Configuration?',
      message: 'This will replace your existing websites, ports, and DDNS settings with the imported configuration.',
      confirmLabel: 'Import & Replace'
    });
    if (!ok) return;
    await call('POST', '/api/config/import', { json }, { success: 'Configuration imported successfully.' });
  };

  const serviceInstalled = startupStatus && startupStatus.service && startupStatus.service.installed;
  const loginItemEnabled = startupStatus && startupStatus.loginItem && startupStatus.loginItem.enabled;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings & System Integration"
        description="Configure web server ports, PHP CGI runtime, Windows automatic boot service, and integration with Apache or Nginx."
      />

      {/* Web Server Engine Settings */}
      <Card
        title="Web Server Engine"
        subtitle="Core listening ports and HTTP/HTTPS server parameters."
        icon={Server}
        actions={
          <Button
            variant="primary"
            loading={savingServer}
            onClick={handleSaveServer}
          >
            Save Server Settings
          </Button>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-3 rounded-lg border border-white/[0.06] bg-ink-900/50 p-4">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-white text-[13.5px]">HTTP Server (Standard)</span>
                <Toggle
                  checked={serverForm.enableHttp}
                  onChange={(v) => setServerForm((s) => ({ ...s, enableHttp: v }))}
                />
              </div>
              <Field label="HTTP Port" hint="Standard web traffic port is 80.">
                <TextInput
                  mono
                  type="number"
                  disabled={!serverForm.enableHttp}
                  value={serverForm.httpPort}
                  onChange={(e) => setServerForm((s) => ({ ...s, httpPort: e.target.value }))}
                />
              </Field>
            </div>

            <div className="space-y-3 rounded-lg border border-white/[0.06] bg-ink-900/50 p-4">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-white text-[13.5px]">HTTPS Server (SSL/TLS)</span>
                <Toggle
                  checked={serverForm.enableHttps}
                  onChange={(v) => setServerForm((s) => ({ ...s, enableHttps: v }))}
                />
              </div>
              <Field label="HTTPS Port" hint="Encrypted web traffic port is 443.">
                <TextInput
                  mono
                  type="number"
                  disabled={!serverForm.enableHttps}
                  value={serverForm.httpsPort}
                  onChange={(e) => setServerForm((s) => ({ ...s, httpsPort: e.target.value }))}
                />
              </Field>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
            <Field label="Maximum Request Body Size (MB)" hint="Maximum size allowed for file uploads through PHP or Node.">
              <TextInput
                type="number"
                value={serverForm.maxBodyMb}
                onChange={(e) => setServerForm((s) => ({ ...s, maxBodyMb: e.target.value }))}
              />
            </Field>

            <div className="space-y-3 pt-6">
              <Toggle
                checked={serverForm.autoStart}
                onChange={(v) => setServerForm((s) => ({ ...s, autoStart: v }))}
                label="Auto-start Web Server on Launch"
                description="Automatically begin listening on configured ports whenever HawHost starts."
              />
              <Toggle
                checked={serverForm.hideDotfiles}
                onChange={(v) => setServerForm((s) => ({ ...s, hideDotfiles: v }))}
                label="Protect Hidden Files (Dotfiles)"
                description="Block public access to sensitive files like .git, .env, and .htaccess."
              />
            </div>
          </div>
        </div>
      </Card>

      {/* PHP Runtime Settings */}
      <Card
        title="PHP Runtime Engine"
        subtitle="Execute PHP scripts, WordPress, or Laravel via local php-cgi."
        icon={FileCode}
      >
        <div className="space-y-4">
          <div className="flex items-center justify-between p-3 rounded-lg border border-white/[0.07] bg-ink-900/60 text-[13px]">
            <div>
              <div className="font-semibold text-white">PHP Engine Status</div>
              <div className="text-[12px] text-ink-400 mt-0.5">
                {data.server.phpCgi ? (
                  <span className="text-emerald-300">Active: {data.server.phpCgi}</span>
                ) : (
                  <span className="text-amber-300">No PHP runtime detected. Static websites and Node apps will work, but .php files cannot run.</span>
                )}
              </div>
            </div>
            {data.server.phpCgi ? (
              <Badge tone="green">PHP Available</Badge>
            ) : (
              <Badge tone="amber">Not Found</Badge>
            )}
          </div>

          <Field label="Custom php-cgi.exe Path" hint="If using XAMPP, WampServer, Laragon, or custom PHP:">
            <div className="flex gap-2">
              <TextInput
                mono
                value={serverForm.phpCgiPath}
                onChange={(e) => setServerForm((s) => ({ ...s, phpCgiPath: e.target.value }))}
                placeholder="C:\xampp\php\php-cgi.exe"
                className="flex-1"
              />
              <Button variant="secondary" onClick={handleBrowsePhp}>Browse</Button>
            </div>
          </Field>

          {detectInfo && detectInfo.php && detectInfo.php.length > 0 && !serverForm.phpCgiPath && (
            <div className="text-[12px] text-ink-400">
              Auto-detected PHP installations: {detectInfo.php.map((p, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setServerForm((s) => ({ ...s, phpCgiPath: p.path }))}
                  className="text-brand-400 hover:underline mx-1"
                >
                  {p.path} ({p.version})
                </button>
              ))}
            </div>
          )}
        </div>
      </Card>

      {/* Windows Automatic Startup & Background Service */}
      <Card
        title="Windows Automatic Startup & Background Service"
        subtitle="Keep your self-hosted websites running 24/7 even after your computer restarts."
        icon={Power}
        actions={
          <Button
            size="sm"
            variant="secondary"
            icon={RefreshCw}
            loading={loadingStartup}
            onClick={fetchStartupStatus}
          >
            Check Status
          </Button>
        }
      >
        <div className="space-y-5">
          {/* Background Service (Task Scheduler S4U) */}
          <div className="flex items-start justify-between gap-4 p-4 rounded-lg border border-white/[0.08] bg-ink-900/60">
            <div>
              <div className="flex items-center gap-2">
                <span className="font-semibold text-white text-[14px]">Windows Background Service (Boot Task)</span>
                {serviceInstalled ? (
                  <Badge tone="green">Installed & Active</Badge>
                ) : (
                  <Badge tone="neutral">Not Installed</Badge>
                )}
              </div>
              <p className="text-[12.5px] text-ink-300 mt-1 max-w-xl leading-relaxed">
                Creates a persistent Windows Task Scheduler task that starts the HawHost background server at Windows boot <b>before anyone logs in</b>, running under your account with automatic crash recovery.
              </p>
              {serviceInstalled && startupStatus.service && (
                <div className="text-[11.5px] text-ink-400 mt-2 mono">
                  Task: HawHost Server · State: {startupStatus.service.state || 'Ready'} · User: {startupStatus.service.user}
                </div>
              )}
            </div>

            <div className="shrink-0">
              {serviceInstalled ? (
                <Button
                  variant="danger"
                  size="sm"
                  loading={busy === 'service'}
                  onClick={handleUninstallService}
                >
                  Uninstall Service
                </Button>
              ) : (
                <Button
                  variant="primary"
                  size="sm"
                  loading={busy === 'service'}
                  onClick={handleInstallService}
                >
                  Install Boot Service
                </Button>
              )}
            </div>
          </div>

          {/* User Logon Startup & Tray Preferences */}
          <div className="space-y-3 pt-2">
            <Toggle
              checked={loginItemEnabled}
              onChange={handleToggleLoginItem}
              label="Open HawHost Control Panel at User Login"
              description="Automatically launches the desktop window minimized to the Windows system tray when you sign in."
            />
            <Toggle
              checked={uiForm.closeToTray}
              onChange={(v) => handleToggleUi('closeToTray', v)}
              label="Minimize to System Tray on Close"
              description="Clicking the [X] button hides the window into the Windows notification tray instead of stopping the app."
            />
          </div>
        </div>
      </Card>

      {/* Apache & Nginx Config Generator */}
      <Card
        title="Apache & Nginx Configuration Exporter"
        subtitle="Generate ready-to-include VirtualHost configuration files if you prefer to proxy or run Apache/Nginx directly."
        icon={FileCode}
        actions={
          <Button
            variant="secondary"
            loading={exporting}
            onClick={handleExportWebServers}
          >
            Export VirtualHosts
          </Button>
        }
      >
        <div className="space-y-3 text-[13px] text-ink-300">
          <p>
            HawHost includes its own high-performance web server engine, but if you have existing <b>XAMPP Apache</b> or <b>Nginx for Windows</b> installations, HawHost can automatically export compliant configuration files matching your website rules, ports, and SSL certificates.
          </p>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={async () => (await bridge()).openPath(data.paths.exportsDir)}
            >
              Open Exports Folder
            </Button>
          </div>
        </div>
      </Card>

      {/* Config Management & App Info */}
      <Card
        title="Data Storage & Configuration Backup"
        subtitle="All settings and website definitions are stored 100% locally on your PC."
        icon={FolderOpen}
      >
        <div className="space-y-4">
          <div className="flex items-center justify-between p-3 rounded-lg border border-white/[0.06] bg-ink-900/60 text-[13px]">
            <div>
              <div className="font-semibold text-white">Local Application Data Directory</div>
              <div className="text-[12px] text-ink-400 mono mt-0.5">{data.dataDir}</div>
            </div>
            <Button
              size="sm"
              variant="secondary"
              icon={FolderOpen}
              onClick={async () => (await bridge()).openPath(data.dataDir)}
            >
              Open Data Folder
            </Button>
          </div>

          <div className="flex items-center justify-between pt-2">
            <div className="text-[12.5px] text-ink-300">
              Backup or transfer your entire server configuration (websites, DDNS accounts, ports) as a single JSON file.
            </div>
            <div className="flex gap-2 shrink-0">
              <Button variant="secondary" icon={Upload} onClick={handleImportConfigJson}>
                Import JSON
              </Button>
              <Button variant="secondary" icon={Download} onClick={handleExportConfigJson}>
                Export JSON
              </Button>
            </div>
          </div>

          <div className="pt-3 border-t border-white/[0.06] text-[12px] text-ink-400 flex flex-wrap gap-4">
            <span>HawHost v{data.version}</span>
            <span>Process PID: {data.pid}</span>
            <span>Platform: Windows {process.arch}</span>
            {appInfo && <span>Executable: {appInfo.exePath}</span>}
          </div>
        </div>
      </Card>

      {/* Exported Config Modal */}
      {exportedConfigs && (
        <Modal
          open
          width={760}
          title="Generated Web Server Configurations"
          subtitle="Copy or include these files in your Apache or Nginx configuration."
          onClose={() => setExportedConfigs(null)}
          footer={
            <Button variant="primary" onClick={() => setExportedConfigs(null)}>Done</Button>
          }
        >
          <div className="space-y-3">
            <div className="flex gap-2 border-b border-white/[0.07] pb-2">
              <button
                type="button"
                onClick={() => setExportTab('apache')}
                className={cx('px-3 py-1 rounded text-[13px] font-medium', exportTab === 'apache' ? 'bg-brand-500 text-white' : 'text-ink-400 hover:text-white')}
              >
                Apache VirtualHost (httpd.conf)
              </button>
              <button
                type="button"
                onClick={() => setExportTab('nginx')}
                className={cx('px-3 py-1 rounded text-[13px] font-medium', exportTab === 'nginx' ? 'bg-brand-500 text-white' : 'text-ink-400 hover:text-white')}
              >
                Nginx Server Blocks (nginx.conf)
              </button>
            </div>

            <div className="text-[12px] text-ink-400">
              Saved to: <span className="mono text-ink-200">{exportTab === 'apache' ? exportedConfigs.apache.path : exportedConfigs.nginx.path}</span>
            </div>

            <pre className="h-80 overflow-y-auto p-4 rounded-lg bg-ink-950 border border-white/[0.08] text-[12px] mono text-ink-200">
              {exportTab === 'apache' ? exportedConfigs.apache.content : exportedConfigs.nginx.content}
            </pre>
          </div>
        </Modal>
      )}
    </div>
  );
}
