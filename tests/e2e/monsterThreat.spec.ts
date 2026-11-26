import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

const ARTIFACT_DIR = join(process.cwd(), 'docs', 'phase-reports', 'alpha-02', 'monsters');
const PASSWORD = 'alpha-two-monsters';
// The elite owns this corner of the wilds; no other spec approaches it.
const ALPHA_ID = 'wilds_alpha_1';
const ALPHA_TILE = { x: 30, y: 4 };

test.describe.configure({ mode: 'serial', timeout: 240_000 });

type WorldPage = {
  context: BrowserContext;
  page: Page;
};

const opened: { context: BrowserContext; page: Page }[] = [];

function token(): string {
  return randomUUID().replace(/-/gu, '').slice(0, 6);
}

async function registerWarrior(browser: Browser): Promise<WorldPage> {
  const context = await browser.newContext();
  const page = await context.newPage();
  opened.push({ context, page });
  const username = `threat_${token()}`;
  const characterName = `Hunt${token()}`;

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
  return { context, page };
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

/** Hides the DOM HUD so the warning ring is not covered by the center panel. */
async function hideHud(page: Page): Promise<void> {
  await page.addStyleTag({
    content: '.shell > *:not(.canvas-layer) { visibility: hidden !important; }',
  });
}

function isTelegraph(value: unknown): value is { radiusTiles: number; remainingMs: number } {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return typeof record['radiusTiles'] === 'number' && typeof record['remainingMs'] === 'number';
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

test('the alpha wolf telegraphs its pounce before damage lands', async ({ browser }) => {
  mkdirSync(ARTIFACT_DIR, { recursive: true });
  const { page } = await registerWarrior(browser);
  await transferToWilds(page);
  await moveTo(page, ALPHA_TILE.x - 2, ALPHA_TILE.y + 1);

  const alpha = page.locator(`[data-testid="monster-row"][data-monster-id="${ALPHA_ID}"]`);
  await expect(alpha).toBeVisible({ timeout: 40_000 });
  await hideHud(page);

  // Resolve as soon as the warning exists, then shoot the canvas before the
  // 900ms wind-up ends; a settled poll would often capture an empty ground.
  const rawTelegraph: unknown = await page
    .waitForFunction(
      (monsterId) =>
        window.__webLegendDebug
          ?.activeTelegraphs()
          .find((entry) => entry.monsterId === monsterId) ?? null,
      ALPHA_ID,
      { timeout: 20_000, polling: 50 },
    )
    .then((handle) => handle.jsonValue());
  expect(isTelegraph(rawTelegraph)).toBe(true);
  if (!isTelegraph(rawTelegraph)) {
    return;
  }
  expect(rawTelegraph.radiusTiles).toBe(1.5);
  expect(rawTelegraph.remainingMs).toBeGreaterThan(0);

  await page.locator('.canvas-layer').screenshot({ path: join(ARTIFACT_DIR, 'alpha-pounce.png') });

  // The warning clears once the server's impact time passes.
  await expect
    .poll(
      async () =>
        page.evaluate(
          (monsterId) =>
            window.__webLegendDebug
              ?.activeTelegraphs()
              .some((entry) => entry.monsterId === monsterId) ?? false,
          ALPHA_ID,
        ),
      { timeout: 5_000, intervals: [100, 200, 300] },
    )
    .toBe(false);
});
