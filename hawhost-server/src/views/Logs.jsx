import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  Download, Trash2
} from 'lucide-react';

import { useHawhost } from '../lib/store';
import { bytes, number, time } from '../lib/format';
import { bridge } from '../lib/bridge';
import {
  PageHeader, Card, Button, TextInput, Select, Toggle, cx
} from '../components/ui';

export default function Logs() {
  const { data, access, system, setAccess, setSystem } = useHawhost();
  const [tab, setTab] = useState('access'); // 'access' | 'system'
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [levelFilter, setLevelFilter] = useState('all');
  const [autoScroll, setAutoScroll] = useState(true);

  const listBottomRef = useRef(null);

  useEffect(() => {
    if (autoScroll && listBottomRef.current) {
      listBottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [access, system, autoScroll]);

  // Filter access logs
  const filteredAccess = useMemo(() => {
    let list = access || [];
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((l) =>
        (l.url && l.url.toLowerCase().includes(q)) ||
        (l.ip && l.ip.includes(q)) ||
        (l.host && l.host.toLowerCase().includes(q)) ||
        (l.site && l.site.toLowerCase().includes(q))
      );
    }
    if (statusFilter !== 'all') {
      if (statusFilter === '2xx') list = list.filter((l) => l.status >= 200 && l.status < 300);
      else if (statusFilter === '3xx') list = list.filter((l) => l.status >= 300 && l.status < 400);
      else if (statusFilter === '4xx') list = list.filter((l) => l.status >= 400 && l.status < 500);
      else if (statusFilter === '5xx') list = list.filter((l) => l.status >= 500);
    }
    return list;
  }, [access, search, statusFilter]);

  // Filter system logs
  const filteredSystem = useMemo(() => {
    let list = system || [];
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((l) =>
        (l.message && l.message.toLowerCase().includes(q)) ||
        (l.source && l.source.toLowerCase().includes(q))
      );
    }
    if (levelFilter !== 'all') {
      list = list.filter((l) => l.level === levelFilter);
    }
    return list;
  }, [system, search, levelFilter]);

  // After every hook: returning earlier changed the hook count between renders,
  // and React throws when the data first arrives.
  if (!data) return null;
  const stats = (data.server && data.server.stats) || {
    requests: 0, bytes: 0, activeConnections: 0,
    status2xx: 0, status3xx: 0, status4xx: 0, status5xx: 0
  };

  const handleClear = () => {
    if (tab === 'access') setAccess([]);
    else setSystem([]);
  };

  const handleExport = async () => {
    const b = await bridge();
    const text = tab === 'access'
      ? filteredAccess.map((l) => `[${l.t}] ${l.ip} "${l.method} ${l.url}" ${l.status} ${l.bytes || 0}B "${l.host || ''}" (${l.ms || 0}ms)`).join('\n')
      : filteredSystem.map((l) => `[${l.t}] [${l.level.toUpperCase()}] [${l.source}] ${l.message}`).join('\n');

    await b.saveText({
      title: `Export HawHost ${tab === 'access' ? 'Access' : 'System'} Logs`,
      defaultPath: `hawhost-${tab}-logs-${new Date().toISOString().slice(0, 10)}.log`,
      content: text
    });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Logs & Real-Time Traffic"
        description="Monitor live HTTP web requests, visitor traffic, error responses, and HawHost background daemon operations."
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              icon={Download}
              onClick={handleExport}
            >
              Export Logs
            </Button>
            <Button
              variant="secondary"
              icon={Trash2}
              onClick={handleClear}
            >
              Clear View
            </Button>
          </div>
        }
      />

      {/* Traffic Stats Bar */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        <div className="rounded-xl border border-white/[0.07] bg-ink-850 p-3.5">
          <div className="text-[11.5px] font-medium text-ink-400 uppercase tracking-wider">Total Requests</div>
          <div className="text-[18px] font-semibold text-white mt-1 mono">{number(stats.requests)}</div>
        </div>

        <div className="rounded-xl border border-white/[0.07] bg-ink-850 p-3.5">
          <div className="text-[11.5px] font-medium text-ink-400 uppercase tracking-wider">Data Served</div>
          <div className="text-[18px] font-semibold text-white mt-1 mono">{bytes(stats.bytes)}</div>
        </div>

        <div className="rounded-xl border border-white/[0.07] bg-ink-850 p-3.5">
          <div className="text-[11.5px] font-medium text-ink-400 uppercase tracking-wider">2xx Success</div>
          <div className="text-[18px] font-semibold text-emerald-400 mt-1 mono">{number(stats.status2xx)}</div>
        </div>

        <div className="rounded-xl border border-white/[0.07] bg-ink-850 p-3.5">
          <div className="text-[11.5px] font-medium text-ink-400 uppercase tracking-wider">3xx Redirects</div>
          <div className="text-[18px] font-semibold text-sky-400 mt-1 mono">{number(stats.status3xx)}</div>
        </div>

        <div className="rounded-xl border border-white/[0.07] bg-ink-850 p-3.5">
          <div className="text-[11.5px] font-medium text-ink-400 uppercase tracking-wider">4xx Client Errors</div>
          <div className="text-[18px] font-semibold text-amber-400 mt-1 mono">{number(stats.status4xx)}</div>
        </div>

        <div className="rounded-xl border border-white/[0.07] bg-ink-850 p-3.5">
          <div className="text-[11.5px] font-medium text-ink-400 uppercase tracking-wider">5xx Server Errors</div>
          <div className="text-[18px] font-semibold text-rose-400 mt-1 mono">{number(stats.status5xx)}</div>
        </div>
      </div>

      {/* Main Logs Card */}
      <Card
        title={
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setTab('access')}
              className={cx(
                'text-[14px] font-semibold transition-colors pb-1 border-b-2',
                tab === 'access' ? 'text-white border-brand-400' : 'text-ink-400 border-transparent hover:text-ink-200'
              )}
            >
              Access Logs ({filteredAccess.length})
            </button>
            <button
              type="button"
              onClick={() => setTab('system')}
              className={cx(
                'text-[14px] font-semibold transition-colors pb-1 border-b-2',
                tab === 'system' ? 'text-white border-brand-400' : 'text-ink-400 border-transparent hover:text-ink-200'
              )}
            >
              System Logs ({filteredSystem.length})
            </button>
          </div>
        }
        actions={
          <div className="flex items-center gap-3">
            <div className="w-56">
              <TextInput
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={tab === 'access' ? 'Filter URL, IP, host…' : 'Filter message…'}
                className="h-8 text-[12.5px]"
              />
            </div>

            {tab === 'access' ? (
              <Select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="h-8 text-[12px] w-28"
              >
                <option value="all">All Status</option>
                <option value="2xx">2xx OK</option>
                <option value="3xx">3xx Redirect</option>
                <option value="4xx">4xx Error</option>
                <option value="5xx">5xx Error</option>
              </Select>
            ) : (
              <Select
                value={levelFilter}
                onChange={(e) => setLevelFilter(e.target.value)}
                className="h-8 text-[12px] w-28"
              >
                <option value="all">All Levels</option>
                <option value="info">Info</option>
                <option value="warn">Warnings</option>
                <option value="error">Errors</option>
              </Select>
            )}

            <Toggle
              checked={autoScroll}
              onChange={setAutoScroll}
              label="Auto-scroll"
            />
          </div>
        }
      >
        <div className="h-[460px] overflow-y-auto border border-white/[0.07] rounded-lg bg-ink-950/80 p-2 font-mono text-[12px]">
          {tab === 'access' ? (
            filteredAccess.length === 0 ? (
              <div className="h-full grid place-items-center text-ink-500 font-sans">
                No access log entries yet. Make an HTTP request to your server to see incoming traffic.
              </div>
            ) : (
              <div className="space-y-1">
                {filteredAccess.map((entry, idx) => {
                  const s = entry.status;
                  const statusTone = s >= 200 && s < 300 ? 'text-emerald-400'
                    : s >= 300 && s < 400 ? 'text-sky-400'
                      : s >= 400 && s < 500 ? 'text-amber-400' : 'text-rose-400';

                  const methodBg = entry.method === 'GET' ? 'bg-emerald-500/15 text-emerald-300'
                    : entry.method === 'POST' ? 'bg-sky-500/15 text-sky-300'
                      : entry.method === 'DELETE' ? 'bg-rose-500/15 text-rose-300'
                        : 'bg-amber-500/15 text-amber-300';

                  return (
                    <div
                      key={idx}
                      className="flex items-center gap-2.5 py-1 px-2 rounded hover:bg-white/[0.04] transition-colors"
                    >
                      <span className="text-ink-500 shrink-0 text-[11px]">{time(entry.t)}</span>
                      <span className={cx('px-1.5 py-0.5 rounded text-[10.5px] font-bold shrink-0', methodBg)}>
                        {entry.method}
                      </span>
                      <span className={cx('font-bold shrink-0 w-8', statusTone)}>{entry.status}</span>
                      <span className="text-ink-200 truncate flex-1" title={entry.url}>{entry.url}</span>
                      {entry.site && (
                        <span className="text-[11px] text-ink-400 px-1.5 py-0.5 rounded bg-white/[0.04] truncate max-w-xs shrink-0">
                          {entry.site}
                        </span>
                      )}
                      <span className="text-ink-400 shrink-0 text-[11.5px]">{entry.ip}</span>
                      {entry.ms !== undefined && (
                        <span className="text-ink-500 shrink-0 text-[11px] w-12 text-right">{entry.ms}ms</span>
                      )}
                      <span className="text-ink-500 shrink-0 text-[11px] w-14 text-right">{bytes(entry.bytes || 0)}</span>
                    </div>
                  );
                })}
                <div ref={listBottomRef} />
              </div>
            )
          ) : (
            filteredSystem.length === 0 ? (
              <div className="h-full grid place-items-center text-ink-500 font-sans">
                No system events recorded.
              </div>
            ) : (
              <div className="space-y-1">
                {filteredSystem.map((entry, idx) => {
                  const lvl = entry.level;
                  const lvlColor = lvl === 'error' ? 'text-rose-400 bg-rose-500/15 border-rose-400/20'
                    : lvl === 'warn' ? 'text-amber-400 bg-amber-500/15 border-amber-400/20'
                      : 'text-sky-300 bg-sky-500/15 border-sky-400/20';

                  return (
                    <div
                      key={idx}
                      className="flex items-start gap-2.5 py-1 px-2 rounded hover:bg-white/[0.04] transition-colors leading-relaxed"
                    >
                      <span className="text-ink-500 shrink-0 text-[11px] mt-0.5">{time(entry.t)}</span>
                      <span className={cx('px-1.5 py-0.2 rounded text-[10px] uppercase font-bold shrink-0 border', lvlColor)}>
                        {entry.level}
                      </span>
                      <span className="text-ink-400 shrink-0 text-[11px] font-semibold mt-0.5">[{entry.source}]</span>
                      <span className="text-ink-200 flex-1 break-words">{entry.message}</span>
                    </div>
                  );
                })}
                <div ref={listBottomRef} />
              </div>
            )
          )}
        </div>
      </Card>
    </div>
  );
}
