import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

const ARTIFACT_DIR = join(process.cwd(), 'docs', 'phase-reports', 'alpha-02', 'quests');
const PASSWORD = 'alpha-two-quest-password';
const QUEST_ID = 'quest_slime_cleanup';
/**
 * Exclusive slime spawn, close to the wilds entrance so a level-1 character
 * never crosses wolf/spider territory. Every other spec owns one or two
 * spawns (wilds_slime_1/2/3/8/10/11/12); taking the first living slime would
 * steal combat.spec's target and make its skill assertion flaky (EL-019).
 */
const QUEST_SLIME = { id: 'wilds_slime_9', tile: { x: 1, y: 21 } } as const;

test.describe.configure({ mode: 'serial', timeout: 240_000 });

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

async function registerWorld(browser: Browser): Promise<Page> {
  const { page } = await openPage(browser);
  const username = `quest_${token()}`;
  const characterName = `Quest${token()}`;

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

async function moveTo(page: Page, x: number, y: number): Promise<void> {
  await page.evaluate((tile) => window.__webLegendDebug?.moveToTile(tile.x, tile.y), { x, y });
}

async function selfTile(page: Page): Promise<{ x: number; y: number }> {
  const row = page.locator('[data-testid="player-row"][data-self="true"]');
  return {
    x: Number(await row.getAttribute('data-tile-x')),
    y: Number(await row.getAttribute('data-tile-y')),
  };
}

async function walkTo(page: Page, x: number, y: number): Promise<void> {
  await moveTo(page, x, y);
  await expect.poll(async () => selfTile(page), { timeout: 30_000 }).toEqual({ x, y });
}

function trackerRow(page: Page) {
  return page.locator(`[data-testid="quest-tracker-row"][data-quest-id="${QUEST_ID}"]`);
}

function questRow(page: Page) {
  return page.locator(`[data-testid="quest-row"][data-quest-id="${QUEST_ID}"]`);
}

function questSlimeRow(page: Page) {
  return page.locator(`[data-testid="monster-row"][data-monster-id="${QUEST_SLIME.id}"]`);
}

/** Waits for the dedicated slime to be alive, then lets auto attack kill it. */
async function killSlime(page: Page): Promise<void> {
  const row = questSlimeRow(page);
  await expect(row).toHaveCount(1, { timeout: 15_000 });
  await expect.poll(async () => row.getAttribute('data-state'), { timeout: 20_000 }).not.toBe('dead');
  await page.evaluate(
    (monsterId) => window.__webLegendDebug?.attackMonster(monsterId) ?? false,
    QUEST_SLIME.id,
  );
  await expect
    .poll(async () => row.getAttribute('data-state').catch(() => null), { timeout: 45_000 })
    .toBe('dead');
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

test('the guard quest chain tracks kills and pays out on turn-in', async ({ browser }) => {
  mkdirSync(ARTIFACT_DIR, { recursive: true });
  const page = await registerWorld(browser);

  // The quest chain is the town's next objective after the merchant exists.
  await expect(page.getByTestId('quest-hint')).toContainText('清理史莱姆', { timeout: 20_000 });
  await walkTo(page, 24, 12);

  const guardPoint = await page.evaluate(
    () => window.__webLegendDebug?.npcScreenPoint('town_guard') ?? null,
  );
  expect(guardPoint).not.toBeNull();
  if (guardPoint !== null) {
    await page.mouse.click(guardPoint.x, guardPoint.y);
  }
  await expect(page.getByTestId('quest-panel')).toBeVisible({ timeout: 10_000 });
  await expect(questRow(page)).toHaveAttribute('data-status', 'available');
  await expect(questRow(page)).toHaveAttribute('data-near', 'true');
  await page.screenshot({ path: join(ARTIFACT_DIR, 'quest-offer.png') });

  await questRow(page).getByTestId('quest-accept').click();
  await expect(questRow(page)).toHaveAttribute('data-status', 'active', { timeout: 10_000 });
  await expect(trackerRow(page)).toHaveAttribute('data-progress', '0');
  await expect(trackerRow(page)).toContainText('野地史莱姆 0/3');
  await page.getByTestId('quest-close').click();
  await expect(page.getByTestId('quest-panel')).toHaveCount(0);

  // Walk to the wilds and earn the objective through real combat.
  await moveTo(page, 38, 15);
  await expect(page.getByTestId('map-name')).toHaveAttribute('data-map-id', 'starter_wilds', {
    timeout: 30_000,
  });
  await expect(page.getByTestId('connection-status')).toHaveAttribute('data-status', 'connected', {
    timeout: 20_000,
  });

  await walkTo(page, QUEST_SLIME.tile.x, QUEST_SLIME.tile.y);
  for (let kill = 1; kill <= 3; kill += 1) {
    await killSlime(page);
    await expect(trackerRow(page)).toHaveAttribute('data-progress', String(kill), {
      timeout: 20_000,
    });
  }
  await expect(trackerRow(page)).toHaveAttribute('data-status', 'completed');
  await expect(trackerRow(page)).toContainText('可交付');
  await page.screenshot({ path: join(ARTIFACT_DIR, 'quest-complete.png') });

  // Return to the guard and turn it in.
  await moveTo(page, 1, 16);
  await expect(page.getByTestId('map-name')).toHaveAttribute('data-map-id', 'starter_town', {
    timeout: 30_000,
  });
  await expect(page.getByTestId('connection-status')).toHaveAttribute('data-status', 'connected', {
    timeout: 20_000,
  });
  await walkTo(page, 24, 12);

  const before = await inventory(page);
  const potionsBefore =
    before?.items.find((item) => item.templateId === 'small_hp_potion')?.quantity ?? 0;
  await page.getByTestId('quest-tracker-open').click();
  await expect(page.getByTestId('quest-panel')).toBeVisible();
  await expect(questRow(page)).toHaveAttribute('data-status', 'completed');
  await questRow(page).getByTestId('quest-claim').click();
  await expect(questRow(page)).toHaveAttribute('data-status', 'claimed', { timeout: 10_000 });

  await expect
    .poll(async () => (await inventory(page))?.gold ?? null, { timeout: 10_000 })
    .toBe((before?.gold ?? 0) + 20);
  const after = await inventory(page);
  expect(after?.items.find((item) => item.templateId === 'small_hp_potion')?.quantity).toBe(
    potionsBefore + 1,
  );
  await expect(page.getByTestId('quest-tracker')).toHaveCount(0);
  await expect(trackerRow(page)).toHaveCount(0);
  await page.screenshot({ path: join(ARTIFACT_DIR, 'quest-claimed.png') });
});
