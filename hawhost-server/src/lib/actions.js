import { useCallback, useState } from 'react';
import { bridge, api } from './bridge';
import { useHawhost, useToast, wantedFirewallPorts } from './store';

/** Open the selected ports in Windows Firewall (one administrator prompt). */
export function useFirewallApply() {
  const { data, refreshFirewall } = useHawhost();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const apply = useCallback(async (portsOverride) => {
    const ports = portsOverride || wantedFirewallPorts(data);
    if (!ports.length) return;
    setBusy(true);
    try {
      const b = await bridge();
      await b.firewall.apply(ports);
      toast.show(`Windows Firewall now allows incoming TCP on ${ports.join(', ')}.`, 'success');
    } catch (err) {
      toast.show(err.message, 'error');
    } finally {
      setBusy(false);
      refreshFirewall();
    }
  }, [data, refreshFirewall, toast]);
  return [apply, busy];
}

export function useDiagnose() {
  const { setDiagnosis, diagnosis } = useHawhost();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = useCallback(async (publicHost) => {
    setBusy(true);
    try {
      const d = await api('POST', '/api/diagnose', { publicHost: publicHost || undefined });
      setDiagnosis(d);
      return d;
    } catch (err) {
      toast.show(err.message, 'error');
      return null;
    } finally {
      setBusy(false);
    }
  }, [setDiagnosis, toast]);
  return [run, busy, diagnosis];
}
