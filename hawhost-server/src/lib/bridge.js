// The one place the UI talks to Electron. In a plain browser (vite dev
// preview) a demo backend stands in so the screens can be designed and checked.

let bridgePromise = null;

export function getBridge() {
  if (!bridgePromise) {
    bridgePromise = window.hawhost
      ? Promise.resolve(window.hawhost)
      : import.meta.env.DEV
        ? import('./demo-bridge.js').then((m) => m.createDemoBridge())
        : Promise.reject(new Error('HawHost must be opened as the desktop app.'));
  }
  return bridgePromise;
}

export async function api(method, path, body) {
  const b = await getBridge();
  return b.api(method, path, body);
}

export async function bridge() {
  return getBridge();
}

export const isDemo = () => !window.hawhost;
