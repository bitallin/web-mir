import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

const ARTIFACT_DIR = join(process.cwd(), 'docs', 'phase-reports', 'alpha-03', 'quest-guidance');
const PASSWORD = 'quest-guidance-password';
const QUEST_ID = 'quest_daily_slime_cleanup';
const GUARD_TILE = { x: 24, y: 12 } as const;

/**
 * One click walks the character to the wilds, auto-attacks the five slimes,
 * then one click returns to the guard and auto-delivers (ADR-039). The room
 * uses `freshTransfer=1` so its wilds instance never competes with another
 * scenario for the same spawns.
 */
test.describe.configure({ mode: 'serial', timeout: 300_000 });

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
  const username = `guidance_${token()}`;
  const characterName = `Guide${token()}`;

  await page.goto('/?fresh=1&freshTransfer=1');
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

test('one-click quest guidance hunts, returns and delivers', async ({ browser }) => {
  mkdirSync(ARTIFACT_DIR, { recursive: true });
  const page = await registerWorld(browser);

  await expect(page.getByTestId('quest-hint')).toContainText('清理史莱姆', { timeout: 20_000 });
  await walkTo(page, GUARD_TILE.x, GUARD_TILE.y);
  const guardPoint = await page.evaluate(
    () => window.__webLegendDebug?.npcScreenPoint('town_guard') ?? null,
  );
  expect(guardPoint).not.toBeNull();
  if (guardPoint !== null) {
    await page.mouse.click(guardPoint.x, guardPoint.y);
  }
  await expect(page.getByTestId('quest-panel')).toBeVisible({ timeout: 10_000 });

  const dailyRow = page.locator(`[data-testid="quest-row"][data-quest-id="${QUEST_ID}"]`);
  await expect(dailyRow).toHaveAttribute('data-repeat', 'daily');
  const goldBefore = await page.evaluate(
    () => window.__webLegendDebug?.inventoryState()?.gold ?? 0,
  );

  await dailyRow.getByTestId('quest-accept-hunt').click();
  const banner = page.getByTestId('quest-nav-banner');
  await expect(banner).toBeVisible({ timeout: 10_000 });
  await expect(banner).toHaveAttribute('data-purpose', 'hunt');
  await page.screenshot({ path: join(ARTIFACT_DIR, 'e2e-nav-hunt.png') });

  // The server walks the character through the town portal into the wilds.
  await expect(page.getByTestId('map-name')).toHaveAttribute('data-map-id', 'starter_wilds', {
    timeout: 60_000,
  });
  const tracker = page.locator(`[data-testid="quest-tracker-row"][data-quest-id="${QUEST_ID}"]`);
  await expect(tracker).toHaveAttribute('data-status', 'completed', { timeout: 180_000 });
  await expect(tracker).toHaveAttribute('data-progress', '5');
  // The giver name comes from the whole world, not only the current map.
  await expect(tracker).toContainText('回到守卫');
  await page.screenshot({ path: join(ARTIFACT_DIR, 'e2e-nav-complete.png') });

  // One click back: the server routes to the wilds portal, then to the guard.
  await tracker.getByTestId('quest-tracker-return').click();
  await expect(banner).toHaveAttribute('data-purpose', 'return', { timeout: 10_000 });
  await expect(page.getByTestId('map-name')).toHaveAttribute('data-map-id', 'starter_town', {
    timeout: 90_000,
  });
  await expect
    .poll(
      async () =>
        page.evaluate(
          (questId) =>
            window.__webLegendDebug?.questState().find((quest) => quest.questId === questId)
              ?.status ?? null,
          QUEST_ID,
        ),
      { timeout: 30_000 },
    )
    .toBe('claimed');

  const goldAfter = await page.evaluate(() => window.__webLegendDebug?.inventoryState()?.gold ?? 0);
  expect(goldAfter).toBeGreaterThanOrEqual(goldBefore + 15);
  await expect(page.getByTestId('quest-nav-banner')).toHaveCount(0);
  await expect(tracker).toHaveCount(0);
  await page.screenshot({ path: join(ARTIFACT_DIR, 'e2e-nav-claimed.png') });
});
