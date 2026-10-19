import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5188,
    strictPort: true,
    // Windows may briefly lock freshly downloaded assets while native watchers attach.
    watch: { usePolling: process.platform === 'win32', interval: 250 },
    proxy: { '/api': 'http://127.0.0.1:3028' },
  },
});
