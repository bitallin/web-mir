import { randomUUID } from 'node:crypto';

import {
  roleHasPermission,
  type AdminActionResult,
  type AdminAuditQuery,
  type AdminAuditResponse,
  type AdminCommandView,
  type AdminCommandsQuery,
  type AdminCommandsResponse,
  type AdminDashboard,
  type AdminItemView,
  type AdminPlayerDetail,
  type AdminPlayerListQuery,
  type AdminPlayersResponse,
  type AdminRoomsResponse,
} from '@web-legend/contracts';
import {
  accounts,
  countAuditForTarget,
  dashboardCounts,
  findAdminPlayer,
  findWallet,
  insertAdminAudit,
  insertOutboxEvent,
  listAdminAudit,
  listAdminPlayers,
  listEquippedItems,
  listInventoryItems,
  listOutboxCommands,
  outboxStatusCounts,
  type AdminPlayerRecord,
  type AdminUser,
  type Database,
} from '@web-legend/persistence';
import { eq } from 'drizzle-orm';
import type { Logger } from 'pino';

import { AppError } from '../http/errors';
import {
  toAdminAuditEntry,
  toAdminCommandView,
  toAdminItemView,
  toAdminPlayerSummary,
} from './adminViews';
import type { ContentService } from './content';
import type { GameServerGateway } from './gameServerClient';

const PENDING_ALERT_MS = 60_000;

function toItemView(
  item: Parameters<typeof toAdminItemView>[0],
  bundle: Awaited<ReturnType<ContentService['activeBundle']>>['bundle'],
): AdminItemView {
  const definition = bundle.items[item.templateId];
  return toAdminItemView(item, definition?.name ?? item.templateId, definition?.kind ?? 'material');
}

export class AdminService {
  constructor(
    private readonly db: Database,
    private readonly content: ContentService,
    private readonly gameServer: GameServerGateway,
    private readonly logger: Logger,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async dashboard(): Promise<AdminDashboard> {
    const now = this.now();
    const [counts, outbox, contentState, gameStatus] = await Promise.all([
      dashboardCounts(this.db, now),
      outboxStatusCounts(this.db),
      this.content.state(),
      this.gameServer.status(),
    ]);

    const rooms = gameStatus?.rooms ?? [];
    const pendingAgeMs =
      outbox.oldestPendingAt === null
        ? null
        : Math.max(0, now.getTime() - outbox.oldestPendingAt.getTime());
    const alerts: AdminDashboard['alerts'] = [];
    if (gameStatus === null) {
      alerts.push({
        level: 'error',
        message: 'Game Server 不可达：运营指令会保留在 Outbox 并自动重试',
      });
    } else if (rooms.length === 0) {
      alerts.push({ level: 'warning', message: '当前没有运行中的地图实例' });
    }
    if (outbox.failed > 0) {
      alerts.push({ level: 'error', message: `${String(outbox.failed)} 条运营指令投递失败` });
    }
    if (pendingAgeMs !== null && pendingAgeMs > PENDING_ALERT_MS) {
      alerts.push({
        level: 'warning',
        message: `最老待投递指令已等待 ${String(Math.round(pendingAgeMs / 1_000))} 秒`,
      });
    }
    if (contentState.activeRelease === null) {
      alerts.push({ level: 'warning', message: '当前区服没有激活内容版本，使用代码基线' });
    }

    return {
      generatedAt: now.toISOString(),
      health: {
        database: 'ok',
        gameServer: gameStatus === null ? 'offline' : 'ok',
        ...(gameStatus === null ? { detail: '无法连接 Game Server' } : {}),
      },
      metrics: {
        onlinePlayers: gameStatus?.totals.players ?? counts.onlinePlayers,
        rooms: gameStatus?.totals.rooms ?? 0,
        accounts: counts.accounts,
        characters: counts.characters,
        pendingCommands: outbox.pending,
        failedCommands: outbox.failed,
        oldestPendingAgeMs: pendingAgeMs,
        activeContentVersion: contentState.activeRelease?.version ?? null,
      },
      alerts: alerts.slice(0, 20),
      rooms,
    };
  }

  async rooms(): Promise<AdminRoomsResponse> {
    const status = await this.gameServer.status();
    const timestamp = this.now().toISOString();
    if (status === null) {
      return {
        status: 'offline',
        detail: '无法连接 Game Server',
        gameServer: null,
        timestamp,
      };
    }
    return { status: 'ok', gameServer: status, timestamp };
  }

  async players(query: AdminPlayerListQuery): Promise<AdminPlayersResponse> {
    const now = this.now();
    const page = await listAdminPlayers(
      this.db,
      {
        ...(query.query === undefined || query.query.length === 0 ? {} : { query: query.query }),
        ...(query.status === undefined ? {} : { status: query.status }),
        ...(query.online === undefined ? {} : { online: query.online === 'true' }),
        page: query.page,
        pageSize: query.pageSize,
        sortBy: query.sortBy,
        sortDir: query.sortDir,
      },
      now,
    );
    return {
      items: page.items.map((row) => toAdminPlayerSummary(row, now)),
      total: page.total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async playerDetail(characterId: string): Promise<AdminPlayerDetail> {
    const record = await findAdminPlayer(this.db, characterId);
    if (record === undefined) {
      throw new AppError(404, 'NOT_FOUND', '角色不存在');
    }
    const now = this.now();
    const [inventory, equipped, wallet, recentAudit, recentCommands, content] = await Promise.all([
      listInventoryItems(this.db, characterId),
      listEquippedItems(this.db, characterId),
      findWallet(this.db, characterId),
      countAuditForTarget(this.db, 'character', characterId, 10),
      listOutboxCommands(this.db, { targetId: characterId, page: 1, pageSize: 10 }),
      this.content.activeBundle(),
    ]);
    const commands = await this.commandsForAccount(record.account.id, 10);

    const summary = toAdminPlayerSummary(
      {
        characterId: record.character.id,
        name: record.character.name,
        classId: record.character.classId,
        level: record.character.level,
        mapId: record.character.mapId,
        updatedAt: record.character.updatedAt,
        accountId: record.account.id,
        username: record.account.username,
        accountStatus: record.account.status,
        mutedUntil: record.account.mutedUntil,
        gameServerId: record.gameServerId,
        leaseExpiresAt: record.leaseExpiresAt,
      },
      now,
    );
    const equipmentSlot = (slot: 'weapon' | 'armor'): AdminItemView | null => {
      const item = equipped.find((entry) => entry.equipSlot === slot);
      return item === undefined ? null : toItemView(item, content.bundle);
    };

    return {
      character: {
        ...summary,
        exp: record.character.exp,
        hp: record.character.hp,
        maxHp: record.character.maxHp,
        mp: record.character.mp,
        maxMp: record.character.maxMp,
        x: record.character.x,
        y: record.character.y,
        createdAt: record.character.createdAt.toISOString(),
      },
      account: {
        id: record.account.id,
        username: record.account.username,
        status: record.account.status,
        mutedUntil: record.account.mutedUntil?.toISOString() ?? null,
        createdAt: record.account.createdAt.toISOString(),
      },
      wallet: { balance: wallet?.balance ?? 0 },
      inventory: inventory.map((item) => toItemView(item, content.bundle)),
      equipment: { weapon: equipmentSlot('weapon'), armor: equipmentSlot('armor') },
      recentAudit: recentAudit.map(toAdminAuditEntry),
      recentCommands: [
        ...recentCommands.items.map(toAdminCommandView),
        ...commands.filter(
          (command) => !recentCommands.items.some((row) => row.commandId === command.commandId),
        ),
      ].slice(0, 10),
    };
  }

  async audit(query: AdminAuditQuery): Promise<AdminAuditResponse> {
    const page = await listAdminAudit(this.db, {
      page: query.page,
      pageSize: query.pageSize,
      ...(query.actor === undefined ? {} : { actor: query.actor }),
      ...(query.action === undefined ? {} : { action: query.action }),
      ...(query.targetId === undefined ? {} : { targetId: query.targetId }),
      ...(query.result === undefined ? {} : { result: query.result }),
    });
    return {
      items: page.items.map(toAdminAuditEntry),
      total: page.total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async commands(query: AdminCommandsQuery): Promise<AdminCommandsResponse> {
    const page = await listOutboxCommands(this.db, {
      page: query.page,
      pageSize: query.pageSize,
      ...(query.status === undefined ? {} : { status: query.status }),
      ...(query.type === undefined ? {} : { type: query.type }),
      ...(query.targetId === undefined ? {} : { targetId: query.targetId }),
    });
    return {
      items: page.items.map(toAdminCommandView),
      total: page.total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async kick(
    characterId: string,
    reason: string,
    admin: AdminUser,
    requestId: string,
  ): Promise<AdminActionResult> {
    await this.assertPlayersAction(admin, requestId, 'player.kick', characterId, reason);
    const record = await this.requireCharacter(
      characterId,
      'player.kick',
      admin,
      requestId,
      reason,
    );
    const now = this.now();
    const online =
      record.leaseExpiresAt !== null && record.leaseExpiresAt.getTime() > now.getTime();
    const result = await this.db.transaction(async (tx) => {
      const audit = await insertAdminAudit(tx, {
        requestId,
        actorAdminId: admin.id,
        actorUsername: admin.username,
        actorRole: admin.role,
        action: 'player.kick',
        targetType: 'character',
        targetId: record.character.id,
        reason,
        before: { online },
        after: { online: false },
        result: 'success',
        createdAt: now,
      });
      const command = await insertOutboxEvent(tx, {
        commandId: randomUUID(),
        type: 'kick',
        targetType: 'character',
        targetId: record.character.id,
        targetName: record.character.name,
        payload: { reason },
        reason,
        actorAdminId: admin.id,
        actorUsername: admin.username,
        auditLogId: audit.id,
        createdAt: now,
      });
      return { audit, command };
    });
    return { command: toAdminCommandView(result.command), auditId: result.audit.id };
  }

  async ban(
    characterId: string,
    reason: string,
    admin: AdminUser,
    requestId: string,
  ): Promise<AdminActionResult> {
    await this.assertPlayersAction(admin, requestId, 'player.ban', characterId, reason);
    const record = await this.requireCharacter(characterId, 'player.ban', admin, requestId, reason);
    const now = this.now();
    const result = await this.db.transaction(async (tx) => {
      await tx
        .update(accounts)
        .set({ status: 'banned', updatedAt: now })
        .where(eq(accounts.id, record.account.id));
      const audit = await insertAdminAudit(tx, {
        requestId,
        actorAdminId: admin.id,
        actorUsername: admin.username,
        actorRole: admin.role,
        action: 'player.ban',
        targetType: 'character',
        targetId: record.character.id,
        reason,
        before: { accountStatus: record.account.status },
        after: { accountStatus: 'banned' },
        result: 'success',
        createdAt: now,
      });
      const command = await insertOutboxEvent(tx, {
        commandId: randomUUID(),
        type: 'ban',
        targetType: 'account',
        targetId: record.account.id,
        targetName: record.account.username,
        payload: { reason },
        reason,
        actorAdminId: admin.id,
        actorUsername: admin.username,
        auditLogId: audit.id,
        createdAt: now,
      });
      return { audit, command };
    });
    return { command: toAdminCommandView(result.command), auditId: result.audit.id };
  }

  async mute(
    characterId: string,
    reason: string,
    durationSeconds: number,
    admin: AdminUser,
    requestId: string,
  ): Promise<AdminActionResult> {
    await this.assertPlayersAction(admin, requestId, 'player.mute', characterId, reason);
    const record = await this.requireCharacter(
      characterId,
      'player.mute',
      admin,
      requestId,
      reason,
    );
    const now = this.now();
    const mutedUntil = new Date(now.getTime() + durationSeconds * 1_000);
    const result = await this.db.transaction(async (tx) => {
      await tx
        .update(accounts)
        .set({ mutedUntil, updatedAt: now })
        .where(eq(accounts.id, record.account.id));
      const audit = await insertAdminAudit(tx, {
        requestId,
        actorAdminId: admin.id,
        actorUsername: admin.username,
        actorRole: admin.role,
        action: 'player.mute',
        targetType: 'character',
        targetId: record.character.id,
        reason,
        before: { mutedUntil: record.account.mutedUntil?.toISOString() ?? null },
        after: { mutedUntil: mutedUntil.toISOString(), durationSeconds },
        result: 'success',
        createdAt: now,
      });
      const command = await insertOutboxEvent(tx, {
        commandId: randomUUID(),
        type: 'mute',
        targetType: 'account',
        targetId: record.account.id,
        targetName: record.account.username,
        payload: { mutedUntil: mutedUntil.toISOString(), durationSeconds },
        reason,
        actorAdminId: admin.id,
        actorUsername: admin.username,
        auditLogId: audit.id,
        createdAt: now,
      });
      return { audit, command };
    });
    return { command: toAdminCommandView(result.command), auditId: result.audit.id };
  }

  private async commandsForAccount(accountId: string, limit: number): Promise<AdminCommandView[]> {
    const page = await listOutboxCommands(this.db, {
      targetId: accountId,
      page: 1,
      pageSize: limit,
    });
    return page.items.map(toAdminCommandView);
  }

  private async requireCharacter(
    characterId: string,
    action: string,
    admin: AdminUser,
    requestId: string,
    reason: string,
  ): Promise<AdminPlayerRecord> {
    const record = await findAdminPlayer(this.db, characterId);
    if (record === undefined) {
      await this.recordFailure(admin, requestId, action, characterId, reason, 'NOT_FOUND');
      throw new AppError(404, 'NOT_FOUND', '角色不存在');
    }
    return record;
  }

  /** Records a rejected write (for example an invalid reason) in the audit log. */
  async auditRejected(
    admin: AdminUser,
    requestId: string,
    action: string,
    targetId: string,
    reason: string | null,
    errorCode: string,
  ): Promise<void> {
    await this.recordFailure(admin, requestId, action, targetId, reason ?? '', errorCode);
  }

  private async assertPlayersAction(
    admin: AdminUser,
    requestId: string,
    action: string,
    targetId: string,
    reason: string,
  ): Promise<void> {
    if (roleHasPermission(admin.role, 'players.action')) {
      return;
    }
    await this.recordFailure(admin, requestId, action, targetId, reason, 'FORBIDDEN');
    throw new AppError(403, 'FORBIDDEN', '没有执行该运营操作的权限');
  }

  private async recordFailure(
    admin: AdminUser,
    requestId: string,
    action: string,
    targetId: string,
    reason: string,
    errorCode: string,
  ): Promise<void> {
    try {
      await insertAdminAudit(this.db, {
        requestId,
        actorAdminId: admin.id,
        actorUsername: admin.username,
        actorRole: admin.role,
        action,
        targetType: 'character',
        targetId,
        reason,
        before: null,
        after: null,
        result: 'failed',
        errorCode,
        createdAt: this.now(),
      });
    } catch (error) {
      this.logger.error({ err: error, action }, 'failed to record admin audit failure');
    }
  }
}
