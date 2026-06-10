import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Relative base so the packaged app can load dist/index.html over file://
  base: './',
  server: {
    // Bind IPv4 explicitly: on some Windows setups "localhost" resolves to ::1
    // only, which breaks the wait-on check that gates the Electron launch.
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
  },
});
