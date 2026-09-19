import { expect, test } from '@playwright/test';

test.describe('theming', () => {
  test('defaults to the system preference on first run', async ({ browser }) => {
    const dark = await browser.newContext({ colorScheme: 'dark' });
    const darkPage = await dark.newPage();
    await darkPage.goto('/');
    await expect(darkPage.locator('html')).toHaveClass(/dark/);
    await dark.close();

    const light = await browser.newContext({ colorScheme: 'light' });
    const lightPage = await light.newPage();
    await lightPage.goto('/');
    await expect(lightPage.locator('html')).not.toHaveClass(/dark/);
    await light.close();
  });

  test('toggling changes the whole app instantly and persists across reloads', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('radio', { name: 'Dark theme' }).click();
    await expect(page.locator('html')).toHaveClass(/dark/);
    expect(await page.evaluate(() => localStorage.getItem('wms-theme'))).toBe('dark');

    await page.reload();
    await expect(page.locator('html')).toHaveClass(/dark/);

    await page.getByRole('radio', { name: 'Light theme' }).click();
    await expect(page.locator('html')).not.toHaveClass(/dark/);
    await page.reload();
    await expect(page.locator('html')).not.toHaveClass(/dark/);
  });

  test('no flash of the wrong theme on load', async ({ browser }) => {
    // Stored preference deliberately opposes the OS setting: if the inline
    // bootstrap script were missing, the first paint would be light, then flip.
    const context = await browser.newContext({ colorScheme: 'light' });
    const page = await context.newPage();
    await page.addInitScript(() => localStorage.setItem('wms-theme', 'dark'));

    await page.goto('/', { waitUntil: 'commit' });
    // Evaluated as early as possible: the class must already be correct.
    const classAtFirstOpportunity = await page.evaluate(() =>
      document.documentElement.classList.contains('dark'),
    );
    expect(classAtFirstOpportunity).toBe(true);
    await context.close();
  });
});
