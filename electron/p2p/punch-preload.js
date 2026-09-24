'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/**
 * The only bridge the punch window gets. It relays signalling and already-framed
 * channel data, and nothing else — the window has no reason to touch the disk,
 * the engine or any other part of the app.
 */
contextBridge.exposeInMainWorld('punch', {
  send: (type, payload) => ipcRenderer.send('p2p:from-window', { type, payload }),
  on: (callback) => {
    ipcRenderer.on('p2p:to-window', (_event, message) => callback(message));
  }
});
