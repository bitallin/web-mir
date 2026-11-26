import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

const ARTIFACT_DIR = join(process.cwd(), 'docs', 'phase-reports', 'alpha-02', 'hud-relayout');
const SCENE_ARTIFACT_DIR = join(
  process.cwd(),
  'docs',
  'phase-reports',
  'alpha-02',
  'scene-readable',
);
const PASSWORD = 'hud-relayout-password';

test.describe.configure({ mode: 'serial', timeout: 150_000 });

const opened: { context: BrowserContext; page: Page }[] = [];

function token(): string {
  return randomUUID().replace(/-/gu, '').slice(0, 6);
}

function overlaps(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

async function registerWorld(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  opened.push({ context, page });
  const username = `hud_${token()}`;
  const characterName = `Hud${token()}`;

  await page.goto('/?fresh=1');
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
  await expect(card).toHaveCount(1, { timeout: 10_000 });
  await card.getByTestId('enter-world').click();
  await expect(page.getByTestId('connection-status')).toHaveAttribute('data-status', 'connected', {
    timeout: 20_000,
  });
  return page;
}

async function moveTo(page: Page, x: number, y: number): Promise<void> {
  await page.evaluate((tile) => window.__webLegendDebug?.moveToTile(tile.x, tile.y), { x, y });
}

test.beforeAll(() => {
  mkdirSync(ARTIFACT_DIR, { recursive: true });
  mkdirSync(SCENE_ARTIFACT_DIR, { recursive: true });
});

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

test('the status plate stays compact and leaves the play area clear', async ({ browser }) => {
  const page = await registerWorld(browser);

  const plate = page.getByTestId('player-card');
  await expect(plate).toBeVisible();
  await expect(page.getByTestId('vitals')).toContainText('HP');
  await expect(page.getByTestId('vitals')).toContainText('法力');
  await expect(page.getByTestId('exp-bar')).toBeVisible();
  await expect(page.getByTestId('inventory-toggle')).toBeVisible();

  const box = await plate.boundingBox();
  expect(box).not.toBeNull();
  if (box !== null) {
    // The plate is a corner card, not a banner: it must not reach the middle
    // of the screen where the player and the fight are.
    expect(box.width).toBeLessThanOrEqual(380);
    expect(box.height).toBeLessThanOrEqual(200);
    expect(box.x + box.width).toBeLessThan(1280 / 2);
    expect(box.y + box.height).toBeLessThan(720 / 2);
  }
  await page.screenshot({ path: join(ARTIFACT_DIR, 'status-plate.png') });
});

test('chat collapses to its heading and expands again', async ({ browser }) => {
  const page = await registerWorld(browser);

  await expect(page.getByTestId('chat-log')).toBeVisible();
  await expect(page.getByTestId('chat-input')).toBeVisible();

  await page.getByTestId('chat-toggle').click();
  await expect(page.getByTestId('chat-toggle')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByTestId('chat-log')).toBeHidden();
  await expect(page.getByTestId('chat-input')).toBeHidden();
  await page.screenshot({ path: join(ARTIFACT_DIR, 'chat-collapsed.png') });

  await page.getByTestId('chat-toggle').click();
  await expect(page.getByTestId('chat-log')).toBeVisible();
  await expect(page.getByTestId('chat-input')).toBeVisible();
});

test('world name plates declutter: the player keeps its plate, the NPC yields', async ({
  browser,
}) => {
  const page = await registerWorld(browser);

  // Tile (12, 9) stands one tile below the merchant at (12, 8); the
  // pseudo-isometric projection puts the two plates on top of each other.
  await moveTo(page, 12, 9);
  await expect
    .poll(
      async () => {
        const labels = await page.evaluate(() => window.__webLegendDebug?.labels() ?? []);
        const self = labels.find((label) => label.kind === 'player');
        const npc = labels.find((label) => label.id === 'npc:town_merchant');
        if (self === undefined || npc === undefined) {
          return { ready: false };
        }
        const visible = labels.filter((label) => label.visible);
        let visibleCollisions = 0;
        for (let i = 0; i < visible.length; i += 1) {
          for (let j = i + 1; j < visible.length; j += 1) {
            const a = visible[i];
            const b = visible[j];
            if (a !== undefined && b !== undefined && overlaps(a.rect, b.rect)) {
              visibleCollisions += 1;
            }
          }
        }
        return {
          ready: true,
          selfVisible: self.visible,
          npcVisible: npc.visible,
          platesCollide: overlaps(self.rect, npc.rect),
          visibleCollisions,
        };
      },
      { timeout: 15_000 },
    )
    .toEqual({
      ready: true,
      selfVisible: true,
      npcVisible: false,
      platesCollide: true,
      visibleCollisions: 0,
    });

  await page.evaluate(() => {
    const style = document.createElement('style');
    style.id = 'e2e-hide-hud';
    style.textContent = '.shell > *:not(.canvas-layer) { visibility: hidden !important; }';
    document.head.append(style);
  });
  await page.locator('.canvas-layer').screenshot({
    path: join(SCENE_ARTIFACT_DIR, 'name-plates.png'),
  });
  await page.evaluate(() => document.getElementById('e2e-hide-hud')?.remove());
});

test('the merchant docks right and keeps the HUD toggles clickable', async ({ browser }) => {
  const page = await registerWorld(browser);

  await moveTo(page, 12, 9);
  const shopToggle = page.getByTestId('shop-toggle');
  await expect(shopToggle).toBeVisible({ timeout: 15_000 });
  await shopToggle.click();

  const shop = page.getByTestId('shop-panel');
  await expect(shop).toBeVisible();
  const [shopBox, toggleBox] = await Promise.all([
    shop.boundingBox(),
    page.getByTestId('inventory-toggle').boundingBox(),
  ]);
  expect(shopBox).not.toBeNull();
  expect(toggleBox).not.toBeNull();
  if (shopBox !== null && toggleBox !== null) {
    expect(shopBox.x).toBeGreaterThan(1280 / 2);
    expect(overlaps(shopBox, toggleBox)).toBe(false);
  }
  await page.screenshot({ path: join(ARTIFACT_DIR, 'shop-docked.png') });

  // Opening the bag while trading needs no extra close step.
  await page.getByTestId('inventory-toggle').click();
  await expect(page.getByTestId('inventory-panel')).toBeVisible();
  await expect(shop).toBeHidden();
  await page.screenshot({ path: join(ARTIFACT_DIR, 'shop-to-bag.png') });
});
