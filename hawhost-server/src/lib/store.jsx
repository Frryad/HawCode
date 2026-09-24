import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api, bridge } from './bridge';

const Ctx = createContext(null);
const ToastCtx = createContext(null);

const MAX_LOG = 600;

export function HawhostProvider({ children }) {
  const [data, setData] = useState(null);
  const [appInfo, setAppInfo] = useState(null);
  const [connected, setConnected] = useState(false);
  const [fatal, setFatal] = useState(null);
  const [access, setAccess] = useState([]);
  const [system, setSystem] = useState([]);
  const [firewall, setFirewall] = useState(null);
  const [firewallBusy, setFirewallBusy] = useState(false);
  const [diagnosis, setDiagnosis] = useState(null);
  const toast = useContext(ToastCtx);

  const refresh = useCallback(async () => {
    const s = await api('GET', '/api/state');
    setData(s);
    setConnected(true);
    setFatal(null);
    return s;
  }, []);

  const refreshFirewall = useCallback(async () => {
    const b = await bridge();
    setFirewallBusy(true);
    try {
      setFirewall(await b.firewall.status());
    } catch (err) {
      setFirewall({ supported: true, error: err.message, rules: [], openPorts: [] });
    } finally {
      setFirewallBusy(false);
    }
  }, []);

  useEffect(() => {
    const unsubs = [];
    let alive = true;

    const onEvent = ({ type, data: d }) => {
      setData((prev) => {
        if (!prev) return prev;
        switch (type) {
          case 'server': return { ...prev, server: d };
          case 'stats': return { ...prev, server: { ...prev.server, stats: d } };
          case 'apps': return { ...prev, server: { ...prev.server, apps: d } };
          case 'config': return { ...prev, config: d };
          case 'ddns': return { ...prev, ddns: d };
          case 'upnp': return { ...prev, upnp: { ...prev.upnp, forwarded: d } };
          default: return prev;
        }
      });
      if (type === 'access') setAccess((prev) => [...prev, ...d].slice(-MAX_LOG));
      if (type === 'system') setSystem((prev) => [...prev, d].slice(-MAX_LOG));
    };

    (async () => {
      try {
        const b = await bridge();
        setAppInfo(await b.appInfo());
        unsubs.push(b.onEvent(onEvent));
        unsubs.push(b.onConnection((c) => {
          setConnected(c);
          if (c) refresh().catch(() => {});
        }));
        unsubs.push(b.onError((msg) => setFatal(msg)));
        await b.ensureDaemon();
        if (!alive) return;
        await refresh();
        const [acc, sys] = await Promise.all([
          api('GET', '/api/logs?kind=access&limit=400'),
          api('GET', '/api/logs?kind=system&limit=400')
        ]);
        setAccess(acc);
        setSystem(sys);
        refreshFirewall();
      } catch (err) {
        setFatal(err.message);
      }
    })();

    return () => {
      alive = false;
      unsubs.forEach((u) => u && u());
    };
  }, [refresh, refreshFirewall]);

  /** API call with a toast on failure; returns undefined when it failed. */
  const call = useCallback(async (method, path, body, { success, quiet } = {}) => {
    try {
      const res = await api(method, path, body);
      if (success) toast.show(success, 'success');
      return res;
    } catch (err) {
      if (!quiet) toast.show(err.message, 'error');
      throw err;
    }
  }, [toast]);

  const value = useMemo(() => ({
    data,
    config: data && data.config,
    appInfo,
    connected,
    fatal,
    access,
    system,
    setAccess,
    setSystem,
    firewall,
    firewallBusy,
    refreshFirewall,
    diagnosis,
    setDiagnosis,
    refresh,
    call
  }), [data, appInfo, connected, fatal, access, system, firewall, firewallBusy, refreshFirewall, diagnosis, refresh, call]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useHawhost() {
  return useContext(Ctx);
}

// ------------------------------------------------------------------ toasts

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const idRef = useRef(0);

  const show = useCallback((message, kind = 'info', ms = 4500) => {
    const id = ++idRef.current;
    setToasts((t) => [...t, { id, message, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 8000 : ms);
  }, []);

  const dismiss = useCallback((id) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const value = useMemo(() => ({ show, dismiss, toasts }), [show, dismiss, toasts]);
  return <ToastCtx.Provider value={value}>{children}</ToastCtx.Provider>;
}

export function useToast() {
  return useContext(ToastCtx);
}

// ------------------------------------------------------------------ derived helpers

/** Ports HawHost should open in the firewall: listeners + extra firewall ports. */
export function wantedFirewallPorts(data) {
  if (!data) return [];
  const planned = (data.server.planned || []).map((l) => l.port);
  return [...new Set([...planned, ...(data.config.firewall.extraPorts || [])])].sort((a, b) => a - b);
}

export function useTick(ms = 1000) {
  const [, setN] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setN((n) => n + 1), ms);
    return () => clearInterval(t);
  }, [ms]);
}
