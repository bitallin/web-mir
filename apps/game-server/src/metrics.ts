import type { CommandRejectionCode } from '@web-legend/contracts';

const DEFAULT_WINDOW_SIZE = 240;

export type TickStats = {
  samples: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
};

export type AssetQueueStats = {
  samples: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
};

export type RoomMetricInfo = {
  mapId?: string;
  instanceId?: string;
  contentVersion?: string;
};

export type RoomMetricsSnapshot = {
  roomId: string;
  mapId: string;
  instanceId: string;
  contentVersion: string;
  players: number;
  wsSentBytes: number;
  wsPatchBytes: number;
  acceptedCommands: number;
  rejectedCommands: number;
  rejectionsByCode: Record<string, number>;
  chatMessages: number;
  chatFiltered: number;
  chatMuted: number;
  transfers: number;
  combatCommands: number;
  combatEvents: number;
  monsterKills: number;
  playerDeaths: number;
  pvpKills: number;
  assetCommands: number;
  assetFailures: number;
  lootSpawned: number;
  lootPickedUp: number;
  goldGranted: number;
  expGranted: number;
  tick: TickStats;
  /** Latency of queued asset transactions (queue wait + commit). */
  assetTx: AssetQueueStats;
};

function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) {
    return 0;
  }
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1));
  return sorted[index] ?? 0;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

export class RoomMetrics {
  private readonly tickDurations: number[] = [];
  private players = 0;
  private wsSentBytes = 0;
  private wsPatchBytes = 0;
  private acceptedCommands = 0;
  private rejectedCommands = 0;
  private chatMessages = 0;
  private chatFiltered = 0;
  private chatMuted = 0;
  private transfers = 0;
  private combatCommands = 0;
  private combatEvents = 0;
  private monsterKills = 0;
  private playerDeaths = 0;
  private pvpKills = 0;
  private assetCommands = 0;
  private assetFailures = 0;
  private readonly assetDurations: number[] = [];
  private lootSpawned = 0;
  private lootPickedUp = 0;
  private goldGranted = 0;
  private expGranted = 0;
  private readonly rejectionsByCode = new Map<string, number>();

  constructor(
    private readonly roomId: string,
    private readonly windowSize = DEFAULT_WINDOW_SIZE,
    private readonly info: RoomMetricInfo = {},
  ) {}

  recordTick(durationMs: number): void {
    this.tickDurations.push(durationMs);
    if (this.tickDurations.length > this.windowSize) {
      this.tickDurations.shift();
    }
  }

  recordWsSent(bytes: number, patching: boolean): void {
    if (!Number.isFinite(bytes) || bytes <= 0) {
      return;
    }
    this.wsSentBytes += bytes;
    if (patching) {
      this.wsPatchBytes += bytes;
    }
  }

  recordAcceptedCommand(): void {
    this.acceptedCommands += 1;
  }

  recordRejectedCommand(code: CommandRejectionCode): void {
    this.rejectedCommands += 1;
    this.rejectionsByCode.set(code, (this.rejectionsByCode.get(code) ?? 0) + 1);
  }

  recordChatMessage(): void {
    this.chatMessages += 1;
  }

  recordChatFiltered(): void {
    this.chatFiltered += 1;
  }

  recordChatMuted(): void {
    this.chatMuted += 1;
  }

  recordTransfer(): void {
    this.transfers += 1;
  }

  recordCombatCommand(): void {
    this.combatCommands += 1;
  }

  recordCombatEvents(count: number): void {
    this.combatEvents += count;
  }

  recordMonsterKill(): void {
    this.monsterKills += 1;
  }

  recordPlayerDeath(): void {
    this.playerDeaths += 1;
  }

  recordPvpKill(): void {
    this.pvpKills += 1;
  }

  recordAssetCommand(): void {
    this.assetCommands += 1;
  }

  recordAssetFailure(): void {
    this.assetFailures += 1;
  }

  recordAssetDuration(durationMs: number): void {
    if (!Number.isFinite(durationMs) || durationMs < 0) {
      return;
    }
    this.assetDurations.push(durationMs);
    if (this.assetDurations.length > this.windowSize) {
      this.assetDurations.shift();
    }
  }

  assetQueueStats(): AssetQueueStats {
    const sorted = [...this.assetDurations].sort((left, right) => left - right);
    return {
      samples: sorted.length,
      p50Ms: round(percentile(sorted, 0.5)),
      p95Ms: round(percentile(sorted, 0.95)),
      p99Ms: round(percentile(sorted, 0.99)),
    };
  }

  recordLootSpawned(count: number): void {
    this.lootSpawned += count;
  }

  recordLootPickedUp(): void {
    this.lootPickedUp += 1;
  }

  recordGoldGranted(amount: number): void {
    this.goldGranted += amount;
  }

  recordExpGranted(amount: number): void {
    this.expGranted += amount;
  }

  setPlayers(count: number): void {
    this.players = count;
  }

  tickStats(): TickStats {
    const sorted = [...this.tickDurations].sort((left, right) => left - right);
    return {
      samples: sorted.length,
      p50Ms: round(percentile(sorted, 0.5)),
      p95Ms: round(percentile(sorted, 0.95)),
      p99Ms: round(percentile(sorted, 0.99)),
      maxMs: round(sorted.at(-1) ?? 0),
    };
  }

  snapshot(): RoomMetricsSnapshot {
    return {
      roomId: this.roomId,
      mapId: this.info.mapId ?? '',
      instanceId: this.info.instanceId ?? '',
      contentVersion: this.info.contentVersion ?? '',
      players: this.players,
      wsSentBytes: this.wsSentBytes,
      wsPatchBytes: this.wsPatchBytes,
      acceptedCommands: this.acceptedCommands,
      rejectedCommands: this.rejectedCommands,
      rejectionsByCode: Object.fromEntries(this.rejectionsByCode),
      chatMessages: this.chatMessages,
      chatFiltered: this.chatFiltered,
      chatMuted: this.chatMuted,
      transfers: this.transfers,
      combatCommands: this.combatCommands,
      combatEvents: this.combatEvents,
      monsterKills: this.monsterKills,
      playerDeaths: this.playerDeaths,
      pvpKills: this.pvpKills,
      assetCommands: this.assetCommands,
      assetFailures: this.assetFailures,
      lootSpawned: this.lootSpawned,
      lootPickedUp: this.lootPickedUp,
      goldGranted: this.goldGranted,
      expGranted: this.expGranted,
      tick: this.tickStats(),
      assetTx: this.assetQueueStats(),
    };
  }
}

export type MetricsSnapshot = {
  service: 'game-server';
  rooms: RoomMetricsSnapshot[];
  totals: {
    activeRooms: number;
    roomsCreated: number;
    acceptedCommands: number;
    rejectedCommands: number;
    wsSentBytes: number;
    wsPatchBytes: number;
    chatMessages: number;
    chatFiltered: number;
    chatMuted: number;
    transfers: number;
    combatCommands: number;
    combatEvents: number;
    monsterKills: number;
    playerDeaths: number;
    pvpKills: number;
    assetCommands: number;
    assetFailures: number;
    lootSpawned: number;
    lootPickedUp: number;
    goldGranted: number;
    expGranted: number;
  };
  timestamp: string;
};

export class MetricsRegistry {
  private readonly rooms = new Map<string, RoomMetrics>();
  private roomsCreated = 0;
  private acceptedCommands = 0;
  private rejectedCommands = 0;
  private wsSentBytes = 0;
  private wsPatchBytes = 0;
  private chatMessages = 0;
  private chatFiltered = 0;
  private chatMuted = 0;
  private transfers = 0;
  private combatCommands = 0;
  private combatEvents = 0;
  private monsterKills = 0;
  private playerDeaths = 0;
  private pvpKills = 0;
  private assetCommands = 0;
  private assetFailures = 0;
  private lootSpawned = 0;
  private lootPickedUp = 0;
  private goldGranted = 0;
  private expGranted = 0;

  register(roomId: string, info: RoomMetricInfo = {}): RoomMetrics {
    const metrics = new RoomMetrics(roomId, DEFAULT_WINDOW_SIZE, info);
    this.rooms.set(roomId, metrics);
    this.roomsCreated += 1;
    return metrics;
  }

  unregister(roomId: string): void {
    const metrics = this.rooms.get(roomId);
    if (metrics === undefined) {
      return;
    }
    const snapshot = metrics.snapshot();
    this.acceptedCommands += snapshot.acceptedCommands;
    this.rejectedCommands += snapshot.rejectedCommands;
    this.wsSentBytes += snapshot.wsSentBytes;
    this.wsPatchBytes += snapshot.wsPatchBytes;
    this.chatMessages += snapshot.chatMessages;
    this.chatFiltered += snapshot.chatFiltered;
    this.chatMuted += snapshot.chatMuted;
    this.transfers += snapshot.transfers;
    this.combatCommands += snapshot.combatCommands;
    this.combatEvents += snapshot.combatEvents;
    this.monsterKills += snapshot.monsterKills;
    this.playerDeaths += snapshot.playerDeaths;
    this.pvpKills += snapshot.pvpKills;
    this.assetCommands += snapshot.assetCommands;
    this.assetFailures += snapshot.assetFailures;
    this.lootSpawned += snapshot.lootSpawned;
    this.lootPickedUp += snapshot.lootPickedUp;
    this.goldGranted += snapshot.goldGranted;
    this.expGranted += snapshot.expGranted;
    this.rooms.delete(roomId);
  }

  snapshot(): MetricsSnapshot {
    const rooms = [...this.rooms.values()]
      .map((room) => room.snapshot())
      .sort((left, right) => left.roomId.localeCompare(right.roomId));

    const activeAccepted = rooms.reduce((total, room) => total + room.acceptedCommands, 0);
    const activeRejected = rooms.reduce((total, room) => total + room.rejectedCommands, 0);
    const activeWsSent = rooms.reduce((total, room) => total + room.wsSentBytes, 0);
    const activeWsPatch = rooms.reduce((total, room) => total + room.wsPatchBytes, 0);
    const activeChat = rooms.reduce((total, room) => total + room.chatMessages, 0);
    const activeChatFiltered = rooms.reduce((total, room) => total + room.chatFiltered, 0);
    const activeChatMuted = rooms.reduce((total, room) => total + room.chatMuted, 0);
    const activeTransfers = rooms.reduce((total, room) => total + room.transfers, 0);
    const activeCombatCommands = rooms.reduce((total, room) => total + room.combatCommands, 0);
    const activeCombatEvents = rooms.reduce((total, room) => total + room.combatEvents, 0);
    const activeMonsterKills = rooms.reduce((total, room) => total + room.monsterKills, 0);
    const activePlayerDeaths = rooms.reduce((total, room) => total + room.playerDeaths, 0);
    const activePvpKills = rooms.reduce((total, room) => total + room.pvpKills, 0);
    const activeAssetCommands = rooms.reduce((total, room) => total + room.assetCommands, 0);
    const activeAssetFailures = rooms.reduce((total, room) => total + room.assetFailures, 0);
    const activeLootSpawned = rooms.reduce((total, room) => total + room.lootSpawned, 0);
    const activeLootPickedUp = rooms.reduce((total, room) => total + room.lootPickedUp, 0);
    const activeGoldGranted = rooms.reduce((total, room) => total + room.goldGranted, 0);
    const activeExpGranted = rooms.reduce((total, room) => total + room.expGranted, 0);

    return {
      service: 'game-server',
      rooms,
      totals: {
        activeRooms: rooms.length,
        roomsCreated: this.roomsCreated,
        acceptedCommands: this.acceptedCommands + activeAccepted,
        rejectedCommands: this.rejectedCommands + activeRejected,
        wsSentBytes: this.wsSentBytes + activeWsSent,
        wsPatchBytes: this.wsPatchBytes + activeWsPatch,
        chatMessages: this.chatMessages + activeChat,
        chatFiltered: this.chatFiltered + activeChatFiltered,
        chatMuted: this.chatMuted + activeChatMuted,
        transfers: this.transfers + activeTransfers,
        combatCommands: this.combatCommands + activeCombatCommands,
        combatEvents: this.combatEvents + activeCombatEvents,
        monsterKills: this.monsterKills + activeMonsterKills,
        playerDeaths: this.playerDeaths + activePlayerDeaths,
        pvpKills: this.pvpKills + activePvpKills,
        assetCommands: this.assetCommands + activeAssetCommands,
        assetFailures: this.assetFailures + activeAssetFailures,
        lootSpawned: this.lootSpawned + activeLootSpawned,
        lootPickedUp: this.lootPickedUp + activeLootPickedUp,
        goldGranted: this.goldGranted + activeGoldGranted,
        expGranted: this.expGranted + activeExpGranted,
      },
      timestamp: new Date().toISOString(),
    };
  }
}
