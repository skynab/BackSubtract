import { defineConfig, devices } from '@playwright/test';

const PORT = 4176;
/** Set by GitHub Actions (.github/workflows/models.yml). */
const CI = !!process.env.CI;

/**
 * Browser tests with the real AI models (`npm run test:models`), kept apart from
 * `npm run test:e2e`, whose stand-in AI worker saves downloading them on every run.
 * These download about 190 MB from Hugging Face and run the models on the CPU, so they
 * take a few minutes. They build the real app into dist-models, leaving dist alone.
 */
export default defineConfig({
  testDir: 'e2e-models',
  timeout: 5 * 60_000,
  forbidOnly: CI,
  // A passing network hiccup gets one more try on CI.
  retries: CI ? 1 : 0,
  reporter: CI ? [['list'], ['github'], ['./e2e/failure-summary.ts']] : [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'models', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npx vite build --outDir dist-models --emptyOutDir && npx vite preview --outDir dist-models --port ${PORT} --strictPort`,
    port: PORT,
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
