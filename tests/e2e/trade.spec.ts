import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

const ARTIFACT_DIR = join(process.cwd(), 'docs', 'phase-reports', 'alpha-03', 'trade');
const PASSWORD = 'alpha-three-trade-password';

test.describe.configure({ mode: 'serial', timeout: 240_000 });

const opened: { context: BrowserContext; page: Page }[] = [];

function token(): string {
  return randomUUID().replace(/-/gu, '').slice(0, 6);
}

async function registerWorld(
  browser: Browser,
  query: string,
): Promise<{ page: Page; name: string }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  opened.push({ context, page });
  const username = `trade_${token()}`;
  const characterName = `Trade${token()}`;

  await page.goto(`/${query}`);
  await page.getByRole('tab', { name: '注册' }).click();
  await page.getByTestId('auth-username').fill(username);
  await page.getByTestId('auth-password').fill(PASSWORD);
  await page.getByTestId('auth-submit').click();
  await expect(page.getByTestId('account-name')).toHaveText(username, { timeout: 20_000 });

  await page.getByTestId('character-name').fill(characterName);
  await page.getByTestId('character-create').click();
  const card = page.locator(
    `[data-testid="character-card"][data-character-name="${characterName}"]`,
  );
  await expect(card).toHaveCount(1, { timeout: 20_000 });
  await card.getByTestId('enter-world').click();
  await expect(page.getByTestId('connection-status')).toHaveAttribute('data-status', 'connected', {
    timeout: 20_000,
  });
  return { page, name: characterName };
}

function playerRow(page: Page, name: string) {
  return page.locator(`[data-testid="player-row"][data-name="${name}"]`);
}

function tradeBagItem(page: Page, templateId: string) {
  return page.locator(`[data-testid="trade-bag-item"][data-template-id="${templateId}"]`);
}

async function moveTo(page: Page, tileX: number, tileY: number): Promise<void> {
  await page.evaluate(([x, y]) => window.__webLegendDebug?.moveToTile(x ?? 0, y ?? 0), [
    tileX,
    tileY,
  ] as const);
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

test('two nearby players swap a potion and gold after both lock', async ({ browser }) => {
  mkdirSync(ARTIFACT_DIR, { recursive: true });
  const alice = await registerWorld(browser, '?fresh=1');
  const roomId = (await alice.page.getByTestId('room-id').textContent())?.trim() ?? '';
  expect(roomId).not.toBe('');
  expect(roomId).not.toBe('—');
  const bob = await registerWorld(browser, `?join=${roomId}`);

  await expect(playerRow(alice.page, bob.name)).toHaveCount(1, { timeout: 20_000 });
  // Put both on adjacent tiles so the face-to-face range check is deterministic.
  await moveTo(alice.page, 17, 10);
  await moveTo(bob.page, 18, 10);
  await expect(playerRow(alice.page, alice.name)).toHaveAttribute('data-tile-x', '17', {
    timeout: 15_000,
  });
  await expect(playerRow(bob.page, bob.name)).toHaveAttribute('data-tile-x', '18', {
    timeout: 15_000,
  });

  // Alice opens the trade from the nearby-player row; Bob accepts.
  await playerRow(alice.page, bob.name).getByTestId('player-trade').click();
  const invite = bob.page.getByTestId('trade-invite');
  await expect(invite).toBeVisible({ timeout: 15_000 });
  await expect(invite).toContainText(alice.name);
  await bob.page.screenshot({ path: join(ARTIFACT_DIR, 'e2e-trade-invite.png') });
  await invite.getByTestId('trade-invite-accept').click();

  await expect(alice.page.getByTestId('trade-panel')).toHaveAttribute('data-status', 'open', {
    timeout: 15_000,
  });
  await expect(bob.page.getByTestId('trade-panel')).toHaveAttribute('data-status', 'open', {
    timeout: 15_000,
  });
  await expect(alice.page.getByTestId('trade-panel')).toContainText(bob.name);

  // Alice offers her health potions and 10 gold.
  await tradeBagItem(alice.page, 'small_hp_potion').getByTestId('trade-bag-toggle').click();
  await expect(alice.page.getByTestId('trade-self-item')).toHaveCount(1, { timeout: 10_000 });
  await expect(bob.page.getByTestId('trade-other-item')).toHaveCount(1, { timeout: 10_000 });
  await alice.page.getByTestId('trade-gold-input').fill('10');
  await alice.page.getByTestId('trade-gold-set').click();
  await expect(alice.page.getByTestId('trade-self-gold')).toHaveText('金币 10', {
    timeout: 10_000,
  });
  await expect(bob.page.getByTestId('trade-other-gold')).toHaveText('金币 10', {
    timeout: 10_000,
  });

  // Bob offers his mana potions.
  await tradeBagItem(bob.page, 'small_mp_potion').getByTestId('trade-bag-toggle').click();
  await expect(bob.page.getByTestId('trade-self-item')).toHaveCount(1, { timeout: 10_000 });

  // Alice locks first; Bob still has to confirm.
  await alice.page.getByTestId('trade-lock').click();
  await expect(alice.page.getByTestId('trade-self-locked')).toBeVisible({ timeout: 10_000 });
  await expect(bob.page.getByTestId('trade-other-locked')).toBeVisible({ timeout: 10_000 });
  await alice.page.screenshot({ path: join(ARTIFACT_DIR, 'e2e-trade-locked.png') });

  await bob.page.getByTestId('trade-lock').click();
  await expect(alice.page.getByTestId('trade-panel')).toHaveAttribute('data-status', 'completed', {
    timeout: 20_000,
  });
  await expect(bob.page.getByTestId('trade-panel')).toHaveAttribute('data-status', 'completed', {
    timeout: 20_000,
  });
  await expect(alice.page.getByTestId('trade-result')).toContainText('交易完成');
  await alice.page.screenshot({ path: join(ARTIFACT_DIR, 'e2e-trade-completed.png') });
  await alice.page.getByTestId('trade-close').click();
  await bob.page.getByTestId('trade-close').click();
  await expect(alice.page.getByTestId('trade-panel')).toHaveCount(0);

  // The bags now hold the other side's potions, and the gold moved.
  await alice.page.getByTestId('inventory-toggle').click();
  await expect(
    alice.page.locator('[data-testid="inventory-item"][data-template-id="small_mp_potion"]'),
  ).toHaveAttribute('data-quantity', '2', { timeout: 10_000 });
  await expect(
    alice.page.locator('[data-testid="inventory-item"][data-template-id="small_hp_potion"]'),
  ).toHaveCount(0);
  await alice.page.getByTestId('inventory-toggle').click();

  await bob.page.getByTestId('inventory-toggle').click();
  await expect(
    bob.page.locator('[data-testid="inventory-item"][data-template-id="small_hp_potion"]'),
  ).toHaveAttribute('data-quantity', '6', { timeout: 10_000 });
  await expect(
    bob.page.locator('[data-testid="inventory-item"][data-template-id="small_mp_potion"]'),
  ).toHaveCount(0);

  const aliceGold = await alice.page.evaluate(
    () => window.__webLegendDebug?.inventoryState()?.gold ?? -1,
  );
  const bobGold = await bob.page.evaluate(
    () => window.__webLegendDebug?.inventoryState()?.gold ?? -1,
  );
  expect(aliceGold).toBe(40);
  expect(bobGold).toBe(60);
  await bob.page.screenshot({ path: join(ARTIFACT_DIR, 'e2e-trade-aftermath.png') });
});

test('an invited player can decline and no trade panel opens', async ({ browser }) => {
  mkdirSync(ARTIFACT_DIR, { recursive: true });
  const alice = await registerWorld(browser, '?fresh=1');
  const roomId = (await alice.page.getByTestId('room-id').textContent())?.trim() ?? '';
  const bob = await registerWorld(browser, `?join=${roomId}`);

  await expect(playerRow(alice.page, bob.name)).toHaveCount(1, { timeout: 20_000 });
  await moveTo(alice.page, 17, 10);
  await moveTo(bob.page, 18, 10);
  await expect(playerRow(alice.page, bob.name).getByTestId('player-trade')).toBeVisible({
    timeout: 15_000,
  });

  await playerRow(alice.page, bob.name).getByTestId('player-trade').click();
  const invite = bob.page.getByTestId('trade-invite');
  await expect(invite).toBeVisible({ timeout: 15_000 });
  await invite.getByTestId('trade-invite-decline').click();

  await expect(alice.page.getByTestId('last-notice')).toContainText('拒绝', { timeout: 10_000 });
  await expect(alice.page.getByTestId('trade-panel')).toHaveCount(0);
  await expect(bob.page.getByTestId('trade-panel')).toHaveCount(0);
});
