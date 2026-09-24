import React from 'react';
import { X, Circle, SplitSquareHorizontal } from 'lucide-react';
import FileIcon from './FileIcon';

/**
 * The open-file tab strip.
 *
 * A tab shows a dot instead of its close button while the file has unsaved
 * keystrokes, so it is obvious what is still in flight — HawCode writes on a
 * short delay rather than on an explicit save.
 */
export default function EditorTabs({
  tabs,
  activePath,
  dirtyPaths,
  onSelect,
  onClose,
  onSplit,
  canSplit = true
}) {
  if (!tabs.length) return null;

  return (
    <div className="flex items-stretch h-9 bg-[#161b22] border-b border-border flex-shrink-0">
      <div className="flex items-stretch overflow-x-auto custom-scrollbar flex-1">
        {tabs.map((path) => {
          const isActive = path === activePath;
          const isDirty = dirtyPaths.has(path);
          const name = path.split('/').pop();
          return (
            <div
              key={path}
              onClick={() => onSelect(path)}
              onAuxClick={(event) => {
                // Middle-click closes, as in every other editor.
                if (event.button === 1) {
                  event.preventDefault();
                  onClose(path);
                }
              }}
              title={path}
              className={`group flex items-center gap-2 px-3 cursor-pointer border-r border-white/5 whitespace-nowrap transition-colors ${
                isActive
                  ? 'bg-[#0d1117] text-white'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.03]'
              }`}
            >
              {isActive && <span className="absolute-none" />}
              <FileIcon path={path} size={13} muted={!isActive} />
              <span className="text-[12px]">{name}</span>
              <button
                onClick={(event) => {
                  event.stopPropagation();
                  onClose(path);
                }}
                aria-label={`Close ${name}`}
                className="w-4 h-4 flex items-center justify-center rounded hover:bg-white/10 transition-colors"
              >
                {isDirty ? (
                  <Circle
                    size={8}
                    className="fill-current text-amber-400 group-hover:hidden"
                  />
                ) : null}
                <X
                  size={12}
                  className={isDirty
                    ? 'hidden group-hover:block text-slate-400'
                    : 'opacity-0 group-hover:opacity-100 text-slate-400'}
                />
              </button>
            </div>
          );
        })}
      </div>

      {canSplit && (
        <button
          onClick={onSplit}
          title="Split editor (Ctrl+\)"
          className="px-3 text-slate-500 hover:text-white hover:bg-white/5 transition-colors flex-shrink-0"
        >
          <SplitSquareHorizontal size={15} />
        </button>
      )}
    </div>
  );
}
