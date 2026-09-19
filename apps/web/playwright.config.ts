import { defineConfig, devices } from '@playwright/test';

/**
 * Smoke/E2E suite. Runs against the dev server by default; set WMS_E2E_TARGET=preview
 * to validate the production preview build, which must send the same COOP/COEP headers.
 */
const isPreview = process.env.WMS_E2E_TARGET === 'preview';
const port = isPreview ? 4173 : 5173;
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // VITE_STRICT_OFFLINE makes the network guard throw on any non-origin request.
    command: isPreview
      ? 'VITE_STRICT_OFFLINE=1 pnpm build && pnpm preview --port 4173'
      : 'VITE_STRICT_OFFLINE=1 pnpm dev --port 5173',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
