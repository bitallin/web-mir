import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

const ARTIFACT_DIR = join(process.cwd(), 'docs', 'phase-reports', 'alpha-02', 'ruins');
const PASSWORD = 'alpha-two-ruins';

test.describe.configure({ mode: 'serial', timeout: 240_000 });

const opened: { context: BrowserContext; page: Page }[] = [];

function token(): string {
  return randomUUID().replace(/-/gu, '').slice(0, 6);
}

async function registerWarrior(browser: Browser): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  opened.push({ context, page });
  const username = `ruins_${token()}`;
  const characterName = `Ruin${token()}`;

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

test('the ruins are reachable from the town and populated', async ({ browser }) => {
  mkdirSync(ARTIFACT_DIR, { recursive: true });
  const page = await registerWarrior(browser);
  const mapName = page.getByTestId('map-name');

  // The ruins gate sits in the town's north-west corner, away from the paths
  // the shop, PvP and auto-attack specs use (EL-019).
  await moveTo(page, 3, 2);
  await expect(mapName).toHaveAttribute('data-map-id', 'ruined_fields', { timeout: 30_000 });
  await expect(mapName).toContainText('残垣废墟');
  await expect(page.getByTestId('connection-status')).toHaveAttribute('data-status', 'connected', {
    timeout: 20_000,
  });

  await expect(page.getByTestId('pvp-mode')).toHaveAttribute('data-pvp', 'open');
  await expect(page.getByTestId('pvp-mode')).toContainText('野外');

  // Entry is a safe clearing: the nearest residents are visible but outside
  // aggro range, so a low-level character can look before committing. Patrols
  // drift, so assert the skeleton camp (which stays inside the entry AOI)
  // rather than one specific warlock.
  await expect(
    page.locator('[data-testid="monster-row"][data-monster-id="ruins_skeleton_1"]'),
  ).toBeVisible({ timeout: 20_000 });
  const monsterCount = Number(
    (await page.getByTestId('monster-count').innerText()).replace(/\D/gu, ''),
  );
  expect(monsterCount).toBeGreaterThanOrEqual(2);

  await page.screenshot({
    path: join(ARTIFACT_DIR, 'ruins-entry.png'),
    fullPage: false,
  });

  // Walking back onto the return portal puts the character in the town.
  await moveTo(page, 3, 18);
  await expect(mapName).toHaveAttribute('data-map-id', 'starter_town', { timeout: 30_000 });
});
