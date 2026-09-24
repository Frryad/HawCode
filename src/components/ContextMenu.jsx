import React, { useEffect, useRef, useState } from 'react';

/**
 * A right-click menu positioned at the pointer, nudged back on screen when it
 * would otherwise open past the window edge.
 */
export default function ContextMenu({ x, y, items, onClose }) {
  const ref = useRef(null);
  const [position, setPosition] = useState({ left: x, top: y });

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    setPosition({
      left: Math.min(x, window.innerWidth - rect.width - 8),
      top: Math.min(y, window.innerHeight - rect.height - 8)
    });
  }, [x, y]);

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }} />
      <div
        ref={ref}
        style={position}
        className="fixed z-50 min-w-[180px] bg-[#1c2128] border border-white/10 rounded-lg shadow-2xl py-1"
      >
        {items.map((item, index) => (
          item.separator ? (
            <div key={`sep-${index}`} className="h-px bg-white/[0.07] my-1" />
          ) : (
            <button
              key={item.label}
              onClick={() => {
                onClose();
                item.onClick();
              }}
              disabled={item.disabled}
              className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-[12px] text-left transition-colors disabled:opacity-30 ${
                item.danger
                  ? 'text-rose-300 hover:bg-rose-500/15'
                  : 'text-slate-200 hover:bg-white/5'
              }`}
            >
              {item.icon && <item.icon size={13} className="flex-shrink-0 opacity-70" />}
              <span className="flex-1">{item.label}</span>
              {item.hint && <span className="text-[10px] text-slate-600">{item.hint}</span>}
            </button>
          )
        ))}
      </div>
    </>
  );
}
