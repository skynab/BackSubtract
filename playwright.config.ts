import { defineConfig, devices } from '@playwright/test';

const PORT = 4174;
/** Set by GitHub Actions (.github/workflows/pages.yml). */
const CI = !!process.env.CI;
/** Headless Chromium draws WebGL in software; allow it. */
const chromium = { launchOptions: { args: ['--enable-unsafe-swiftshader'] } };
/**
 * Headless Firefox and WebKit have no WebGL on Linux, and the editor can't draw or take
 * input without it. So on CI they run headed, on the virtual display the workflow starts
 * (xvfb-run), drawing in software with Mesa's llvmpipe. Firefox blocks WebGL on such a
 * renderer by default, so it's allowed here.
 */
const headedOnCi = { headless: !CI };
const firefox = {
  ...headedOnCi,
  launchOptions: {
    firefoxUserPrefs: {
      'webgl.force-enabled': true,
      'webgl.disable-fail-if-major-performance-caveat': true,
    },
  },
};

/**
 * Browser tests against a production build (`npm run test:e2e`). It is built in
 * "e2e" mode, which is the real app except that the AI worker is a stand-in
 * (src/ml/fake-worker.ts), so the AI tools are covered without downloading
 * 100+ MB of models on every run. It builds to dist-e2e, leaving dist alone.
 *
 * `npm run test:e2e` runs the Chromium projects (desktop and phone), which must pass
 * before a deploy. `npm run test:e2e:browsers` runs Firefox and WebKit, best on Linux
 * or macOS: Playwright's Windows WebKit lacks OffscreenCanvas, which Safari has. On Linux
 * without a display, run it as `CI=1 xvfb-run --auto-servernum npm run test:e2e:browsers`.
 */
export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  fullyParallel: true,
  // On CI: a stray test.only fails the run instead of skipping the rest, a failed test
  // gets one more try (shown as flaky if it then passes), and failures are annotated.
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  // On CI, every failure is also listed on the run's page (see e2e/failure-summary.ts).
  reporter: CI ? [['list'], ['github'], ['./e2e/failure-summary.ts']] : [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], ...chromium } },
    { name: 'mobile', use: { ...devices['Pixel 7'], ...chromium } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'], ...firefox } },
    { name: 'webkit', use: { ...devices['Desktop Safari'], ...headedOnCi } },
  ],
  webServer: {
    command: `npm run build -- --mode e2e && npx vite preview --mode e2e --port ${PORT} --strictPort`,
    port: PORT,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
