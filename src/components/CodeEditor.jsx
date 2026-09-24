import React, { useEffect, useRef, useImperativeHandle, forwardRef } from 'react';
import { monaco, DARK_THEME, setupMonaco } from '../lib/monaco-setup';
import { getModel, saveViewState, takeViewState } from '../lib/editor-models';

// This module is imported on demand — the app shell does not pull Monaco in —
// so the themes, the workers and the model registry are wired up here, the
// moment the chunk lands, rather than at application start.
setupMonaco();

/**
 * A Monaco editor bound to the shared model registry.
 *
 * Deliberately not controlled by a `value` prop: the model is the source of
 * truth, so the undo stack, the cursor and the scroll position all survive
 * switching tabs and receiving changes from a peer.
 */
const CodeEditor = forwardRef(function CodeEditor(
  { path, content, settings, onContentChange, onCursorChange, onSaveRequest },
  ref
) {
  const hostRef = useRef(null);
  const editorRef = useRef(null);
  const pathRef = useRef(path);
  const handlersRef = useRef({});

  handlersRef.current = { onContentChange, onCursorChange, onSaveRequest };

  // Create the editor once; the model is swapped underneath when the tab changes.
  useEffect(() => {
    if (!hostRef.current || editorRef.current) return undefined;

    const editor = monaco.editor.create(hostRef.current, {
      model: getModel(path, content),
      theme: DARK_THEME,
      automaticLayout: true,
      fontSize: settings.fontSize,
      fontFamily: settings.fontFamily,
      tabSize: settings.tabSize,
      wordWrap: settings.wordWrap ? 'on' : 'off',
      minimap: { enabled: Boolean(settings.minimap) },
      scrollBeyondLastLine: false,
      smoothScrolling: true,
      cursorBlinking: 'smooth',
      cursorSmoothCaretAnimation: 'on',
      renderLineHighlight: 'all',
      padding: { top: 14 },
      bracketPairColorization: { enabled: true },
      guides: { bracketPairs: true, indentation: true },
      suggestSelection: 'first',
      fixedOverflowWidgets: true
    });

    editorRef.current = editor;

    // Ctrl+S is claimed here so it reaches the editor even when the browser or
    // Electron would otherwise swallow it.
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      const handler = handlersRef.current.onSaveRequest;
      if (handler) handler();
    });

    const contentSub = editor.onDidChangeModelContent(() => {
      const handler = handlersRef.current.onContentChange;
      const model = editor.getModel();
      if (handler && model) handler(pathRef.current, model.getValue());
    });

    const cursorSub = editor.onDidChangeCursorPosition((event) => {
      const handler = handlersRef.current.onCursorChange;
      if (handler) {
        handler(pathRef.current, event.position.lineNumber, event.position.column);
      }
    });

    const restored = takeViewState(path);
    if (restored) editor.restoreViewState(restored);
    editor.focus();

    return () => {
      contentSub.dispose();
      cursorSub.dispose();
      // Save where we were before the editor goes away, but leave the model
      // alone — the tab may still be open and another pane may share it.
      saveViewState(pathRef.current, editor.saveViewState());
      editor.dispose();
      editorRef.current = null;
    };
    // Created once per mounted pane.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Swap models when the active tab changes, remembering the outgoing view.
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    if (pathRef.current === path && editor.getModel()) return;

    if (pathRef.current && pathRef.current !== path) {
      saveViewState(pathRef.current, editor.saveViewState());
    }
    pathRef.current = path;

    editor.setModel(getModel(path, content));
    const restored = takeViewState(path);
    if (restored) editor.restoreViewState(restored);
    editor.focus();
  }, [path, content]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.updateOptions({
      fontSize: settings.fontSize,
      tabSize: settings.tabSize,
      wordWrap: settings.wordWrap ? 'on' : 'off',
      minimap: { enabled: Boolean(settings.minimap) }
    });
  }, [settings.fontSize, settings.tabSize, settings.wordWrap, settings.minimap]);

  // Monaco routes undo/redo through whatever currently holds the text focus,
  // falling back to the browser's native undo when the editor does not. Pressing
  // a toolbar button moves focus to that button, so focus has to be handed back
  // before the command is triggered or it silently does nothing.
  const withFocus = (run) => () => {
    const editor = editorRef.current;
    if (!editor) return undefined;
    editor.focus();
    return run(editor);
  };

  useImperativeHandle(ref, () => ({
    undo: withFocus((editor) => editor.trigger('hawcode', 'undo', null)),
    redo: withFocus((editor) => editor.trigger('hawcode', 'redo', null)),
    focus: () => editorRef.current?.focus(),
    format: withFocus((editor) => editor.getAction('editor.action.formatDocument')?.run()),
    find: withFocus((editor) => editor.getAction('actions.find')?.run()),
    getValue: () => editorRef.current?.getModel()?.getValue() ?? '',
    revealLine: (line, column = 1) => {
      const editor = editorRef.current;
      if (!editor) return;
      editor.revealLineInCenter(line);
      editor.setPosition({ lineNumber: line, column });
      editor.focus();
    }
  }), []);

  return <div ref={hostRef} className="absolute inset-0" />;
});

export default CodeEditor;
