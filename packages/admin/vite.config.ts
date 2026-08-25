import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Frontend builds into `build/` (same dir as the backend artifacts) so the
// runtime serveStatic() in src-backend/static.ts can find index.html + assets/
// at one canonical location.
export default defineConfig(({ command }) => ({
  plugins: [react(), tailwindcss()],
  // Relative asset URLs + the serve-time <base href> injection let one
  // prebuilt bundle work at any mount path. Dev server keeps /admin/.
  base: command === 'build' ? './' : '/admin/',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    outDir: 'build',
    // Don't wipe build/ — backend artifacts live there too
    emptyOutDir: false,
    sourcemap: true,
  },
}));
