import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

const ARTIFACT_DIR = join(process.cwd(), 'docs', 'phase-reports', 'alpha-02', 'equipment');
const PASSWORD = 'alpha-two-equipment-password';

test.describe.configure({ mode: 'serial', timeout: 180_000 });

const opened: { context: BrowserContext; page: Page }[] = [];

function token(): string {
  return randomUUID().replace(/-/gu, '').slice(0, 6);
}

async function openPage(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('/');
  const entry = { context, page };
  opened.push(entry);
  return entry;
}

async function registerWorld(browser: Browser): Promise<{ page: Page; characterName: string }> {
  const { page } = await openPage(browser);
  const username = `gear_${token()}`;
  const characterName = `Gear${token()}`;

  await page.goto('/?fresh=1');
  await page.getByRole('tab', { name: '注册' }).click();
  await page.getByTestId('auth-username').fill(username);
  await page.getByTestId('auth-password').fill(PASSWORD);
  await page.getByTestId('auth-submit').click();
  await expect(page.getByTestId('account-name')).toHaveText(username, { timeout: 20_000 });

  await page.getByTestId('character-name').fill(characterName);
  await page.getByTestId('character-create').click();
  await page
    .locator(`[data-testid="character-card"][data-character-name="${characterName}"]`)
    .getByTestId('enter-world')
    .click();
  await expect(page.getByTestId('connection-status')).toHaveAttribute('data-status', 'connected', {
    timeout: 20_000,
  });
  return { page, characterName };
}

async function moveTo(page: Page, x: number, y: number): Promise<void> {
  await page.evaluate((tile) => window.__webLegendDebug?.moveToTile(tile.x, tile.y), { x, y });
}

test.afterEach(async () => {
  for (const entry of opened.splice(0)) {
    try {
      await entry.page.evaluate(() => window.__webLegendDebug?.leaveWorld());
    } catch {
      // The page may already be closed.
    }
    await entry.context.close();
  }
});

test('bag shows quality and stat comparison, sorts gear first, and equips it', async ({
  browser,
}) => {
  mkdirSync(ARTIFACT_DIR, { recursive: true });
  const { page } = await registerWorld(browser);

  await expect
    .poll(async () => page.getByTestId('gold').innerText(), { timeout: 15_000 })
    .toBe('金币 50');

  await page.getByTestId('inventory-toggle').click();
  await expect(page.getByTestId('inventory-panel')).toBeVisible();

  // The starter weapon sits in the bag, so the panel compares it with the
  // empty weapon slot instead of showing a delta against another item.
  const sword = page.locator('[data-testid="inventory-item"][data-template-id="warrior_sword"]');
  await expect(sword).toHaveCount(1);
  await expect(sword).toHaveAttribute('data-quality', 'common');
  await expect(sword.getByTestId('equipment-comparison')).toHaveAttribute(
    'data-comparison',
    '装备后 攻击 +6',
  );

  await page.getByTestId('inventory-toggle').click();
  await expect(page.getByTestId('inventory-panel')).toBeHidden();

  await moveTo(page, 12, 9);
  await expect(page.getByTestId('shop-toggle')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('shop-toggle').click();
  await expect(page.getByTestId('shop-panel')).toBeVisible();

  const armorOffer = page.locator('[data-testid="shop-offer"][data-template-id="cloth_armor"]');
  await expect(armorOffer).toBeVisible();
  // Every bonus the content defines is shown, including secondary stats.
  await expect(
    page.locator('[data-testid="shop-offer"][data-template-id="leather_armor"]'),
  ).toContainText('防御 +5 · 生命 +15');
  await armorOffer.getByTestId('shop-buy').click();
  await expect(page.getByTestId('shop-gold')).toHaveText('金币 10', { timeout: 10_000 });

  // The centered merchant panel covers the HUD toggles; close it the way a
  // player would before opening the bag.
  await page.getByTestId('shop-panel').getByRole('button', { name: '关闭' }).click();
  await expect(page.getByTestId('shop-panel')).toBeHidden();

  await page.getByTestId('inventory-toggle').click();
  await expect(page.getByTestId('inventory-panel')).toBeVisible();

  const armor = page.locator('[data-testid="inventory-item"][data-template-id="cloth_armor"]');
  await expect(armor).toHaveCount(1);
  await expect(armor).toHaveAttribute('data-quality', 'common');
  await expect(armor.locator('.bag-item-meta')).toHaveText('防御 +2');
  await expect(armor.getByTestId('equipment-comparison')).toHaveAttribute(
    'data-comparison',
    '装备后 防御 +2',
  );
  await page.screenshot({ path: join(ARTIFACT_DIR, 'bag-comparison.png') });

  // Sorting is a display-only view: equipment first, consumables last.
  await page.getByTestId('bag-sort').click();
  await expect(page.getByTestId('bag-sort')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('inventory-item').last()).toHaveAttribute(
    'data-kind',
    'consumable',
  );
  await expect(page.getByTestId('inventory-item').first()).toHaveAttribute(
    'data-kind',
    /weapon|armor/u,
  );
  await page.screenshot({ path: join(ARTIFACT_DIR, 'bag-sorted.png') });

  await armor.getByTestId('equip-item').click();
  await expect(page.getByTestId('equipment-armor')).toHaveAttribute(
    'data-template-id',
    'cloth_armor',
    { timeout: 10_000 },
  );
  await expect(page.getByTestId('equipment-armor')).toContainText('防御 +2');
  await expect(
    page.locator('[data-testid="inventory-item"][data-template-id="cloth_armor"]'),
  ).toHaveCount(0);
  await expect(page.getByTestId('bag-stats')).toContainText('防御 10');
  await page.screenshot({ path: join(ARTIFACT_DIR, 'armor-equipped.png') });
});
