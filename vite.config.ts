/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

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
  plugins: [react()],
  server: { headers: isolation },
  preview: { headers: isolation },
  worker: { format: 'es' },
  // Pre-bundle the AI library at startup, so the dev page doesn't reload the first time a model is used.
  optimizeDeps: { include: ['@huggingface/transformers'] },
  test: {
    environment: 'node',
  },
});
