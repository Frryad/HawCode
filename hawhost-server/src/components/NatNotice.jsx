import React from 'react';
import { Callout, Button } from './ui';

/** Explains double NAT / CGNAT when the router's own WAN address is not public. */
export default function NatNotice({ data, onGuide, compact }) {
  const { natWarning, routerWanIp, publicIp } = data.ddns;
  if (!natWarning) return null;
  const action = onGuide ? <Button size="sm" onClick={onGuide}>How to fix</Button> : null;

  if (natWarning === 'double-nat') {
    return (
      <Callout tone="warn" title="Two routers between this PC and the internet (double NAT)" action={action}>
        Your router reports its internet-side address as <span className="mono">{routerWanIp}</span>, which is a private address — so another
        device (usually the ISP modem) sits in front of it. Forwarding ports on your router alone is not enough{compact ? '.' : (
          <>: forward the same ports on the modem to <span className="mono">{routerWanIp}</span> as well, or put the modem in bridge mode / set its DMZ to <span className="mono">{routerWanIp}</span>.</>
        )}
      </Callout>
    );
  }
  if (natWarning === 'cgnat') {
    return (
      <Callout tone="error" title="Your ISP uses carrier-grade NAT (CGNAT)" action={action}>
        Your router's internet address <span className="mono">{routerWanIp}</span> is in the 100.64.0.0/10 range your ISP shares between customers.
        Incoming connections cannot reach you until the ISP gives you a public IPv4 address — ask them for one (often free, sometimes called a
        "public IP" or "static IP" add-on).
      </Callout>
    );
  }
  return (
    <Callout tone="warn" title="Your router and your DDNS provider see different addresses" action={action}>
      The router says <span className="mono">{routerWanIp}</span>, but the internet sees <span className="mono">{publicIp}</span>. There is likely
      another router, a VPN or carrier-grade NAT in between.
    </Callout>
  );
}
