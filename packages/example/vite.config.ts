import { defineConfig } from 'vite';
import { colyseus } from 'colyseus/vite';

export default defineConfig({
  plugins: [
    colyseus({
      serverEntry: '/src/server/vite.ts',
      // serveClient: true,
    }),
  ],
});
