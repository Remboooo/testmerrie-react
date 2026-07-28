import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// In dev the app runs on http://localhost:3000 while the API and media server
// live on the production host. Proxying /api keeps the browser same-origin with
// the API so the httpOnly session cookie is accepted in development. Point this
// at a local API instead by setting VITE_DEV_API_TARGET.
const DEV_API_TARGET = process.env.VITE_DEV_API_TARGET || 'https://testmerrie.nl';

export default defineConfig({
  plugins: [react()],
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
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
});
