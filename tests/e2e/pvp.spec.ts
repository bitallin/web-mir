import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

const ARTIFACT_DIR = join(process.cwd(), 'docs', 'phase-reports', 'phase-06');
const PASSWORD = 'phase-six-password';

test.describe.configure({ mode: 'serial', timeout: 180_000 });

type WorldPage = {
  context: BrowserContext;
  page: Page;
  characterName: string;
  roomId: string;
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

async function registerCharacter(
  browser: Browser,
  prefix: string,
): Promise<{ context: BrowserContext; page: Page; characterName: string }> {
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
  return { context, page, characterName };
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
    throw new Error('the client did not report a room id');
  }
  return roomId;
}

/** First player: `?fresh=1` isolates the scenario in a new town room. */
async function registerWorld(browser: Browser, prefix: string): Promise<WorldPage> {
  const registration = await registerCharacter(browser, prefix);
  const roomId = await enterWorld(registration.page, registration.characterName);
  return { ...registration, roomId };
}

/** Second player: registers normally, then rejoins the first player's room. */
async function joinWorld(browser: Browser, roomId: string, prefix: string): Promise<WorldPage> {
  const registration = await registerCharacter(browser, prefix);
  await registration.page.goto(`/?join=${roomId}`);
  await expect(
    registration.page.locator(
      `[data-testid="character-card"][data-character-name="${registration.characterName}"]`,
    ),
  ).toHaveCount(1, { timeout: 15_000 });
  await enterWorld(registration.page, registration.characterName);
  return { ...registration, roomId };
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

function selfRow(page: Page) {
  return page.locator('[data-testid="player-row"][data-self="true"]');
}

async function otherPlayerId(page: Page, characterName: string): Promise<string> {
  const row = page.locator(
    `[data-testid="player-row"][data-name="${characterName}"][data-self="false"]`,
  );
  await expect(row).toHaveCount(1, { timeout: 20_000 });
  const playerId = await row.getAttribute('data-player-id');
  if (playerId === null) {
    throw new Error(`player row for ${characterName} has no id`);
  }
  return playerId;
}

test.afterEach(async () => {
  for (const entry of opened.splice(0)) {
    try {
      await entry.page.evaluate(() => window.__webLegendDebug?.leaveWorld());
    } catch {
      // The page may already be closed or outside the world.
    }
    await entry.context.close();
  }
});

test('town safe zone rejects player attacks on the server', async ({ browser }) => {
  mkdirSync(ARTIFACT_DIR, { recursive: true });
  const alice = await registerWorld(browser, 'ZoneA');
  const bob = await joinWorld(browser, alice.roomId, 'ZoneB');

  const bobId = await otherPlayerId(alice.page, bob.characterName);
  await expect(alice.page.getByTestId('pvp-mode')).toHaveAttribute('data-pvp', 'safe');
  const bobRow = alice.page.locator(`[data-testid="player-row"][data-player-id="${bobId}"]`);
  const hpBefore = await bobRow.getAttribute('data-hp');
  expect(hpBefore).not.toBeNull();
  await alice.page.screenshot({ path: join(ARTIFACT_DIR, 'town-safe-zone.png') });

  await alice.page.locator(`[data-testid="player-attack"][data-player-id="${bobId}"]`).click();

  await expect(alice.page.getByTestId('last-notice')).toContainText('安全区', { timeout: 10_000 });
  await alice.page.waitForTimeout(600);
  expect(await bobRow.getAttribute('data-hp')).toBe(hpBefore);
  expect(await selfRow(bob.page).getAttribute('data-hp')).toBe(hpBefore);
  await expect(bob.page.getByTestId('player-dead')).toHaveCount(0);
  await alice.page.screenshot({ path: join(ARTIFACT_DIR, 'town-safe-zone-rejected.png') });
});

test('wilds pvp kills, announces and revives without a reward', async ({ browser }) => {
  mkdirSync(ARTIFACT_DIR, { recursive: true });
  const alice = await registerWorld(browser, 'DuelA');
  const bob = await joinWorld(browser, alice.roomId, 'DuelB');
  await transferBothToWilds(alice.page, bob.page);

  // A spot at least one aggro radius away from every wilds spawn (ADR-023
  // density), so monsters do not interrupt the duel.
  await Promise.all([moveTo(alice.page, 12, 10), moveTo(bob.page, 13, 10)]);
  await expect(selfRow(alice.page)).toHaveAttribute('data-tile-x', '12', { timeout: 20_000 });
  await expect(selfRow(alice.page)).toHaveAttribute('data-tile-y', '10');
  await expect(selfRow(bob.page)).toHaveAttribute('data-tile-x', '13', { timeout: 20_000 });
  await expect(selfRow(bob.page)).toHaveAttribute('data-tile-y', '10');

  await expect(alice.page.getByTestId('pvp-mode')).toHaveAttribute('data-pvp', 'open');
  const bobId = await otherPlayerId(alice.page, bob.characterName);
  const startingHp = await selfRow(bob.page).getAttribute('data-hp');
  expect(startingHp).not.toBeNull();

  const aliceExpBefore = await alice.page.getByTestId('exp-bar').getAttribute('data-exp');
  const aliceGoldBefore = (await alice.page.getByTestId('gold').textContent())?.trim() ?? '';
  await alice.page.screenshot({ path: join(ARTIFACT_DIR, 'wilds-before-duel.png') });

  for (let attempt = 0; attempt < 24; attempt += 1) {
    await alice.page.evaluate(
      (playerId) => window.__webLegendDebug?.attackPlayer(playerId) ?? false,
      bobId,
    );
    await alice.page.waitForTimeout(950);
    if ((await selfRow(bob.page).getAttribute('data-alive')) === 'false') {
      break;
    }
  }

  await expect(selfRow(bob.page)).toHaveAttribute('data-alive', 'false', { timeout: 10_000 });
  await expect(bob.page.getByTestId('player-dead')).toContainText('你已倒下', { timeout: 5_000 });
  await expect(alice.page.getByTestId('system-message').filter({ hasText: '击败' })).toBeVisible({
    timeout: 10_000,
  });
  await bob.page.screenshot({ path: join(ARTIFACT_DIR, 'wilds-pvp-death.png') });

  // The victim returns at the wilds respawn point with full vitals; a player
  // kill grants no exp, gold or drop.
  await expect(selfRow(bob.page)).toHaveAttribute('data-alive', 'true', { timeout: 20_000 });
  await expect
    .poll(
      async () => {
        const hp = await selfRow(bob.page).getAttribute('data-hp');
        const maxHp = await selfRow(bob.page).getAttribute('data-max-hp');
        return hp !== null && hp === maxHp;
      },
      { timeout: 10_000 },
    )
    .toBe(true);
  await expect(bob.page.getByTestId('player-dead')).toHaveCount(0);
  await expect(alice.page.getByTestId('exp-bar')).toHaveAttribute('data-exp', aliceExpBefore ?? '');
  expect((await alice.page.getByTestId('gold').textContent())?.trim()).toBe(aliceGoldBefore);

  // The revived victim stays inside the attacker's interest area, and the
  // attacker never receives the private respawn event. Both views must still
  // read the victim as alive from the authoritative snapshot rather than keep
  // the death pose.
  const aliceId = await selfRow(alice.page).getAttribute('data-player-id');
  if (aliceId === null) {
    throw new Error('alice row has no player id');
  }
  await expect(
    alice.page.locator(`[data-testid="player-row"][data-player-id="${bobId}"]`),
  ).toHaveAttribute('data-alive', 'true', { timeout: 10_000 });
  await expect
    .poll(
      async () =>
        alice.page.evaluate(
          (playerId) => window.__webLegendDebug?.playerAppearance(playerId)?.clip ?? null,
          bobId,
        ),
      { timeout: 10_000 },
    )
    .not.toBe('death');
  await expect
    .poll(
      async () =>
        bob.page.evaluate(
          (playerId) => window.__webLegendDebug?.playerAppearance(playerId)?.clip ?? null,
          aliceId,
        ),
      { timeout: 10_000 },
    )
    .not.toBe('death');
  await expect
    .poll(
      async () => bob.page.evaluate(() => window.__webLegendDebug?.selfAppearance().clip ?? null),
      { timeout: 10_000 },
    )
    .not.toBe('death');

  await bob.page.screenshot({ path: join(ARTIFACT_DIR, 'wilds-pvp-revived.png') });
});

test('minimap, character panel and filtered chat work in the world', async ({ browser }) => {
  mkdirSync(ARTIFACT_DIR, { recursive: true });
  const alice = await registerWorld(browser, 'PanelA');

  const minimap = alice.page.getByTestId('minimap');
  await expect(minimap).toBeVisible();
  await expect(minimap).toHaveAttribute('data-map-id', 'starter_town');
  await expect
    .poll(async () => minimap.getAttribute('data-self-x'), { timeout: 10_000 })
    .not.toBe('');

  await alice.page.getByTestId('character-toggle').click();
  const panel = alice.page.getByTestId('character-panel');
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('安全区');
  await expect(alice.page.getByTestId('character-level')).not.toHaveText('');
  // The death-cost rule travels with the room's content release, so the UI
  // must describe the release's numbers rather than hardcoded copy.
  await expect(alice.page.getByTestId('death-penalty')).toContainText('10%');
  await expect(alice.page.getByTestId('death-penalty')).toContainText('10 级前保护');

  await alice.page.getByTestId('chat-input').fill('访问 www.example.com 领取奖励');
  await alice.page.getByTestId('chat-send').click();
  await expect(alice.page.getByTestId('system-message').filter({ hasText: '链接' })).toBeVisible({
    timeout: 10_000,
  });
  await expect(alice.page.getByTestId('chat-log')).not.toContainText('www.example.com');
  await alice.page.screenshot({ path: join(ARTIFACT_DIR, 'minimap-panel-chat-filter.png') });
});
