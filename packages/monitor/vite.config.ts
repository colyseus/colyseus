import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    port: 3000,
    open: true,
  },
  build: {
    outDir: 'build/static',
    sourcemap: true,
  },
  define: {
    'process.env.npm_package_version': JSON.stringify(process.env.npm_package_version || '0.17.0'),
  },
  resolve: {
    extensions: ['.ts', '.tsx', '.js', '.json'],
  },
  optimizeDeps: {
    include: ['react', 'react-dom', 'react-router-dom'],
  },
});
