import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

import { setCharacterLevel } from './characterFixture';

const ARTIFACT_DIR = join(process.cwd(), 'docs', 'phase-reports', 'alpha-02', 'skills');
const PASSWORD = 'alpha-two-skills';
// Other wilds specs use slimes 1–3 around the portal; this one is far away so
// parallel specs cannot pull its aggro or kill it.
const SLIME_ID = 'wilds_slime_10';
const SLIME_TILE = { x: 20, y: 21 };

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

async function registerLeveledWorld(
  browser: Browser,
  prefix: string,
  classId: 'warrior' | 'taoist',
  level: number,
): Promise<WorldPage> {
  const context = await browser.newContext();
  const page = await context.newPage();
  opened.push({ context, page });
  const username = `${prefix.toLowerCase()}_${token()}`;
  const characterName = `${prefix}${token()}`;

  await page.goto('/?fresh=1');
  await page.getByRole('tab', { name: '注册' }).click();
  await page.getByTestId('auth-username').fill(username);
  await page.getByTestId('auth-password').fill(PASSWORD);
  await page.getByTestId('auth-submit').click();
  await expect(page.getByTestId('account-name')).toHaveText(username, { timeout: 20_000 });

  await page.getByTestId(`class-${classId}`).click();
  await page.getByTestId('character-name').fill(characterName);
  await page.getByTestId('character-create').click();
  await expect(
    page.locator(`[data-testid="character-card"][data-character-name="${characterName}"]`),
  ).toHaveCount(1, { timeout: 10_000 });

  // The browser suite cannot grind to level 5; this fixture writes only to the
  // throwaway E2E database and runs before the character joins a room.
  await setCharacterLevel(characterName, level);

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

async function transferToWilds(page: Page): Promise<void> {
  await moveTo(page, 38, 15);
  await expect(page.getByTestId('map-name')).toHaveAttribute('data-map-id', 'starter_wilds', {
    timeout: 30_000,
  });
  await expect(page.getByTestId('connection-status')).toHaveAttribute('data-status', 'connected', {
    timeout: 20_000,
  });
  await moveTo(page, SLIME_TILE.x, SLIME_TILE.y - 1);
  const slime = page.locator(`[data-testid="monster-row"][data-monster-id="${SLIME_ID}"]`);
  await expect(slime).toBeVisible({ timeout: 30_000 });
  // The slime only enters its attack state once the player has actually
  // arrived, which is the observable condition for being inside skill range.
  await expect(slime).toHaveAttribute('data-state', 'attack', { timeout: 30_000 });
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

test('a level-5 taoist casts poison and the server ticks damage over time', async ({ browser }) => {
  mkdirSync(ARTIFACT_DIR, { recursive: true });
  const world = await registerLeveledWorld(browser, 'Poison', 'taoist', 5);
  await transferToWilds(world.page);

  await expect(world.page.getByTestId('skill-2')).toHaveAttribute('data-skill-id', 'taoist_poison');

  await world.page.evaluate(
    (monsterId) => window.__webLegendDebug?.castSkill('taoist_poison', monsterId),
    SLIME_ID,
  );

  await expect(world.page.getByTestId('combat-log')).toContainText('持续伤害', {
    timeout: 6_000,
  });
  await expect
    .poll(
      async () => {
        const row = world.page.locator(
          `[data-testid="monster-row"][data-monster-id="${SLIME_ID}"]`,
        );
        const hp = await row.getAttribute('data-hp').catch(() => null);
        return hp === null ? 0 : Number(hp);
      },
      { timeout: 8_000 },
    )
    .toBeLessThan(50);

  await world.page.screenshot({ path: join(ARTIFACT_DIR, 'taoist-poison.png') });
});

test('a level-5 warrior casts iron skin and the shield absorbs monster damage', async ({
  browser,
}) => {
  mkdirSync(ARTIFACT_DIR, { recursive: true });
  const world = await registerLeveledWorld(browser, 'Shield', 'warrior', 5);
  await transferToWilds(world.page);

  await expect(world.page.getByTestId('skill-2')).toHaveAttribute(
    'data-skill-id',
    'warrior_iron_skin',
  );

  await world.page.keyboard.press('2');
  await expect(world.page.getByTestId('self-shield')).toBeVisible({ timeout: 5_000 });
  await expect(world.page.getByTestId('combat-log')).toContainText('护盾吸收', {
    timeout: 8_000,
  });

  await world.page.screenshot({ path: join(ARTIFACT_DIR, 'warrior-shield.png') });
});
