import { expect, test } from '@playwright/test';

/**
 * Rewritten for the editor shell (addendum §A.1). The previous version asserted
 * a website-style header/sidebar/main layout, which no longer exists — the app
 * is now a menu bar, a toolbar, a dock and a status bar.
 */
test.describe('editor shell', () => {
  test('loads the menu bar, toolbar, dock and status bar', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('menubar')).toBeVisible();
    await expect(page.getByTestId('app-toolbar')).toBeVisible();
    await expect(page.getByTestId('status-bar')).toBeVisible();
    await expect(page.getByTestId('workspace-tabs')).toBeVisible();

    // The four default-open docked panels.
    await expect(page.getByTestId('viewport-panel')).toBeVisible();
    await expect(page.getByTestId('video-monitor-panel')).toBeVisible();
    await expect(page.getByTestId('timeline-scrub')).toBeVisible();
    await expect(page.getByTestId('workspace-tree').or(page.getByText('Choose where recordings are saved'))).toBeVisible();
  });

  test('the Record button is present and disabled without a source', async ({ page }) => {
    await page.goto('/');
    const record = page.getByTestId('record-button');
    await expect(record).toBeVisible();
    await expect(record).toBeDisabled();
  });

  test('the Edit workspace tab is visible but not selectable yet', async ({ page }) => {
    await page.goto('/');
    const edit = page.getByTestId('workspace-tab-edit');
    await expect(edit).toBeVisible();
    await expect(edit).toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByTestId('workspace-tab-live')).toHaveAttribute('aria-selected', 'true');
  });

  test('opens Diagnostics from the status bar', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('status-diagnostics').click();
    await expect(page.getByText('Capabilities')).toBeVisible();
  });
});
