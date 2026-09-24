import React, { Component, Suspense } from 'react';

/**
 * Views that arrive as their own chunk, and the guard rails around them.
 *
 * Code splitting is what keeps the window opening in a fraction of a second,
 * but it moves part of the app behind a network fetch — and a fetch can fail.
 * React's default answer to a failed lazy import is to unmount the tree, which
 * turns one missing chunk into an entirely blank window. Everything here exists
 * so that never happens: a failed view retries, then says so in its own corner
 * of the screen, and the rest of the app carries on.
 */

function Loading({ label }) {
  return (
    <div className="flex-1 flex items-center justify-center p-6 text-[11px] text-slate-600">
      Loading {label}…
    </div>
  );
}

function Failed({ label, onRetry }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-3 p-6 text-center">
      <p className="text-xs text-slate-400 max-w-xs">
        {label} did not finish loading. Nothing else is affected — the rest of
        HawCode is still running.
      </p>
      <div className="flex items-center gap-2">
        <button
          onClick={onRetry}
          className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-semibold transition-colors"
        >
          Try again
        </button>
        <button
          onClick={() => window.location.reload()}
          className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 text-[11px] font-semibold border border-white/10 transition-colors"
        >
          Reload HawCode
        </button>
      </div>
    </div>
  );
}

/**
 * Wraps one lazily loaded view: shows a quiet placeholder while its chunk is on
 * the way, and an explanation with a retry if it never arrives.
 *
 * `label` names the view in both messages, so "Loading the terminal…" reads as
 * a sentence rather than as a spinner nobody can interpret.
 */
export class LazyView extends Component {
  constructor(props) {
    super(props);
    this.state = { failed: false, key: 0 };
    this.retry = this.retry.bind(this);
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error) {
    console.error(`HawCode could not load ${this.props.label}`, error);
  }

  // Remounting with a fresh key gives the import another go: React caches the
  // rejected promise against the lazy component, so the child has to be built
  // again rather than merely re-rendered.
  retry() {
    this.setState((previous) => ({ failed: false, key: previous.key + 1 }));
  }

  render() {
    const { label, children, fallback } = this.props;
    if (this.state.failed) return <Failed label={label} onRetry={this.retry} />;
    return (
      <Suspense key={this.state.key} fallback={fallback ?? <Loading label={label} />}>
        {children}
      </Suspense>
    );
  }
}

/**
 * The last line of defence, around the whole application. A render error
 * anywhere that is not already covered leaves the window with something to say
 * instead of an empty dark rectangle.
 */
export class AppBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('HawCode hit an error it could not recover from', error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-background text-foreground">
        <div className="max-w-md w-full bg-[#161b22] border border-white/10 rounded-2xl p-7 space-y-4">
          <h1 className="text-base font-bold text-white">HawCode ran into a problem</h1>
          <p className="text-xs text-slate-400">
            Your files are untouched — this is the window, not the folder.
            Reloading usually clears it.
          </p>
          <pre className="text-[10px] text-rose-300 bg-black/40 rounded-lg p-3 overflow-auto max-h-40 whitespace-pre-wrap">
            {String(this.state.error && this.state.error.message ? this.state.error.message : this.state.error)}
          </pre>
          <button
            onClick={() => window.location.reload()}
            className="w-full py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-sm transition-colors"
          >
            Reload HawCode
          </button>
        </div>
      </div>
    );
  }
}
