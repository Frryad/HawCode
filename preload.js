const { contextBridge, ipcRenderer } = require('electron');

/** Wrap an ipcRenderer listener so the renderer gets a clean unsubscribe. */
function subscribe(channel, callback) {
  const handler = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld('electronAPI', {
  // Workspace setup
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  startHost: (options) => ipcRenderer.invoke('start-host', options),
  probeHost: (url) => ipcRenderer.invoke('probe-host', url),
  joinWorkspace: (options) => ipcRenderer.invoke('join-workspace', options),
  disconnectWorkspace: () => ipcRenderer.invoke('disconnect-workspace'),

  // Domain names this computer issues, and the name server behind them.
  domainPreview: (name, ending) => ipcRenderer.invoke('domain-preview', { name, ending }),
  domainCheck: () => ipcRenderer.invoke('domain-check'),
  domainSetup: () => ipcRenderer.invoke('domain-setup'),

  // Reaching this computer from the internet by name. The token goes in through
  // its own channel and never comes back out.
  ddnsConfig: () => ipcRenderer.invoke('ddns-config'),
  ddnsSave: (patch) => ipcRenderer.invoke('ddns-save', patch),
  ddnsSetToken: (token) => ipcRenderer.invoke('ddns-set-token', token),
  ddnsStatus: () => ipcRenderer.invoke('ddns-status'),
  ddnsTest: (candidate) => ipcRenderer.invoke('ddns-test', candidate),
  ddnsRefresh: () => ipcRenderer.invoke('ddns-refresh'),
  ddnsUnpoint: () => ipcRenderer.invoke('ddns-unpoint'),
  networkCheck: (options) => ipcRenderer.invoke('network-check', options),
  // This PC's address on the Wi-Fi router, for reserving a static IP.
  routerInfo: () => ipcRenderer.invoke('router-info'),

  // Windows Firewall. The plan is fetched and shown before anything is run.
  firewallPlan: () => ipcRenderer.invoke('firewall-plan'),
  firewallApply: (options) => ipcRenderer.invoke('firewall-apply', options),
  firewallRevert: () => ipcRenderer.invoke('firewall-revert'),
  portOwner: (port, protocol) => ipcRenderer.invoke('port-owner', { port, protocol }),
  // Router port forwarding over UPnP.
  upnpRetry: () => ipcRenderer.invoke('upnp-retry'),
  // XAMPP's Apache: where it listens, whether it runs, and starting it.
  xamppStatus: () => ipcRenderer.invoke('xampp-status'),
  xamppStart: () => ipcRenderer.invoke('xampp-start'),
  // Route the shared folder's name through Apache, or take the routing out.
  xamppVhostApply: () => ipcRenderer.invoke('xampp-vhost-apply'),
  xamppVhostRemove: () => ipcRenderer.invoke('xampp-vhost-remove'),

  // The local name, end to end: checklist, and one UAC prompt for the firewall,
  // the hosts file and (optionally) the Private network profile.
  pcSetupStatus: (options) => ipcRenderer.invoke('pc-setup-status', options),
  pcSetupApply: (options) => ipcRenderer.invoke('pc-setup-apply', options),

  // Direct peer-to-peer sharing. One invite per friend: they send back a reply
  // code, which is what acceptAnswer completes the connection with.
  createInvite: () => ipcRenderer.invoke('p2p-create-invite'),
  joinWithInvite: (options) => ipcRenderer.invoke('join-with-invite', options),
  acceptAnswer: (peerId, code) => ipcRenderer.invoke('p2p-accept-answer', { peerId, code }),
  saveInvitePage: (peerId) => ipcRenderer.invoke('p2p-save-invite-page', { peerId }),

  // Sync controls
  pauseSync: () => ipcRenderer.invoke('pause-sync'),
  resumeSync: () => ipcRenderer.invoke('resume-sync'),
  stopSync: () => ipcRenderer.invoke('stop-sync'),
  getSyncStatus: () => ipcRenderer.invoke('get-sync-status'),

  // Files
  getFileTree: () => ipcRenderer.invoke('get-file-tree'),
  readFile: (relativePath) => ipcRenderer.invoke('read-file', relativePath),
  setActiveFile: (relativePath) => ipcRenderer.invoke('set-active-file', relativePath),
  writeFile: (relativePath, content) => ipcRenderer.invoke('write-file', { path: relativePath, content }),
  createFile: (relativePath) => ipcRenderer.invoke('create-file', relativePath),
  createDir: (relativePath) => ipcRenderer.invoke('create-dir', relativePath),
  deleteItem: (relativePath) => ipcRenderer.invoke('delete-item', relativePath),
  renameItem: (from, to) => ipcRenderer.invoke('rename-item', { from, to }),
  duplicateItem: (relativePath) => ipcRenderer.invoke('duplicate-item', relativePath),

  // Terminal — desktop only, never routed through the network server.
  terminalShells: () => ipcRenderer.invoke('terminal-shells'),
  terminalCreate: (options) => ipcRenderer.invoke('terminal-create', options),
  terminalWrite: (id, data) => ipcRenderer.invoke('terminal-write', { id, data }),
  terminalResize: (id, cols, rows) => ipcRenderer.invoke('terminal-resize', { id, cols, rows }),
  terminalKill: (id) => ipcRenderer.invoke('terminal-kill', id),
  terminalList: () => ipcRenderer.invoke('terminal-list'),
  terminalScrollback: (id) => ipcRenderer.invoke('terminal-scrollback', id),

  // Git
  gitStatus: () => ipcRenderer.invoke('git-status'),
  gitStage: (paths) => ipcRenderer.invoke('git-stage', paths),
  gitStageAll: () => ipcRenderer.invoke('git-stage-all'),
  gitUnstage: (paths) => ipcRenderer.invoke('git-unstage', paths),
  gitDiscard: (paths) => ipcRenderer.invoke('git-discard', paths),
  gitCommit: (message) => ipcRenderer.invoke('git-commit', message),
  gitPush: () => ipcRenderer.invoke('git-push'),
  gitPull: () => ipcRenderer.invoke('git-pull'),
  gitBranches: () => ipcRenderer.invoke('git-branches'),
  gitCheckout: (branch, create) => ipcRenderer.invoke('git-checkout', { branch, create }),
  gitDiff: (relativePath, staged) => ipcRenderer.invoke('git-diff', { path: relativePath, staged }),
  gitLog: (limit) => ipcRenderer.invoke('git-log', limit),
  gitInit: () => ipcRenderer.invoke('git-init'),

  // Search
  searchWorkspace: (options) => ipcRenderer.invoke('search-workspace', options),
  searchReplace: (options) => ipcRenderer.invoke('search-replace', options),
  quickOpen: (query, limit) => ipcRenderer.invoke('quick-open', { query, limit }),

  // Scripts
  scriptsList: () => ipcRenderer.invoke('scripts-list'),
  scriptsRun: (script) => ipcRenderer.invoke('scripts-run', script),

  // Settings
  getSettings: () => ipcRenderer.invoke('settings-get'),
  updateSettings: (patch) => ipcRenderer.invoke('settings-update', patch),
  resetSettings: () => ipcRenderer.invoke('settings-reset'),
  readIgnoreFile: () => ipcRenderer.invoke('read-ignore-file'),
  writeIgnoreFile: (content) => ipcRenderer.invoke('write-ignore-file', content),

  // Presence
  broadcastPresence: (payload) => ipcRenderer.invoke('broadcast-presence', payload),
  getPresence: () => ipcRenderer.invoke('get-presence'),

  // Shell helpers
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  revealFolder: () => ipcRenderer.invoke('reveal-folder'),
  getHostInfo: () => ipcRenderer.invoke('get-host-info'),

  // Events
  onDiscoveredWorkspaces: (callback) => subscribe('discovered-workspaces', callback),
  onSyncStatus: (callback) => subscribe('sync-status', callback),
  onSyncActivity: (callback) => subscribe('sync-activity', callback),
  onTransferProgress: (callback) => subscribe('transfer-progress', callback),
  onFileTreeChanged: (callback) => subscribe('file-tree-changed', callback),
  onFileUpdated: (callback) => subscribe('file-updated', callback),
  onTerminalData: (callback) => subscribe('terminal-data', callback),
  onTerminalExit: (callback) => subscribe('terminal-exit', callback),
  onPeerPresence: (callback) => subscribe('peer-presence', callback),
  onDirectPeerState: (callback) => subscribe('direct-peer-state', callback)
});
