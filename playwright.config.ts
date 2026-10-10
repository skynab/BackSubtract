import { defineConfig, devices } from '@playwright/test';

const PORT = 4174;

/**
 * Browser tests against a production build (`npm run test:e2e`). It is built in
 * "e2e" mode, which is the real app except that the AI worker is a stand-in
 * (src/ml/fake-worker.ts), so the AI tools are covered without downloading
 * 100+ MB of models on every run. It builds to dist-e2e, leaving dist alone.
 */
export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  fullyParallel: true,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    // Headless Chromium draws WebGL in software; allow it.
    launchOptions: { args: ['--enable-unsafe-swiftshader'] },
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: `npm run build -- --mode e2e && npx vite preview --mode e2e --port ${PORT} --strictPort`,
    port: PORT,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
