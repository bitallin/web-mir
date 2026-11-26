import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

const ARTIFACT_DIR = join(process.cwd(), 'docs', 'phase-reports', 'alpha-02', 'classes');
const PASSWORD = 'alpha-two-classes';
// Far from the slimes other wilds specs attack, so parallel workers cannot
// steal this one's aggro.
const SLIME_ID = 'wilds_slime_12';
const SLIME_TILE = { x: 42, y: 22 };
const CHARACTER_PREFIX: Record<'warrior' | 'mage' | 'taoist', string> = {
  warrior: 'Warr',
  mage: 'Mage',
  taoist: 'Taoi',
};

test.describe.configure({ mode: 'serial', timeout: 240_000 });

type ClassId = 'warrior' | 'mage' | 'taoist';

type WorldPage = {
  context: BrowserContext;
  page: Page;
  characterName: string;
};

const opened: { context: BrowserContext; page: Page }[] = [];

function token(): string {
  return randomUUID().replace(/-/gu, '').slice(0, 6);
}

async function registerWorld(
  browser: Browser,
  prefix: string,
  classId: ClassId,
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
}

async function appearance(page: Page): Promise<{ textureKey: string; clip: string } | null> {
  return page.evaluate(() => window.__webLegendDebug?.selfAppearance() ?? null);
}

/** Hides the DOM HUD so a screenshot shows the pose, not panel overlays. */
async function hideHud(page: Page): Promise<void> {
  await page.addStyleTag({
    content: '.shell > *:not(.canvas-layer) { visibility: hidden !important; }',
  });
}

async function screenshotWorld(page: Page, file: string): Promise<void> {
  await page.locator('.canvas-layer').screenshot({ path: join(ARTIFACT_DIR, file) });
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

for (const classId of ['warrior', 'mage', 'taoist'] as const) {
  test(`the ${classId} renders its own sheet and walks with its own frames`, async ({
    browser,
  }) => {
    mkdirSync(ARTIFACT_DIR, { recursive: true });
    // Character names are capped at 12 characters; keep the prefix short so
    // the random token survives.
    const { page } = await registerWorld(browser, CHARACTER_PREFIX[classId], classId);

    await expect
      .poll(async () => (await appearance(page))?.textureKey, { timeout: 20_000 })
      .toBe(`character-${classId}`);
    await expect.poll(async () => (await appearance(page))?.clip, { timeout: 10_000 }).toBe('idle');
    await page.screenshot({ path: join(ARTIFACT_DIR, `${classId}.png`) });

    await moveTo(page, 22, 10);
    await expect
      .poll(async () => (await appearance(page))?.clip, {
        timeout: 10_000,
        intervals: [50, 100, 200],
      })
      .toBe('walk');
    await expect.poll(async () => (await appearance(page))?.clip, { timeout: 20_000 }).toBe('idle');
  });
}

test('a warrior swings the basic attack clip at a slime', async ({ browser }) => {
  mkdirSync(ARTIFACT_DIR, { recursive: true });
  const { page } = await registerWorld(browser, 'Swing', 'warrior');
  await transferToWilds(page);
  await moveTo(page, SLIME_TILE.x, SLIME_TILE.y - 1);

  const slime = page.locator(`[data-testid="monster-row"][data-monster-id="${SLIME_ID}"]`);
  await expect(slime).toBeVisible({ timeout: 30_000 });
  await expect(slime).toHaveAttribute('data-state', 'attack', { timeout: 30_000 });
  await hideHud(page);

  await page.evaluate((monsterId) => window.__webLegendDebug?.attackMonster(monsterId), SLIME_ID);
  await expect
    .poll(async () => (await appearance(page))?.clip, {
      timeout: 10_000,
      intervals: [50, 100, 200],
    })
    .toBe('attack');
  await screenshotWorld(page, 'warrior-attack.png');
});

test('a taoist casts the heal skill with the cast clip', async ({ browser }) => {
  mkdirSync(ARTIFACT_DIR, { recursive: true });
  const { page } = await registerWorld(browser, 'Cast', 'taoist');

  const selfId = await page.evaluate(() => window.__webLegendDebug?.selfId() ?? '');
  expect(selfId).not.toBe('');
  await hideHud(page);

  await page.evaluate(
    (targetId) => window.__webLegendDebug?.castSkill('taoist_heal', targetId),
    selfId,
  );
  await expect
    .poll(async () => (await appearance(page))?.clip, {
      timeout: 10_000,
      intervals: [50, 100, 200],
    })
    .toBe('cast');
  await screenshotWorld(page, 'taoist-cast.png');
});
