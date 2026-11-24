import { expect, test } from '@playwright/test';

const ADMIN_URL = `http://127.0.0.1:${process.env.ADMIN_WEB_PORT ?? '5174'}`;

test('game client boots Phaser into the browser', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Web Legend' })).toBeVisible();
  await expect(page.getByText('工程底座')).toBeVisible();
  await expect(page.locator('canvas')).toBeVisible();
});

test('admin console renders its custom shell', async ({ page }) => {
  await page.goto(ADMIN_URL);

  await expect(page.getByRole('heading', { name: '工程状态' })).toBeVisible();
  await expect(page.getByText('运营控制台')).toBeVisible();
  await expect(page.getByText('阶段 0 交付检查')).toBeVisible();
});
