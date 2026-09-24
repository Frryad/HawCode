'use strict';

const path = require('path');
const { BrowserWindow, ipcMain } = require('electron');

/**
 * Owns the hidden window that actually speaks WebRTC, and turns its IPC chatter
 * into callbacks the rest of main can use.
 *
 * `backgroundThrottling: false` is not optional. Chromium slows timers to a
 * crawl in a window that is never shown, and ICE keepalives are timers — with
 * throttling left on, connections come up and then quietly die a minute later.
 */
function createPunchWindow() {
  let window = null;
  let ready = null;
  const listeners = new Map();

  function emit(type, payload) {
    const handler = listeners.get(type);
    if (handler) handler(payload);
  }

  function onFromWindow(_event, message) {
    if (!message || typeof message.type !== 'string') return;
    emit(message.type, message.payload || {});
  }

  async function ensure() {
    if (ready) return ready;
    ready = new Promise((resolve, reject) => {
      window = new BrowserWindow({
        show: false,
        webPreferences: {
          preload: path.join(__dirname, 'punch-preload.js'),
          nodeIntegration: false,
          contextIsolation: true,
          backgroundThrottling: false
        }
      });

      let settled = false;
      listeners.set('ready', () => {
        if (settled) return;
        settled = true;
        resolve();
      });

      window.on('closed', () => {
        window = null;
        ready = null;
      });

      window.loadFile(path.join(__dirname, 'punch.html')).catch((error) => {
        if (settled) return;
        settled = true;
        ready = null;
        reject(new Error(`The peer-to-peer engine could not start: ${error.message}`));
      });

      setTimeout(() => {
        if (settled) return;
        settled = true;
        ready = null;
        reject(new Error('The peer-to-peer engine did not start in time'));
      }, 15000);
    });
    return ready;
  }

  ipcMain.on('p2p:from-window', onFromWindow);

  return {
    ensure,

    /** Register the single handler for one message type from the window. */
    on(type, handler) {
      listeners.set(type, handler);
    },

    post(type, payload) {
      if (!window || window.isDestroyed()) return;
      window.webContents.send('p2p:to-window', { type, payload });
    },

    destroy() {
      ipcMain.removeListener('p2p:from-window', onFromWindow);
      listeners.clear();
      if (window && !window.isDestroyed()) window.destroy();
      window = null;
      ready = null;
    }
  };
}

module.exports = { createPunchWindow };
