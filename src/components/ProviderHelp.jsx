import React, { useState } from 'react';
import { AlertTriangle, Copy, Check, RefreshCw, Loader2, Phone } from 'lucide-react';

const REQUEST_TEXT = 'Hello. Please give my internet line a public (real) IPv4 address and turn off '
  + 'CGNAT (carrier-grade NAT). I host a website on my own computer and people must be able '
  + 'to connect to it from the internet. If a public IPv4 is not possible, please enable IPv6 on my line.';

/**
 * What to do when the provider shares the public address (carrier NAT).
 *
 * Nothing on this computer can open a shared address, so this says exactly who
 * can (the provider), what to ask, and what to do afterwards. "Check again"
 * re-runs the traceroute, so the panel turns green by itself once the line has
 * a real address.
 */
/**
 * The provider's box in front of the Wi-Fi router, from the traceroute: the
 * second hop, when it is still a home-style private address (192.168.x or
 * 172.16-31.x). Anything further out belongs to the provider.
 */
function modemFromPath(reach) {
  const hops = (reach && reach.path && reach.path.hops) || [];
  const second = hops.find((entry) => entry.hop === 2);
  const address = second && second.address;
  return address && /^(192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(address) ? address : null;
}

export default function ProviderHelp({ reach, routerWanIp = null, modemUrl = null, onChecked }) {
  const [copied, setCopied] = useState(false);
  const [checking, setChecking] = useState(false);
  const [lastCheck, setLastCheck] = useState(null);

  const current = lastCheck || reach;
  const modem = modemFromPath(current);
  const modemLink = modemUrl || (modem ? `http://${modem}` : null);
  if (!current || current.canForward !== false) {
    return lastCheck ? (
      <div className="flex items-start gap-2 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/25 text-[11px] text-emerald-100">
        <Check size={15} className="text-emerald-400 flex-shrink-0 mt-0.5" />
        Your line now has its own public address ({lastCheck.label}). Friends on the internet can open your links.
      </div>
    ) : null;
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(REQUEST_TEXT);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // The text is on screen to copy by hand.
    }
  };

  const checkAgain = async () => {
    const api = window.electronAPI;
    if (!api || !api.networkCheck) return;
    setChecking(true);
    try {
      const result = await api.networkCheck({ fresh: true });
      setLastCheck(result);
      if (onChecked) onChecked(result);
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 space-y-2.5 text-[11px] text-rose-100 leading-relaxed">
      <div className="flex items-start gap-2">
        <AlertTriangle size={16} className="text-rose-400 flex-shrink-0 mt-0.5" />
        <div>
          <strong className="block text-rose-50 text-[12px]">
            Friends on the internet cannot connect yet: your provider shares your address
          </strong>
          {current.summary}
        </div>
      </div>

      <div className="pl-6 space-y-2">
        <div>
          <strong className="text-white">1. Call your internet provider</strong> and ask for this
          (it is the only fix; nothing on this PC or your routers can do it):
          <div className="mt-1.5 flex items-start gap-2 bg-[#0d1117] border border-white/10 rounded-lg p-2">
            <span className="flex-1 text-slate-200 select-text">{REQUEST_TEXT}</span>
            <button onClick={copy} className="text-slate-400 hover:text-white flex-shrink-0" title="Copy">
              {copied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
            </button>
          </div>
        </div>
        <div>
          <strong className="text-white">2. After they change it</strong>
          {modemLink ? (
            <>
              , open your provider&rsquo;s box at <span className="font-mono text-white">{modemLink}</span>, sign in, and
              set <strong>DMZ host</strong> to{' '}
              {routerWanIp
                ? <span className="font-mono text-white">{routerWanIp}</span>
                : <>your Wi-Fi router&rsquo;s WAN IP (on a TP-Link: <strong>Status → WAN → IP Address</strong>)</>}
              {' '}(or put that box in bridge mode).
            </>
          ) : (
            <>, forward the port on your router.</>
          )}
          {' '}Then forward the port on your own router, or turn on UPnP there and HawCode opens it for you.
        </div>
        <div className="flex items-center gap-2">
          <strong className="text-white">3.</strong>
          <button
            onClick={checkAgain}
            disabled={checking}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-white/10 hover:bg-white/20 disabled:opacity-50 text-white font-semibold"
          >
            {checking ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            Check again
          </button>
          <span className="text-rose-200/80 flex items-center gap-1">
            <Phone size={11} /> Until then, everyone on your Wi-Fi can open the links.
          </span>
        </div>
      </div>
    </div>
  );
}
