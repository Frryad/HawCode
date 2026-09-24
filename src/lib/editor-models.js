import { languageFor } from './languages';

/**
 * Monaco itself is loaded on demand, when the first editor mounts, so the
 * window can paint without waiting on a four-megabyte chunk. Everything here
 * works on models, and there are no models before that happens — so the
 * reference below is filled in by `monaco-setup` and every function that could
 * be called earlier simply has nothing to do.
 */
let monaco = null;

/** Handed the real Monaco by `setupMonaco()` once the editor chunk arrives. */
export function setMonaco(instance) {
  monaco = instance;
}

/**
 * One Monaco model per open file, kept alive for the life of the tab.
 *
 * This is what makes undo and redo work properly. Feeding a `value` prop into
 * the editor replaces the text wholesale and throws the undo stack away, so
 * Ctrl+Z after a remote change would jump somewhere unexpected — or do nothing.
 * A model owns its own history, so switching tabs and coming back leaves both
 * the stack and the cursor where they were.
 */
const models = new Map();
const viewStates = new Map();

function uriFor(relPath) {
  // A stable per-path URI lets Monaco's language services relate files to each
  // other (imports, JSX, CSS in HTML) instead of treating each as an island.
  return monaco.Uri.parse(`hawcode:///${String(relPath).replace(/^\/+/, '')}`);
}

export function getModel(relPath, content = '') {
  const existing = models.get(relPath);
  if (existing && !existing.isDisposed()) return existing;

  const uri = uriFor(relPath);
  // A model for this URI can outlive our Map if Monaco kept it internally.
  const found = monaco.editor.getModel(uri);
  const model = found && !found.isDisposed()
    ? found
    : monaco.editor.createModel(content, languageFor(relPath), uri);

  models.set(relPath, model);
  return model;
}

export function hasModel(relPath) {
  const model = models.get(relPath);
  return Boolean(model && !model.isDisposed());
}

export function disposeModel(relPath) {
  const model = models.get(relPath);
  if (model && !model.isDisposed()) model.dispose();
  models.delete(relPath);
  viewStates.delete(relPath);
}

export function disposeAll() {
  for (const relPath of Array.from(models.keys())) disposeModel(relPath);
}

export function saveViewState(relPath, state) {
  if (state) viewStates.set(relPath, state);
}

export function takeViewState(relPath) {
  return viewStates.get(relPath) || null;
}

/** Rename in place, so an open tab follows a renamed file without reloading. */
export function renameModel(fromPath, toPath) {
  const model = models.get(fromPath);
  if (!model || model.isDisposed()) return;
  // Monaco models are keyed by URI and cannot be re-pointed, so carry the text
  // and history across by creating the new one from the old content.
  const content = model.getValue();
  disposeModel(fromPath);
  const next = getModel(toPath, content);
  next.setValue(content);
}

/**
 * Narrow a whole-file replacement down to the part that actually changed.
 *
 * Replacing the entire range would work, but it moves every cursor and marker
 * to the end of the file. Trimming the common prefix and suffix means a peer
 * editing line 200 leaves your cursor on line 10 exactly where it was.
 */
function minimalEdit(model, next) {
  const current = model.getValue();
  if (current === next) return null;

  let start = 0;
  const limit = Math.min(current.length, next.length);
  while (start < limit && current[start] === next[start]) start += 1;

  let end = 0;
  while (
    end < limit - start &&
    current[current.length - 1 - end] === next[next.length - 1 - end]
  ) {
    end += 1;
  }

  const startPosition = model.getPositionAt(start);
  const endPosition = model.getPositionAt(current.length - end);
  return {
    range: new monaco.Range(
      startPosition.lineNumber, startPosition.column,
      endPosition.lineNumber, endPosition.column
    ),
    text: next.slice(start, next.length - end)
  };
}

/**
 * Apply a change that arrived from another computer.
 *
 * Goes through `pushEditOperations` rather than `setValue` so the edit joins
 * the undo stack instead of destroying it. Returns false when the text already
 * matched, which is the common case for an echo of our own write.
 */
export function applyRemoteContent(relPath, content) {
  if (!monaco) return false;
  const model = models.get(relPath);
  if (!model || model.isDisposed()) return false;

  const edit = minimalEdit(model, content);
  if (!edit) return false;

  model.pushEditOperations([], [edit], () => null);
  return true;
}

export { models as openModels };
