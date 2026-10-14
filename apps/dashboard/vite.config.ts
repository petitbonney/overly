import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist/web',
    // Not Vite's default "assets": /assets/ is reserved for the asset library (Phase 2).
    assetsDir: 'static',
    emptyOutDir: true,
  },
});
