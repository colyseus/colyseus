import { defineConfig } from 'vite';
import path from 'path';

// https://vitejs.dev/config/
export default defineConfig({
  root: __dirname,
  base: './',
  server: {
    port: 3001,
    open: true,
  },
  build: {
    outDir: 'dist-test',
    sourcemap: true,
  },
  resolve: {
    alias: {
      '@colyseus/sdk': path.resolve(__dirname, '../src'),
    },
  },
});

