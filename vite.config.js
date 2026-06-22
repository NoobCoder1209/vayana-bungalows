import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// On GitHub Pages the site is served from /arapq-website/, so we set the base
// to that subpath only when building for production. In dev (npm run dev)
// it stays at /, so localhost works without prefixing every URL.
export default defineConfig(({ command }) => ({
  root: '.',
  base: command === 'build' ? '/arapq-website/' : '/',
  server: {
    port: 5173,
    open: true,
  },
  build: {
    outDir: 'dist',
    assetsInlineLimit: 0,
    rollupOptions: {
      // Multi-page build: one entry per HTML page. Vite emits each as its own
      // index.html under the matching folder, so the URLs stay /<bungalow>/.
      input: {
        home: resolve(__dirname, 'index.html'),
        premierOceanviewVilla: resolve(__dirname, 'premier-oceanview-villa/index.html'),
        deluxeHilltopResidence: resolve(__dirname, 'deluxe-hilltop-residence/index.html'),
        premierBeachfrontSuite: resolve(__dirname, 'premier-beachfront-suite/index.html'),
        enquiries: resolve(__dirname, 'enquiries/index.html'),
        stay: resolve(__dirname, 'stay/index.html'),
        destination: resolve(__dirname, 'destination/index.html'),
      },
    },
  },
}));
