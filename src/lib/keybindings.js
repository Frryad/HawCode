import { useEffect, useRef } from 'react';

/** Normalise a KeyboardEvent into a comparable string like "ctrl+shift+p". */
export function describeEvent(event) {
  const parts = [];
  if (event.ctrlKey) parts.push('ctrl');
  if (event.metaKey) parts.push('meta');
  if (event.altKey) parts.push('alt');
  if (event.shiftKey) parts.push('shift');

  let key = event.key;
  if (key === ' ') key = 'space';
  else if (key.length === 1) key = key.toLowerCase();
  else key = key.toLowerCase();

  // Modifier keys on their own are not a shortcut.
  if (['control', 'meta', 'alt', 'shift'].includes(key)) return null;
  parts.push(key);
  return parts.join('+');
}

/** How a binding should read in the UI, using the platform's symbols. */
export function formatBinding(binding) {
  if (!binding) return '';
  const isMac = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform || '');
  return binding
    .split('+')
    .map((part) => {
      if (part === 'ctrl') return isMac ? '⌃' : 'Ctrl';
      if (part === 'meta') return isMac ? '⌘' : 'Win';
      if (part === 'alt') return isMac ? '⌥' : 'Alt';
      if (part === 'shift') return isMac ? '⇧' : 'Shift';
      if (part === 'escape') return 'Esc';
      if (part === 'arrowup') return '↑';
      if (part === 'arrowdown') return '↓';
      return part.length === 1 ? part.toUpperCase() : part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(isMac ? '' : '+');
}

/**
 * Global shortcut handler.
 *
 * `bindings` maps a normalised combination to a handler. Typing inside an input
 * is left alone unless the shortcut uses a modifier, so Ctrl+P still works from
 * a text box while a bare letter does not steal the keystroke.
 */
export function useKeybindings(bindings, enabled = true) {
  // Held in a ref so the listener below is attached once rather than being
  // rebuilt every time a handler identity changes.
  const ref = useRef(bindings);
  useEffect(() => {
    ref.current = bindings;
  }, [bindings]);

  useEffect(() => {
    if (!enabled) return undefined;

    const onKeyDown = (event) => {
      const combination = describeEvent(event);
      if (!combination) return;

      const handler = ref.current[combination];
      if (!handler) return;

      const target = event.target;
      const isTyping = target && (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable ||
        // Monaco and xterm both render their own focusable surfaces.
        target.closest?.('.monaco-editor, .xterm')
      );
      const hasModifier = event.ctrlKey || event.metaKey || event.altKey;
      if (isTyping && !hasModifier && combination !== 'escape') return;

      event.preventDefault();
      event.stopPropagation();
      handler(event);
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [enabled]);
}
