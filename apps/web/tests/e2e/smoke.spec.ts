import { expect, test } from '@playwright/test';

test.describe('app shell smoke', () => {
  test('loads the shell with header, sidebar, main and status bar', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Foundation ready' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible();
    await expect(page.getByTestId('frame-counter')).toHaveText('Frames: —');
    await expect(page.getByRole('radiogroup', { name: 'Color theme' })).toBeVisible();
  });

  test('is cross-origin isolated (COOP/COEP active)', async ({ page }) => {
    await page.goto('/');
    // Acceptance gate §12.4 — without this there is no SharedArrayBuffer.
    await expect.poll(() => page.evaluate(() => window.crossOriginIsolated)).toBe(true);
    await expect.poll(() => page.evaluate(() => typeof SharedArrayBuffer)).toBe('function');
  });

  test('diagnostics panel reports SIMD and isolation', async ({ page }) => {
    await page.goto('/');
    const diagnostics = page.getByTestId('diagnostics');
    await expect(diagnostics).toBeVisible();
    await expect(diagnostics.getByText('crossOriginIsolated')).toBeVisible();
    await expect(diagnostics.getByText('WASM SIMD')).toBeVisible();
    await expect(diagnostics.getByText('WASM threads')).toBeVisible();

    // SIMD must be detected in a modern Chromium.
    const simdRow = diagnostics.locator('div', { hasText: /^WASM SIMD/ }).first();
    await expect(simdRow).toContainText('Yes');
  });

  test('collapses and expands the sidebar', async ({ page }) => {
    await page.goto('/');
    const nav = page.getByRole('navigation', { name: 'Primary' });
    await expect(nav).toHaveAttribute('data-collapsed', 'false');
    await page.getByRole('button', { name: 'Collapse sidebar' }).click();
    await expect(nav).toHaveAttribute('data-collapsed', 'true');
    await page.getByRole('button', { name: 'Expand sidebar' }).click();
    await expect(nav).toHaveAttribute('data-collapsed', 'false');
  });

  test('future sections are disabled with a coming-soon tooltip', async ({ page }) => {
    await page.goto('/');
    const live = page.getByRole('button', { name: 'Live' });
    await expect(live).toBeDisabled();
    await live.hover({ force: true });
    await expect(page.getByRole('tooltip')).toContainText('Coming in Document');
  });
});
