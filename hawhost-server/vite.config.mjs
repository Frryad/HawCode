import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The packaged control panel may load nothing from the network: no fonts,
// no scripts, no images. Everything it shows comes from the local app.
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'";

export default defineConfig(({ command }) => ({
  base: './',
  plugins: [
    react(),
    {
      name: 'hawhost-csp',
      transformIndexHtml(html) {
        if (command !== 'build') return html;
        return html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`);
      }
    }
  ],
  server: {
    host: '127.0.0.1',
    port: 5174,
    strictPort: true
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1500
  }
}));
