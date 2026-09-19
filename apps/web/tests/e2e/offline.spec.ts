import { expect, test } from '@playwright/test';

/**
 * Acceptance gate §12.5 — with VITE_STRICT_OFFLINE=1 (set by the webServer config)
 * the app must complete a clean load with zero requests outside its own origin.
 */
test.describe('offline guard', () => {
  test('makes no non-origin network requests on initial load', async ({ page, baseURL }) => {
    const origin = new URL(baseURL!).origin;
    const external: string[] = [];

    page.on('request', (request) => {
      const url = request.url();
      if (url.startsWith('data:') || url.startsWith('blob:')) return;
      if (!url.startsWith(origin)) external.push(url);
    });

    const consoleErrors: string[] = [];
    page.on('pageerror', (error) => consoleErrors.push(error.message));

    await page.goto('/');
    await expect(page.getByTestId('status-bar')).toBeVisible();
    await page.waitForLoadState('networkidle');

    expect(external, `Unexpected remote requests:\n${external.join('\n')}`).toEqual([]);
    expect(consoleErrors.filter((m) => m.includes('networkGuard'))).toEqual([]);
  });

  test('the guard itself is installed and catches a violation', async ({ page }) => {
    await page.goto('/');
    const violations = await page.evaluate(async () => {
      // Strict mode is on, so this must throw synchronously rather than dial out.
      try {
        await fetch('https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/ort.wasm');
      } catch {
        /* expected */
      }
      return (
        (window as unknown as { __wmsNetworkViolations?: unknown[] }).__wmsNetworkViolations ?? []
      );
    });
    expect(violations.length).toBeGreaterThan(0);
  });

  test('serves ORT wasm binaries from its own origin, not a CDN', async ({ page, baseURL }) => {
    const response = await page.request.get(`${baseURL}/ort/ort-wasm-simd-threaded.wasm`);
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('wasm');
  });
});
