import { expect, test } from '@playwright/test';

const ADMIN_URL = `http://127.0.0.1:${process.env.ADMIN_WEB_PORT ?? '5174'}`;

test.afterEach(async ({ page }) => {
  // Leave the world deliberately so the room can dispose before later specs.
  await page.evaluate(() => window.__webLegendDebug?.leaveWorld()).catch(() => undefined);
});

test('game client boots Phaser and joins the realtime world', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Web Legend' })).toBeVisible();
  await expect(page.getByText('双人联机切片')).toBeVisible();
  await expect(page.locator('canvas')).toBeVisible();
  await expect(page.getByTestId('connection-status')).toBeVisible();
});

test('admin console renders its custom shell', async ({ page }) => {
  await page.goto(ADMIN_URL);

  await expect(page.getByRole('heading', { name: '工程状态' })).toBeVisible();
  await expect(page.getByText('运营控制台')).toBeVisible();
  await expect(page.getByText('阶段 0 交付检查')).toBeVisible();
});
