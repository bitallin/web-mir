import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

const ADMIN_URL = `http://127.0.0.1:${process.env.ADMIN_WEB_PORT ?? '5174'}`;
const ADMIN_USERNAME = process.env.ADMIN_SEED_USERNAME ?? 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_SEED_PASSWORD ?? 'web-legend-admin';
const PLAYER_PASSWORD = 'phase-seven-player-password';
const ARTIFACT_DIR = join(process.cwd(), 'docs', 'phase-reports', 'phase-07');

test.describe.configure({ mode: 'serial', timeout: 180_000 });

const opened: BrowserContext[] = [];

function token(): string {
  return randomUUID().replace(/-/gu, '').slice(0, 6);
}

async function openContext(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  opened.push(context);
  return { context, page };
}

async function loginAdmin(page: Page): Promise<void> {
  await page.goto(ADMIN_URL);
  await page.locator('#admin-username').fill(ADMIN_USERNAME);
  await page.locator('#admin-password').fill(ADMIN_PASSWORD);
  await page.getByTestId('admin-login-submit').click();
  await expect(page.getByTestId('nav-overview')).toBeVisible({ timeout: 20_000 });
}

type WorldPlayer = {
  context: BrowserContext;
  page: Page;
  username: string;
  characterName: string;
};

async function registerWorld(browser: Browser, prefix: string): Promise<WorldPlayer> {
  const { context, page } = await openContext(browser);
  const username = `${prefix.toLowerCase()}_${token()}`;
  const characterName = `${prefix}${token()}`.slice(0, 12);

  await page.goto('/?fresh=1');
  await page.getByRole('tab', { name: '注册' }).click();
  await page.getByTestId('auth-username').fill(username);
  await page.getByTestId('auth-password').fill(PLAYER_PASSWORD);
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
  return { context, page, username, characterName };
}

async function adminPage(browser: Browser): Promise<Page> {
  const { page } = await openContext(browser);
  await loginAdmin(page);
  return page;
}

test.beforeAll(() => {
  mkdirSync(ARTIFACT_DIR, { recursive: true });
});

test.afterEach(async () => {
  for (const context of opened.splice(0)) {
    await context.close().catch(() => undefined);
  }
});

test('admin sees live overview, rooms and audit of an online player', async ({ browser }) => {
  const player = await registerWorld(browser, 'AdminLive');
  const admin = await adminPage(browser);

  await expect(admin.getByText('在线玩家').first()).toBeVisible();
  await expect(admin.getByText('starter_town').first()).toBeVisible({ timeout: 15_000 });
  await admin.screenshot({ path: join(ARTIFACT_DIR, 'admin-overview.png') });

  await admin.getByTestId('nav-rooms').click();
  await expect(admin.getByText('starter_town').first()).toBeVisible({ timeout: 15_000 });
  await expect(admin.getByText(/tick p50/)).toBeVisible();
  await admin.screenshot({ path: join(ARTIFACT_DIR, 'admin-rooms.png') });

  await admin.getByTestId('nav-audit').click();
  await expect(admin.getByRole('heading', { name: '审计日志', level: 1 })).toBeVisible();
  await admin.screenshot({ path: join(ARTIFACT_DIR, 'admin-audit.png') });

  await player.page.evaluate(() => window.__webLegendDebug?.leaveWorld()).catch(() => undefined);
});

test('operator kicks a live player and the audit trail records why', async ({ browser }) => {
  const player = await registerWorld(browser, 'AdminKick');
  const admin = await adminPage(browser);

  await admin.getByTestId('nav-players').click();
  const search = admin.getByPlaceholder('角色名或账号');
  await search.fill(player.characterName);
  await search.press('Enter');

  const row = admin.locator('.ant-table-tbody tr', { hasText: player.characterName }).first();
  await expect(row).toBeVisible({ timeout: 15_000 });
  await row.click();

  await expect(admin.getByText('最近审计')).toBeVisible({ timeout: 15_000 });
  await admin.waitForTimeout(400);
  await admin.screenshot({ path: join(ARTIFACT_DIR, 'admin-player-detail.png') });
  await admin.getByRole('button', { name: '踢下线' }).click();
  await admin.getByTestId('player-action-reason').fill('E2E：管理员踢下线验证');
  await admin.screenshot({ path: join(ARTIFACT_DIR, 'admin-kick-confirm.png') });
  await admin.getByRole('button', { name: '确认踢下线' }).click();

  await expect(player.page.getByTestId('kicked-overlay')).toBeVisible({ timeout: 20_000 });
  await expect(player.page.getByTestId('kicked-overlay')).toHaveAttribute('data-kind', 'kicked');
  await expect(player.page.getByTestId('kicked-overlay')).toContainText('E2E：管理员踢下线验证');
  await player.page.screenshot({ path: join(ARTIFACT_DIR, 'player-kicked.png') });
  await expect(player.page.getByTestId('connection-status')).toHaveAttribute(
    'data-status',
    'disconnected',
    { timeout: 10_000 },
  );
  // Rejoining must clear the moderator disconnect overlay.
  await player.page.getByTestId('kicked-rejoin').click();
  await expect(player.page.getByTestId('kicked-overlay')).toHaveCount(0, { timeout: 5_000 });
  await expect(player.page.getByTestId('connection-status')).toHaveAttribute(
    'data-status',
    'connected',
    {
      timeout: 20_000,
    },
  );

  await admin.locator('.ant-drawer-close').click();
  await expect(admin.locator('.ant-drawer-mask')).toBeHidden({ timeout: 5_000 });

  await admin.getByTestId('nav-commands').click();
  await expect(
    admin.locator('.ant-table-tbody tr', { hasText: player.characterName }).first(),
  ).toContainText('applied', { timeout: 20_000 });
  await admin.screenshot({ path: join(ARTIFACT_DIR, 'admin-commands.png') });

  await admin.getByTestId('nav-audit').click();
  await expect(
    admin.locator('.ant-table-tbody tr', { hasText: 'player.kick' }).first(),
  ).toContainText('成功');
});

test('content designer publishes, activates and rolls back a release', async ({ browser }) => {
  const admin = await adminPage(browser);
  await admin.getByTestId('nav-content').click();

  await expect(admin.getByTestId('content-section-items')).toBeVisible();
  await admin.getByTestId('content-section-items').click();

  const editor = admin.locator('.content-editor textarea');
  await expect(editor).toBeVisible();
  const payload = JSON.parse(await editor.inputValue()) as Record<string, { name?: string }>;
  const gel = payload['slime_gel'];
  expect(gel).toBeDefined();
  if (gel === undefined) {
    return;
  }
  const renamed = `验收凝胶${token()}`;
  gel.name = renamed;
  await editor.fill(JSON.stringify(payload, null, 2));

  await admin.getByPlaceholder('变更原因（必填，写入审计）').fill('E2E：调整材料显示名称');
  await admin.evaluate(() => window.scrollTo(0, 0));
  await admin.locator('.content-editor textarea').evaluate((element) => {
    element.scrollTop = 0;
  });
  await admin.screenshot({ path: join(ARTIFACT_DIR, 'admin-content.png') });
  await admin.getByTestId('content-save').click();
  await expect(admin.getByText('草稿已保存')).toBeVisible({ timeout: 15_000 });

  await admin.getByTestId('content-validate').click();
  await expect(admin.getByText('VALID', { exact: false })).toBeVisible({ timeout: 15_000 });
  await expect(admin.getByTestId('content-report')).toContainText('slime_gel');
  await admin.evaluate(() => window.scrollTo(0, 0));
  await admin.locator('.content-editor textarea').evaluate((element) => {
    element.scrollTop = 0;
  });
  await admin.screenshot({ path: join(ARTIFACT_DIR, 'admin-content-validate.png') });

  await admin.getByTestId('content-publish').click();
  await expect(admin.getByText('已创建不可变版本', { exact: false })).toBeVisible({
    timeout: 15_000,
  });
  await admin.getByTestId('nav-releases').click();
  const releaseTable = admin.locator('.ant-table-tbody');
  await expect(releaseTable.locator('tr').first()).toBeVisible({ timeout: 15_000 });
  const publishedVersion = (
    await releaseTable.locator('tr').first().locator('td').first().innerText()
  )
    .split('\n')[0]
    ?.trim();
  expect(publishedVersion).toBeTruthy();

  await releaseTable
    .locator('tr')
    .first()
    .getByRole('button', { name: /激\s*活/u })
    .click();
  await admin.getByTestId('activate-reason').fill('E2E：激活内容版本');
  await admin.getByRole('button', { name: '确认激活' }).click();
  await expect(releaseTable.locator('tr').first()).toContainText('已激活', { timeout: 15_000 });
  await expect(admin.locator('.ant-modal-content')).toBeHidden({ timeout: 5_000 });
  await admin.waitForTimeout(2_500);
  await admin.evaluate(() => window.scrollTo(0, 0));
  await admin.screenshot({ path: join(ARTIFACT_DIR, 'admin-releases.png') });

  const rollback = admin.getByRole('button', { name: /回滚到/ }).first();
  const rollbackLabel = (await rollback.innerText()).replace('回滚到', '').trim();
  await rollback.click();
  await admin.getByTestId('activate-reason').fill('E2E：回滚验证');
  await admin.getByRole('button', { name: '确认激活' }).click();
  await expect(
    admin.locator('.kv-row').filter({ hasText: '当前激活' }).locator('strong').first(),
  ).toHaveText(rollbackLabel, { timeout: 15_000 });
  await admin.screenshot({ path: join(ARTIFACT_DIR, 'admin-rollback.png') });

  await admin.getByTestId('nav-audit').click();
  await expect(
    admin.locator('.ant-table-tbody tr', { hasText: 'content.publish' }).first(),
  ).toContainText('成功');
  await expect(
    admin.locator('.ant-table-tbody tr', { hasText: 'content.activate' }).first(),
  ).toContainText('成功');
});
