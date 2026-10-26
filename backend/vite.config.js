import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ command }) => ({
  plugins: [react()],
  // Serve backend/public files in dev; keep it disabled during build because
  // the build output itself is backend/public.
  publicDir: command === 'serve' ? 'public' : false,
  server: {
    host: '0.0.0.0',
    watch: {
      usePolling: process.env.VITE_USE_POLLING === 'true',
    },
    proxy: {
      '/api': process.env.VITE_API_TARGET || 'http://localhost:3000',
      '/health': process.env.VITE_API_TARGET || 'http://localhost:3000',
    },
  },
  build: { outDir: 'public', emptyOutDir: false },
}));
