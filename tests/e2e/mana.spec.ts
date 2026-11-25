import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

const ARTIFACT_DIR = join(process.cwd(), 'docs', 'phase-reports', 'alpha-02', 'mana');
const PASSWORD = 'alpha-two-mana-password';
const SLIME_ID = 'wilds_slime_3';

test.describe.configure({ mode: 'serial', timeout: 120_000 });

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

async function registerMage(browser: Browser): Promise<Page> {
  const { page } = await openPage(browser);
  const username = `mana_${token()}`;
  const characterName = `Mana${token()}`;

  await page.goto('/?fresh=1');
  await page.getByRole('tab', { name: '注册' }).click();
  await page.getByTestId('auth-username').fill(username);
  await page.getByTestId('auth-password').fill(PASSWORD);
  await page.getByTestId('auth-submit').click();
  await expect(page.getByTestId('account-name')).toHaveText(username, { timeout: 20_000 });

  await page.getByTestId('class-mage').click();
  await page.getByTestId('character-name').fill(characterName);
  await page.getByTestId('character-create').click();
  await page
    .locator(`[data-testid="character-card"][data-character-name="${characterName}"]`)
    .getByTestId('enter-world')
    .click();
  await expect(page.getByTestId('connection-status')).toHaveAttribute('data-status', 'connected', {
    timeout: 20_000,
  });
  return page;
}

async function moveTo(page: Page, x: number, y: number): Promise<void> {
  await page.evaluate((tile) => window.__webLegendDebug?.moveToTile(tile.x, tile.y), { x, y });
}

async function mana(page: Page): Promise<{ mp: number; max: number } | null> {
  const text = await page.getByTestId('vitals').innerText();
  const match = /法力 (\d+)\/(\d+)/u.exec(text);
  if (match === null) {
    return null;
  }
  return { mp: Number(match[1]), max: Number(match[2]) };
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

test('a mage spends mana and the server regenerates it to the cap', async ({ browser }) => {
  mkdirSync(ARTIFACT_DIR, { recursive: true });
  const page = await registerMage(browser);

  await expect.poll(async () => (await mana(page))?.max ?? 0).toBe(80);

  // Cross into the wilds and stand on an unused slime spawn.
  await moveTo(page, 38, 15);
  await expect(page.getByTestId('map-name')).toHaveAttribute('data-map-id', 'starter_wilds', {
    timeout: 30_000,
  });
  await expect(page.getByTestId('connection-status')).toHaveAttribute('data-status', 'connected', {
    timeout: 20_000,
  });
  await moveTo(page, 11, 20);
  const selfRow = page.locator('[data-testid="player-row"][data-self="true"]');
  await expect(selfRow).toHaveAttribute('data-tile-x', '11', { timeout: 20_000 });
  await expect(selfRow).toHaveAttribute('data-tile-y', '20');
  await expect(
    page.locator(`[data-testid="monster-row"][data-monster-id="${SLIME_ID}"]`),
  ).toHaveCount(1, { timeout: 15_000 });

  const cast = await page.evaluate(
    (monsterId) => window.__webLegendDebug?.castSkill('mage_fireball', monsterId) ?? false,
    SLIME_ID,
  );
  expect(cast).toBe(true);

  // Fireball costs 10 MP. Regen is 3 MP/s, so the first reading may already
  // include one tick; require a visible dip, then a refill to the cap.
  await expect.poll(async () => (await mana(page))?.mp ?? 80, { timeout: 5_000 }).toBeLessThan(80);
  const afterCast = (await mana(page))?.mp ?? 80;
  await expect
    .poll(async () => (await mana(page))?.mp ?? 0, { timeout: 5_000 })
    .toBeGreaterThan(afterCast);

  await page.screenshot({ path: join(ARTIFACT_DIR, 'mana-regenerating.png') });
  await expect.poll(async () => (await mana(page))?.mp ?? 0, { timeout: 10_000 }).toBe(80);
  await page.screenshot({ path: join(ARTIFACT_DIR, 'mana-full.png') });
});
