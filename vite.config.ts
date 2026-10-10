/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * Cross-origin isolation lets the WASM fallback for the AI models use threads.
 * "credentialless" keeps the model downloads from Hugging Face working.
 * The same headers are set for production in public/_headers.
 */
const isolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'credentialless',
};

export default defineConfig({
  plugins: [
    react(),
    // Installable and usable offline: the app itself is cached on first visit.
    // The AI models are cached separately by Transformers.js when first used.
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'BackSubtract',
        short_name: 'BackSubtract',
        description: 'Remove the background from any photo, right in your browser. Free and private.',
        theme_color: '#4f46e5',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png}'],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        // The ~27 MB AI runtime is cached the first time an AI tool is used, not on install.
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.endsWith('.wasm') || url.pathname.endsWith('.mjs'),
            handler: 'CacheFirst',
            options: { cacheName: 'ai-runtime', expiration: { maxEntries: 8 } },
          },
        ],
      },
    }),
  ],
  server: { headers: isolation },
  preview: { headers: isolation },
  worker: { format: 'es' },
  // Pre-bundle the AI library at startup, so the dev page doesn't reload the first time a model is used.
  optimizeDeps: { include: ['@huggingface/transformers'] },
  test: {
    environment: 'node',
    // Browser tests run separately with Playwright (npm run test:e2e).
    exclude: ['e2e/**', 'node_modules/**'],
  },
});
