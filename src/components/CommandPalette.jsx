import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Command, CornerDownLeft } from 'lucide-react';
import { fuzzyFilter, highlightParts } from '../lib/fuzzy';
import { formatBinding } from '../lib/keybindings';

function Highlight({ text, indices }) {
  return (
    <>
      {highlightParts(text, indices).map((part, index) => (
        part.matched
          ? <mark key={index} className="bg-transparent text-indigo-300 font-semibold">{part.text}</mark>
          : <span key={index}>{part.text}</span>
      ))}
    </>
  );
}

/**
 * Every registered command, searchable by name.
 *
 * Commands come from `src/lib/commands.js`, the same registry the keyboard
 * shortcuts are built from, so the palette can never list an action that does
 * not exist or miss one that does.
 */
export default function CommandPalette({ commands, onClose }) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const listRef = useRef(null);

  const matches = useMemo(
    () => fuzzyFilter(commands, query, (command) => `${command.category} ${command.title}`, 60),
    [commands, query]
  );

  // Keep the highlighted row in view when arrowing past the fold.
  useEffect(() => {
    const node = listRef.current?.children[selected];
    if (node) node.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  const choose = (index) => {
    const entry = matches[index];
    if (!entry) return;
    onClose();
    // Let the dialog unmount before the action changes the view underneath.
    setTimeout(() => entry.item.run(), 0);
  };

  const onKeyDown = (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setSelected((current) => Math.min(current + 1, matches.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setSelected((current) => Math.max(current - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      choose(selected);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh] px-4 bg-black/50 backdrop-blur-[2px]"
      onClick={onClose}>
      <div
        className="w-full max-w-xl bg-[#161b22] border border-white/10 rounded-xl shadow-2xl overflow-hidden"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-3 border-b border-white/5">
          <Command size={15} className="text-slate-500 flex-shrink-0" />
          <input
            autoFocus
            value={query}
            onChange={(event) => {
              // Reset the highlight here rather than in an effect: the cause of
              // the reset is the edit itself.
              setQuery(event.target.value);
              setSelected(0);
            }}
            onKeyDown={onKeyDown}
            placeholder="Type a command…"
            className="flex-1 bg-transparent py-3 text-sm text-white focus:outline-none placeholder:text-slate-600"
          />
          <kbd className="text-[10px] text-slate-600 border border-white/10 rounded px-1.5 py-0.5">Esc</kbd>
        </div>

        <div ref={listRef} className="max-h-[52vh] overflow-y-auto custom-scrollbar py-1">
          {matches.length === 0 ? (
            <div className="px-4 py-6 text-center text-slate-600 text-xs">No matching command</div>
          ) : matches.map((entry, index) => (
            <button
              key={entry.item.id}
              onMouseEnter={() => setSelected(index)}
              onClick={() => choose(index)}
              className={`w-full flex items-center gap-3 px-4 py-2 text-left transition-colors ${
                index === selected ? 'bg-indigo-500/15' : 'hover:bg-white/5'
              }`}
            >
              <span className="text-[10px] uppercase tracking-wider text-slate-600 w-16 flex-shrink-0">
                {entry.item.category}
              </span>
              <span className="text-[13px] text-slate-200 flex-1 truncate">
                <Highlight
                  text={entry.item.title}
                  indices={entry.indices
                    .map((i) => i - entry.item.category.length - 1)
                    .filter((i) => i >= 0)}
                />
              </span>
              {entry.item.binding && (
                <kbd className="text-[10px] text-slate-500 border border-white/10 rounded px-1.5 py-0.5 flex-shrink-0">
                  {formatBinding(entry.item.binding)}
                </kbd>
              )}
              {index === selected && (
                <CornerDownLeft size={12} className="text-slate-600 flex-shrink-0" />
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
