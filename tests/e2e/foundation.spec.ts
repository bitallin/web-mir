import { expect, test } from '@playwright/test';

const ADMIN_URL = `http://127.0.0.1:${process.env.ADMIN_WEB_PORT ?? '5174'}`;

test.afterEach(async ({ page }) => {
  // Leave the world deliberately so the room can dispose before later specs.
  await page.evaluate(() => window.__webLegendDebug?.leaveWorld()).catch(() => undefined);
});

test('game client boots into the account gate', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Web Legend' })).toBeVisible();
  await expect(page.getByTestId('auth-username')).toBeVisible();
  await expect(page.getByTestId('auth-password')).toBeVisible();
  await expect(page.getByTestId('auth-submit')).toBeVisible();
  // No world connection may be attempted before a server-issued ticket.
  await expect(page.locator('canvas')).toHaveCount(0);
});

test('admin console boots into its login gate', async ({ page }) => {
  await page.goto(ADMIN_URL);

  await expect(page.getByRole('heading', { name: '运营控制台' })).toBeVisible();
  await expect(page.getByTestId('admin-username')).toBeVisible();
  await expect(page.getByTestId('admin-password')).toBeVisible();
  await expect(page.getByTestId('admin-login-submit')).toBeVisible();
  // Admin data is never fetched before an administrator session exists.
  await expect(page.getByTestId('nav-overview')).toHaveCount(0);
});
