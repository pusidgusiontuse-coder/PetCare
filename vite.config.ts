import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'app',
  publicDir: false,
  base: '/static/frontend/',
  plugins: [react()],
  build: { outDir: 'static/frontend', emptyOutDir: true },
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:8000',
      '^/static/(?!frontend/)': 'http://127.0.0.1:8000',
      '/sw.js': 'http://127.0.0.1:8000',
      '/manifest.webmanifest': 'http://127.0.0.1:8000',
    },
  },
});
