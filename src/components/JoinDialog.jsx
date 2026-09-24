import React, { useState } from 'react';
import {
  Monitor, Lock, Users, RefreshCw, Link2, Loader2, X, ArrowRight, Radar,
  Ticket, Copy, Check, Send
} from 'lucide-react';

/**
 * Joining a workspace. Nearby hosts arrive over UDP discovery and appear here
 * automatically, so the usual path is one click; the manual field stays for
 * online hosts, which cannot be discovered on the LAN.
 */
export default function JoinDialog({ discovered, onJoin, onJoinInvite, onCancel }) {
  const [url, setUrl] = useState('');
  const [code, setCode] = useState('');
  const [needsCode, setNeedsCode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [invite, setInvite] = useState('');
  const [reply, setReply] = useState(null);
  const [copied, setCopied] = useState(false);

  /**
   * Joining from an invite code is a two-way exchange: we answer, and the host
   * has to paste our answer back before anything connects. So this leaves the
   * dialog open on the reply instead of closing on success.
   */
  const useInvite = async () => {
    if (!invite.trim()) return;
    setBusy(true);
    setError('');
    try {
      const result = await onJoinInvite({ code: invite.trim() });
      if (result && result.error) setError(result.error);
      else if (result && result.answerCode) setReply(result.answerCode);
    } catch (caught) {
      setError(caught.message || 'Could not use that invite code');
    }
    setBusy(false);
  };

  const copyReply = async () => {
    try {
      await navigator.clipboard.writeText(reply);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // The textarea is selectable; copying by hand still works.
    }
  };

  // Picking or typing a different host invalidates whatever code was entered
  // for the last one, so the reset happens where the address actually changes.
  const changeUrl = (next) => {
    setUrl(next);
    setNeedsCode(false);
    setCode('');
    setError('');
  };

  const attempt = async (targetUrl, targetCode) => {
    if (!targetUrl) return;
    setBusy(true);
    setError('');
    try {
      const result = await onJoin({ url: targetUrl, code: targetCode || undefined });
      if (result && result.error === 'code-required') {
        setNeedsCode(true);
        setError('This workspace is protected. Enter its room code.');
      } else if (result && result.error === 'bad-code') {
        setNeedsCode(true);
        setError('That room code is not correct.');
      } else if (result && result.error) {
        setError(result.error);
      }
      // A successful join unmounts this dialog from the parent.
    } catch (caught) {
      setError(caught.message || 'Could not connect');
    }
    setBusy(false);
  };

  const pickHost = (peer) => {
    changeUrl(peer.url);
    if (peer.requiresCode) {
      setNeedsCode(true);
      setError('This workspace is protected. Enter its room code.');
    } else {
      attempt(peer.url, '');
    }
  };

  if (reply) {
    return (
      <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
        <div className="bg-[#161b22] border border-white/10 rounded-2xl w-full max-w-lg shadow-2xl p-6 space-y-4">
          <div className="flex items-start gap-3">
            <div className="flex-1">
              <h3 className="text-lg font-bold text-white">Send this reply code back</h3>
              <p className="text-xs text-slate-400 mt-0.5">
                The folder connects as soon as the other computer pastes it in.
              </p>
            </div>
            <button onClick={onCancel} className="text-slate-500 hover:text-white transition-colors">
              <X size={18} />
            </button>
          </div>

          <textarea
            readOnly
            value={reply}
            onFocus={(event) => event.target.select()}
            className="w-full h-28 bg-[#0d1117] border border-white/10 rounded-lg px-3 py-2.5 text-[11px] text-emerald-300 font-mono break-all resize-none focus:outline-none focus:border-emerald-500/50"
          />

          <div className="flex gap-3">
            <button
              onClick={copyReply}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg bg-white/5 hover:bg-white/10 text-white text-sm font-medium transition-colors border border-white/10"
            >
              {copied ? <><Check size={15} className="text-emerald-400" />Copied</> : <><Copy size={15} />Copy reply code</>}
            </button>
            <button
              onClick={onCancel}
              className="flex-1 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold transition-colors"
            >
              Done
            </button>
          </div>

          <p className="text-[10px] text-slate-600 leading-relaxed">
            Send it the same way the invite reached you. Nothing is connected until they
            paste it, and the status bar will say when the folder is in step.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-[#161b22] border border-white/10 rounded-2xl w-full max-w-lg shadow-2xl max-h-[92vh] flex flex-col">
        <div className="flex items-start gap-3 p-6 pb-4 flex-shrink-0">
          <div className="flex-1">
            <h3 className="text-lg font-bold text-white">Join a workspace</h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Pick a computer on your network, or paste an address for an online host.
            </p>
          </div>
          <button onClick={onCancel} className="text-slate-500 hover:text-white transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="px-6 pb-6 overflow-y-auto custom-scrollbar space-y-4">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Radar size={13} className="text-emerald-400" />
              <span className="text-[10px] uppercase tracking-widest text-slate-400 font-bold">
                On your network
              </span>
              {discovered.length > 0 && (
                <span className="text-[10px] text-slate-600">{discovered.length} found</span>
              )}
            </div>

            {discovered.length === 0 ? (
              <div className="flex items-center gap-3 p-4 rounded-xl border border-dashed border-white/10 bg-white/[0.02]">
                <RefreshCw size={16} className="text-slate-600 animate-spin flex-shrink-0" style={{ animationDuration: '3s' }} />
                <div className="text-[11px] text-slate-500 leading-relaxed">
                  Looking for nearby workspaces… Make sure the other computer has started
                  hosting and is on the same Wi-Fi.
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                {discovered.map((peer) => (
                  <button
                    key={peer.id || peer.url}
                    onClick={() => pickHost(peer)}
                    disabled={busy}
                    className={`w-full flex items-center gap-3 p-3 rounded-xl border transition-all text-left disabled:opacity-50 ${
                      url === peer.url
                        ? 'border-indigo-500/60 bg-indigo-500/10'
                        : 'border-white/10 bg-white/[0.02] hover:border-white/25 hover:bg-white/[0.05]'
                    }`}
                  >
                    <div className="p-2 rounded-lg bg-blue-500/15 flex-shrink-0">
                      <Monitor size={16} className="text-blue-300" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-white truncate">
                          {peer.folderName || 'Workspace'}
                        </span>
                        {peer.requiresCode && <Lock size={11} className="text-amber-400 flex-shrink-0" />}
                      </div>
                      <div className="flex items-center gap-2 text-[10px] text-slate-500 mt-0.5">
                        <span className="truncate">{peer.hostName}</span>
                        <span className="text-slate-700">·</span>
                        <span className="font-mono truncate">{peer.url}</span>
                        {peer.peerCount > 0 && (
                          <>
                            <span className="text-slate-700">·</span>
                            <span className="flex items-center gap-1 flex-shrink-0">
                              <Users size={9} />{peer.peerCount}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                    <ArrowRight size={15} className="text-slate-600 flex-shrink-0" />
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center gap-3">
            <div className="h-px bg-white/10 flex-1" />
            <span className="text-[10px] uppercase tracking-widest text-slate-600 font-bold">or</span>
            <div className="h-px bg-white/10 flex-1" />
          </div>

          <div className="space-y-2.5">
            <div className="flex items-center gap-2 mb-1">
              <Ticket size={13} className="text-purple-300" />
              <span className="text-[10px] uppercase tracking-widest text-slate-400 font-bold">
                Paste an invite code
              </span>
            </div>
            <textarea
              placeholder="HAW1-…"
              value={invite}
              onChange={(event) => { setInvite(event.target.value); setError(''); }}
              className="w-full h-20 bg-[#0d1117] border border-white/10 rounded-lg px-3 py-2.5 text-[11px] text-white font-mono break-all resize-none focus:outline-none focus:border-purple-500 transition-colors placeholder:text-slate-600"
            />
            <button
              onClick={useInvite}
              disabled={busy || !invite.trim()}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-white text-sm font-semibold transition-colors"
            >
              {busy ? <><Loader2 size={15} className="animate-spin" />Working out your address…</> : <><Send size={15} />Use this invite</>}
            </button>
            <p className="text-[10px] text-slate-600 leading-relaxed">
              For a host who is not on your network. You will get a reply code to send
              back to them — the connection goes straight between the two computers.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <div className="h-px bg-white/10 flex-1" />
            <span className="text-[10px] uppercase tracking-widest text-slate-600 font-bold">or</span>
            <div className="h-px bg-white/10 flex-1" />
          </div>

          <div className="space-y-2.5">
            <div className="flex items-center gap-2 mb-1">
              <Link2 size={13} className="text-slate-400" />
              <span className="text-[10px] uppercase tracking-widest text-slate-400 font-bold">
                Enter an address
              </span>
            </div>
            <input
              type="text"
              placeholder="http://notes.box  or  http://192.168.1.20:3000  or  http://name.duckdns.org:3000"
              value={url}
              onChange={(event) => changeUrl(event.target.value)}
              className="w-full bg-[#0d1117] border border-white/10 rounded-lg px-4 py-2.5 text-sm text-white font-mono focus:outline-none focus:border-indigo-500 transition-colors placeholder:text-slate-600 placeholder:font-sans"
            />

            {needsCode && (
              <input
                type="text"
                placeholder="Room code"
                value={code}
                autoFocus
                maxLength={6}
                onChange={(event) => setCode(event.target.value.toUpperCase())}
                onKeyDown={(event) => { if (event.key === 'Enter') attempt(url.trim(), code); }}
                className="w-full bg-[#0d1117] border border-amber-500/40 rounded-lg px-4 py-2.5 text-center text-lg text-amber-200 font-bold tracking-[0.4em] focus:outline-none focus:border-amber-400 transition-colors placeholder:text-slate-600 placeholder:text-sm placeholder:tracking-normal placeholder:font-normal"
              />
            )}

            {error && <p className="text-rose-400 text-[11px]">{error}</p>}
          </div>

          <div className="flex gap-3 pt-1">
            <button
              onClick={onCancel}
              className="flex-1 py-2.5 rounded-lg bg-white/5 hover:bg-white/10 text-white text-sm font-medium transition-colors border border-white/10"
            >
              Cancel
            </button>
            <button
              onClick={() => attempt(url.trim(), code)}
              disabled={busy || !url.trim()}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-sm font-semibold transition-colors"
            >
              {busy ? <><Loader2 size={15} className="animate-spin" />Connecting…</> : 'Connect'}
            </button>
          </div>

          <p className="text-[10px] text-slate-600 leading-relaxed">
            You will be asked to choose a folder on this computer. HawCode keeps it in step
            with the host — files already there are merged, not overwritten.
          </p>
        </div>
      </div>
    </div>
  );
}
