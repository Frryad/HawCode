import React, { useState, useCallback, useRef } from 'react';
import {
  Search, Replace, CaseSensitive, WholeWord, Regex, ChevronRight, ChevronDown,
  Loader2, AlertTriangle, ReplaceAll, SlidersHorizontal
} from 'lucide-react';
import FileIcon from './FileIcon';

const api = window.electronAPI;
const DEBOUNCE_MS = 250;

function Toggle({ icon: Icon, active, onClick, title }) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={`p-1 rounded transition-colors ${
        active ? 'bg-indigo-500/25 text-indigo-300' : 'text-slate-500 hover:text-white hover:bg-white/5'
      }`}
    >
      <Icon size={13} />
    </button>
  );
}

function ResultGroup({ result, onOpen, query }) {
  const [expanded, setExpanded] = useState(true);
  const name = result.path.split('/').pop();
  const folder = result.path.includes('/') ? result.path.slice(0, result.path.lastIndexOf('/')) : '';

  return (
    <div>
      <button
        onClick={() => setExpanded((open) => !open)}
        className="w-full flex items-center gap-1.5 px-2 py-1 hover:bg-white/5 text-left group"
      >
        {expanded
          ? <ChevronDown size={12} className="text-slate-500 flex-shrink-0" />
          : <ChevronRight size={12} className="text-slate-500 flex-shrink-0" />}
        <FileIcon path={result.path} size={13} />
        <span className="text-[12px] text-slate-200 truncate">{name}</span>
        {folder && <span className="text-[10px] text-slate-600 truncate">{folder}</span>}
        <span className="ml-auto text-[10px] text-slate-500 bg-white/5 px-1.5 rounded-full flex-shrink-0">
          {result.matches.length}
        </span>
      </button>

      {expanded && result.matches.map((match, index) => {
        // Highlight the hit inside its line without re-running the search.
        const before = match.preview.slice(0, match.column - 1);
        const hit = match.preview.slice(match.column - 1, match.column - 1 + match.length);
        const after = match.preview.slice(match.column - 1 + match.length);
        return (
          <button
            key={`${match.line}-${match.column}-${index}`}
            onClick={() => onOpen(result.path, match.line, match.column)}
            className="w-full flex items-start gap-2 pl-7 pr-2 py-0.5 hover:bg-white/5 text-left"
            title={`Line ${match.line}`}
          >
            <span className="text-[10px] text-slate-600 tabular-nums w-8 text-right flex-shrink-0 mt-0.5">
              {match.line}
            </span>
            <span className="text-[11px] font-mono truncate text-slate-400">
              {before}
              <mark className="bg-amber-400/25 text-amber-200 rounded-sm">{hit || query}</mark>
              {after}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * Workspace-wide find and replace.
 *
 * The heavy lifting happens in the main process against the sync manifest, so
 * this only renders results. A replace goes through the sync engine, which
 * means every edited file is sent to connected peers automatically.
 */
export default function SearchPanel({ onOpenResult }) {
  const [query, setQuery] = useState('');
  const [replacement, setReplacement] = useState('');
  const [showReplace, setShowReplace] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [include, setInclude] = useState('');
  const [exclude, setExclude] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [isRegex, setIsRegex] = useState(false);
  const [results, setResults] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const timer = useRef(null);

  const options = useCallback(() => ({
    query, isRegex, caseSensitive, wholeWord, include, exclude
  }), [query, isRegex, caseSensitive, wholeWord, include, exclude]);

  const runSearch = useCallback(async (immediate = false) => {
    if (timer.current) clearTimeout(timer.current);
    const execute = async () => {
      const current = options();
      if (!current.query) {
        setResults(null);
        setError('');
        return;
      }
      setBusy(true);
      const found = await api.searchWorkspace(current);
      setBusy(false);
      if (found.error) {
        setError(found.error);
        setResults(null);
        return;
      }
      setError('');
      setResults(found);
    };
    if (immediate) await execute();
    else timer.current = setTimeout(execute, DEBOUNCE_MS);
  }, [options]);

  // Re-run whenever the query or any option changes.
  React.useEffect(() => {
    runSearch();
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [runSearch]);

  const replaceAll = async () => {
    if (!results || !results.results.length) return;
    const fileCount = results.results.length;
    const confirmed = window.confirm(
      `Replace ${results.totalMatches} match${results.totalMatches === 1 ? '' : 'es'} ` +
      `across ${fileCount} file${fileCount === 1 ? '' : 's'}?\n\n` +
      'Every connected computer receives these changes.'
    );
    if (!confirmed) return;

    setBusy(true);
    const outcome = await api.searchReplace({ ...options(), replacement });
    setBusy(false);

    if (outcome.error) {
      setError(outcome.error);
      return;
    }
    if (outcome.failures && outcome.failures.length) {
      setError(`${outcome.failures.length} file(s) could not be changed — the first was ${outcome.failures[0].path}`);
    }
    await runSearch(true);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="p-2 space-y-1.5 border-b border-white/5">
        <div className="flex items-start gap-1">
          <button
            onClick={() => setShowReplace((open) => !open)}
            title={showReplace ? 'Hide replace' : 'Show replace'}
            className="mt-1.5 text-slate-500 hover:text-white transition-colors"
          >
            {showReplace ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </button>

          <div className="flex-1 space-y-1.5">
            <div className="flex items-center gap-1 bg-[#0d1117] border border-white/10 rounded-md px-2 focus-within:border-indigo-500 transition-colors">
              <Search size={12} className="text-slate-500 flex-shrink-0" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search"
                className="flex-1 bg-transparent py-1.5 text-[12px] text-white focus:outline-none placeholder:text-slate-600"
              />
              <Toggle icon={CaseSensitive} active={caseSensitive} title="Match case"
                onClick={() => setCaseSensitive((value) => !value)} />
              <Toggle icon={WholeWord} active={wholeWord} title="Match whole word"
                onClick={() => setWholeWord((value) => !value)} />
              <Toggle icon={Regex} active={isRegex} title="Use regular expression"
                onClick={() => setIsRegex((value) => !value)} />
            </div>

            {showReplace && (
              <div className="flex items-center gap-1 bg-[#0d1117] border border-white/10 rounded-md px-2 focus-within:border-indigo-500 transition-colors">
                <Replace size={12} className="text-slate-500 flex-shrink-0" />
                <input
                  value={replacement}
                  onChange={(event) => setReplacement(event.target.value)}
                  placeholder="Replace"
                  className="flex-1 bg-transparent py-1.5 text-[12px] text-white focus:outline-none placeholder:text-slate-600"
                />
                <button
                  onClick={replaceAll}
                  disabled={busy || !results || !results.totalMatches}
                  title="Replace all"
                  className="p-1 rounded text-slate-400 hover:text-white hover:bg-white/5 disabled:opacity-30 transition-colors"
                >
                  <ReplaceAll size={13} />
                </button>
              </div>
            )}
          </div>
        </div>

        <button
          onClick={() => setShowFilters((open) => !open)}
          className="flex items-center gap-1 text-[10px] text-slate-500 hover:text-slate-300 transition-colors pl-5"
        >
          <SlidersHorizontal size={10} />
          {showFilters ? 'Hide' : 'Show'} file filters
        </button>

        {showFilters && (
          <div className="space-y-1.5 pl-5">
            <input
              value={include}
              onChange={(event) => setInclude(event.target.value)}
              placeholder="Include, e.g. src/**, *.js"
              className="w-full bg-[#0d1117] border border-white/10 rounded-md px-2 py-1.5 text-[11px] text-white focus:outline-none focus:border-indigo-500 placeholder:text-slate-600"
            />
            <input
              value={exclude}
              onChange={(event) => setExclude(event.target.value)}
              placeholder="Exclude, e.g. *.test.js"
              className="w-full bg-[#0d1117] border border-white/10 rounded-md px-2 py-1.5 text-[11px] text-white focus:outline-none focus:border-indigo-500 placeholder:text-slate-600"
            />
            <p className="text-[10px] text-slate-600">
              Same pattern style as .hawignore. Ignored folders are never searched.
            </p>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {error && (
          <div className="flex items-start gap-2 m-2 p-2 rounded-md bg-rose-500/10 border border-rose-500/20">
            <AlertTriangle size={13} className="text-rose-400 flex-shrink-0 mt-0.5" />
            <span className="text-[11px] text-rose-200">{error}</span>
          </div>
        )}

        {busy && !results && (
          <div className="flex items-center justify-center gap-2 py-8 text-slate-500 text-[11px]">
            <Loader2 size={13} className="animate-spin" />
            Searching…
          </div>
        )}

        {results && (
          <>
            <div className="px-3 py-1.5 text-[10px] text-slate-500 border-b border-white/5">
              {results.totalMatches === 0
                ? 'No results'
                : `${results.totalMatches} result${results.totalMatches === 1 ? '' : 's'} in ${results.results.length} file${results.results.length === 1 ? '' : 's'}`}
              {results.truncated && <span className="text-amber-400/80"> · showing the first matches only</span>}
            </div>
            {results.results.map((result) => (
              <ResultGroup key={result.path} result={result} onOpen={onOpenResult} query={query} />
            ))}
          </>
        )}

        {!results && !busy && !error && (
          <div className="text-center text-slate-600 text-[11px] mt-8 px-4">
            Search every file in the shared folder.
          </div>
        )}
      </div>
    </div>
  );
}
