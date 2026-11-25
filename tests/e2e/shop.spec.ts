import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

const ARTIFACT_DIR = join(process.cwd(), 'docs', 'phase-reports', 'alpha-02', 'shop');
const PASSWORD = 'alpha-two-shop-password';

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

async function registerWorld(
  browser: Browser,
): Promise<{ page: Page; username: string; characterName: string }> {
  const { page } = await openPage(browser);
  const username = `shop_${token()}`;
  const characterName = `Shop${token()}`;

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
  return { page, username, characterName };
}

async function moveTo(page: Page, x: number, y: number): Promise<void> {
  await page.evaluate((tile) => window.__webLegendDebug?.moveToTile(tile.x, tile.y), { x, y });
}

async function inventory(page: Page) {
  return page.evaluate(() => window.__webLegendDebug?.inventoryState() ?? null);
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

test('new character uses starting gold at the town merchant and can sell back', async ({
  browser,
}) => {
  mkdirSync(ARTIFACT_DIR, { recursive: true });
  const { page, characterName } = await registerWorld(browser);

  await expect
    .poll(async () => (await inventory(page))?.gold ?? null, { timeout: 15_000 })
    .toBe(50);
  await expect(page.getByTestId('gold')).toHaveText('金币 50');

  await moveTo(page, 12, 9);
  const shopToggle = page.getByTestId('shop-toggle');
  await expect(shopToggle).toBeVisible({ timeout: 15_000 });
  await shopToggle.click();

  await expect(page.getByTestId('shop-panel')).toBeVisible();
  await expect(page.getByTestId('shop-gold')).toHaveText('金币 50');
  const potionOffer = page.locator(
    '[data-testid="shop-offer"][data-template-id="small_hp_potion"]',
  );
  await expect(potionOffer).toBeVisible();
  await expect(
    page.locator('[data-testid="shop-offer"][data-template-id="cloth_armor"]'),
  ).toHaveCount(1);

  await page.screenshot({ path: join(ARTIFACT_DIR, 'shop-open.png') });

  await potionOffer.getByTestId('shop-buy').click();
  await expect(page.getByTestId('shop-gold')).toHaveText('金币 35', { timeout: 10_000 });
  await expect
    .poll(async () => {
      const state = await inventory(page);
      return {
        gold: state?.gold ?? null,
        potions: state?.items.find((item) => item.templateId === 'small_hp_potion')?.quantity ?? 0,
      };
    })
    .toEqual({ gold: 35, potions: 4 });

  // The level-3 armor is affordable only after more play; the button is shown
  // disabled rather than sending a doomed command.
  await expect(
    page
      .locator('[data-testid="shop-offer"][data-template-id="leather_armor"]')
      .getByTestId('shop-buy'),
  ).toBeDisabled();

  await page.getByTestId('shop-tab-sell').click();
  await expect
    .poll(async () => {
      const state = await inventory(page);
      return state?.items.some((item) => item.templateId === 'small_hp_potion') ?? false;
    })
    .toBe(true);
  await page
    .locator('[data-testid="shop-sell-item"]')
    .filter({ hasText: '金创药' })
    .getByTestId('shop-sell')
    .click();
  await expect(page.getByTestId('shop-gold')).toHaveText('金币 40', { timeout: 10_000 });
  await expect
    .poll(async () => {
      const state = await inventory(page);
      return {
        gold: state?.gold ?? null,
        potions: state?.items.find((item) => item.templateId === 'small_hp_potion')?.quantity ?? 0,
      };
    })
    .toEqual({ gold: 40, potions: 3 });

  await page.screenshot({ path: join(ARTIFACT_DIR, 'shop-after-trade.png') });

  await moveTo(page, 17, 10);
  await expect(shopToggle).toBeHidden({ timeout: 15_000 });
  await expect(page.getByTestId('shop-panel')).toHaveCount(0);

  // Leaving and re-entering must read the committed wallet and bag back from
  // PostgreSQL, not from the client cache.
  await page.evaluate(() => window.__webLegendDebug?.leaveWorld());
  await page.getByTestId('exit-world').click();
  const card = page.locator(
    `[data-testid="character-card"][data-character-name="${characterName}"]`,
  );
  await expect(card).toHaveCount(1, { timeout: 20_000 });
  await card.getByTestId('enter-world').click();
  await expect(page.getByTestId('connection-status')).toHaveAttribute('data-status', 'connected', {
    timeout: 20_000,
  });
  await expect(page.getByTestId('gold')).toHaveText('金币 40', { timeout: 15_000 });
  await expect(page.getByTestId('shop-panel')).toHaveCount(0);
  await expect
    .poll(async () => {
      const state = await inventory(page);
      return state?.items.find((item) => item.templateId === 'small_hp_potion')?.quantity ?? 0;
    })
    .toBe(3);
});
