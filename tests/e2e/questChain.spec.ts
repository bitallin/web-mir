import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

const ARTIFACT_DIR = join(process.cwd(), 'docs', 'phase-reports', 'alpha-03', 'quest-chain');
const PASSWORD = 'alpha-three-quest-chain';

test.describe.configure({ mode: 'serial', timeout: 120_000 });

const opened: { context: BrowserContext; page: Page }[] = [];

function token(): string {
  return randomUUID().replace(/-/gu, '').slice(0, 6);
}

async function registerWorld(browser: Browser): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  opened.push({ context, page });
  const username = `chain_${token()}`;
  const characterName = `Chain${token()}`;

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

test('the full quest chain is visible and grouped by what the player can do', async ({
  browser,
}) => {
  mkdirSync(ARTIFACT_DIR, { recursive: true });
  const page = await registerWorld(browser);

  // The story step wins the guidance hint over the repeatable daily.
  await expect(page.getByTestId('quest-hint')).toContainText('可接任务：清理史莱姆', {
    timeout: 20_000,
  });

  await page.getByTestId('quest-toggle').click();
  const panel = page.getByTestId('quest-panel');
  await expect(panel).toBeVisible({ timeout: 10_000 });
  await expect(panel).toContainText('任务 · 全部地图');

  // Actionable quests come first; the ten-step chain, the two one-time side
  // quests and the repeatable dailies stay visible as goals.
  await expect(page.getByTestId('quest-section-title')).toHaveText(['可接取', '尚未解锁']);
  await expect(page.getByTestId('quest-section-count')).toHaveText(['4', '12']);
  await expect(
    page.locator('[data-testid="quest-section"][data-section="available"]'),
  ).toBeVisible();
  await expect(page.locator('[data-testid="quest-section"][data-section="locked"]')).toBeVisible();

  const scoutQuest = page.locator('[data-testid="quest-row"][data-quest-id="quest_ruins_bones"]');
  await expect(scoutQuest).toHaveAttribute('data-status', 'locked');
  await expect(scoutQuest.getByTestId('quest-location')).toContainText('残垣废墟');
  await expect(scoutQuest.getByTestId('quest-location')).toContainText('废墟斥候');

  await page.screenshot({ path: join(ARTIFACT_DIR, 'e2e-panel-sections.png') });
  await scoutQuest.scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(ARTIFACT_DIR, 'e2e-panel-chain.png') });
});
