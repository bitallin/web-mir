import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';

import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

const ARTIFACT_DIR = join(process.cwd(), 'docs', 'phase-reports', 'phase-03');
const PASSWORD = 'phase-two-password';

test.describe.configure({ mode: 'serial' });

type WorldPage = {
  context: BrowserContext;
  page: Page;
  roomId: string;
  characterName: string;
};

const opened: { context: BrowserContext; page: Page }[] = [];
const websocketLog: string[] = [];

function token(): string {
  return randomUUID().replace(/-/gu, '').slice(0, 6);
}

function uniqueUsername(prefix: string): string {
  return `${prefix}_${token()}`;
}

function uniqueCharacterName(prefix: string): string {
  return `${prefix}${token()}`;
}

function lanAddress(): string | null {
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === 'IPv4' && !entry.internal) {
        return entry.address;
      }
    }
  }
  return null;
}

async function openPage(
  browser: Browser,
  url = '/',
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on('websocket', (socket) => {
    websocketLog.push(`connected ${socket.url()}`);
    socket.on('framesent', (event) => {
      websocketLog.push(`sent ${String(event.payload.length)} bytes`);
    });
    socket.on('framereceived', (event) => {
      websocketLog.push(`recv ${String(event.payload.length)} bytes`);
    });
  });
  await page.goto(url);
  const entry = { context, page };
  opened.push(entry);
  return entry;
}

async function registerAndCreateCharacter(
  page: Page,
  username: string,
  characterName: string,
  query = '',
): Promise<void> {
  if (query.length > 0) {
    await page.goto(`/${query}`);
  }
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
}

async function loginAndSelectCharacter(
  page: Page,
  username: string,
  characterName: string,
  query = '',
): Promise<void> {
  if (query.length > 0) {
    await page.goto(`/${query}`);
  }
  await page.getByTestId('auth-username').fill(username);
  await page.getByTestId('auth-password').fill(PASSWORD);
  await page.getByTestId('auth-submit').click();
  await expect(page.getByTestId('account-name')).toHaveText(username, { timeout: 20_000 });
  await expect(
    page.locator(`[data-testid="character-card"][data-character-name="${characterName}"]`),
  ).toHaveCount(1);
}

async function enterWorld(page: Page, characterName: string): Promise<string> {
  await page
    .locator(`[data-testid="character-card"][data-character-name="${characterName}"]`)
    .getByTestId('enter-world')
    .click();
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
  return roomId;
}

async function registerWorld(
  browser: Browser,
  options: { prefix: string; query?: string },
): Promise<WorldPage> {
  const { context, page } = await openPage(browser);
  const username = uniqueUsername(options.prefix.toLowerCase());
  const characterName = uniqueCharacterName(options.prefix);
  await registerAndCreateCharacter(page, username, characterName, options.query ?? '');
  const roomId = await enterWorld(page, characterName);
  return { context, page, roomId, characterName };
}

async function joinWorld(browser: Browser, roomId: string, prefix: string): Promise<WorldPage> {
  const { context, page } = await openPage(browser);
  const username = uniqueUsername(prefix.toLowerCase());
  const characterName = uniqueCharacterName(prefix);
  await registerAndCreateCharacter(page, username, characterName, `?join=${roomId}`);
  await enterWorld(page, characterName);
  return { context, page, roomId, characterName };
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

test('two accounts create characters and see each other within 250ms', async ({ browser }) => {
  mkdirSync(ARTIFACT_DIR, { recursive: true });

  const entry = await openPage(browser);
  await entry.page.screenshot({ path: join(ARTIFACT_DIR, 'auth-screen.png') });

  const aliceUsername = uniqueUsername('alice');
  const aliceCharacter = uniqueCharacterName('Alice');
  await registerAndCreateCharacter(entry.page, aliceUsername, aliceCharacter, '?fresh=1');
  await entry.page.screenshot({ path: join(ARTIFACT_DIR, 'character-screen.png') });
  const aliceRoomId = await enterWorld(entry.page, aliceCharacter);
  const alice: WorldPage = {
    context: entry.context,
    page: entry.page,
    roomId: aliceRoomId,
    characterName: aliceCharacter,
  };
  await expectPlayers(alice.page, 1);

  const bob = await joinWorld(browser, alice.roomId, 'Bob');
  await expectPlayers(alice.page, 2);
  await expectPlayers(bob.page, 2);

  const aliceSelf = alice.page.locator('[data-testid="player-row"][data-self="true"]');
  const startTileX = Number(await aliceSelf.getAttribute('data-tile-x'));
  const startTileY = Number(await aliceSelf.getAttribute('data-tile-y'));

  const bobSeesAlice = bob.page.locator(
    `[data-testid="player-row"][data-name="${alice.characterName}"]`,
  );
  await expect(bobSeesAlice).toHaveCount(1);

  const target = { x: 18, y: 10 };
  await alice.page.waitForFunction(() => window.__webLegendDebug !== undefined);
  const point = await screenPointForTile(alice.page, target.x, target.y);

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
    { name: alice.characterName, x: startTileX, y: startTileY },
  );

  await bob.page.evaluate(() => {
    if (window.__webLegendDebug !== undefined) {
      window.__webLegendDebug.lastMovingSnapshotAt = 0;
    }
  });
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

  const [aliceDebug, bobDebug, aliceFps, bobFps] = await Promise.all([
    alice.page.evaluate(() => ({
      intentAt: window.__webLegendDebug?.lastMoveIntentAt ?? 0,
      ackAt: window.__webLegendDebug?.lastAckAt ?? 0,
      snapshotAt: window.__webLegendDebug?.lastSnapshotAt ?? 0,
    })),
    bob.page.evaluate(() => ({
      movingAt: window.__webLegendDebug?.lastMovingSnapshotAt ?? 0,
    })),
    alice.page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          let frames = 0;
          const started = performance.now();
          const step = (): void => {
            frames += 1;
            if (performance.now() - started < 1_000) {
              requestAnimationFrame(step);
            } else {
              resolve(frames);
            }
          };
          requestAnimationFrame(step);
        }),
    ),
    bob.page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          let frames = 0;
          const started = performance.now();
          const step = (): void => {
            frames += 1;
            if (performance.now() - started < 1_000) {
              requestAnimationFrame(step);
            } else {
              resolve(frames);
            }
          };
          requestAnimationFrame(step);
        }),
    ),
  ]);

  await alice.page.screenshot({ path: join(ARTIFACT_DIR, 'two-players-alice.png') });
  await bob.page.screenshot({ path: join(ARTIFACT_DIR, 'two-players-bob.png') });
  writeFileSync(
    join(ARTIFACT_DIR, 'websocket.log'),
    `# Colyseus websocket frames observed by browser contexts\n` +
      `# room ${alice.roomId}; first move visible to the other client after ${String(visibleAfterMs)}ms\n` +
      `# click->intent ${String(aliceDebug.intentAt - clickedAt)}ms; ` +
      `intent->server ack ${String(aliceDebug.ackAt - aliceDebug.intentAt)}ms; ` +
      `click->Bob first moving snapshot ${String(bobDebug.movingAt - clickedAt)}ms; ` +
      `click->Bob DOM ${String(observedAt - clickedAt)}ms; ` +
      `rAF/s Alice ${String(aliceFps)} Bob ${String(bobFps)}\n` +
      websocketLog.join('\n') +
      '\n',
  );

  test.info().annotations.push({
    type: 'movement-visibility',
    description: `${String(visibleAfterMs)}ms`,
  });
});

test('a page reload returns to the same character without duplicating the player', async ({
  browser,
}) => {
  const alice = await registerWorld(browser, { prefix: 'Alice', query: '?fresh=1' });
  const bob = await joinWorld(browser, alice.roomId, 'Bob');
  await expectPlayers(alice.page, 2);
  await expectPlayers(bob.page, 2);

  await alice.page.goto(`/?join=${alice.roomId}`);
  await expect(
    alice.page.locator(
      `[data-testid="character-card"][data-character-name="${alice.characterName}"]`,
    ),
  ).toHaveCount(1, { timeout: 20_000 });
  await enterWorld(alice.page, alice.characterName);

  await expectPlayers(alice.page, 2);
  await expectPlayers(bob.page, 2);
  const bobSeesAlice = bob.page.locator(
    `[data-testid="player-row"][data-name="${alice.characterName}"]`,
  );
  await expect(bobSeesAlice).toHaveCount(1);

  const aliceSelf = alice.page.locator('[data-testid="player-row"][data-self="true"]');
  const startTileX = Number(await aliceSelf.getAttribute('data-tile-x'));
  const target = { x: startTileX >= 18 ? 14 : 18, y: 10 };
  const point = await screenPointForTile(alice.page, target.x, target.y);
  await alice.page.mouse.click(point.x, point.y);
  await expect(bobSeesAlice).toHaveAttribute('data-tile-x', String(target.x), {
    timeout: 5_000,
  });
  await expect(alice.page.getByTestId('command-count')).toHaveText('指令 1');

  await alice.page.screenshot({ path: join(ARTIFACT_DIR, 'after-reload.png') });
});

test('a second client cannot control a character that is already in the world', async ({
  browser,
}) => {
  const username = uniqueUsername('lease');
  const characterName = uniqueCharacterName('Lease');
  const { page: ownerPage } = await openPage(browser);
  await registerAndCreateCharacter(ownerPage, username, characterName, '?fresh=1');
  const roomId = await enterWorld(ownerPage, characterName);

  const { page: intruderPage } = await openPage(browser);
  await loginAndSelectCharacter(intruderPage, username, characterName, `?join=${roomId}`);
  await intruderPage
    .locator(`[data-testid="character-card"][data-character-name="${characterName}"]`)
    .getByTestId('enter-world')
    .click();

  await expect(intruderPage.getByTestId('connection-status')).toHaveAttribute(
    'data-status',
    'failed',
    { timeout: 20_000 },
  );
  await expect(intruderPage.locator('.connection-detail')).toContainText('另一台设备');

  await expect(ownerPage.getByTestId('connection-status')).toHaveAttribute(
    'data-status',
    'connected',
  );
  await expectPlayers(ownerPage, 1);
});

test('a dropped socket shows the reconnecting state and recovers', async ({ browser }) => {
  const alice = await registerWorld(browser, { prefix: 'Alice', query: '?fresh=1' });
  const bob = await joinWorld(browser, alice.roomId, 'Bob');
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
  const alice = await registerWorld(browser, { prefix: 'Alice', query: '?fresh=1' });
  const bob = await joinWorld(browser, alice.roomId, 'Bob');
  await expectPlayers(alice.page, 2);
  await expectPlayers(bob.page, 2);

  const before = await alice.page.evaluate(() => window.__webLegendDebug?.sceneGeneration() ?? 0);
  const restarted = await alice.page.evaluate(
    () => window.__webLegendDebug?.restartScene() ?? false,
  );
  expect(restarted).toBe(true);
  await expect
    .poll(async () => alice.page.evaluate(() => window.__webLegendDebug?.sceneGeneration() ?? 0), {
      timeout: 10_000,
    })
    .toBe(before + 1);

  const aliceSelf = alice.page.locator('[data-testid="player-row"][data-self="true"]');
  const startTileX = Number(await aliceSelf.getAttribute('data-tile-x'));
  const target = { x: startTileX >= 18 ? 14 : 18, y: 10 };
  const point = await screenPointForTile(alice.page, target.x, target.y);

  await alice.page.mouse.click(point.x, point.y);
  await expect(alice.page.getByTestId('command-count')).toHaveText('指令 1', {
    timeout: 5_000,
  });

  await expect(
    bob.page.locator(`[data-testid="player-row"][data-name="${alice.characterName}"]`),
  ).toHaveAttribute('data-tile-x', String(target.x), { timeout: 5_000 });
});

test('logging out clears the session and returns to the account screen', async ({ browser }) => {
  const { page } = await openPage(browser);
  const username = uniqueUsername('logout');
  const characterName = uniqueCharacterName('Out');
  await registerAndCreateCharacter(page, username, characterName);

  await page.getByTestId('logout').click();
  await expect(page.getByTestId('auth-submit')).toBeVisible({ timeout: 10_000 });

  await page.goto('/');
  await expect(page.getByTestId('auth-submit')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('account-name')).toHaveCount(0);
});

test('registration and the world work on a plain-HTTP LAN origin', async ({ browser }) => {
  const address = lanAddress();
  if (address === null) {
    test.skip(true, 'No non-internal IPv4 address available');
    return;
  }

  const port = process.env.GAME_WEB_PORT ?? '5173';
  const origin = `http://${address}:${port}`;
  const context = await browser.newContext();
  const page = await context.newPage();
  opened.push({ context, page });

  const username = uniqueUsername('lan');
  const characterName = uniqueCharacterName('Lan');
  try {
    await page.goto(`${origin}/?fresh=1`);
    expect(await page.evaluate(() => window.isSecureContext)).toBe(false);
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
    const point = await screenPointForTile(page, 18, 10);
    await page.mouse.click(point.x, point.y);
    await expect(page.getByTestId('command-count')).toHaveText('指令 1', { timeout: 5_000 });
  } finally {
    try {
      await page.evaluate(() => window.__webLegendDebug?.leaveWorld());
    } catch {
      // Already navigated away.
    }
    await context.close();
    opened.pop();
  }
});

test('clicking a blocked tile sends no move command', async ({ browser }) => {
  const alice = await registerWorld(browser, { prefix: 'Alice', query: '?fresh=1' });
  const self = alice.page.locator('[data-testid="player-row"][data-self="true"]');
  const beforeTile = {
    x: await self.getAttribute('data-tile-x'),
    y: await self.getAttribute('data-tile-y'),
  };

  const point = await screenPointForTile(alice.page, 30, 5);
  await alice.page.mouse.click(point.x, point.y);

  await expect(alice.page.getByTestId('command-count')).toHaveText('指令 0');
  await expect(self).toHaveAttribute('data-tile-x', beforeTile.x ?? '');
  await expect(self).toHaveAttribute('data-tile-y', beforeTile.y ?? '');
});

test('a character crosses the town wilds portal and returns without duplicates', async ({
  browser,
}) => {
  mkdirSync(ARTIFACT_DIR, { recursive: true });
  const alice = await registerWorld(browser, { prefix: 'Portal', query: '?fresh=1' });
  const mapName = alice.page.getByTestId('map-name');
  const self = alice.page.locator('[data-testid="player-row"][data-self="true"]');

  await expect(mapName).toHaveAttribute('data-map-id', 'starter_town');
  await alice.page.evaluate(() => window.__webLegendDebug?.moveToTile(38, 15));

  await expect(mapName).toHaveAttribute('data-map-id', 'starter_wilds', { timeout: 30_000 });
  await expect(alice.page.getByTestId('connection-status')).toHaveAttribute(
    'data-status',
    'connected',
    { timeout: 20_000 },
  );
  // The wilds map is a shared fixed room; a live player or another suite may be
  // present. The duplicate rule below is about this character, not total count.
  await expect(self).toHaveCount(1);
  const wildsCount = Number((await alice.page.getByTestId('player-count').textContent()) ?? '0');
  expect(wildsCount).toBeGreaterThanOrEqual(1);
  await expect(self).toHaveAttribute('data-tile-x', '2', { timeout: 10_000 });
  await expect(self).toHaveAttribute('data-tile-y', '16');
  expect(await alice.page.evaluate(() => window.__webLegendDebug?.currentMapId() ?? '')).toBe(
    'starter_wilds',
  );
  await alice.page.screenshot({ path: join(ARTIFACT_DIR, 'wilds-after-transfer.png') });

  await alice.page.evaluate(() => window.__webLegendDebug?.moveToTile(1, 16));

  await expect(mapName).toHaveAttribute('data-map-id', 'starter_town', { timeout: 20_000 });
  await expect(alice.page.getByTestId('connection-status')).toHaveAttribute(
    'data-status',
    'connected',
    { timeout: 20_000 },
  );
  await expectPlayers(alice.page, 1);
  await expect(self).toHaveCount(1);
  await expect(self).toHaveAttribute('data-tile-x', '37', { timeout: 10_000 });
  await expect(self).toHaveAttribute('data-tile-y', '15');
  await alice.page.screenshot({ path: join(ARTIFACT_DIR, 'town-after-return.png') });
});

test('chat reaches the other player on the same map', async ({ browser }) => {
  mkdirSync(ARTIFACT_DIR, { recursive: true });
  const alice = await registerWorld(browser, { prefix: 'Alice', query: '?fresh=1' });
  const bob = await joinWorld(browser, alice.roomId, 'Bob');
  await expectPlayers(alice.page, 2);
  await expectPlayers(bob.page, 2);

  const message = '一起打怪吗？';
  await alice.page.getByTestId('chat-input').fill(message);
  await alice.page.getByTestId('chat-send').click();

  await expect(alice.page.getByTestId('chat-message')).toContainText(message, {
    timeout: 10_000,
  });
  await expect(bob.page.getByTestId('chat-message')).toContainText(message, {
    timeout: 10_000,
  });
  await expect(bob.page.getByTestId('chat-message')).toContainText(alice.characterName);
  await bob.page.screenshot({ path: join(ARTIFACT_DIR, 'chat-received.png') });
});
