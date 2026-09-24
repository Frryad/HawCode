/**
 * One table describing every file type HawCode knows about.
 *
 * It answers three questions from one place, so the editor, the file tree, the
 * tab bar and the status bar can never disagree with each other:
 *   - which Monaco language should colour this file,
 *   - what should it be called in the UI,
 *   - which icon and colour represent it.
 */

import {
  FileCode, FileJson, FileText, FileImage, FileArchive, FileType, FileTerminal,
  FileSpreadsheet, FileQuestion, Braces, Database, Palette, Globe, Settings,
  Binary, Coffee, Book, Box
} from 'lucide-react';

/**
 * Per-language presentation. `color` is the accent used for the icon in the
 * tree and tabs; the values follow the colours people already associate with
 * each ecosystem.
 */
const LANGUAGES = {
  html:       { label: 'HTML',         color: '#e34c26', icon: Globe },
  css:        { label: 'CSS',          color: '#519aba', icon: Palette },
  scss:       { label: 'SCSS',         color: '#c6538c', icon: Palette },
  less:       { label: 'Less',         color: '#5f8bcb', icon: Palette },
  javascript: { label: 'JavaScript',   color: '#f1e05a', icon: FileCode },
  typescript: { label: 'TypeScript',   color: '#3178c6', icon: FileCode },
  php:        { label: 'PHP',          color: '#8892bf', icon: FileCode },
  json:       { label: 'JSON',         color: '#f5de19', icon: FileJson },
  markdown:   { label: 'Markdown',     color: '#7aa2f7', icon: Book },
  python:     { label: 'Python',       color: '#3572a5', icon: FileCode },
  java:       { label: 'Java',         color: '#e76f00', icon: Coffee },
  c:          { label: 'C',            color: '#8cc2f0', icon: FileCode },
  cpp:        { label: 'C++',          color: '#f34b7d', icon: FileCode },
  csharp:     { label: 'C#',           color: '#9b4f9b', icon: FileCode },
  go:         { label: 'Go',           color: '#00add8', icon: FileCode },
  rust:       { label: 'Rust',         color: '#dea584', icon: FileCode },
  ruby:       { label: 'Ruby',         color: '#cc342d', icon: FileCode },
  swift:      { label: 'Swift',        color: '#f05138', icon: FileCode },
  kotlin:     { label: 'Kotlin',       color: '#a97bff', icon: FileCode },
  dart:       { label: 'Dart',         color: '#00b4ab', icon: FileCode },
  lua:        { label: 'Lua',          color: '#5b8bd6', icon: FileCode },
  perl:       { label: 'Perl',         color: '#0298c3', icon: FileCode },
  r:          { label: 'R',            color: '#198ce7', icon: FileCode },
  shell:      { label: 'Shell',        color: '#89e051', icon: FileTerminal },
  powershell: { label: 'PowerShell',   color: '#5391fe', icon: FileTerminal },
  bat:        { label: 'Batch',        color: '#c1f12e', icon: FileTerminal },
  sql:        { label: 'SQL',          color: '#e38c00', icon: Database },
  xml:        { label: 'XML',          color: '#a0a0a0', icon: FileCode },
  yaml:       { label: 'YAML',         color: '#e05a5a', icon: Settings },
  ini:        { label: 'INI',          color: '#9aa4b0', icon: Settings },
  graphql:    { label: 'GraphQL',      color: '#e10098', icon: Braces },
  dockerfile: { label: 'Dockerfile',   color: '#2496ed', icon: Box },
  makefile:   { label: 'Makefile',     color: '#9aa4b0', icon: Settings },
  objective:  { label: 'Objective-C',  color: '#438eff', icon: FileCode },
  clojure:    { label: 'Clojure',      color: '#63b132', icon: FileCode },
  fsharp:     { label: 'F#',           color: '#b845fc', icon: FileCode },
  scala:      { label: 'Scala',        color: '#c22d40', icon: FileCode },
  pascal:     { label: 'Pascal',       color: '#e3f171', icon: FileCode },
  julia:      { label: 'Julia',        color: '#a270ba', icon: FileCode },
  handlebars: { label: 'Handlebars',   color: '#f0772b', icon: Globe },
  razor:      { label: 'Razor',        color: '#8f6fd6', icon: Globe },
  twig:       { label: 'Twig',         color: '#9bb02d', icon: Globe },
  plaintext:  { label: 'Plain Text',   color: '#94a3b8', icon: FileText }
};

/** Types Monaco has no tokenizer for, but that still deserve their own icon. */
const ASSET_KINDS = {
  image:   { label: 'Image',    color: '#a78bfa', icon: FileImage },
  archive: { label: 'Archive',  color: '#fbbf24', icon: FileArchive },
  font:    { label: 'Font',     color: '#f472b6', icon: FileType },
  sheet:   { label: 'Sheet',    color: '#22c55e', icon: FileSpreadsheet },
  binary:  { label: 'Binary',   color: '#64748b', icon: Binary },
  pdf:     { label: 'PDF',      color: '#ef4444', icon: FileText },
  media:   { label: 'Media',    color: '#38bdf8', icon: FileImage }
};

/** extension -> Monaco language id */
const BY_EXTENSION = {
  // Web: the four the app is built around come first.
  html: 'html', htm: 'html', xhtml: 'html', vue: 'html', svelte: 'html',
  hbs: 'handlebars', handlebars: 'handlebars', ejs: 'html', twig: 'twig',
  cshtml: 'razor', razor: 'razor', jsp: 'html', asp: 'html', aspx: 'html',
  css: 'css', scss: 'scss', sass: 'scss', less: 'less', styl: 'css', pcss: 'css',
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
  php: 'php', phtml: 'php', php3: 'php', php4: 'php', php5: 'php', phps: 'php',

  // Data and config
  json: 'json', jsonc: 'json', json5: 'json', geojson: 'json', map: 'json',
  webmanifest: 'json', xml: 'xml', xsd: 'xml', xsl: 'xml', svg: 'xml',
  plist: 'xml', csproj: 'xml', resx: 'xml', yml: 'yaml', yaml: 'yaml',
  toml: 'ini', ini: 'ini', cfg: 'ini', conf: 'ini', properties: 'ini',
  env: 'ini', editorconfig: 'ini', graphql: 'graphql', gql: 'graphql',
  proto: 'plaintext', sql: 'sql', psql: 'sql', mysql: 'sql',

  // Docs
  md: 'markdown', markdown: 'markdown', mdx: 'markdown', rst: 'plaintext',
  txt: 'plaintext', log: 'plaintext', csv: 'plaintext', tsv: 'plaintext',

  // Systems and scripting
  py: 'python', pyw: 'python', pyi: 'python',
  java: 'java', jav: 'java',
  c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp', hh: 'cpp', hxx: 'cpp',
  cs: 'csharp', fs: 'fsharp', fsx: 'fsharp', vb: 'plaintext',
  go: 'go', rs: 'rust', rb: 'ruby', erb: 'ruby', rake: 'ruby',
  swift: 'swift', kt: 'kotlin', kts: 'kotlin', dart: 'dart', lua: 'lua',
  pl: 'perl', pm: 'perl', r: 'r', jl: 'julia', scala: 'scala', sc: 'scala',
  clj: 'clojure', cljs: 'clojure', edn: 'clojure', m: 'objective', mm: 'objective',
  pas: 'pascal', pp: 'pascal', asm: 'plaintext', s: 'plaintext',
  sh: 'shell', bash: 'shell', zsh: 'shell', fish: 'shell', ksh: 'shell',
  ps1: 'powershell', psm1: 'powershell', psd1: 'powershell',
  bat: 'bat', cmd: 'bat'
};

/** Whole filenames that decide the type on their own, extension or not. */
const BY_FILENAME = {
  dockerfile: 'dockerfile',
  containerfile: 'dockerfile',
  makefile: 'makefile',
  gnumakefile: 'makefile',
  'cmakelists.txt': 'makefile',
  rakefile: 'ruby',
  gemfile: 'ruby',
  procfile: 'yaml',
  '.gitignore': 'ini',
  '.gitattributes': 'ini',
  '.hawignore': 'ini',
  '.npmrc': 'ini',
  '.editorconfig': 'ini',
  '.env': 'ini',
  '.babelrc': 'json',
  '.prettierrc': 'json',
  '.eslintrc': 'json',
  license: 'plaintext',
  licence: 'plaintext',
  readme: 'markdown'
};

/** Extensions Monaco cannot tokenise but that we still label and colour. */
const BY_ASSET_EXTENSION = {
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', bmp: 'image',
  webp: 'image', ico: 'image', avif: 'image', tiff: 'image',
  zip: 'archive', rar: 'archive', '7z': 'archive', tar: 'archive', gz: 'archive',
  bz2: 'archive', xz: 'archive', jar: 'archive', war: 'archive',
  ttf: 'font', otf: 'font', woff: 'font', woff2: 'font', eot: 'font',
  xlsx: 'sheet', xls: 'sheet', ods: 'sheet',
  pdf: 'pdf',
  mp3: 'media', wav: 'media', ogg: 'media', flac: 'media', mp4: 'media',
  mkv: 'media', mov: 'media', webm: 'media', avi: 'media',
  exe: 'binary', dll: 'binary', so: 'binary', dylib: 'binary', bin: 'binary',
  wasm: 'binary', db: 'binary', sqlite: 'binary', class: 'binary'
};

const FALLBACK = { language: 'plaintext', ...LANGUAGES.plaintext, icon: FileQuestion };

function basename(filepath) {
  return String(filepath || '').split(/[\\/]/).pop();
}

function extensionOf(filepath) {
  const name = basename(filepath);
  const dot = name.lastIndexOf('.');
  // A leading dot means the whole thing is the name (".gitignore"), not an
  // extension, so only a dot past position 0 counts as a separator.
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

/** The Monaco language id used to colour this file. */
export function languageFor(filepath) {
  if (!filepath) return 'plaintext';
  const name = basename(filepath).toLowerCase();
  if (BY_FILENAME[name]) return BY_FILENAME[name];
  // ".env.local", ".env.production" and friends.
  if (name.startsWith('.env')) return 'ini';
  return BY_EXTENSION[extensionOf(filepath)] || 'plaintext';
}

/**
 * Everything the UI needs to draw a file: its language id, a human label, an
 * accent colour and an icon component.
 */
export function fileMeta(filepath) {
  if (!filepath) return FALLBACK;
  const extension = extensionOf(filepath);

  const assetKind = BY_ASSET_EXTENSION[extension];
  if (assetKind && !BY_EXTENSION[extension]) {
    return { language: 'plaintext', ...ASSET_KINDS[assetKind] };
  }

  const language = languageFor(filepath);
  return { language, ...(LANGUAGES[language] || LANGUAGES.plaintext) };
}

/** Every language the status-bar picker can switch to, sorted by name. */
export function selectableLanguages() {
  return Object.entries(LANGUAGES)
    .map(([id, value]) => ({ id, label: value.label }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** True when HawCode can render a live preview for this path. */
export function isPreviewable(filepath) {
  const language = languageFor(filepath);
  return ['html', 'php', 'razor', 'handlebars', 'twig'].includes(language);
}

/** True when the file needs a PHP runtime to render correctly. */
export function needsPhp(filepath) {
  return languageFor(filepath) === 'php';
}

export { LANGUAGES, ASSET_KINDS };
