import { execSync } from 'node:child_process';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Build-time version stamp, shown in the UI so you can tell which build is live.
const APP_VERSION = (() => {
  try {
    return execSync('git describe --always --dirty', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return 'unknown';
  }
})();
const BUILD_TIME = new Date().toLocaleString('sv-SE').slice(0, 16); // "YYYY-MM-DD HH:mm", server local time

// In dev the app runs on http://localhost:3000 while the API and media server
// live on the production host. Proxying /api keeps the browser same-origin with
// the API so the httpOnly session cookie is accepted in development. Point this
// at a local API instead by setting VITE_DEV_API_TARGET.
const DEV_API_TARGET = process.env.VITE_DEV_API_TARGET || 'https://testmerrie.nl';

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
    __BUILD_TIME__: JSON.stringify(BUILD_TIME),
  },
  server: {
    port: 3000,
    host: true,
    proxy: {
      '/api': {
        target: DEV_API_TARGET,
        changeOrigin: true,
        secure: true,
        cookieDomainRewrite: '',
      },
    },
  },
  build: {
    // Keep the CRA output dir so existing deploy tooling (cp build/ -> web root)
    // keeps working.
    outDir: 'build',
    // The ovenplayer vendor chunk is inherently ~550 kB; that's expected, not a
    // regression to warn about on every build.
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        // Split rarely-changing vendor code into its own chunks so it stays
        // cached across our frequent app-only deploys.
        manualChunks(id) {
          if (id.includes('node_modules')) {
            // ovenplayer is a large, self-contained lib with no cycles into the
            // react/mui graph, so it splits cleanly. Everything else (react, mui,
            // emotion, ...) MUST stay in one chunk — splitting that interdependent
            // graph apart creates cross-chunk init cycles ("exports of undefined").
            if (id.includes('ovenplayer')) return 'ovenplayer';
            return 'vendor';
          }
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
});
