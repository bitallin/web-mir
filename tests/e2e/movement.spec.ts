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

  // Isolate the wilds instance: monsters left chasing a player from an earlier
  // spec can make the approach test sample a stationary character.
  await page.goto('/?fresh=1&freshTransfer=1');
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
): Promise<{ x: number; y: number; t: number; serverX: number; serverY: number }[]> {
  const collected = await page.evaluate(
    async ({ count, interval }) => {
      const out: { x: number; y: number; t: number; serverX: number; serverY: number }[] = [];
      for (let index = 0; index < count; index += 1) {
        const position = window.__webLegendDebug?.selfUnitPosition();
        const server = window.__webLegendDebug?.selfServerPosition();
        if (position !== null && position !== undefined) {
          out.push({
            ...position,
            t: performance.now(),
            serverX: server?.x ?? -1,
            serverY: server?.y ?? -1,
          });
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

test('keyboard walks diagonally and space stops the character', async ({ browser }) => {
  const page = await registerWarrior(browser);

  await moveTo(page, 10, 10);
  await page.waitForFunction(
    () => {
      const position = window.__webLegendDebug?.selfUnitPosition();
      return (
        position !== null &&
        position !== undefined &&
        Math.abs(position.x - 10_500) < 200 &&
        Math.abs(position.y - 10_500) < 200
      );
    },
    undefined,
    { timeout: 20_000 },
  );

  // Hold two direction keys: the character should move on both axes.
  await page.keyboard.down('d');
  await page.keyboard.down('s');
  await page.waitForFunction(
    () => {
      const position = window.__webLegendDebug?.selfUnitPosition();
      return (
        position !== null && position !== undefined && position.x > 11_500 && position.y > 11_500
      );
    },
    undefined,
    { timeout: 20_000 },
  );
  await page.keyboard.up('d');
  await page.keyboard.up('s');

  await page.keyboard.press('Space');

  // The stop command is authoritative; the predicted position may still ease
  // toward the last snapshot for a moment, so let that settle before sampling.
  await page.waitForTimeout(1_200);
  const stopped = await page.evaluate(() => window.__webLegendDebug?.selfUnitPosition());
  await page.waitForTimeout(500);
  const later = await page.evaluate(() => window.__webLegendDebug?.selfUnitPosition());

  expect(stopped).toBeTruthy();
  expect(later).toBeTruthy();
  const delta = Math.hypot(
    (later?.x ?? 0) - (stopped?.x ?? 0),
    (later?.y ?? 0) - (stopped?.y ?? 0),
  );
  expect(delta).toBeLessThan(20);

  // Typing in chat must not move the character.
  await page.getByTestId('chat-input').click();
  await page.keyboard.press('d');
  await page.keyboard.press('s');
  await page.waitForTimeout(400);
  const afterTyping = await page.evaluate(() => window.__webLegendDebug?.selfUnitPosition());
  const typedDelta = Math.hypot(
    (afterTyping?.x ?? 0) - (later?.x ?? 0),
    (afterTyping?.y ?? 0) - (later?.y ?? 0),
  );
  expect(typedDelta).toBeLessThan(20);
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

  // Walk closer first: a patrolling slime can cross a cell boundary and leave
  // the spawn's AOI, so engaging from the gate is racy (TD-QA-11).
  await moveTo(page, 8, 19);
  await page.waitForFunction(
    () => {
      const position = window.__webLegendDebug?.selfUnitPosition();
      return (
        position !== null &&
        position !== undefined &&
        Math.abs(position.x - 8_500) < 200 &&
        Math.abs(position.y - 19_500) < 200
      );
    },
    undefined,
    { timeout: 30_000 },
  );

  // Owns this spawn: the other wilds specs use different slimes (TD-QA-11).
  const engaged = await page.evaluate(
    () => window.__webLegendDebug?.attackMonster('wilds_slime_14') ?? false,
  );
  expect(engaged).toBe(true);
  const start = await page.evaluate(() => window.__webLegendDebug?.selfUnitPosition());
  expect(start).not.toBeNull();
  // Wait until the server's approved approach path actually moves the client;
  // sampling from spawn would otherwise measure frames before the engage RTT.
  await page.waitForFunction(
    (origin) => {
      const position = window.__webLegendDebug?.selfUnitPosition();
      return (
        position !== null &&
        position !== undefined &&
        Math.hypot(position.x - origin.x, position.y - origin.y) > 300
      );
    },
    start ?? { x: 0, y: 0 },
    { timeout: 10_000 },
  );

  const samples = await samplePositions(page, 60, 20);

  // A client that only follows snapshots moves the predicted position exactly
  // when the authoritative position changes. Path prediction advances the
  // predicted position between snapshots, so these "prediction only" updates
  // are the discriminator; unlike an update-rate threshold this does not
  // depend on the software renderer's frame rate (TD-QA-10).
  let predictionOnlyChanges = 0;
  let serverChanges = 0;
  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1];
    const current = samples[index];
    if (previous === undefined || current === undefined) {
      continue;
    }
    const predictedMoved = current.x !== previous.x || current.y !== previous.y;
    const serverMoved =
      current.serverX !== previous.serverX || current.serverY !== previous.serverY;
    if (serverMoved) {
      serverChanges += 1;
    } else if (predictedMoved) {
      predictionOnlyChanges += 1;
    }
  }
  expect(serverChanges).toBeGreaterThan(4);
  expect(predictionOnlyChanges).toBeGreaterThan(2);

  const first = samples[0];
  const last = samples[samples.length - 1];
  const travelled = Math.hypot((last?.x ?? 0) - (first?.x ?? 0), (last?.y ?? 0) - (first?.y ?? 0));
  expect(travelled).toBeGreaterThan(2_000);
});
