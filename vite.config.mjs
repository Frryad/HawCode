import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // Electron loads dist/index.html over the local HawCode server, and browsers
  // are served the same build from the same place. A relative base keeps the
  // asset URLs correct in both, and in the file:// fallback used when no port
  // is free.
  base: './',
  plugins: [react()],
  server: {
    // Bound to 127.0.0.1 by name rather than by the default `localhost`. On a
    // Windows machine that resolves `localhost` to ::1 first, Node binds the
    // IPv6 address *only* — and the Electron window, which asks for
    // 127.0.0.1:5173, then gets a connection refused and shows nothing at all.
    host: '127.0.0.1',
    port: 5173,
    // Without this, a port already in use sends the dev server quietly to 5174
    // while the window keeps loading 5173: the same blank window, with no
    // explanation. Better to fail loudly at the terminal.
    strictPort: true
  },
  worker: {
    // Monaco's language workers are ES modules; Electron's Chromium and every
    // browser HawCode targets support module workers.
    format: 'es'
  },
  optimizeDeps: {
    // Monaco and xterm are now imported from lazily loaded components, so the
    // dev server would only meet them the first time a file or a terminal is
    // opened — and would then stop to pre-bundle thousands of modules and
    // reload the page mid-edit. Naming them here gets that done once, while the
    // dev server is starting.
    include: [
      'monaco-editor',
      '@monaco-editor/react',
      '@xterm/xterm',
      '@xterm/addon-fit',
      '@xterm/addon-web-links'
    ]
  },
  build: {
    // Monaco is several megabytes and the editor is not on the startup path:
    // `EditorPane` imports it with the first file that is opened. Left to split
    // automatically, Rollup gives each Monaco language its own chunk too, so
    // opening a JavaScript file does not also download Ruby, ABAP and Verilog.
    //
    // Grouping it into one manual chunk instead used to defeat this entirely:
    // the bundler put its own dynamic-import helper inside that chunk, the
    // entry imports the helper, and all four megabytes — plus Monaco's
    // stylesheet — went back to being preloaded by index.html.
    chunkSizeWarningLimit: 4000
  }
})
