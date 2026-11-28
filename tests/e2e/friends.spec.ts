import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

const ARTIFACT_DIR = join(process.cwd(), 'docs', 'phase-reports', 'alpha-03', 'friends');
const PASSWORD = 'alpha-three-friends-password';

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
  const username = `friends_${token()}`;
  const characterName = `Friend${token()}`;

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

function friendRow(page: Page, name: string) {
  return page.locator(`[data-testid="friend"][data-name="${name}"]`);
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

test('players add a friend, invite them to a party, and filter chat channels', async ({
  browser,
}) => {
  mkdirSync(ARTIFACT_DIR, { recursive: true });
  const alice = await registerWorld(browser, '?fresh=1');
  const roomId = (await alice.page.getByTestId('room-id').textContent())?.trim() ?? '';
  expect(roomId).not.toBe('');
  expect(roomId).not.toBe('—');
  const bob = await registerWorld(browser, `?join=${roomId}`);

  await expect(playerRow(alice.page, bob.name)).toHaveCount(1, { timeout: 20_000 });

  // Alice asks from the nearby list; Bob sees the request in his friend panel.
  await playerRow(alice.page, bob.name).getByTestId('player-add-friend').click();
  await bob.page.getByTestId('friend-toggle').click();
  // The panel docks on the right so it never covers the player or the centre
  // of the play area.
  const panelBox = await bob.page.getByTestId('friend-panel').boundingBox();
  const viewport = bob.page.viewportSize();
  expect(panelBox).not.toBeNull();
  expect(panelBox?.x ?? 0).toBeGreaterThan((viewport?.width ?? 1280) / 2);
  const request = bob.page.locator(`[data-testid="friend-request"][data-name="${alice.name}"]`);
  await expect(request).toHaveCount(1, { timeout: 10_000 });
  await bob.page.screenshot({ path: join(ARTIFACT_DIR, 'e2e-friend-request.png') });
  await request.getByTestId('friend-accept').click();

  // Both rosters see the other player online.
  await expect(friendRow(bob.page, alice.name)).toHaveAttribute('data-online', 'true', {
    timeout: 10_000,
  });
  await alice.page.getByTestId('friend-toggle').click();
  await expect(friendRow(alice.page, bob.name)).toHaveAttribute('data-online', 'true', {
    timeout: 10_000,
  });
  await expect(alice.page.getByTestId('friend-count')).toContainText('1/1');
  await alice.page.screenshot({ path: join(ARTIFACT_DIR, 'e2e-friend-list.png') });

  // Inviting from the friend list forms a party without walking together.
  await friendRow(alice.page, bob.name).getByTestId('friend-invite').click();
  const invite = bob.page.getByTestId('party-invite');
  await expect(invite).toBeVisible({ timeout: 15_000 });
  await invite.getByTestId('party-invite-accept').click();
  await expect(alice.page.getByTestId('party-member')).toHaveCount(2, { timeout: 10_000 });
  await expect(bob.page.getByTestId('party-member')).toHaveCount(2, { timeout: 10_000 });

  // Chat stays private by channel. The log shows every channel by default;
  // the composer select chooses where the next line goes.
  await alice.page.getByTestId('chat-input').fill('map hello from alice');
  await alice.page.getByTestId('chat-send').click();
  await alice.page.getByTestId('chat-send-channel').selectOption('party');
  await expect(alice.page.getByTestId('chat-send-channel')).toHaveValue('party');
  await alice.page.getByTestId('chat-input').fill('party hello from alice');
  await alice.page.getByTestId('chat-send').click();

  const mapMessage = bob.page
    .locator('[data-testid="chat-message"][data-channel="map"]')
    .filter({ hasText: 'map hello from alice' });
  const partyMessage = bob.page
    .locator('[data-testid="chat-message"][data-channel="party"]')
    .filter({ hasText: 'party hello from alice' });
  // Bob's log defaults to “all”, so both channels are visible at once.
  await expect(mapMessage).toHaveCount(1, { timeout: 10_000 });
  await expect(partyMessage).toHaveCount(1, { timeout: 10_000 });

  // Filtering narrows the log only; it must not change where a line is sent.
  await bob.page.getByTestId('chat-filter-map').click();
  await expect(bob.page.getByTestId('chat-filter-map')).toHaveAttribute('aria-selected', 'true');
  await expect(mapMessage).toHaveCount(1);
  await expect(partyMessage).toHaveCount(0);
  await expect(bob.page.getByTestId('chat-send-channel')).toHaveValue('map');

  await bob.page.getByTestId('chat-filter-party').click();
  await expect(mapMessage).toHaveCount(0);
  await expect(partyMessage).toHaveCount(1);
  await expect(bob.page.getByTestId('chat-send-channel')).toHaveValue('map');
  await bob.page.getByTestId('chat-send-channel').selectOption('party');
  await expect(bob.page.getByTestId('chat-input')).toHaveAttribute('placeholder', '发送到队伍…');
  await bob.page.screenshot({ path: join(ARTIFACT_DIR, 'e2e-chat-filter.png') });

  // Whispers start from the friend list and stay between the two players.
  await friendRow(alice.page, bob.name).getByTestId('friend-whisper').click();
  await expect(alice.page.getByTestId('chat-send-channel')).toHaveValue('whisper');
  await expect(alice.page.getByTestId('chat-input')).toHaveAttribute(
    'placeholder',
    `发送给 ${bob.name}…`,
  );
  await expect(alice.page.getByTestId('chat-filter-whisper')).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await alice.page.getByTestId('chat-input').fill('whisper hello from alice');
  await alice.page.getByTestId('chat-send').click();

  // Alice sees her own line labelled with the recipient.
  const aliceWhisper = alice.page
    .locator('[data-testid="chat-message"][data-channel="whisper"]')
    .filter({ hasText: 'whisper hello from alice' });
  await expect(aliceWhisper).toHaveCount(1, { timeout: 10_000 });
  await expect(aliceWhisper).toContainText(`→ ${bob.name}`);

  // Bob opens his whisper log and replies from the friend row.
  await bob.page.getByTestId('chat-filter-whisper').click();
  const bobWhisper = bob.page
    .locator('[data-testid="chat-message"][data-channel="whisper"]')
    .filter({ hasText: 'whisper hello from alice' });
  await expect(bobWhisper).toHaveCount(1, { timeout: 10_000 });
  await expect(bobWhisper).toContainText('私聊');
  // Clicking the sender's name starts the reply directly, without reopening
  // the friend panel.
  await bobWhisper.getByTestId('chat-author-whisper').click();
  await expect(bob.page.getByTestId('chat-send-channel')).toHaveValue('whisper');
  await expect(bob.page.getByTestId('chat-input')).toHaveAttribute(
    'placeholder',
    `发送给 ${alice.name}…`,
  );
  await bob.page.getByTestId('chat-input').fill('whisper reply from bob');
  await bob.page.getByTestId('chat-send').click();

  const aliceReply = alice.page
    .locator('[data-testid="chat-message"][data-channel="whisper"]')
    .filter({ hasText: 'whisper reply from bob' });
  await expect(aliceReply).toHaveCount(1, { timeout: 10_000 });
  await expect(aliceReply).toContainText('私聊');

  // The nearby-only filter never exposes a whisper to the map channel.
  await bob.page.getByTestId('chat-filter-map').click();
  await expect(
    bob.page
      .locator('[data-testid="chat-message"][data-channel="whisper"]')
      .filter({ hasText: 'whisper reply from bob' }),
  ).toHaveCount(0);

  // Scrollback and the open whisper survive a map change. Alice walks through
  // the town portal; the earlier map, party and whisper lines must remain.
  await alice.page.getByTestId('chat-filter-all').click();
  await alice.page.evaluate(() => window.__webLegendDebug?.moveToTile(38, 15));
  await expect
    .poll(() => alice.page.evaluate(() => window.__webLegendDebug?.currentMapId() ?? ''), {
      timeout: 20_000,
    })
    .toBe('starter_wilds');
  await expect(alice.page.getByTestId('connection-status')).toHaveAttribute(
    'data-status',
    'connected',
    { timeout: 20_000 },
  );
  await expect(alice.page.getByTestId('chat-filter-all')).toHaveAttribute('aria-selected', 'true');
  const aliceLog = alice.page.locator('[data-testid="chat-message"]');
  await expect(aliceLog.filter({ hasText: 'map hello from alice' })).toHaveCount(1);
  await expect(aliceLog.filter({ hasText: 'party hello from alice' })).toHaveCount(1);
  const oldWhisper = alice.page
    .locator('[data-testid="chat-message"][data-channel="whisper"]')
    .filter({ hasText: 'whisper reply from bob' });
  await expect(oldWhisper).toHaveCount(1);

  // Reply from an old whisper line after the transfer: Alice is in the wilds,
  // Bob is still in town, and the name click still targets him.
  await oldWhisper.getByTestId('chat-author-whisper').click();
  await expect(alice.page.getByTestId('chat-send-channel')).toHaveValue('whisper');
  await alice.page.getByTestId('chat-input').fill('after transfer from alice');
  await alice.page.getByTestId('chat-send').click();
  // Bob is looking at the map tab, so the whisper is surfaced on the tab
  // instead of silently disappearing behind the filter.
  await expect(bob.page.getByTestId('chat-unread-whisper')).toHaveCount(1, {
    timeout: 10_000,
  });
  await bob.page.getByTestId('chat-filter-whisper').click();
  await expect(bob.page.getByTestId('chat-unread-whisper')).toHaveCount(0);
  await expect(
    bob.page
      .locator('[data-testid="chat-message"][data-channel="whisper"]')
      .filter({ hasText: 'after transfer from alice' }),
  ).toHaveCount(1, { timeout: 10_000 });

  // Shell-style input history and an explicit way to end the conversation.
  await alice.page.getByTestId('chat-input').press('ArrowUp');
  await expect(alice.page.getByTestId('chat-input')).toHaveValue('after transfer from alice');
  await alice.page.getByTestId('chat-input').press('ArrowDown');
  await expect(alice.page.getByTestId('chat-input')).toHaveValue('');
  await alice.page.getByTestId('chat-whisper-close').click();
  await expect(alice.page.getByTestId('chat-send-channel')).toHaveValue('map');
  await alice.page.screenshot({ path: join(ARTIFACT_DIR, 'e2e-whisper.png') });
});
