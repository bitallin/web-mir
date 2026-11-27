import { randomUUID } from 'node:crypto';

import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

const PASSWORD = 'alpha-three-movement';

test.describe.configure({ mode: 'serial', timeout: 240_000 });

const opened: { context: BrowserContext; page: Page }[] = [];

function token(): string {
  return randomUUID().replace(/-/gu, '').slice(0, 6);
}

async function registerWarrior(browser: Browser): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  opened.push({ context, page });
  const username = `move_${token()}`;
  const characterName = `Move${token()}`;

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

async function samplePositions(
  page: Page,
  samples: number,
  intervalMs: number,
): Promise<{ x: number; y: number }[]> {
  const collected = await page.evaluate(
    async ({ count, interval }) => {
      const out: { x: number; y: number }[] = [];
      for (let index = 0; index < count; index += 1) {
        const position = window.__webLegendDebug?.selfUnitPosition();
        if (position !== null && position !== undefined) {
          out.push(position);
        }
        await new Promise((resolve) => setTimeout(resolve, interval));
      }
      return out;
    },
    { count: samples, interval: intervalMs },
  );
  return collected;
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

test('retargeting mid-step keeps the player moving forward', async ({ browser }) => {
  const page = await registerWarrior(browser);

  // Walk west to a known town tile, then east along the open main street.
  await moveTo(page, 10, 10);
  await page.waitForFunction(
    () => {
      const position = window.__webLegendDebug?.selfUnitPosition();
      return position !== null && position !== undefined && Math.abs(position.x - 10_500) < 200;
    },
    undefined,
    { timeout: 20_000 },
  );
  await moveTo(page, 20, 10);

  // Retarget while the authoritative step is past the current tile's center;
  // the old path builder inserted the center and visibly stepped backwards.
  await page.waitForFunction(
    () => {
      const position = window.__webLegendDebug?.selfUnitPosition();
      return (
        position !== null &&
        position !== undefined &&
        position.x > 11_000 &&
        position.x % 1_000 > 700
      );
    },
    undefined,
    { timeout: 20_000 },
  );
  await moveTo(page, 30, 10);

  const samples = await samplePositions(page, 40, 25);
  expect(samples.length).toBeGreaterThan(20);
  for (let index = 1; index < samples.length; index += 1) {
    expect(samples[index]?.x ?? 0).toBeGreaterThanOrEqual(samples[index - 1]?.x ?? 0);
    expect(Math.abs((samples[index]?.y ?? 0) - 10_500)).toBeLessThanOrEqual(1);
  }
  expect(samples[samples.length - 1]?.x ?? 0).toBeGreaterThan((samples[0]?.x ?? 0) + 2_000);
});

test('auto-attack approach predicts on every frame instead of following 10Hz snapshots', async ({
  browser,
}) => {
  const page = await registerWarrior(browser);

  // The wilds gate sits in the town's east edge.
  await moveTo(page, 38, 15);
  await expect(page.getByTestId('map-name')).toHaveAttribute('data-map-id', 'starter_wilds', {
    timeout: 30_000,
  });
  await expect(page.getByTestId('connection-status')).toHaveAttribute('data-status', 'connected', {
    timeout: 20_000,
  });

  // Owns this spawn: the other wilds specs use different slimes (TD-QA-11).
  await page.evaluate(() => window.__webLegendDebug?.attackMonster('wilds_slime_14'));
  // Wait for the server's approach path to reach the client.
  await page.waitForFunction(
    () => window.__webLegendDebug?.selfUnitPosition() !== null,
    undefined,
    { timeout: 10_000 },
  );

  const samples = await samplePositions(page, 60, 20);
  const moved = samples.filter((sample, index) => {
    const previous = samples[index - 1];
    return previous === undefined || sample.x !== previous.x || sample.y !== previous.y;
  }).length;
  // Following 10Hz snapshots changes the position only ~12 times a second;
  // path prediction changes it on most display frames.
  expect(moved).toBeGreaterThan(30);

  // A 10Hz chase leaves the rendered position frozen for five samples in a
  // row; an unpredicted approach at 20ms sampling runs of one or two at most.
  let longestStill = 0;
  let still = 0;
  for (let index = 1; index < samples.length; index += 1) {
    if (
      samples[index]?.x === samples[index - 1]?.x &&
      samples[index]?.y === samples[index - 1]?.y
    ) {
      still += 1;
      longestStill = Math.max(longestStill, still);
    } else {
      still = 0;
    }
  }
  expect(longestStill).toBeLessThanOrEqual(3);

  const start = samples[0];
  const end = samples[samples.length - 1];
  const travelled = Math.hypot((end?.x ?? 0) - (start?.x ?? 0), (end?.y ?? 0) - (start?.y ?? 0));
  expect(travelled).toBeGreaterThan(2_000);
});
