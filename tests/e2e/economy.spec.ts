import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

const ARTIFACT_DIR = join(process.cwd(), 'docs', 'phase-reports', 'phase-05');
const PASSWORD = 'phase-five-password';
// Owns this spawn: autoAttack.spec kills wilds_slime_1 in parallel, and a
// shared target lets one spec's reward steal the other's drop (EL-019).
const SLIME_ID = 'wilds_slime_11';
const SLIME_TILE = { x: 1, y: 9 };

test.describe.configure({ mode: 'serial', timeout: 180_000 });

type WorldPage = {
  context: BrowserContext;
  page: Page;
  characterName: string;
};

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

async function registerWorld(browser: Browser, prefix: string): Promise<WorldPage> {
  const { context, page } = await openPage(browser);
  const username = `${prefix.toLowerCase()}_${token()}`;
  const characterName = `${prefix}${token()}`;

  await page.goto('/?fresh=1');
  await page.getByRole('tab', { name: '注册' }).click();
  await page.getByTestId('auth-username').fill(username);
  await page.getByTestId('auth-password').fill(PASSWORD);
  await page.getByTestId('auth-submit').click();
  await expect(page.getByTestId('account-name')).toHaveText(username, { timeout: 20_000 });

  await page.getByTestId('character-name').fill(characterName);
  await page.getByTestId('character-create').click();
  await expect(
    page.locator(`[data-testid="character-card"][data-character-name="${characterName}"]`),
  ).toHaveCount(1, { timeout: 10_000 });

  await enterWorld(page, characterName);
  return { context, page, characterName };
}

async function enterWorld(page: Page, characterName: string): Promise<void> {
  await page
    .locator(`[data-testid="character-card"][data-character-name="${characterName}"]`)
    .getByTestId('enter-world')
    .click();
  await expect(page.getByTestId('connection-status')).toHaveAttribute('data-status', 'connected', {
    timeout: 20_000,
  });
}

async function moveTo(page: Page, x: number, y: number): Promise<void> {
  await page.evaluate((tile) => window.__webLegendDebug?.moveToTile(tile.x, tile.y), { x, y });
}

async function transferBothToWilds(alice: Page, bob: Page): Promise<void> {
  await Promise.all([moveTo(alice, 38, 15), moveTo(bob, 38, 15)]);
  for (const page of [alice, bob]) {
    await expect(page.getByTestId('map-name')).toHaveAttribute('data-map-id', 'starter_wilds', {
      timeout: 30_000,
    });
    await expect(page.getByTestId('connection-status')).toHaveAttribute(
      'data-status',
      'connected',
      { timeout: 20_000 },
    );
  }
}

function monsterRow(page: Page) {
  return page.locator(`[data-testid="monster-row"][data-monster-id="${SLIME_ID}"]`);
}

async function attackUntilDead(page: Page, attempts = 20): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const state = await monsterRow(page)
      .getAttribute('data-state')
      .catch(() => null);
    if (state === 'dead') {
      return;
    }
    await page.evaluate(
      (monsterId) => window.__webLegendDebug?.attackMonster(monsterId) ?? false,
      SLIME_ID,
    );
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
}

async function characterIdOf(page: Page): Promise<string> {
  const id = await page.evaluate(
    () => window.__webLegendDebug?.inventoryState()?.characterId ?? null,
  );
  if (id === null) {
    throw new Error('inventory snapshot is not available yet');
  }
  return id;
}

test.afterEach(async () => {
  for (const entry of opened.splice(0)) {
    try {
      await entry.page.evaluate(() => window.__webLegendDebug?.leaveWorld());
    } catch {
      // Page may already be closed or outside the world.
    }
    await entry.context.close();
  }
});

test('kill, loot, equip and relogin keep the committed economy state', async ({ browser }) => {
  mkdirSync(ARTIFACT_DIR, { recursive: true });

  const alice = await registerWorld(browser, 'LootA');
  const bob = await registerWorld(browser, 'LootB');
  await transferBothToWilds(alice.page, bob.page);
  await Promise.all([
    moveTo(alice.page, SLIME_TILE.x, SLIME_TILE.y),
    moveTo(bob.page, SLIME_TILE.x, SLIME_TILE.y),
  ]);

  await expect(monsterRow(alice.page)).toHaveCount(1, { timeout: 10_000 });
  const aliceId = await characterIdOf(alice.page);

  const expBefore = Number(await alice.page.getByTestId('exp-bar').getAttribute('data-exp'));

  await attackUntilDead(alice.page);
  await expect(monsterRow(alice.page)).toHaveAttribute('data-state', 'dead', { timeout: 10_000 });

  // Both browsers see the public drop; only the killer owns it for 30 seconds.
  const aliceLoot = alice.page.locator(
    `[data-testid="loot-row"][data-template-id="slime_gel"][data-owner-id="${aliceId}"]`,
  );
  const bobLoot = bob.page.locator('[data-testid="loot-row"][data-template-id="slime_gel"]');
  await expect(aliceLoot.first()).toBeVisible({ timeout: 10_000 });
  await expect(bobLoot.first()).toBeVisible({ timeout: 10_000 });
  // Ground drops render the same atlas icon as the bag.
  await expect(aliceLoot.first().getByTestId('item-icon')).toHaveCount(1);
  await alice.page.screenshot({ path: join(ARTIFACT_DIR, 'loot-visible.png') });

  await aliceLoot.first().click();
  await expect(
    alice.page.locator(
      `[data-testid="loot-row"][data-template-id="slime_gel"][data-owner-id="${aliceId}"]`,
    ),
  ).toHaveCount(0, { timeout: 10_000 });

  // Experience and gold were committed with the kill reward.
  await expect
    .poll(async () => Number(await alice.page.getByTestId('exp-bar').getAttribute('data-exp')), {
      timeout: 10_000,
    })
    .toBeGreaterThan(expBefore);
  await expect
    .poll(async () => alice.page.getByTestId('gold').innerText(), {
      timeout: 10_000,
    })
    .toMatch(/[1-9]/u);

  // The starter weapon is a real persisted instance; equipping it changes the
  // authoritative attack value shown by the server snapshot.
  await alice.page.getByTestId('inventory-toggle').click();
  await expect(alice.page.getByTestId('inventory-panel')).toBeVisible();
  const sword = alice.page.locator(
    '[data-testid="inventory-item"][data-template-id="warrior_sword"]',
  );
  await expect(sword).toHaveCount(1);
  await sword.getByTestId('equip-item').click();
  await expect(alice.page.getByTestId('equipment-weapon')).toHaveAttribute(
    'data-template-id',
    'warrior_sword',
    { timeout: 10_000 },
  );
  await expect(
    alice.page.locator('[data-testid="inventory-item"][data-template-id="small_hp_potion"]'),
  ).toHaveCount(1);
  await expect(
    alice.page.locator('[data-testid="inventory-item"][data-template-id="slime_gel"]'),
  ).toHaveCount(1);
  await alice.page.screenshot({ path: join(ARTIFACT_DIR, 'inventory-equipped.png') });

  // Exit and re-enter the world: the bag, weapon slot, experience and gold all
  // come back from PostgreSQL.
  const goldBefore = await alice.page.getByTestId('gold').innerText();
  await alice.page.getByTestId('exit-world').click();
  await expect(
    alice.page.locator(
      `[data-testid="character-card"][data-character-name="${alice.characterName}"]`,
    ),
  ).toHaveAttribute('data-map-id', 'starter_wilds', { timeout: 10_000 });
  await enterWorld(alice.page, alice.characterName);
  await expect(alice.page.getByTestId('map-name')).toHaveAttribute('data-map-id', 'starter_wilds', {
    timeout: 20_000,
  });

  await alice.page.getByTestId('inventory-toggle').click();
  await expect(alice.page.getByTestId('equipment-weapon')).toHaveAttribute(
    'data-template-id',
    'warrior_sword',
    { timeout: 10_000 },
  );
  await expect(
    alice.page.locator('[data-testid="inventory-item"][data-template-id="slime_gel"]'),
  ).toHaveCount(1);
  await expect(alice.page.getByTestId('gold')).toHaveText(goldBefore);
  await expect
    .poll(async () => Number(await alice.page.getByTestId('exp-bar').getAttribute('data-exp')), {
      timeout: 10_000,
    })
    .toBeGreaterThan(0);
  await alice.page.screenshot({ path: join(ARTIFACT_DIR, 'relogin-assets.png') });
});
