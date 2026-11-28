import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

import { setCharacterLevel } from './characterFixture';

const ARTIFACT_DIR = join(process.cwd(), 'docs', 'phase-reports', 'alpha-03', 'guild');
const PASSWORD = 'alpha-three-guild-password';

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
  const username = `guild_${token()}`;
  const characterName = `Guild${token()}`;

  await page.goto(`/${query}`);
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
  await expect(card).toHaveCount(1, { timeout: 20_000 });
  // Guild creation needs level 5; the browser cannot grind it in a test run.
  await setCharacterLevel(characterName, 6);
  await card.getByTestId('enter-world').click();
  await expect(page.getByTestId('connection-status')).toHaveAttribute('data-status', 'connected', {
    timeout: 20_000,
  });
  return { page, name: characterName };
}

function playerRow(page: Page, name: string) {
  return page.locator(`[data-testid="player-row"][data-name="${name}"]`);
}

function guildMemberRow(page: Page, name: string) {
  return page.locator(`[data-testid="guild-member"][data-name="${name}"]`);
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

test('players create a guild, invite across the room, and chat in the guild channel', async ({
  browser,
}) => {
  mkdirSync(ARTIFACT_DIR, { recursive: true });
  const alice = await registerWorld(browser, '?fresh=1');
  const roomId = (await alice.page.getByTestId('room-id').textContent())?.trim() ?? '';
  expect(roomId).not.toBe('');
  expect(roomId).not.toBe('—');
  const bob = await registerWorld(browser, `?join=${roomId}`);

  await expect(playerRow(alice.page, bob.name)).toHaveCount(1, { timeout: 20_000 });

  // Alice creates the guild from the panel; the roster starts with herself.
  const guildName = `黎明${token().slice(0, 3)}`;
  await alice.page.getByTestId('guild-toggle').click();
  const panelBox = await alice.page.getByTestId('guild-panel').boundingBox();
  const viewport = alice.page.viewportSize();
  expect(panelBox).not.toBeNull();
  expect(panelBox?.x ?? 0).toBeGreaterThan((viewport?.width ?? 1280) / 2);
  await alice.page.getByTestId('guild-name-input').fill(guildName);
  await alice.page.getByTestId('guild-create').click();
  await expect(alice.page.getByTestId('guild-name')).toHaveText(guildName, { timeout: 10_000 });
  await expect(alice.page.getByTestId('guild-member')).toHaveCount(1);
  await expect(guildMemberRow(alice.page, alice.name)).toHaveAttribute('data-leader', 'true');
  await alice.page.screenshot({ path: join(ARTIFACT_DIR, 'e2e-guild-created.png') });

  // The leader invites the nearby player from the player list.
  await alice.page.getByTestId('guild-close').click();
  await playerRow(alice.page, bob.name).getByTestId('player-guild-invite').click();
  const invite = bob.page.getByTestId('guild-invite');
  await expect(invite).toBeVisible({ timeout: 15_000 });
  await expect(invite).toContainText(guildName);
  await bob.page.screenshot({ path: join(ARTIFACT_DIR, 'e2e-guild-invite.png') });
  await invite.getByTestId('guild-invite-accept').click();

  // Both rosters show the same two members; Bob is online on Alice's side.
  await alice.page.getByTestId('guild-toggle').click();
  await bob.page.getByTestId('guild-toggle').click();
  await expect(alice.page.getByTestId('guild-member')).toHaveCount(2, { timeout: 10_000 });
  await expect(bob.page.getByTestId('guild-member')).toHaveCount(2, { timeout: 10_000 });
  await expect(guildMemberRow(alice.page, bob.name)).toHaveAttribute('data-online', 'true');
  await expect(alice.page.getByTestId('guild-size')).toContainText('2/30');
  await expect(alice.page.getByTestId('guild-leader')).toContainText(alice.name);
  await alice.page.screenshot({ path: join(ARTIFACT_DIR, 'e2e-guild-roster.png') });

  // Bob's panel shows the same roster; he sends a guild-channel line.
  await expect(bob.page.getByTestId('guild-name')).toHaveText(guildName);
  await expect(bob.page.getByTestId('guild-name')).toHaveText(guildName);
  await bob.page.getByTestId('chat-send-channel').selectOption('guild');
  await bob.page.getByTestId('chat-input').fill('行会集合，准备出发');
  await bob.page.getByTestId('chat-send').click();

  const guildMessage = alice.page
    .locator('[data-testid="chat-message"][data-channel="guild"]')
    .filter({ hasText: '行会集合，准备出发' });
  await expect(guildMessage).toHaveCount(1, { timeout: 10_000 });
  await expect(guildMessage).toContainText('行会');
  await alice.page.getByTestId('chat-filter-guild').click();
  await expect(guildMessage).toHaveCount(1);
  await expect(alice.page.getByTestId('chat-filter-guild')).toHaveAttribute(
    'aria-selected',
    'true',
  );
  // Filtering the log is independent from where the next line is sent.
  await expect(alice.page.getByTestId('chat-send-channel')).toHaveValue('map');
  await alice.page.getByTestId('chat-send-channel').selectOption('guild');
  await expect(alice.page.getByTestId('chat-input')).toHaveAttribute('placeholder', '发送到行会…');
  await alice.page.screenshot({ path: join(ARTIFACT_DIR, 'e2e-guild-chat.png') });

  // Leaving clears the panel and the guild channel for the member.
  await bob.page.getByTestId('guild-leave').click();
  await expect(bob.page.getByTestId('guild-name')).toHaveText('未加入', { timeout: 10_000 });
  await expect(bob.page.getByTestId('guild-member')).toHaveCount(0);
  await expect(bob.page.getByTestId('chat-filter-guild')).toBeDisabled();
  await expect(alice.page.getByTestId('guild-member')).toHaveCount(1, { timeout: 10_000 });
});
