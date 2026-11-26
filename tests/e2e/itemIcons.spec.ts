import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

// Read the manifest as data: Playwright's ESM loader rejects bare JSON imports.
const rawManifest = JSON.parse(
  readFileSync(join(process.cwd(), 'content', 'assets', 'manifest.json'), 'utf8'),
) as { itemIcons: { size: number; templates: Record<string, number> } };

const ARTIFACT_DIR = join(process.cwd(), 'docs', 'phase-reports', 'alpha-02', 'icons');
const PASSWORD = 'alpha-two-icons-password';

function frameOf(templateId: string): string {
  const frame = rawManifest.itemIcons.templates[templateId];
  if (frame === undefined) {
    throw new Error(`manifest has no icon frame for ${templateId}`);
  }
  return String(frame);
}

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
  const username = `icons_${token()}`;
  const characterName = `Icons${token()}`;

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

function iconOf(scope: ReturnType<Page['locator']>) {
  return scope.getByTestId('item-icon');
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

test('every bag and merchant row shows its atlas icon and quality styling', async ({ browser }) => {
  mkdirSync(ARTIFACT_DIR, { recursive: true });
  const { page } = await registerWorld(browser);

  await page.getByTestId('inventory-toggle').click();
  await expect(page.getByTestId('inventory-panel')).toBeVisible();

  // The starter kit fills three stacks; each one must resolve to an icon.
  const bagItems = page.getByTestId('inventory-item');
  await expect(bagItems).toHaveCount(3);
  for (const row of await bagItems.all()) {
    await expect(iconOf(row)).toHaveCount(1);
  }

  const sword = page.locator('[data-testid="inventory-item"][data-template-id="warrior_sword"]');
  await expect(iconOf(sword)).toHaveAttribute('data-frame', frameOf('warrior_sword'));
  await expect(iconOf(sword)).toHaveCSS('width', `${String(rawManifest.itemIcons.size)}px`);
  await expect(iconOf(sword)).toHaveCSS('background-image', /item_icons/u);

  const potion = page.locator('[data-testid="inventory-item"][data-template-id="small_hp_potion"]');
  await expect(iconOf(potion)).toHaveAttribute('data-frame', frameOf('small_hp_potion'));
  await page.screenshot({ path: join(ARTIFACT_DIR, 'bag-icons.png') });

  // Equipping keeps the same icon in the weapon slot.
  await sword.getByTestId('equip-item').click();
  await expect(page.getByTestId('equipment-weapon')).toHaveAttribute(
    'data-template-id',
    'warrior_sword',
    { timeout: 10_000 },
  );
  await expect(iconOf(page.getByTestId('equipment-weapon'))).toHaveAttribute(
    'data-frame',
    frameOf('warrior_sword'),
  );
  await expect(page.getByTestId('equipment-weapon')).toHaveAttribute('data-quality', 'common');
  await page.screenshot({ path: join(ARTIFACT_DIR, 'equipped-icons.png') });

  await page.getByTestId('inventory-toggle').click();
  await expect(page.getByTestId('inventory-panel')).toBeHidden();

  await moveTo(page, 12, 9);
  await expect(page.getByTestId('shop-toggle')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('shop-toggle').click();
  await expect(page.getByTestId('shop-panel')).toBeVisible();

  const offers = page.getByTestId('shop-offer');
  await expect(offers.first()).toBeVisible();
  for (const row of await offers.all()) {
    await expect(iconOf(row)).toHaveCount(1);
  }
  const armorOffer = page.locator('[data-testid="shop-offer"][data-template-id="cloth_armor"]');
  await expect(iconOf(armorOffer)).toHaveAttribute('data-frame', frameOf('cloth_armor'));
  await expect(armorOffer).toHaveAttribute('data-quality', 'common');
  await page.screenshot({ path: join(ARTIFACT_DIR, 'shop-icons.png') });

  // The sell tab reuses the same icon component for owned stacks.
  await page.getByTestId('shop-tab-sell').click();
  const sellRows = page.getByTestId('shop-sell-item');
  await expect(sellRows.first()).toBeVisible();
  for (const row of await sellRows.all()) {
    await expect(iconOf(row)).toHaveCount(1);
  }
  await page.screenshot({ path: join(ARTIFACT_DIR, 'sell-icons.png') });
});
