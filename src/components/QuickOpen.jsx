import React, { useState, useEffect, useRef } from 'react';
import { FileSearch, CornerDownLeft } from 'lucide-react';
import FileIcon from './FileIcon';

const api = window.electronAPI;

/**
 * Ctrl+P — jump to any file by typing part of its path.
 *
 * Matching happens in the main process against the sync manifest, which is
 * already an index of every shared file, so this stays fast without the
 * renderer holding a copy of the tree.
 */
export default function QuickOpen({ onOpen, onClose }) {
  const [query, setQuery] = useState('');
  const [items, setItems] = useState([]);
  const [selected, setSelected] = useState(0);
  const listRef = useRef(null);

  useEffect(() => {
    let alive = true;
    api.quickOpen(query, 60).then((results) => {
      if (!alive) return;
      setItems(results);
      setSelected(0);
    });
    return () => { alive = false; };
  }, [query]);

  useEffect(() => {
    const node = listRef.current?.children[selected];
    if (node) node.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  const choose = (index) => {
    const entry = items[index];
    if (!entry) return;
    onClose();
    setTimeout(() => onOpen(entry.path), 0);
  };

  const onKeyDown = (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setSelected((current) => Math.min(current + 1, items.length - 1));
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
          <FileSearch size={15} className="text-slate-500 flex-shrink-0" />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Go to file…"
            className="flex-1 bg-transparent py-3 text-sm text-white focus:outline-none placeholder:text-slate-600"
          />
          <kbd className="text-[10px] text-slate-600 border border-white/10 rounded px-1.5 py-0.5">Esc</kbd>
        </div>

        <div ref={listRef} className="max-h-[52vh] overflow-y-auto custom-scrollbar py-1">
          {items.length === 0 ? (
            <div className="px-4 py-6 text-center text-slate-600 text-xs">
              {query ? 'No matching file' : 'No files in this workspace yet'}
            </div>
          ) : items.map((entry, index) => {
            const folder = entry.path.includes('/')
              ? entry.path.slice(0, entry.path.lastIndexOf('/'))
              : '';
            return (
              <button
                key={entry.path}
                onMouseEnter={() => setSelected(index)}
                onClick={() => choose(index)}
                className={`w-full flex items-center gap-2.5 px-4 py-2 text-left transition-colors ${
                  index === selected ? 'bg-indigo-500/15' : 'hover:bg-white/5'
                }`}
              >
                <FileIcon path={entry.path} size={14} />
                <span className="text-[13px] text-slate-200 flex-shrink-0">{entry.name}</span>
                {folder && (
                  <span className="text-[11px] text-slate-600 truncate">{folder}</span>
                )}
                {index === selected && (
                  <CornerDownLeft size={12} className="text-slate-600 ml-auto flex-shrink-0" />
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
