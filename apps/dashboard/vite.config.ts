import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// `bun run dev` starts the server on 6860 (so it can run next to an installed Overly on 6859).
const devServer = 'http://127.0.0.1:6860';

export default defineConfig({
  plugins: [react()],
  server: {
    // The server only accepts the Vite origin because the dev script passes --dev-origin.
    proxy: {
      '/api': { target: devServer, changeOrigin: true },
      '/ws': { target: devServer, changeOrigin: true, ws: true },
      // The one-time token exchange: /?t=<token>
      '^/\\?t=': { target: devServer, changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist/web',
    // Not Vite's default "assets": /assets/ is reserved for the asset library (Phase 2).
    assetsDir: 'static',
    emptyOutDir: true,
  },
});
