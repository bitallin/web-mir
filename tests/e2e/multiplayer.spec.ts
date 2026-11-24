import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

const ARTIFACT_DIR = join(process.cwd(), 'docs', 'phase-reports', 'phase-01');

test.describe.configure({ mode: 'serial' });

type WorldPage = {
  context: BrowserContext;
  page: Page;
  roomId: string;
};

type OpenOptions = {
  fresh?: boolean;
  joinId?: string;
};

const opened: WorldPage[] = [];
const websocketLog: string[] = [];

function uniqueName(prefix: string): string {
  return `${prefix}${String(Math.floor(Math.random() * 9_000) + 1_000)}`;
}

async function openWorld(
  browser: Browser,
  displayName: string,
  options: OpenOptions = {},
): Promise<WorldPage> {
  const context = await browser.newContext();
  const page = await context.newPage();
  const key = `e2e-${crypto.randomUUID()}`;
  const params = new URLSearchParams({ name: displayName, key });
  if (options.fresh === true) {
    params.set('fresh', '1');
  }
  if (options.joinId !== undefined) {
    params.set('join', options.joinId);
  }

  page.on('websocket', (socket) => {
    websocketLog.push(`connected ${socket.url()}`);
    socket.on('framesent', (event) => {
      websocketLog.push(`sent ${String(event.payload.length)} bytes`);
    });
    socket.on('framereceived', (event) => {
      websocketLog.push(`recv ${String(event.payload.length)} bytes`);
    });
  });

  await page.goto(`/?${params.toString()}`);
  await expect(page.getByTestId('connection-status')).toHaveAttribute('data-status', 'connected', {
    timeout: 20_000,
  });
  await expect(page.locator('[data-testid="player-row"][data-self="true"]')).toHaveCount(1, {
    timeout: 10_000,
  });

  const roomId = (await page.getByTestId('room-id').textContent())?.trim() ?? '';
  if (roomId === '' || roomId === '—') {
    throw new Error('The client did not report a room id');
  }

  const world = { context, page, roomId };
  opened.push(world);
  return world;
}

async function expectPlayers(page: Page, count: number): Promise<void> {
  await expect(page.getByTestId('player-count')).toHaveText(String(count), {
    timeout: 15_000,
  });
}

async function screenPointForTile(page: Page, x: number, y: number) {
  const point = await page.evaluate(
    (tile) => window.__webLegendDebug?.screenPointForTile(tile.x, tile.y) ?? null,
    { x, y },
  );
  if (point === null) {
    throw new Error('The world scene is not ready');
  }
  return point;
}

async function waitForSceneGeneration(page: Page, expected: number): Promise<void> {
  await expect
    .poll(async () => page.evaluate(() => window.__webLegendDebug?.sceneGeneration() ?? 0), {
      timeout: 10_000,
    })
    .toBe(expected);
}

test.afterEach(async () => {
  for (const world of opened.splice(0)) {
    try {
      await world.page.evaluate(() => window.__webLegendDebug?.leaveWorld());
    } catch {
      // Page may already be closed.
    }
    await world.context.close();
  }
});

test('two browser contexts see each other and movement reaches the other client within 250ms', async ({
  browser,
}) => {
  mkdirSync(ARTIFACT_DIR, { recursive: true });

  const aliceName = uniqueName('Alice');
  const bobName = uniqueName('Bob');
  const alice = await openWorld(browser, aliceName, { fresh: true });
  const bob = await openWorld(browser, bobName, { joinId: alice.roomId });

  await expectPlayers(alice.page, 2);
  await expectPlayers(bob.page, 2);

  const aliceSelf = alice.page.locator('[data-testid="player-row"][data-self="true"]');
  const startTileX = Number(await aliceSelf.getAttribute('data-tile-x'));
  const startTileY = Number(await aliceSelf.getAttribute('data-tile-y'));

  const bobSeesAlice = bob.page.locator(`[data-testid="player-row"][data-name="${aliceName}"]`);
  await expect(bobSeesAlice).toHaveCount(1);

  const target = { x: 18, y: 10 };
  await alice.page.waitForFunction(() => window.__webLegendDebug !== undefined);
  const point = await screenPointForTile(alice.page, target.x, target.y);

  // Measure what the players actually observe: the pointer event timestamp in
  // Alice's renderer and the moment Bob's DOM reflects the change. Node-side
  // Playwright IPC is deliberately excluded from the 250ms budget.
  await alice.page.evaluate(() => {
    delete window.__e2eClickAt;
    document.querySelector('canvas')?.addEventListener(
      'pointerdown',
      () => {
        window.__e2eClickAt = Date.now();
      },
      { once: true },
    );
  });

  const bobObservedAt = bob.page.evaluate(
    (start: { name: string; x: number; y: number }) =>
      new Promise<number>((resolve, reject) => {
        const changed = (): boolean => {
          const rows = Array.from(document.querySelectorAll('[data-testid="player-row"]'));
          for (const row of rows) {
            if (row.getAttribute('data-name') !== start.name) {
              continue;
            }
            return (
              row.getAttribute('data-moving') === 'true' ||
              row.getAttribute('data-tile-x') !== String(start.x) ||
              row.getAttribute('data-tile-y') !== String(start.y)
            );
          }
          return false;
        };

        if (changed()) {
          resolve(Date.now());
          return;
        }

        const timer = setTimeout(() => {
          observer.disconnect();
          reject(new Error('Timed out waiting for the remote player update'));
        }, 3_000);
        const observer = new MutationObserver(() => {
          if (changed()) {
            clearTimeout(timer);
            observer.disconnect();
            resolve(Date.now());
          }
        });
        observer.observe(document.body, {
          subtree: true,
          childList: true,
          attributes: true,
          characterData: true,
        });
      }),
    { name: aliceName, x: startTileX, y: startTileY },
  );

  await alice.page.mouse.click(point.x, point.y);
  const clickedAt = await alice.page.evaluate(() => window.__e2eClickAt ?? 0);
  const observedAt = await bobObservedAt;
  const visibleAfterMs = observedAt - clickedAt;

  expect(clickedAt).toBeGreaterThan(0);
  expect(visibleAfterMs).toBeGreaterThanOrEqual(0);

  expect(visibleAfterMs).toBeLessThan(250);
  await expect(alice.page.getByTestId('command-count')).toHaveText('指令 1');

  await expect(bobSeesAlice).toHaveAttribute('data-tile-x', String(target.x), {
    timeout: 5_000,
  });
  await expect(aliceSelf).toHaveAttribute('data-tile-x', String(target.x), {
    timeout: 5_000,
  });

  await alice.page.screenshot({ path: join(ARTIFACT_DIR, 'two-players-alice.png') });
  await bob.page.screenshot({ path: join(ARTIFACT_DIR, 'two-players-bob.png') });
  writeFileSync(
    join(ARTIFACT_DIR, 'websocket.log'),
    `# Colyseus websocket frames observed by the Alice browser context\n` +
      `# room ${alice.roomId}; first move visible to Bob after ${String(visibleAfterMs)}ms\n` +
      websocketLog.join('\n') +
      '\n',
  );

  test.info().annotations.push({
    type: 'movement-visibility',
    description: `${String(visibleAfterMs)}ms`,
  });
});

test('a page refresh reconnects to the living room without duplicating the player', async ({
  browser,
}) => {
  const aliceName = uniqueName('Alice');
  const alice = await openWorld(browser, aliceName, { fresh: true });
  const bob = await openWorld(browser, uniqueName('Bob'), { joinId: alice.roomId });

  await expectPlayers(alice.page, 2);
  await expectPlayers(bob.page, 2);

  await alice.page.reload();

  await expect(alice.page.getByTestId('connection-status')).toHaveAttribute(
    'data-status',
    'connected',
    { timeout: 20_000 },
  );
  await expectPlayers(alice.page, 2);
  await expectPlayers(bob.page, 2);
  const bobSeesAlice = bob.page.locator(`[data-testid="player-row"][data-name="${aliceName}"]`);
  await expect(bobSeesAlice).toHaveCount(1);

  // The refreshed client restarts its command sequence at zero; the first
  // move after reconnection must still be accepted by the server.
  const aliceSelf = alice.page.locator('[data-testid="player-row"][data-self="true"]');
  const startTileX = Number(await aliceSelf.getAttribute('data-tile-x'));
  const target = { x: startTileX >= 18 ? 14 : 18, y: 10 };
  const point = await screenPointForTile(alice.page, target.x, target.y);
  await alice.page.mouse.click(point.x, point.y);
  await expect(bobSeesAlice).toHaveAttribute('data-tile-x', String(target.x), {
    timeout: 5_000,
  });
  await expect(alice.page.getByTestId('command-count')).toHaveText('指令 1');

  await alice.page.screenshot({ path: join(ARTIFACT_DIR, 'after-refresh.png') });
});

test('a dropped socket shows the reconnecting state and recovers', async ({ browser }) => {
  const alice = await openWorld(browser, uniqueName('Alice'), { fresh: true });
  const bob = await openWorld(browser, uniqueName('Bob'), { joinId: alice.roomId });

  await expectPlayers(alice.page, 2);
  await expectPlayers(bob.page, 2);

  const dropped = await alice.page.evaluate(
    () => window.__webLegendDebug?.dropConnection() ?? false,
  );
  expect(dropped).toBe(true);

  await expect(alice.page.getByTestId('connection-status')).toHaveAttribute(
    'data-status',
    'reconnecting',
    { timeout: 10_000 },
  );
  await expect(alice.page.getByTestId('connection-status')).toHaveAttribute(
    'data-status',
    'connected',
    { timeout: 20_000 },
  );
  await expectPlayers(bob.page, 2);
});

test('restarting the Phaser scene does not duplicate input listeners', async ({ browser }) => {
  const aliceName = uniqueName('Alice');
  const alice = await openWorld(browser, aliceName, { fresh: true });
  const bob = await openWorld(browser, uniqueName('Bob'), { joinId: alice.roomId });

  await expectPlayers(alice.page, 2);
  await expectPlayers(bob.page, 2);

  const before = await alice.page.evaluate(() => window.__webLegendDebug?.sceneGeneration() ?? 0);
  const restarted = await alice.page.evaluate(
    () => window.__webLegendDebug?.restartScene() ?? false,
  );
  expect(restarted).toBe(true);
  await waitForSceneGeneration(alice.page, before + 1);

  const aliceSelf = alice.page.locator('[data-testid="player-row"][data-self="true"]');
  const startTileX = Number(await aliceSelf.getAttribute('data-tile-x'));
  const target = { x: startTileX >= 18 ? 14 : 18, y: 10 };
  const point = await screenPointForTile(alice.page, target.x, target.y);

  await alice.page.mouse.click(point.x, point.y);
  await expect(alice.page.getByTestId('command-count')).toHaveText('指令 1', {
    timeout: 5_000,
  });

  await expect(
    bob.page.locator(`[data-testid="player-row"][data-name="${aliceName}"]`),
  ).toHaveAttribute('data-tile-x', String(target.x), { timeout: 5_000 });
});
