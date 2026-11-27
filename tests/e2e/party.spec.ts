import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

const ARTIFACT_DIR = join(process.cwd(), 'docs', 'phase-reports', 'alpha-02', 'party');
const PASSWORD = 'alpha-two-party-password';
/** Town portal to the wilds; a transfer drops the character from its party. */
const WILDS_PORTAL = { x: 38, y: 15 } as const;

test.describe.configure({ mode: 'serial', timeout: 240_000 });

const opened: { context: BrowserContext; page: Page }[] = [];

function token(): string {
  return randomUUID().replace(/-/gu, '').slice(0, 6);
}

async function registerWorld(
  browser: Browser,
  query: string,
): Promise<{ page: Page; name: string }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  opened.push({ context, page });
  const username = `party_${token()}`;
  const characterName = `Party${token()}`;

  await page.goto(`/${query}`);
  await page.getByRole('tab', { name: '注册' }).click();
  await page.getByTestId('auth-username').fill(username);
  await page.getByTestId('auth-password').fill(PASSWORD);
  await page.getByTestId('auth-submit').click();
  await expect(page.getByTestId('account-name')).toHaveText(username, { timeout: 20_000 });

  await page.getByTestId('character-name').fill(characterName);
  await page.getByTestId('character-create').click();
  await page
    .locator(`[data-testid="character-card"][data-character-name="${characterName}"]`)
    .getByTestId('enter-world')
    .click();
  await expect(page.getByTestId('connection-status')).toHaveAttribute('data-status', 'connected', {
    timeout: 20_000,
  });
  return { page, name: characterName };
}

function playerRow(page: Page, name: string) {
  return page.locator(`[data-testid="player-row"][data-name="${name}"]`);
}

function memberRow(page: Page, name: string) {
  return page.locator(`[data-testid="party-member"][data-name="${name}"]`);
}

async function invite(page: Page, name: string): Promise<void> {
  const row = playerRow(page, name);
  await expect(row).toHaveCount(1, { timeout: 20_000 });
  await row.getByTestId('player-invite').click();
}

async function acceptInvite(page: Page, fromName: string): Promise<void> {
  const prompt = page.getByTestId('party-invite');
  await expect(prompt).toBeVisible({ timeout: 15_000 });
  await expect(prompt).toContainText(fromName);
  await prompt.getByTestId('party-invite-accept').click();
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

test('players form a party, leave it, and keep it across a map transfer', async ({ browser }) => {
  mkdirSync(ARTIFACT_DIR, { recursive: true });
  // The first player creates an isolated room; the second joins that exact
  // room, which is what makes the two characters visible to each other.
  const alice = await registerWorld(browser, '?fresh=1');
  const roomId = (await alice.page.getByTestId('room-id').textContent())?.trim() ?? '';
  expect(roomId).not.toBe('');
  expect(roomId).not.toBe('—');
  const bob = await registerWorld(browser, `?join=${roomId}`);

  // Both characters spawn in the same town square, so each sees the other.
  await expect(playerRow(alice.page, bob.name)).toHaveCount(1, { timeout: 20_000 });
  await invite(alice.page, bob.name);
  await acceptInvite(bob.page, alice.name);

  await expect(alice.page.getByTestId('party-panel')).toBeVisible({ timeout: 10_000 });
  await expect(bob.page.getByTestId('party-panel')).toBeVisible({ timeout: 10_000 });
  await expect(alice.page.getByTestId('party-member')).toHaveCount(2);
  await expect(bob.page.getByTestId('party-member')).toHaveCount(2);
  await expect(alice.page.getByTestId('party-size')).toHaveText('2/4');
  await expect(memberRow(alice.page, alice.name)).toHaveAttribute('data-leader', 'true');
  await expect(memberRow(bob.page, alice.name)).toHaveAttribute('data-leader', 'true');
  await expect(memberRow(bob.page, bob.name)).toHaveAttribute('data-leader', 'false');

  const aliceState = await alice.page.evaluate(() => window.__webLegendDebug?.partyState());
  expect(aliceState?.members.map((member) => member.displayName)).toEqual(
    expect.arrayContaining([alice.name, bob.name]),
  );
  await alice.page.screenshot({ path: join(ARTIFACT_DIR, 'party-formed.png') });

  // Leaving removes the member from both rosters, while the leader keeps the
  // remaining party of one.
  await bob.page.getByTestId('party-leave').click();
  await expect(bob.page.getByTestId('party-panel')).toHaveCount(0, { timeout: 10_000 });
  await expect(alice.page.getByTestId('party-member')).toHaveCount(1);
  await expect(alice.page.getByTestId('party-size')).toHaveText('1/4');

  // Re-form, then leave the map: parties are bound to the room hosting them.
  await invite(alice.page, bob.name);
  await acceptInvite(bob.page, alice.name);
  await expect(alice.page.getByTestId('party-member')).toHaveCount(2);

  await bob.page.evaluate((tile) => window.__webLegendDebug?.moveToTile(tile.x, tile.y), {
    x: WILDS_PORTAL.x,
    y: WILDS_PORTAL.y,
  });
  await expect(bob.page.getByTestId('map-name')).toHaveAttribute('data-map-id', 'starter_wilds', {
    timeout: 30_000,
  });
  await expect(bob.page.getByTestId('connection-status')).toHaveAttribute(
    'data-status',
    'connected',
    {
      timeout: 20_000,
    },
  );
  // The party survives the map change: both rosters keep both members, and the
  // transferred member becomes online again from the destination room.
  await expect(bob.page.getByTestId('party-panel')).toBeVisible({ timeout: 20_000 });
  await expect(bob.page.getByTestId('party-member')).toHaveCount(2);
  await expect(alice.page.getByTestId('party-member')).toHaveCount(2, { timeout: 15_000 });
  await expect(alice.page.getByTestId('party-size')).toHaveText('2/4');
  await expect(
    alice.page.locator(`[data-testid="party-member"][data-name="${bob.name}"]`),
  ).toHaveAttribute('data-connected', 'true', { timeout: 15_000 });
  await alice.page.screenshot({ path: join(ARTIFACT_DIR, 'party-after-transfer.png') });
});
