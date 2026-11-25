import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

const ARTIFACT_DIR = join(process.cwd(), 'docs', 'phase-reports', 'phase-04');
const PASSWORD = 'phase-four-password';
const SLIME_ID = 'wilds_slime_2';

test.describe.configure({ mode: 'serial', timeout: 150_000 });

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

  await page
    .locator(`[data-testid="character-card"][data-character-name="${characterName}"]`)
    .getByTestId('enter-world')
    .click();
  await expect(page.getByTestId('connection-status')).toHaveAttribute('data-status', 'connected', {
    timeout: 20_000,
  });
  return { context, page, characterName };
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

async function monsterHp(page: Page): Promise<number> {
  const value = await monsterRow(page).getAttribute('data-hp');
  return Number(value);
}

async function warriorMana(page: Page): Promise<number> {
  const text = await page.getByTestId('vitals').innerText();
  const match = /法力 (\d+)\/30/u.exec(text);
  return match === null ? -1 : Number(match[1]);
}

async function attackUntilHpBelow(page: Page, threshold: number, attempts = 5): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if ((await monsterHp(page)) < threshold) {
      return;
    }
    await page.evaluate(
      (monsterId) => window.__webLegendDebug?.attackMonster(monsterId) ?? false,
      SLIME_ID,
    );
    await new Promise((resolve) => setTimeout(resolve, 950));
  }
}

async function seeSameMonsterHp(alice: Page, bob: Page): Promise<void> {
  await expect
    .poll(
      async () => {
        const [aliceHp, bobHp] = await Promise.all([monsterHp(alice), monsterHp(bob)]);
        return aliceHp === bobHp;
      },
      { timeout: 8_000 },
    )
    .toBe(true);
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

test('two players fight one wilds monster with authoritative hp, skills and respawn', async ({
  browser,
}) => {
  mkdirSync(ARTIFACT_DIR, { recursive: true });

  const alice = await registerWorld(browser, 'FightA');
  const bob = await registerWorld(browser, 'FightB');
  await transferBothToWilds(alice.page, bob.page);

  // Both stand on the monster's spawn tile: the monster stays within its
  // attack range of either player, so basic attacks cannot fall out of range.
  await Promise.all([moveTo(alice.page, 7, 15), moveTo(bob.page, 7, 15)]);

  const aliceSelf = alice.page.locator('[data-testid="player-row"][data-self="true"]');
  const bobSelf = bob.page.locator('[data-testid="player-row"][data-self="true"]');
  await expect(aliceSelf).toHaveAttribute('data-tile-x', '7', { timeout: 20_000 });
  await expect(aliceSelf).toHaveAttribute('data-tile-y', '15');
  await expect(bobSelf).toHaveAttribute('data-tile-x', '7', { timeout: 20_000 });
  await expect(bobSelf).toHaveAttribute('data-tile-y', '15');

  const aliceRow = monsterRow(alice.page);
  const bobRow = monsterRow(bob.page);
  await expect(aliceRow).toHaveCount(1, { timeout: 15_000 });
  await expect(bobRow).toHaveCount(1, { timeout: 15_000 });

  const startHp = await monsterHp(alice.page);
  expect(startHp).toBeGreaterThan(0);

  // Wait until the camera has settled on the arrived player, so the monster
  // body is no longer behind the combat HUD.
  await expect
    .poll(
      async () =>
        alice.page.evaluate(
          (monsterId) => window.__webLegendDebug?.monsterScreenPoint(monsterId)?.y ?? 10_000,
          SLIME_ID,
        ),
      { timeout: 10_000 },
    )
    .toBeLessThan(320);

  // A canvas click on the monster selects it and submits a basic attack.
  const point = await alice.page.evaluate(
    (monsterId) => window.__webLegendDebug?.monsterScreenPoint(monsterId) ?? null,
    SLIME_ID,
  );
  expect(point).not.toBeNull();
  if (point === null) {
    return;
  }
  await alice.page.screenshot({ path: join(ARTIFACT_DIR, 'before-monster-click.png') });
  await alice.page.mouse.click(point.x, point.y);

  await expect(alice.page.getByTestId('target-name')).toHaveText('野地史莱姆', {
    timeout: 10_000,
  });
  await attackUntilHpBelow(alice.page, startHp);
  await expect.poll(async () => monsterHp(alice.page), { timeout: 10_000 }).toBeLessThan(startHp);
  await seeSameMonsterHp(alice.page, bob.page);

  const afterFirstHit = await monsterHp(alice.page);
  await expect(
    bob.page.getByTestId('combat-log-entry').filter({ hasText: '野地史莱姆' }).first(),
  ).toBeVisible({ timeout: 10_000 });

  // Bob's row click selects and attacks the same authoritative monster.
  await bobRow.click();
  await attackUntilHpBelow(bob.page, afterFirstHit);
  await expect
    .poll(async () => monsterHp(bob.page), { timeout: 10_000 })
    .toBeLessThan(afterFirstHit);
  await seeSameMonsterHp(alice.page, bob.page);

  // Auto-attack is server-driven now; stop both loops and make sure the spawn
  // is alive before testing the skill, otherwise the cast targets a corpse and
  // is correctly rejected.
  await Promise.all([
    alice.page.evaluate(() => window.__webLegendDebug?.stopAutoAttack()),
    bob.page.evaluate(() => window.__webLegendDebug?.stopAutoAttack()),
  ]);
  await expect(alice.page.getByTestId('auto-attack-bar')).toHaveCount(0, { timeout: 5_000 });
  await expect.poll(async () => monsterHp(alice.page), { timeout: 30_000 }).toBeGreaterThan(0);

  // The warrior skill spends mana and exposes a server cooldown. Mana now
  // regenerates, so assert the dip rather than a frozen 24/30.
  await alice.page.getByTestId('skill-1').click();
  await expect.poll(async () => warriorMana(alice.page), { timeout: 10_000 }).toBeLessThan(30);
  await expect
    .poll(async () => warriorMana(alice.page), { timeout: 10_000 })
    .toBeGreaterThanOrEqual(24);
  await expect(alice.page.getByTestId('skill-1')).toHaveAttribute('data-cooldown-ms', /[1-9]\d*/u, {
    timeout: 5_000,
  });
  await seeSameMonsterHp(alice.page, bob.page);

  // Finish the monster; both clients must observe the same death.
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const state = await aliceRow.getAttribute('data-state');
    if (state === 'dead') {
      break;
    }
    await alice.page.evaluate(
      (monsterId) => window.__webLegendDebug?.attackMonster(monsterId) ?? false,
      SLIME_ID,
    );
    await new Promise((resolve) => setTimeout(resolve, 950));
  }

  await expect(aliceRow).toHaveAttribute('data-state', 'dead', { timeout: 10_000 });
  await expect(bobRow).toHaveAttribute('data-state', 'dead', { timeout: 10_000 });
  await expect(aliceRow).toHaveAttribute('data-hp', '0');
  await expect(bobRow).toHaveAttribute('data-hp', '0');
  await expect(alice.page.getByTestId('target-state')).toHaveText('死亡');
  await alice.page.screenshot({ path: join(ARTIFACT_DIR, 'monster-defeated.png') });
  await bob.page.screenshot({ path: join(ARTIFACT_DIR, 'combat-witness-bob.png') });

  // The same spawn returns with full hp after the server-side respawn timer.
  await expect(aliceRow).toHaveAttribute('data-hp', String(startHp), { timeout: 20_000 });
  await expect(bobRow).toHaveAttribute('data-hp', String(startHp), { timeout: 10_000 });
  await expect
    .poll(
      async () => {
        const state = await aliceRow.getAttribute('data-state');
        return state !== null && state !== 'dead';
      },
      { timeout: 10_000 },
    )
    .toBe(true);
  await alice.page.screenshot({ path: join(ARTIFACT_DIR, 'monster-respawned.png') });
});
