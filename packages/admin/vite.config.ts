import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Frontend builds into `build/` (same dir as the backend artifacts) so the
// runtime serveStatic() in src-backend/static.ts can find index.html + assets/
// at one canonical location.
export default defineConfig({
  plugins: [react()],
  base: '/admin/',
  build: {
    outDir: 'build',
    // Don't wipe build/ — backend artifacts live there too
    emptyOutDir: false,
    sourcemap: true,
  },
});
