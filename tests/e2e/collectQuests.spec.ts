import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

const ARTIFACT_DIR = join(process.cwd(), 'docs', 'phase-reports', 'alpha-03', 'collect-quests');
const PASSWORD = 'alpha-three-collect-quest';
const QUEST_ID = 'quest_supply_delivery';

test.describe.configure({ mode: 'serial', timeout: 120_000 });

const opened: { context: BrowserContext; page: Page }[] = [];

function token(): string {
  return randomUUID().replace(/-/gu, '').slice(0, 6);
}

async function registerWorld(browser: Browser): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  opened.push({ context, page });
  const username = `gather_${token()}`;
  const characterName = `Gather${token()}`;

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
  return page;
}

async function selfTile(page: Page): Promise<{ x: number; y: number }> {
  const row = page.locator('[data-testid="player-row"][data-self="true"]');
  return {
    x: Number(await row.getAttribute('data-tile-x')),
    y: Number(await row.getAttribute('data-tile-y')),
  };
}

async function walkTo(page: Page, x: number, y: number): Promise<void> {
  await page.evaluate((tile) => window.__webLegendDebug?.moveToTile(tile.x, tile.y), { x, y });
  await expect.poll(async () => selfTile(page), { timeout: 30_000 }).toEqual({ x, y });
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

test('a collect quest reads the bag and consumes the items on turn-in', async ({ browser }) => {
  mkdirSync(ARTIFACT_DIR, { recursive: true });
  const page = await registerWorld(browser);

  // The side quest must not steal the story hint from the main chain.
  await expect(page.getByTestId('quest-hint')).toContainText('可接任务：清理史莱姆', {
    timeout: 20_000,
  });

  await walkTo(page, 24, 12);
  const guardPoint = await page.evaluate(
    () => window.__webLegendDebug?.npcScreenPoint('town_guard') ?? null,
  );
  expect(guardPoint).not.toBeNull();
  if (guardPoint !== null) {
    await page.mouse.click(guardPoint.x, guardPoint.y);
  }
  const panel = page.getByTestId('quest-panel');
  await expect(panel).toBeVisible({ timeout: 10_000 });

  const row = page.locator(`[data-testid="quest-row"][data-quest-id="${QUEST_ID}"]`);
  await expect(row).toHaveAttribute('data-status', 'available');
  await expect(row.getByTestId('quest-objective')).toContainText('收集 金创药 0/1');
  await page.screenshot({ path: join(ARTIFACT_DIR, 'collect-offer.png') });

  // The starter kit already holds a potion, so accepting completes the
  // objective immediately: progress is the bag count, not a pickup event.
  await row.getByTestId('quest-accept').click();
  await expect(row).toHaveAttribute('data-status', 'completed', { timeout: 10_000 });
  await expect(row.getByTestId('quest-objective')).toContainText('收集 金创药 1/1');
  await expect(
    page.locator(`[data-testid="quest-tracker-row"][data-quest-id="${QUEST_ID}"]`),
  ).toContainText('可交付');

  const before = await inventory(page);
  const potionsBefore =
    before?.items.find((item) => item.templateId === 'small_hp_potion')?.quantity ?? 0;
  expect(potionsBefore).toBeGreaterThanOrEqual(1);

  await row.getByTestId('quest-claim').click();
  await expect(row).toHaveAttribute('data-status', 'claimed', { timeout: 10_000 });

  // The turn-in consumes one potion and pays only the quest reward.
  await expect
    .poll(async () => (await inventory(page))?.gold ?? null, { timeout: 10_000 })
    .toBe((before?.gold ?? 0) + 15);
  const after = await inventory(page);
  expect(after?.items.find((item) => item.templateId === 'small_hp_potion')?.quantity ?? 0).toBe(
    potionsBefore - 1,
  );
  await page.screenshot({ path: join(ARTIFACT_DIR, 'collect-claimed.png') });
});
