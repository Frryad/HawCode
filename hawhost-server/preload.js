'use strict';

const { contextBridge, ipcRenderer } = require('electron');

async function call(channel, ...args) {
  const res = await ipcRenderer.invoke(channel, ...args);
  if (!res.ok) throw new Error(res.error);
  return res.data;
}

function on(channel, callback) {
  const handler = (_e, payload) => callback(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld('hawhost', {
  api: (method, path, body) => call('api', { method, path, body }),
  appInfo: () => call('app:info'),
  ensureDaemon: () => call('daemon:ensure'),
  restartDaemon: () => call('daemon:restart'),

  pickFolder: (opts) => call('dialog:folder', opts),
  pickFile: (opts) => call('dialog:file', opts),
  saveText: (opts) => call('dialog:save', opts),
  readTextFile: (opts) => call('dialog:readText', opts),
  openExternal: (url) => call('shell:openExternal', url),
  openPath: (p) => call('shell:openPath', p),
  copy: (text) => call('clipboard:write', text),

  firewall: {
    status: () => call('firewall:status'),
    apply: (ports) => call('firewall:apply', ports),
    remove: () => call('firewall:remove')
  },
  startup: {
    status: () => call('startup:status'),
    setLoginItem: (enabled) => call('startup:setLoginItem', enabled),
    installService: () => call('startup:installService'),
    uninstallService: () => call('startup:uninstallService')
  },
  trustCert: (certPath) => call('cert:trust', certPath),
  quit: (opts) => call('app:quit', opts || {}),

  onEvent: (cb) => on('daemon:event', cb),
  onConnection: (cb) => on('daemon:connection', cb),
  onError: (cb) => on('daemon:error', cb),
  onNavigate: (cb) => on('app:navigate', cb)
});
