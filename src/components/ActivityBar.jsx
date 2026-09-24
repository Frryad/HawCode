import React from 'react';
import { Files, Search, GitBranch, Play, Settings } from 'lucide-react';

/**
 * The narrow icon rail that chooses what the sidebar shows.
 *
 * Clicking the view that is already open collapses the sidebar, which is the
 * behaviour people expect from editors that have this control.
 */
const VIEWS = [
  { id: 'files', icon: Files, label: 'Explorer', binding: 'Ctrl+Shift+E' },
  { id: 'search', icon: Search, label: 'Search', binding: 'Ctrl+Shift+F' },
  { id: 'git', icon: GitBranch, label: 'Source Control', binding: 'Ctrl+Shift+G' },
  { id: 'run', icon: Play, label: 'Scripts', binding: null }
];

export default function ActivityBar({ active, onSelect, onOpenSettings, badges = {} }) {
  return (
    <div className="w-12 flex-shrink-0 bg-[#0b0f16] border-r border-white/5 flex flex-col items-center py-2">
      {VIEWS.map((view) => {
        const Icon = view.icon;
        const isActive = active === view.id;
        const badge = badges[view.id];
        return (
          <button
            key={view.id}
            onClick={() => onSelect(view.id)}
            title={view.binding ? `${view.label} (${view.binding})` : view.label}
            aria-label={view.label}
            aria-pressed={isActive}
            className={`relative w-12 h-12 flex items-center justify-center transition-colors ${
              isActive ? 'text-white' : 'text-slate-500 hover:text-slate-200'
            }`}
          >
            {isActive && (
              <span className="absolute left-0 top-2 bottom-2 w-0.5 bg-indigo-400 rounded-r" />
            )}
            <Icon size={20} />
            {badge > 0 && (
              <span className="absolute top-2 right-2 min-w-[15px] h-[15px] px-1 rounded-full bg-indigo-500 text-white text-[9px] font-bold flex items-center justify-center">
                {badge > 99 ? '99+' : badge}
              </span>
            )}
          </button>
        );
      })}

      <button
        onClick={onOpenSettings}
        title="Settings (Ctrl+,)"
        aria-label="Settings"
        className="mt-auto w-12 h-12 flex items-center justify-center text-slate-500 hover:text-slate-200 transition-colors"
      >
        <Settings size={19} />
      </button>
    </div>
  );
}
