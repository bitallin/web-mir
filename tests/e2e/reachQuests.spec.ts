import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

const ARTIFACT_DIR = join(process.cwd(), 'docs', 'phase-reports', 'alpha-03', 'reach-quests');
const PASSWORD = 'alpha-three-reach-quest';
const QUEST_ID = 'quest_town_east_gate';

test.describe.configure({ mode: 'serial', timeout: 120_000 });

const opened: { context: BrowserContext; page: Page }[] = [];

function token(): string {
  return randomUUID().replace(/-/gu, '').slice(0, 6);
}

async function registerWorld(browser: Browser): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  opened.push({ context, page });
  const username = `reach_${token()}`;
  const characterName = `Reach${token()}`;

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

test('an arrival quest completes on the authoritative position', async ({ browser }) => {
  mkdirSync(ARTIFACT_DIR, { recursive: true });
  const page = await registerWorld(browser);

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
  await expect(row.getByTestId('quest-objective')).toContainText('到达 晨曦主城（35,15） 未到达');
  await page.screenshot({ path: join(ARTIFACT_DIR, 'reach-offer.png') });

  const goldBefore = await page.evaluate(
    () => window.__webLegendDebug?.inventoryState()?.gold ?? 0,
  );

  await row.getByTestId('quest-accept').click();
  await expect(row).toHaveAttribute('data-status', 'active', { timeout: 10_000 });
  await page.getByTestId('quest-close').click();

  // The world and minimap mark where to go while the objective is open, and
  // the server still owns the arrival check (TD-CLI-24).
  const minimap = page.getByTestId('minimap');
  await expect(minimap).toHaveAttribute('data-quest-markers', '1', { timeout: 10_000 });
  await expect(minimap).toHaveAttribute('data-quest-tiles', '35,15');
  await expect
    .poll(
      async () =>
        page.evaluate(
          (questId) => window.__webLegendDebug?.questMarkerScreenPoint(questId) ?? null,
          QUEST_ID,
        ),
      { timeout: 5_000 },
    )
    .not.toBeNull();
  await page.screenshot({ path: join(ARTIFACT_DIR, 'reach-marker.png') });

  const tracker = page.locator(`[data-testid="quest-tracker-row"][data-quest-id="${QUEST_ID}"]`);
  await tracker.getByTestId('quest-tracker-hunt').click();
  const banner = page.getByTestId('quest-nav-banner');
  await expect(banner).toBeVisible({ timeout: 10_000 });
  await expect(banner).toHaveAttribute('data-purpose', 'hunt');
  await expect(banner).toContainText('自动探索');
  await expect(tracker).toHaveAttribute('data-status', 'completed', { timeout: 30_000 });
  await expect(tracker).toHaveAttribute('data-progress', '1');
  await expect(minimap).toHaveAttribute('data-quest-markers', '0');
  await expect
    .poll(
      async () =>
        page.evaluate(
          (questId) => window.__webLegendDebug?.questMarkerScreenPoint(questId) ?? null,
          QUEST_ID,
        ),
      { timeout: 5_000 },
    )
    .toBeNull();
  await page.screenshot({ path: join(ARTIFACT_DIR, 'reach-completed.png') });

  // One click back hands the quest in on arrival; rewards are paid once.
  await tracker.getByTestId('quest-tracker-return').click();
  await expect(banner).toHaveAttribute('data-purpose', 'return', { timeout: 10_000 });
  await expect
    .poll(
      async () =>
        page.evaluate(
          (questId) =>
            window.__webLegendDebug?.questState().find((quest) => quest.questId === questId)
              ?.status ?? null,
          QUEST_ID,
        ),
      { timeout: 45_000 },
    )
    .toBe('claimed');
  await expect
    .poll(async () => page.evaluate(() => window.__webLegendDebug?.inventoryState()?.gold ?? 0), {
      timeout: 10_000,
    })
    .toBe(goldBefore + 5);
  await page.screenshot({ path: join(ARTIFACT_DIR, 'reach-claimed.png') });
});
