import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

import { setCharacterLevel } from './characterFixture';

const ARTIFACT_DIR = join(process.cwd(), 'docs', 'phase-reports', 'alpha-03', 'boss');
const PASSWORD = 'alpha-three-boss';

test.describe.configure({ mode: 'serial', timeout: 240_000 });

const opened: { context: BrowserContext; page: Page }[] = [];

function token(): string {
  return randomUUID().replace(/-/gu, '').slice(0, 6);
}

async function registerWarrior(browser: Browser): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  opened.push({ context, page });
  const username = `boss_${token()}`;
  const characterName = `Boss${token()}`;

  await page.goto('/?fresh=1');
  await page.getByRole('tab', { name: '注册' }).click();
  await page.getByTestId('auth-username').fill(username);
  await page.getByTestId('auth-password').fill(PASSWORD);
  await page.getByTestId('auth-submit').click();
  await expect(page.getByTestId('account-name')).toHaveText(username, { timeout: 20_000 });

  await page.getByTestId('class-warrior').click();
  await page.getByTestId('character-name').fill(characterName);
  await page.getByTestId('character-create').click();
  await expect(
    page.locator(`[data-testid="character-card"][data-character-name="${characterName}"]`),
  ).toHaveCount(1, { timeout: 10_000 });

  // The browser suite cannot grind to level 40; the fixture writes only to the
  // throwaway E2E database and runs before the character joins a room.
  await setCharacterLevel(characterName, 40);

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

test('the ruins colossus appears with its boss plate and stays out of aggro range', async ({
  browser,
}) => {
  mkdirSync(ARTIFACT_DIR, { recursive: true });
  const page = await registerWarrior(browser);
  const mapName = page.getByTestId('map-name');

  // Enter the ruins through the town's north-west gate.
  await moveTo(page, 3, 2);
  await expect(mapName).toHaveAttribute('data-map-id', 'ruined_fields', { timeout: 30_000 });
  await expect(page.getByTestId('connection-status')).toHaveAttribute('data-status', 'connected', {
    timeout: 20_000,
  });

  // The observation point is inside the boss's AOI but outside its aggro
  // radius, so the plate can be verified without starting a fight the suite
  // cannot finish.
  await moveTo(page, 22, 30);
  const bossRow = page.locator('[data-testid="monster-row"][data-monster-id="ruins_colossus_1"]');
  await expect(bossRow).toBeVisible({ timeout: 30_000 });
  await expect(bossRow).toHaveAttribute('data-boss', 'true');
  await expect(bossRow).toHaveAttribute('data-enraged', 'false');
  await expect(bossRow).toContainText('灰烬魔像');

  const bossBar = page.getByTestId('boss-bar');
  await expect(bossBar).toBeVisible({ timeout: 10_000 });
  await expect(bossBar).toHaveAttribute('data-monster-id', 'ruins_colossus_1');
  await expect(bossBar).toHaveAttribute('data-max-hp', '5200');
  await expect(page.getByTestId('boss-bar-name')).toHaveText('灰烬魔像');
  await expect(page.getByTestId('boss-bar-hp')).toHaveText('5200/5200');
  await expect(page.getByTestId('boss-bar-enraged')).toHaveCount(0);

  const barBox = await bossBar.boundingBox();
  expect(barBox).not.toBeNull();
  if (barBox !== null) {
    const viewport = page.viewportSize();
    // The plate belongs to the top edge: it must stay above the vertical
    // middle so the player and the play area remain unobstructed.
    expect(barBox.y + barBox.height).toBeLessThan((viewport?.height ?? 0) / 2);
  }

  await page.screenshot({
    path: join(ARTIFACT_DIR, 'boss-lair.png'),
    fullPage: false,
  });
});
