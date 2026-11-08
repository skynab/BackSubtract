import { defineConfig, devices } from '@playwright/test';

const PORT = 4174;
/** Set by GitHub Actions (.github/workflows/pages.yml). */
const CI = !!process.env.CI;
/** Headless Chromium draws WebGL in software; allow it. */
const chromium = { launchOptions: { args: ['--enable-unsafe-swiftshader'] } };

/**
 * Browser tests against a production build (`npm run test:e2e`). It is built in
 * "e2e" mode, which is the real app except that the AI worker is a stand-in
 * (src/ml/fake-worker.ts), so the AI tools are covered without downloading
 * 100+ MB of models on every run. It builds to dist-e2e, leaving dist alone.
 *
 * `npm run test:e2e` runs the Chromium projects (desktop and phone), which must pass
 * before a deploy. `npm run test:e2e:browsers` runs Firefox and WebKit, best on Linux
 * or macOS: Playwright's Windows WebKit lacks OffscreenCanvas, which Safari has.
 */
export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  fullyParallel: true,
  // On CI: a stray test.only fails the run instead of skipping the rest, a failed test
  // gets one more try (shown as flaky if it then passes), and failures are annotated.
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  reporter: CI ? [['list'], ['github']] : [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], ...chromium } },
    { name: 'mobile', use: { ...devices['Pixel 7'], ...chromium } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: {
    command: `npm run build -- --mode e2e && npx vite preview --mode e2e --port ${PORT} --strictPort`,
    port: PORT,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
