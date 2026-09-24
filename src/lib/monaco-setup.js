/**
 * Monaco, bundled with the app instead of fetched from a CDN.
 *
 * `@monaco-editor/react` downloads Monaco from jsDelivr by default, which means
 * no editor and no syntax colours the moment the machine is offline — exactly
 * the situation HawCode is built for. Pointing its loader at the copy in
 * node_modules makes the editor work on a laptop with the Wi-Fi turned off.
 *
 * The web workers are what give HTML, CSS, JSON and JS/TS their error
 * squiggles, completions and formatting. Without them the languages still
 * colour correctly (that is done on the main thread), so a failure here
 * degrades rather than breaks.
 */

import { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import { setMonaco } from './editor-models';

// monaco-editor 0.56 publishes an exports map of `"./*": "./esm/vs/*.js"`, so
// the old `monaco-editor/esm/vs/...` specifiers now resolve to `esm/vs/esm/vs/...`
// and fail. Everything below the package root is addressed from `vs/` directly.
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';
import JsonWorker from 'monaco-editor/language/json/json.worker?worker';
import CssWorker from 'monaco-editor/language/css/css.worker?worker';
import HtmlWorker from 'monaco-editor/language/html/html.worker?worker';
import TsWorker from 'monaco-editor/language/typescript/ts.worker?worker';

export const DARK_THEME = 'hawcode-dark';
export const LIGHT_THEME = 'hawcode-light';

/**
 * Token colours. Dark is VS Code's Dark+ palette, retuned to sit on HawCode's
 * own #0d1117 chrome rather than VS Code's #1e1e1e.
 */
const DARK_RULES = [
  { token: '', foreground: 'd4d4d4' },
  { token: 'comment', foreground: '6a9955', fontStyle: 'italic' },
  { token: 'string', foreground: 'ce9178' },
  { token: 'string.escape', foreground: 'd7ba7d' },
  { token: 'number', foreground: 'b5cea8' },
  { token: 'regexp', foreground: 'd16969' },
  { token: 'keyword', foreground: '569cd6' },
  { token: 'keyword.control', foreground: 'c586c0' },
  { token: 'operator', foreground: 'd4d4d4' },
  { token: 'delimiter', foreground: '808080' },
  { token: 'delimiter.bracket', foreground: 'ffd700' },
  { token: 'type', foreground: '4ec9b0' },
  { token: 'type.identifier', foreground: '4ec9b0' },
  { token: 'identifier', foreground: '9cdcfe' },
  { token: 'variable', foreground: '9cdcfe' },
  { token: 'variable.predefined', foreground: '4fc1ff' },
  { token: 'function', foreground: 'dcdcaa' },
  { token: 'constant', foreground: '4fc1ff' },
  { token: 'annotation', foreground: 'dcdcaa' },
  { token: 'namespace', foreground: '4ec9b0' },

  // HTML / XML
  { token: 'tag', foreground: '569cd6' },
  { token: 'tag.id', foreground: '9cdcfe' },
  { token: 'tag.class', foreground: '9cdcfe' },
  { token: 'metatag', foreground: '569cd6' },
  { token: 'metatag.content.html', foreground: 'ce9178' },
  { token: 'attribute.name', foreground: '9cdcfe' },
  { token: 'attribute.value', foreground: 'ce9178' },
  { token: 'attribute.value.html', foreground: 'ce9178' },

  // CSS
  { token: 'attribute.name.css', foreground: '9cdcfe' },
  { token: 'attribute.value.number.css', foreground: 'b5cea8' },
  { token: 'attribute.value.unit.css', foreground: 'b5cea8' },
  { token: 'attribute.value.hex.css', foreground: 'ce9178' },
  { token: 'tag.css', foreground: 'd7ba7d' },

  // PHP
  { token: 'metatag.php', foreground: 'c586c0' },
  { token: 'variable.php', foreground: '9cdcfe' },
  { token: 'string.php', foreground: 'ce9178' },
  { token: 'keyword.php', foreground: '569cd6' },

  // Markdown
  { token: 'keyword.md', foreground: '569cd6', fontStyle: 'bold' },
  { token: 'string.link.md', foreground: '4fc1ff' },
  { token: 'emphasis', fontStyle: 'italic' },
  { token: 'strong', fontStyle: 'bold' }
];

const LIGHT_RULES = [
  { token: '', foreground: '1f2328' },
  { token: 'comment', foreground: '008000', fontStyle: 'italic' },
  { token: 'string', foreground: 'a31515' },
  { token: 'number', foreground: '098658' },
  { token: 'regexp', foreground: '811f3f' },
  { token: 'keyword', foreground: '0000ff' },
  { token: 'keyword.control', foreground: 'af00db' },
  { token: 'type', foreground: '267f99' },
  { token: 'identifier', foreground: '001080' },
  { token: 'function', foreground: '795e26' },
  { token: 'tag', foreground: '800000' },
  { token: 'attribute.name', foreground: 'e50000' },
  { token: 'attribute.value', foreground: '0451a5' },
  { token: 'delimiter.bracket', foreground: '0431fa' }
];

const DARK_COLORS = {
  'editor.background': '#0d1117',
  'editor.foreground': '#d4d4d4',
  'editorLineNumber.foreground': '#3d4552',
  'editorLineNumber.activeForeground': '#8b949e',
  'editorCursor.foreground': '#6ea8fe',
  'editor.lineHighlightBackground': '#161b22',
  'editor.lineHighlightBorder': '#00000000',
  'editor.selectionBackground': '#264f78',
  'editor.inactiveSelectionBackground': '#264f7855',
  'editor.selectionHighlightBackground': '#2d4f6e55',
  'editor.wordHighlightBackground': '#37415155',
  'editor.findMatchBackground': '#9e6a03',
  'editor.findMatchHighlightBackground': '#f2cc6055',
  'editorIndentGuide.background1': '#21262d',
  'editorIndentGuide.activeBackground1': '#3d4552',
  'editorBracketMatch.background': '#3d455255',
  'editorBracketMatch.border': '#6ea8fe',
  'editorWidget.background': '#161b22',
  'editorWidget.border': '#30363d',
  'editorSuggestWidget.background': '#161b22',
  'editorSuggestWidget.border': '#30363d',
  'editorSuggestWidget.selectedBackground': '#1f6feb44',
  'editorHoverWidget.background': '#161b22',
  'editorHoverWidget.border': '#30363d',
  'editorGutter.addedBackground': '#2ea04366',
  'editorGutter.modifiedBackground': '#bb800966',
  'editorGutter.deletedBackground': '#f8514966',
  'editorOverviewRuler.border': '#00000000',
  'scrollbarSlider.background': '#2a344466',
  'scrollbarSlider.hoverBackground': '#3d4a5e88',
  'scrollbarSlider.activeBackground': '#3d4a5eaa',
  'minimap.background': '#0d1117',
  'diffEditor.insertedTextBackground': '#2ea04326',
  'diffEditor.removedTextBackground': '#f8514926'
};

const LIGHT_COLORS = {
  'editor.background': '#ffffff',
  'editor.foreground': '#1f2328',
  'editorLineNumber.foreground': '#9aa4b0',
  'editor.lineHighlightBackground': '#f6f8fa',
  'editorIndentGuide.background1': '#e6e9ee',
  'editorWidget.background': '#f6f8fa',
  'editorWidget.border': '#d0d7de'
};

let initialised = false;

/**
 * Install the local Monaco and the HawCode themes. Safe to call more than once;
 * only the first call does any work.
 */
export function setupMonaco() {
  if (initialised) return monaco;
  initialised = true;

  // Vite turns each `?worker` import into its own chunk; Monaco asks for one by
  // label and we hand back the matching constructor.
  self.MonacoEnvironment = {
    getWorker(_workerId, label) {
      switch (label) {
        case 'json':
          return new JsonWorker();
        case 'css':
        case 'scss':
        case 'less':
          return new CssWorker();
        case 'html':
        case 'handlebars':
        case 'razor':
          return new HtmlWorker();
        case 'typescript':
        case 'javascript':
          return new TsWorker();
        default:
          return new EditorWorker();
      }
    }
  };

  monaco.editor.defineTheme(DARK_THEME, {
    base: 'vs-dark',
    inherit: true,
    rules: DARK_RULES,
    colors: DARK_COLORS
  });

  monaco.editor.defineTheme(LIGHT_THEME, {
    base: 'vs',
    inherit: true,
    rules: LIGHT_RULES,
    colors: LIGHT_COLORS
  });

  // JSX and TSX live in .js/.jsx files here, so let the TS worker parse them
  // instead of flagging every tag as a syntax error.
  const ts = monaco.languages.typescript;
  if (ts) {
    const compilerOptions = {
      allowJs: true,
      allowNonTsExtensions: true,
      jsx: ts.JsxEmit.React,
      target: ts.ScriptTarget.ESNext,
      moduleResolution: ts.ModuleResolutionKind.NodeJs
    };
    ts.javascriptDefaults.setCompilerOptions(compilerOptions);
    ts.typescriptDefaults.setCompilerOptions(compilerOptions);
    // Imports resolve against the user's folder, not ours, so unresolved-module
    // errors would be noise on every single file.
    ts.javascriptDefaults.setDiagnosticsOptions({ diagnosticCodesToIgnore: [2307, 2792] });
    ts.typescriptDefaults.setDiagnosticsOptions({ diagnosticCodesToIgnore: [2307, 2792] });
  }

  loader.config({ monaco });
  // The model registry is imported by the app shell, which loads long before
  // this module does; this is the moment it can start making models.
  setMonaco(monaco);
  return monaco;
}

export { monaco };
