import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

const ARTIFACT_DIR = join(process.cwd(), 'docs', 'phase-reports', 'alpha-01');
const PASSWORD = 'alpha-one-password';
const SLIME_ID = 'wilds_slime_1';

test.describe.configure({ mode: 'serial', timeout: 180_000 });

const opened: { context: BrowserContext; page: Page }[] = [];

function token(): string {
  return randomUUID().replace(/-/gu, '').slice(0, 6);
}

async function registerWorld(browser: Browser): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  opened.push({ context, page });
  const username = `auto_${token()}`;
  const characterName = `Auto${token()}`;

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

async function transferToWilds(page: Page): Promise<void> {
  await page.evaluate(() => window.__webLegendDebug?.moveToTile(38, 15));
  await expect(page.getByTestId('map-name')).toHaveAttribute('data-map-id', 'starter_wilds', {
    timeout: 30_000,
  });
  await expect(page.getByTestId('connection-status')).toHaveAttribute('data-status', 'connected', {
    timeout: 20_000,
  });
  await page.evaluate(() => window.__webLegendDebug?.moveToTile(19, 10));
  await expect(page.getByTestId('connection-status')).toHaveAttribute('data-status', 'connected', {
    timeout: 20_000,
  });
}

function slimeRow(page: Page) {
  return page.locator(`[data-testid="monster-row"][data-monster-id="${SLIME_ID}"]`);
}

test.beforeAll(() => {
  mkdirSync(ARTIFACT_DIR, { recursive: true });
});

test.afterEach(async () => {
  for (const entry of opened.splice(0)) {
    await entry.page.evaluate(() => window.__webLegendDebug?.leaveWorld()).catch(() => undefined);
    await entry.context.close();
  }
});

test('one click locks and auto-attacks until the target dies', async ({ browser }) => {
  const page = await registerWorld(browser);
  await transferToWilds(page);
  const row = slimeRow(page);
  await expect(row).toBeVisible({ timeout: 15_000 });
  const startHp = Number(await row.getAttribute('data-hp'));

  // One click only. Everything that follows is server-driven.
  await row.click();
  await expect(page.getByTestId('auto-attack-bar')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('target-stop')).toBeVisible();
  await page.screenshot({ path: join(ARTIFACT_DIR, 'auto-attack-running.png') });

  await expect(row).toHaveAttribute('data-state', 'dead', { timeout: 30_000 });
  await expect(row).toHaveAttribute('data-hp', '0');
  expect(startHp).toBeGreaterThan(0);
  await page.screenshot({ path: join(ARTIFACT_DIR, 'auto-attack-killed.png') });

  // Clicking the corpse produces a transient toast; it must not stay on
  // screen or cover the combat panel (TD-CLI-02).
  await row.click();
  const notice = page.getByTestId('last-notice');
  await expect(notice).toContainText('目标已经死亡', { timeout: 10_000 });
  const [toastBox, panelBox] = await Promise.all([
    notice.boundingBox(),
    page.locator('.combat-panel').boundingBox(),
  ]);
  expect(toastBox).not.toBeNull();
  expect(panelBox).not.toBeNull();
  if (toastBox !== null && panelBox !== null) {
    const overlaps =
      toastBox.x < panelBox.x + panelBox.width &&
      toastBox.x + toastBox.width > panelBox.x &&
      toastBox.y < panelBox.y + panelBox.height &&
      toastBox.y + toastBox.height > panelBox.y;
    expect(overlaps).toBe(false);
  }
  await expect(notice).toHaveCount(0, { timeout: 8_000 });

  // The spawn returns; lock it again and stop explicitly.
  await expect
    .poll(async () => row.getAttribute('data-state'), { timeout: 30_000 })
    .not.toBe('dead');
  await row.click();
  await expect(page.getByTestId('auto-attack-bar')).toBeVisible({ timeout: 10_000 });
  await page.getByTestId('target-stop').click();
  await expect(page.getByTestId('auto-attack-bar')).toHaveCount(0, { timeout: 5_000 });
  await expect(page.getByTestId('target-attack')).toBeVisible();
  await page.screenshot({ path: join(ARTIFACT_DIR, 'auto-attack-stopped.png') });
});
