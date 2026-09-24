export function bytes(n) {
  if (!n) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${units[i]}`;
}

export function number(n) {
  return new Intl.NumberFormat().format(n || 0);
}

export function ago(iso) {
  if (!iso) return 'never';
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

export function duration(fromIso) {
  if (!fromIso) return '—';
  let s = Math.max(0, Math.floor((Date.now() - new Date(fromIso).getTime()) / 1000));
  const d = Math.floor(s / 86400); s -= d * 86400;
  const h = Math.floor(s / 3600); s -= h * 3600;
  const m = Math.floor(s / 60); s -= m * 60;
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${s}s`;
  return `${s}s`;
}

export function time(iso) {
  return iso ? new Date(iso).toLocaleTimeString() : '';
}

export function dateTime(iso) {
  return iso ? new Date(iso).toLocaleString() : '';
}

export function date(iso) {
  return iso ? new Date(iso).toLocaleDateString() : '';
}

/** "http://host" or "http://host:8080" */
export function url(host, port, tls = false) {
  const scheme = tls ? 'https' : 'http';
  const def = tls ? 443 : 80;
  return `${scheme}://${host}${port && port !== def ? `:${port}` : ''}/`;
}
