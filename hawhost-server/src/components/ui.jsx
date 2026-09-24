import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Check, Copy, Loader2, X, AlertTriangle, Info, CheckCircle2, XCircle, ExternalLink } from 'lucide-react';
import { bridge } from '../lib/bridge';
import { useToast } from '../lib/store';

export function cx(...parts) {
  return parts.filter(Boolean).join(' ');
}

// ------------------------------------------------------------------ layout

export function PageHeader({ title, description, actions }) {
  return (
    <div className="flex items-end justify-between gap-6 mb-6">
      <div className="min-w-0">
        <h1 className="text-[22px] font-semibold tracking-tight text-white">{title}</h1>
        {description && <p className="text-ink-400 mt-1 max-w-3xl leading-relaxed">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}

export function Card({ title, subtitle, icon: Icon, actions, children, className, bodyClass, id }) {
  return (
    <section id={id} className={cx('rounded-xl border border-white/[0.07] bg-ink-850', className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-4 px-5 pt-4 pb-3">
          <div className="flex items-center gap-2.5 min-w-0">
            {Icon && <Icon size={16} className="text-ink-400 shrink-0" />}
            <div className="min-w-0">
              <h2 className="text-[14px] font-semibold text-white">{title}</h2>
              {subtitle && <p className="text-ink-400 text-[12.5px] mt-0.5">{subtitle}</p>}
            </div>
          </div>
          {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
        </header>
      )}
      <div className={cx('px-5 pb-5', !title && !actions && 'pt-5', bodyClass)}>{children}</div>
    </section>
  );
}

// ------------------------------------------------------------------ controls

const BTN = {
  primary: 'bg-brand-500 hover:bg-brand-400 text-white shadow-sm shadow-brand-600/30',
  secondary: 'bg-white/[0.06] hover:bg-white/[0.1] text-ink-100 border border-white/[0.08]',
  ghost: 'hover:bg-white/[0.06] text-ink-300 hover:text-white',
  danger: 'bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-400/20',
  success: 'bg-emerald-500 hover:bg-emerald-400 text-white'
};

export function Button({ variant = 'secondary', size = 'md', icon: Icon, loading, className, children, disabled, ...rest }) {
  return (
    <button
      type="button"
      disabled={disabled || loading}
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors whitespace-nowrap',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        size === 'sm' ? 'h-7 px-2.5 text-[12.5px]' : 'h-9 px-3.5',
        BTN[variant],
        className
      )}
      {...rest}
    >
      {loading ? <Loader2 size={size === 'sm' ? 13 : 15} className="spin" /> : Icon && <Icon size={size === 'sm' ? 13 : 15} />}
      {children}
    </button>
  );
}

export function IconButton({ icon: Icon, title, className, ...rest }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      className={cx('inline-flex items-center justify-center w-8 h-8 rounded-lg text-ink-400 hover:text-white hover:bg-white/[0.07] transition-colors disabled:opacity-40', className)}
      {...rest}
    >
      <Icon size={15} />
    </button>
  );
}

const TONES = {
  neutral: 'bg-white/[0.06] text-ink-300 border-white/[0.08]',
  green: 'bg-emerald-400/10 text-emerald-300 border-emerald-400/20',
  amber: 'bg-amber-400/10 text-amber-300 border-amber-400/20',
  red: 'bg-rose-400/10 text-rose-300 border-rose-400/20',
  blue: 'bg-sky-400/10 text-sky-300 border-sky-400/20',
  violet: 'bg-brand-500/15 text-brand-400 border-brand-400/25'
};

export function Badge({ tone = 'neutral', children, className, title }) {
  return (
    <span title={title} className={cx('inline-flex items-center gap-1 h-[22px] px-2 rounded-md border text-[11.5px] font-medium whitespace-nowrap', TONES[tone], className)}>
      {children}
    </span>
  );
}

const DOTS = { green: 'bg-emerald-400', amber: 'bg-amber-400', red: 'bg-rose-400', neutral: 'bg-ink-500', blue: 'bg-sky-400' };

export function Dot({ tone = 'neutral', pulse }) {
  return <span className={cx('inline-block w-2 h-2 rounded-full shrink-0', DOTS[tone], pulse && 'pulse-dot')} />;
}

export function Field({ label, hint, error, children, className }) {
  return (
    <label className={cx('block', className)}>
      {label && <span className="block text-[12.5px] font-medium text-ink-200 mb-1.5">{label}</span>}
      {children}
      {error ? <span className="block text-[12px] text-rose-300 mt-1.5">{error}</span>
        : hint && <span className="block text-[12px] text-ink-400 mt-1.5 leading-relaxed">{hint}</span>}
    </label>
  );
}

const INPUT = 'w-full h-9 px-3 rounded-lg bg-ink-950/70 border border-white/[0.09] text-ink-100 placeholder:text-ink-500 focus:border-brand-400/70 focus:outline-none transition-colors disabled:opacity-60';

export const TextInput = React.forwardRef(function TextInput({ className, mono, ...rest }, ref) {
  return <input ref={ref} className={cx(INPUT, mono && 'mono', className)} spellCheck={false} {...rest} />;
});

export function TextArea({ className, mono, ...rest }) {
  return <textarea className={cx(INPUT, 'h-auto py-2 leading-relaxed', mono && 'mono', className)} spellCheck={false} {...rest} />;
}

export function Select({ className, children, ...rest }) {
  return (
    <select className={cx(INPUT, 'pr-8 appearance-none bg-no-repeat', className)} style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2712%27 height=%2712%27 fill=%27none%27 stroke=%27%237a869e%27 stroke-width=%272%27%3E%3Cpath d=%27M3 4.5 6 7.5 9 4.5%27/%3E%3C/svg%3E")', backgroundPosition: 'right 10px center' }} {...rest}>
      {children}
    </select>
  );
}

export function Toggle({ checked, onChange, label, description, disabled }) {
  return (
    <label className={cx('flex items-start gap-3 select-none', disabled ? 'opacity-50' : 'cursor-pointer')}>
      <button
        type="button"
        role="switch"
        aria-checked={Boolean(checked)}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx('relative mt-0.5 w-9 h-5 rounded-full shrink-0 transition-colors', checked ? 'bg-brand-500' : 'bg-ink-600')}
      >
        <span className={cx('absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all', checked ? 'left-[18px]' : 'left-0.5')} />
      </button>
      {(label || description) && (
        <span className="min-w-0">
          {label && <span className="block text-ink-100 font-medium">{label}</span>}
          {description && <span className="block text-ink-400 text-[12.5px] mt-0.5 leading-relaxed">{description}</span>}
        </span>
      )}
    </label>
  );
}

export function Segmented({ options, value, onChange }) {
  return (
    <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map((o) => {
        const active = o.value === value;
        const Icon = o.icon;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={cx(
              'text-left rounded-lg border px-3 py-2.5 transition-colors',
              active ? 'border-brand-400/60 bg-brand-500/10' : 'border-white/[0.08] bg-ink-950/40 hover:border-white/[0.16]'
            )}
          >
            <span className="flex items-center gap-2 font-medium text-ink-100">
              {Icon && <Icon size={15} className={active ? 'text-brand-400' : 'text-ink-400'} />}
              {o.label}
            </span>
            {o.description && <span className="block text-[12px] text-ink-400 mt-1 leading-snug">{o.description}</span>}
          </button>
        );
      })}
    </div>
  );
}

export function Spinner({ size = 16, className }) {
  return <Loader2 size={size} className={cx('spin text-ink-400', className)} />;
}

const CALLOUT = {
  info: { cls: 'border-sky-400/20 bg-sky-400/[0.06] text-sky-100', icon: Info, iconCls: 'text-sky-300' },
  warn: { cls: 'border-amber-400/25 bg-amber-400/[0.07] text-amber-50', icon: AlertTriangle, iconCls: 'text-amber-300' },
  error: { cls: 'border-rose-400/25 bg-rose-400/[0.07] text-rose-50', icon: XCircle, iconCls: 'text-rose-300' },
  success: { cls: 'border-emerald-400/20 bg-emerald-400/[0.06] text-emerald-50', icon: CheckCircle2, iconCls: 'text-emerald-300' }
};

export function Callout({ tone = 'info', title, children, action, className }) {
  const c = CALLOUT[tone];
  const Icon = c.icon;
  return (
    <div className={cx('flex gap-3 rounded-lg border px-4 py-3', c.cls, className)}>
      <Icon size={17} className={cx('shrink-0 mt-0.5', c.iconCls)} />
      <div className="min-w-0 flex-1 leading-relaxed">
        {title && <div className="font-semibold mb-0.5">{title}</div>}
        <div className="text-[13px] opacity-90">{children}</div>
      </div>
      {action && <div className="shrink-0 self-center">{action}</div>}
    </div>
  );
}

export function Empty({ icon: Icon, title, children, action }) {
  return (
    <div className="flex flex-col items-center text-center py-10 px-6">
      {Icon && <div className="w-11 h-11 rounded-xl bg-white/[0.05] grid place-items-center mb-3"><Icon size={20} className="text-ink-400" /></div>}
      <div className="font-semibold text-white">{title}</div>
      {children && <p className="text-ink-400 mt-1 max-w-md leading-relaxed">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

// ------------------------------------------------------------------ clipboard & links

export function useCopy() {
  const toast = useToast();
  return useCallback(async (text, label = 'Copied') => {
    const b = await bridge();
    await b.copy(text);
    toast.show(label, 'success', 1600);
  }, [toast]);
}

export function CopyText({ value, className, mono = true, children }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    const b = await bridge();
    await b.copy(value);
    setDone(true);
    setTimeout(() => setDone(false), 1400);
  };
  return (
    <span className={cx('inline-flex items-center gap-1.5 min-w-0', className)}>
      <span className={cx('truncate', mono && 'mono')}>{children || value}</span>
      <button type="button" onClick={copy} title="Copy" className="text-ink-500 hover:text-white shrink-0">
        {done ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
      </button>
    </span>
  );
}

export function ExtLink({ href, children, className }) {
  return (
    <button
      type="button"
      onClick={async () => (await bridge()).openExternal(href)}
      className={cx('inline-flex items-center gap-1 text-brand-400 hover:text-brand-300 hover:underline underline-offset-2', className)}
    >
      {children}
      <ExternalLink size={12} />
    </button>
  );
}

// ------------------------------------------------------------------ modal & confirm

export function Modal({ open, title, subtitle, onClose, children, footer, width = 640 }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && onClose && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-6 bg-black/60 backdrop-blur-[2px]" onMouseDown={(e) => e.target === e.currentTarget && onClose && onClose()}>
      <div className="fade-in w-full max-h-full flex flex-col rounded-xl border border-white/10 bg-ink-850 shadow-2xl shadow-black/60" style={{ maxWidth: width }}>
        <header className="flex items-start justify-between gap-4 px-6 pt-5 pb-4 border-b border-white/[0.06]">
          <div>
            <h2 className="text-[16px] font-semibold text-white">{title}</h2>
            {subtitle && <p className="text-ink-400 mt-0.5 text-[12.5px]">{subtitle}</p>}
          </div>
          {onClose && <IconButton icon={X} title="Close" onClick={onClose} />}
        </header>
        <div className="px-6 py-5 overflow-y-auto">{children}</div>
        {footer && <footer className="flex justify-end gap-2 px-6 py-4 border-t border-white/[0.06]">{footer}</footer>}
      </div>
    </div>
  );
}

const ConfirmCtx = createContext(null);

export function ConfirmProvider({ children }) {
  const [state, setState] = useState(null);
  const resolver = useRef(null);
  const confirm = useCallback((opts) => new Promise((resolve) => {
    resolver.current = resolve;
    setState(opts);
  }), []);
  const close = (v) => {
    setState(null);
    if (resolver.current) resolver.current(v);
  };
  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      <Modal
        open={Boolean(state)}
        title={state && state.title}
        onClose={() => close(false)}
        width={460}
        footer={(
          <>
            <Button onClick={() => close(false)}>Cancel</Button>
            <Button variant={state && state.danger ? 'danger' : 'primary'} onClick={() => close(true)}>{(state && state.confirmLabel) || 'Continue'}</Button>
          </>
        )}
      >
        <div className="text-ink-300 leading-relaxed">{state && state.message}</div>
      </Modal>
    </ConfirmCtx.Provider>
  );
}

export function useConfirm() {
  return useContext(ConfirmCtx);
}

export function Toasts() {
  const { toasts, dismiss } = useToast();
  return (
    <div className="fixed bottom-5 right-5 z-[60] flex flex-col gap-2 w-[380px]">
      {toasts.map((t) => (
        <div key={t.id} className={cx(
          'fade-in flex items-start gap-2.5 rounded-lg border px-3.5 py-3 shadow-xl shadow-black/40 bg-ink-800',
          t.kind === 'error' ? 'border-rose-400/30' : t.kind === 'success' ? 'border-emerald-400/25' : 'border-white/10'
        )}>
          {t.kind === 'error' ? <XCircle size={16} className="text-rose-300 mt-0.5 shrink-0" />
            : t.kind === 'success' ? <CheckCircle2 size={16} className="text-emerald-300 mt-0.5 shrink-0" />
              : <Info size={16} className="text-sky-300 mt-0.5 shrink-0" />}
          <div className="flex-1 text-[13px] leading-relaxed text-ink-100 break-words">{t.message}</div>
          <button type="button" onClick={() => dismiss(t.id)} className="text-ink-500 hover:text-white"><X size={14} /></button>
        </div>
      ))}
    </div>
  );
}

/** Runs an async action with a busy flag; errors are shown as toasts by `call`. */
export function useBusy() {
  const [busy, setBusy] = useState(null);
  const run = useCallback(async (key, fn) => {
    setBusy(key);
    try {
      return await fn();
    } catch {
      return undefined;
    } finally {
      setBusy(null);
    }
  }, []);
  return [busy, run];
}

export function StatRow({ label, children, className }) {
  return (
    <div className={cx('flex items-center justify-between gap-4 py-2 border-b border-white/[0.05] last:border-0', className)}>
      <span className="text-ink-400 shrink-0">{label}</span>
      <span className="text-ink-100 text-right min-w-0 truncate">{children}</span>
    </div>
  );
}
