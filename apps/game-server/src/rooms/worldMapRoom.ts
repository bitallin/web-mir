import { CloseCode, ErrorCode, Room, ServerError, type Client } from '@colyseus/core';
import { StateView } from '@colyseus/schema';
import { hashToken } from '@web-legend/auth';
import {
  CHAT_MESSAGE_MAX_LENGTH,
  CLIENT_MESSAGES,
  COMMAND_REJECTION_MESSAGES,
  DEFAULT_PATCH_RATE_MS,
  DEFAULT_TICK_HZ,
  FACING,
  MONSTER_STATE_CODES,
  PICKUP_RANGE_TILES,
  PLAYER_SPEED_UNITS_PER_SECOND,
  PROTOCOL_VERSION,
  SERVER_MESSAGES,
  TILE_UNITS,
  assetResultSchema,
  characterClassSchema,
  characterProgressSchema,
  chatMessageSchema,
  chatSendSchema,
  combatAutoAttackStartSchema,
  combatAutoAttackStopSchema,
  combatBasicAttackSchema,
  combatEngageSchema,
  combatEventSchema,
  combatProfileSchema,
  combatTargetChangedSchema,
  commandAckSchema,
  commandRejectedSchema,
  DEFAULT_AUTO_PICKUP_RANGE_TILES,
  sessionKickedSchema,
  inventoryEquipSchema,
  inventorySnapshotSchema,
  inventoryUnequipSchema,
  inventoryUseSchema,
  levelUpSchema,
  lootClaimedSchema,
  lootPickupSchema,
  moveStopCommandSchema,
  moveToCommandSchema,
  PARTY_INVITE_RANGE_TILES,
  partyAcceptCommandSchema,
  partyDeclineCommandSchema,
  partyInviteCommandSchema,
  partyKickCommandSchema,
  partyLeaveCommandSchema,
  partySnapshotSchema,
  partyTransferLeaderCommandSchema,
  playerRespawnPointOf,
  questAcceptSchema,
  questClaimSchema,
  questNavigateSchema,
  questNavigationSchema,
  questSnapshotSchema,
  questUpdateSchema,
  sessionTransferSchema,
  shopBuySchema,
  shopCatalogSchema,
  shopMerchantSchema,
  shopSellSchema,
  skillCastSchema,
  systemNoticeSchema,
  tilePointSchema,
  QUEST_NPC_RANGE_TILES,
  SHOP_RANGE_TILES,
  worldJoinOptionsSchema,
  type AdminCommandEnvelope,
  type AdminRoom,
  type AssetCommandKind,
  type AssetResult,
  type CharacterProgress,
  type ChatMessage,
  type CombatEvent,
  type CombatEventPayload,
  type CombatProfile,
  type CombatTargetChangeReason,
  type CombatTargetChanged,
  type CommandAck,
  type CommandRejected,
  type CommandRejectionCode,
  type Facing,
  type InventorySnapshot,
  type LevelUp,
  type MapMonsterSpawn,
  type MapPortal,
  type PartyMemberView,
  type PartySnapshot,
  type PartyView,
  type QuestContent,
  type QuestNavigation,
  type QuestNavigationReason,
  type QuestSnapshot,
  type QuestUpdate,
  type QuestView,
  type SessionTransfer,
  type ShopCatalog,
  type ShopMerchant,
  type ShopOffer,
  type ShopSellPrice,
  type SystemNotice,
  type TilePoint,
} from '@web-legend/contracts';
import { MAP_MANIFESTS } from '@web-legend/contracts/maps';
import {
  LootState,
  MonsterState,
  PlayerState,
  WorldState,
  type PlayerStateInstance,
  type WorldStateInstance,
} from '@web-legend/contracts/world-state';
import {
  AssetError,
  AssetService,
  type DeathPenaltyInput,
  type DeathPenaltyOutcome,
  type KillQuestUpdate,
  type KillRewardInput,
  type KillRewardOutcome,
  type LoadedAssets,
  type LootDropView,
  type PartyKillRewardInput,
  type PartyKillRewardOutcome,
} from '@web-legend/game-application';
import {
  CombatWorld,
  dailyPeriodKey,
  defaultChatFilter,
  itemBuyPrice,
  itemSellPrice,
  nextDailyResetAt,
  questViewFor,
  questViewsFor,
  reachObjectiveMet,
  type ChatFilter,
  type CombatCommandResult,
  type CombatStats,
  type QuestRecordState,
  type QuestViewContext,
} from '@web-legend/game-domain';
import {
  DEFAULT_INTEREST,
  InterestManager,
  createFixedStepRunner,
  findPath,
  tileOfUnits,
  WorldSimulation,
  type FixedStepRunner,
  type SimulationPlayer,
} from '@web-legend/game-simulation';
import {
  acquireCharacterLease,
  consumeGameTicket,
  findAccountById,
  findCharacterById,
  findRealmById,
  refreshCharacterLeases,
  releaseCharacterLease,
  saveCharacterCheckpoint,
  saveCharacterTransfer,
  type Database,
} from '@web-legend/persistence';
import type { Logger } from 'pino';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

import type { AdminCommandHub } from '../admin/commandHub';
import type { MetricsRegistry, RoomMetrics } from '../metrics';
import { createCombatRng } from '../world/combatRng';
import { BASE_ROOM_CONTENT, type ContentProvider, type RoomContent } from '../world/contentStore';
import type { MapInstance } from '../world/mapRegistry';
import { createTokenBucket } from '../world/rateLimiter';
import { PartyService } from '../world/partyService';
import { type PartyManagementRejection, type PartyState } from '../world/partyRegistry';
import { CommandGuard } from './commandGuard';
import { SessionRegistry, type QuestNavigationState, type SessionRecord } from './sessionRegistry';
import {
  findApproachPath,
  mapsWithAnyMonsterSpawn,
  mapsWithNpc,
  nearestSpawnTileAmong,
  nextPortalToward,
} from '../world/questRouting';
import { StateViewPublisher } from './stateViewPublisher';

export type WorldMapRoomOptions = {
  database: Database;
  serverId: string;
  logger: Logger;
  metrics: MetricsRegistry;
  mapInstance: MapInstance;
  /** Fixed content snapshot source; omitted in unit fixtures means baseline. */
  contentStore?: ContentProvider;
  adminHub?: AdminCommandHub;
  /** Process-wide party table shared by every map room (ADR-036). */
  partyService?: PartyService;
  /** Realm this process serves; characters from other realms are rejected. */
  realmCode?: string;
  /** Overrides the compiled map's monster spawns; tests use an empty list. */
  monsterSpawns?: readonly MapMonsterSpawn[];
  tickHz?: number;
  patchRateMs?: number;
  reconnectGraceSeconds?: number;
  commandRateCapacity?: number;
  commandRateRefillPerSecond?: number;
  chatRateCapacity?: number;
  chatRateRefillPerSecond?: number;
  /** Replaces the built-in moderation rules; tests inject a narrow rule set. */
  chatFilter?: ChatFilter;
  checkpointIntervalMs?: number;
  interestCellSize?: number;
  interestRadiusCells?: number;
  /** Deterministic in tests; production defaults to a crypto-seeded RNG. */
  combatRng?: () => number;
  /** Deterministic in tests; production defaults to Math.random for loot. */
  economyRng?: () => number;
  monsterRespawnMs?: number;
  playerRespawnMs?: number;
  /** Test seam: disable owner auto-pickup when a test exercises manual loot. */
  autoPickup?: boolean;
};

const DEFAULT_RECONNECT_GRACE_SECONDS = 15;
const DEFAULT_COMMAND_RATE_CAPACITY = 10;
const DEFAULT_COMMAND_RATE_REFILL_PER_SECOND = 10;
const DEFAULT_CHAT_RATE_CAPACITY = 4;
const DEFAULT_CHAT_RATE_REFILL_PER_SECOND = 2;
const DEFAULT_CHECKPOINT_INTERVAL_MS = 20_000;
const RECENT_COMMAND_WINDOW = 32;
const RECENT_CHAT_WINDOW = 32;
const COLOR_COUNT = 6;
const LOOT_EXPIRY_CHECK_TICKS = 20;
/** Owner auto-pickup is cheap but needs no per-tick cadence (ADR-041). */
const AUTO_PICKUP_INTERVAL_TICKS = 4;
const AUTO_PICKUP_FULL_BACKOFF_MS = 5_000;
const AUTO_PICKUP_RETRY_BACKOFF_MS = 2_000;
/** Arrival objectives read authoritative positions off the tick (ADR-042). */
const REACH_CHECK_INTERVAL_TICKS = 5;
const REACH_RETRY_BACKOFF_MS = 2_000;
/** Database-side loot cleanup; the in-memory view expires every second. */
const LOOT_DB_PURGE_INTERVAL_MS = 30_000;
/** Repath towards a moving auto-attack target at most this often. */
const AUTO_ATTACK_REPATH_INTERVAL_MS = 350;
const REWARD_RETRY_ATTEMPTS = 3;
/** Expired party invites are dropped once a second; the TTL is 30 seconds. */
const PARTY_INVITE_SWEEP_INTERVAL_MS = 1_000;
/** Daily quest rollover is announced within half a minute of the realm reset. */
const QUEST_PERIOD_SWEEP_INTERVAL_MS = 30_000;
/** Pause before retargeting after a quest kill so the reward transaction commits. */
const QUEST_RETARGET_DELAY_MS = 400;
/** How long a hunt waits at a spawn area when no target is visible. */
const QUEST_NAV_WAIT_MS = 1_000;

/**
 * Leases outlive a single tick and are refreshed in the background. A crashed
 * process releases control automatically once its lease expires.
 */
const LEASE_DURATION_MS = 30_000;
const LEASE_REFRESH_INTERVAL_MS = 10_000;

const authDataSchema = z.object({
  accountId: z.uuid(),
  characterId: z.uuid(),
  realmId: z.uuid(),
  displayName: z.string().min(1).max(32),
  classId: characterClassSchema,
  level: z.number().int().min(1),
  mapId: z.string().min(1),
  x: z.number().int().nonnegative(),
  y: z.number().int().nonnegative(),
  facing: z.number().int().min(0).max(7),
  hp: z.number().int().nonnegative(),
  maxHp: z.number().int().positive(),
  mp: z.number().int().nonnegative(),
  maxMp: z.number().int().nonnegative(),
  /** Epoch ms while a moderator mute is active; null when unmuted. */
  mutedUntil: z.number().int().nonnegative().nullable(),
});

type WorldAuthData = z.infer<typeof authDataSchema>;

function colorIndexFor(characterId: string): number {
  let hash = 0;
  for (const char of characterId) {
    hash = (hash * 31 + char.charCodeAt(0)) % 1_000_003;
  }
  return hash % COLOR_COUNT;
}

function toFacing(value: number): Facing {
  switch (value) {
    case FACING.north:
      return FACING.north;
    case FACING.east:
      return FACING.east;
    case FACING.south:
      return FACING.south;
    case FACING.west:
      return FACING.west;
    case FACING.northEast:
      return FACING.northEast;
    case FACING.southEast:
      return FACING.southEast;
    case FACING.southWest:
      return FACING.southWest;
    case FACING.northWest:
      return FACING.northWest;
    default:
      return FACING.south;
  }
}

function extractCommandMeta(raw: unknown): { commandId?: string; clientSequence?: number } {
  if (typeof raw !== 'object' || raw === null) {
    return {};
  }
  const record = raw as Record<string, unknown>;
  const meta: { commandId?: string; clientSequence?: number } = {};
  if (typeof record['commandId'] === 'string' && z.uuid().safeParse(record['commandId']).success) {
    meta.commandId = record['commandId'];
  }
  const sequence = record['clientSequence'];
  if (typeof sequence === 'number' && Number.isInteger(sequence) && sequence >= 0) {
    meta.clientSequence = sequence;
  }
  return meta;
}

function tileCenter(tile: TilePoint): { x: number; y: number } {
  return {
    x: tile.x * TILE_UNITS + TILE_UNITS / 2,
    y: tile.y * TILE_UNITS + TILE_UNITS / 2,
  };
}

/** `ws` emits Buffer, ArrayBuffer or a list of fragments depending on framing. */
function payloadByteLength(data: unknown): number {
  if (typeof data === 'string') {
    return Buffer.byteLength(data, 'utf8');
  }
  if (data instanceof ArrayBuffer) {
    return data.byteLength;
  }
  if (ArrayBuffer.isView(data)) {
    return data.byteLength;
  }
  if (Array.isArray(data)) {
    let total = 0;
    for (const chunk of data) {
      total += payloadByteLength(chunk);
    }
    return total;
  }
  return 0;
}

/**
 * One Colyseus room per map instance (ADR-003 / ADR-018). The room performs
 * connection adaptation only: ticket validation, lease acquisition, rate
 * limiting, routing, AOI filtering and state synchronization. Movement and
 * map rules live in `@web-legend/game-simulation` and `@web-legend/map-runtime`.
 */
export class WorldMapRoom extends Room<{ state: WorldStateInstance }> {
  override maxClients = 50;

  override state = new WorldState();

  private options!: WorldMapRoomOptions;
  private metrics!: RoomMetrics;
  private map!: MapInstance;
  private content!: RoomContent;
  private simulation!: WorldSimulation;
  private combat!: CombatWorld;
  private interest!: InterestManager;
  private runner!: FixedStepRunner;
  private assets!: AssetService;
  private tick = 0;
  private killSequence = 0;
  /** True while Colyseus is encoding and writing a state patch. */
  private patching = false;
  private assetQueue: Promise<void> = Promise.resolve();
  private checkpointIntervalMs = DEFAULT_CHECKPOINT_INTERVAL_MS;
  private readonly registry = new SessionRegistry();
  private guard!: CommandGuard;
  private views!: StateViewPublisher;
  private parties!: PartyService;
  /** Current content snapshot's party rule; defaults keep the feature usable. */
  private partyRule: { maxMembers: number; assistSharePermille: number; assistRangeTiles: number } =
    { maxMembers: 4, assistSharePermille: 0, assistRangeTiles: 12 };
  /** Viewers to recompute once at the end of the current simulation tick. */
  private readonly pendingViewRefresh = new Set<string>();
  private readonly pendingAssets = new Map<string, LoadedAssets>();
  private readonly pendingQuests = new Map<string, QuestRecordState[]>();
  /** Last daily period this room has announced; null until the first sweep. */
  private questPeriodKey: string | null = null;
  /** Quest giver display names from every compiled map. */
  private readonly npcNames = new Map<string, string>();
  /** Map id -> display name for arrival objectives (ADR-042). */
  private readonly mapNames = new Map<string, string>();
  private readonly reachInFlight = new Set<string>();
  private readonly reachBackoffUntil = new Map<string, number>();
  /** Owner drops inside this radius fly into the bag on their own (ADR-041). */
  private autoPickupRangeTiles: number = DEFAULT_AUTO_PICKUP_RANGE_TILES;
  private autoPickupEnabled = true;
  private readonly autoPickupInFlight = new Set<string>();
  private readonly autoPickupBackoffUntil = new Map<string, number>();
  private readonly autoPickupNotified = new Set<string>();

  override onCreate(options: WorldMapRoomOptions): void {
    this.options = options;
    this.map = options.mapInstance;
    // Snapshot once: an activation only affects rooms created afterwards.
    this.content = options.contentStore?.snapshot() ?? BASE_ROOM_CONTENT;
    this.simulation = new WorldSimulation(this.map.runtime.grid);
    this.interest = new InterestManager({
      cellSize: options.interestCellSize ?? DEFAULT_INTEREST.cellSize,
      radiusCells: options.interestRadiusCells ?? DEFAULT_INTEREST.radiusCells,
    });
    this.guard = new CommandGuard({
      protocolVersion: PROTOCOL_VERSION,
      windowSize: RECENT_COMMAND_WINDOW,
      now: Date.now,
    });
    this.views = new StateViewPublisher(this.interest, this.state, this.registry);
    this.partyRule = this.content.bundle.rules?.party ?? {
      maxMembers: 4,
      assistSharePermille: 0,
      assistRangeTiles: 12,
    };
    this.autoPickupRangeTiles =
      this.content.bundle.rules?.loot?.autoPickupRangeTiles ?? DEFAULT_AUTO_PICKUP_RANGE_TILES;
    this.autoPickupEnabled = options.autoPickup ?? true;
    this.parties =
      options.partyService ?? new PartyService({ maxMembers: this.partyRule.maxMembers });
    this.parties.registerRoom(this.roomId, {
      sendInvite: (playerId, invite) => {
        this.registry.findByPlayerId(playerId)?.client.send(SERVER_MESSAGES.partyInvite, invite);
      },
      sendChat: (playerId, message) => {
        this.registry
          .findByPlayerId(playerId)
          ?.client.send(SERVER_MESSAGES.chatMessage, chatMessageSchema.parse(message));
      },
      refresh: (playerIds) => {
        for (const playerId of playerIds) {
          const session = this.registry.findByPlayerId(playerId);
          if (session !== undefined) {
            this.sendPartySnapshot(session.client, session);
          }
        }
      },
    });

    let respawnTile: TilePoint;
    try {
      respawnTile = playerRespawnPointOf(this.map.runtime.manifest);
    } catch {
      throw new Error(`map "${this.map.mapId}" has no spawn point for combat respawn`);
    }
    this.combat = new CombatWorld({
      spawns: options.monsterSpawns ?? this.map.runtime.manifest.monsterSpawns,
      grid: this.map.runtime.grid,
      pathfinder: findPath,
      rng: options.combatRng ?? createCombatRng(),
      playerRespawnTile: respawnTile,
      content: this.content.bundle,
      // The immutable compiled map decides safe zones; client intent can never
      // change it (ADR-021).
      pvpEnabled: this.map.runtime.manifest.pvpMode === 'open',
      ...(options.monsterRespawnMs === undefined
        ? {}
        : { monsterRespawnMs: options.monsterRespawnMs }),
      ...(options.playerRespawnMs === undefined
        ? {}
        : { playerRespawnMs: options.playerRespawnMs }),
    });
    for (const monster of this.combat.listMonsters()) {
      const monsterState = new MonsterState();
      monsterState.monsterId = monster.id;
      monsterState.templateId = monster.templateId;
      monsterState.displayName = monster.displayName;
      monsterState.level = monster.level;
      monsterState.x = monster.x;
      monsterState.y = monster.y;
      monsterState.facing = monster.facing;
      monsterState.hp = monster.hp;
      monsterState.maxHp = monster.maxHp;
      monsterState.state = MONSTER_STATE_CODES[monster.state];
      monsterState.boss = monster.boss;
      monsterState.enraged = monster.enraged;
      this.state.monsters.set(monster.id, monsterState);
      this.interest.add(monster.id, tileOfUnits(monster));
    }

    this.assets = new AssetService(options.database, {
      content: this.content.bundle,
      ...(options.economyRng === undefined ? {} : { rng: options.economyRng }),
    });

    // Quest views must name the giver even when the player is on another map
    // (the return trip and auto-delivery show the name in the wilds).
    for (const npc of MAP_MANIFESTS.flatMap((map) => map.npcPoints)) {
      this.npcNames.set(npc.id, npc.name);
    }
    for (const map of MAP_MANIFESTS) {
      this.mapNames.set(map.mapId, map.name);
    }

    const resetRule = this.content.bundle.rules?.dailyReset;
    this.questPeriodKey = resetRule === undefined ? null : dailyPeriodKey(new Date(), resetRule);

    this.metrics = options.metrics.register(this.roomId, {
      mapId: this.map.mapId,
      instanceId: this.map.instanceId,
      contentVersion: this.content.version,
    });

    const tickHz = options.tickHz ?? DEFAULT_TICK_HZ;
    const patchRateMs = options.patchRateMs ?? DEFAULT_PATCH_RATE_MS;
    this.checkpointIntervalMs = options.checkpointIntervalMs ?? DEFAULT_CHECKPOINT_INTERVAL_MS;

    this.state.mapId = this.map.mapId;
    this.state.instanceId = this.map.instanceId;
    this.state.contentVersion = this.content.version;
    this.state.contentChecksum = this.content.checksum;
    this.state.tickHz = tickHz;
    this.state.speedUnitsPerSecond = PLAYER_SPEED_UNITS_PER_SECOND;
    this.setPatchRate(patchRateMs);

    // Patch writes happen synchronously inside broadcastPatch(), so a flag
    // around it lets the per-client byte counter separate patches from
    // ordinary messages without touching Colyseus internals.
    const broadcastPatch = this.broadcastPatch.bind(this);
    this.broadcastPatch = (): boolean => {
      this.patching = true;
      try {
        return broadcastPatch();
      } finally {
        this.patching = false;
      }
    };

    const stepMs = 1_000 / tickHz;
    this.runner = createFixedStepRunner({
      stepMs,
      maxCatchUpSteps: 5,
      onStep: () => {
        this.simulateTick();
      },
    });
    this.setSimulationInterval((deltaMs) => {
      this.runner.advance(deltaMs);
    }, stepMs);

    this.onMessage<unknown>(CLIENT_MESSAGES.moveTo, (client, message) => {
      this.handleMove(client, message);
    });
    this.onMessage<unknown>(CLIENT_MESSAGES.moveStop, (client, message) => {
      this.handleMoveStop(client, message);
    });
    this.onMessage<unknown>(CLIENT_MESSAGES.chatSend, (client, message) => {
      this.handleChat(client, message);
    });
    this.onMessage<unknown>(CLIENT_MESSAGES.combatBasicAttack, (client, message) => {
      this.handleBasicAttack(client, message);
    });
    this.onMessage<unknown>(CLIENT_MESSAGES.combatEngage, (client, message) => {
      this.handleEngage(client, message);
    });
    this.onMessage<unknown>(CLIENT_MESSAGES.combatAutoAttackStart, (client, message) => {
      this.handleAutoAttackStart(client, message);
    });
    this.onMessage<unknown>(CLIENT_MESSAGES.combatAutoAttackStop, (client, message) => {
      this.handleAutoAttackStop(client, message);
    });
    this.onMessage<unknown>(CLIENT_MESSAGES.skillCast, (client, message) => {
      this.handleSkillCast(client, message);
    });
    this.onMessage<unknown>(CLIENT_MESSAGES.lootPickup, (client, message) => {
      this.handleLootPickup(client, message);
    });
    this.onMessage<unknown>(CLIENT_MESSAGES.inventoryEquip, (client, message) => {
      this.handleInventoryEquip(client, message);
    });
    this.onMessage<unknown>(CLIENT_MESSAGES.inventoryUnequip, (client, message) => {
      this.handleInventoryUnequip(client, message);
    });
    this.onMessage<unknown>(CLIENT_MESSAGES.inventoryUse, (client, message) => {
      this.handleInventoryUse(client, message);
    });
    this.onMessage<unknown>(CLIENT_MESSAGES.shopBuy, (client, message) => {
      this.handleShopBuy(client, message);
    });
    this.onMessage<unknown>(CLIENT_MESSAGES.shopSell, (client, message) => {
      this.handleShopSell(client, message);
    });
    this.onMessage<unknown>(CLIENT_MESSAGES.questAccept, (client, message) => {
      this.handleQuestAccept(client, message);
    });
    this.onMessage<unknown>(CLIENT_MESSAGES.questClaim, (client, message) => {
      this.handleQuestClaim(client, message);
    });
    this.onMessage<unknown>(CLIENT_MESSAGES.questNavigate, (client, message) => {
      this.handleQuestNavigate(client, message);
    });
    this.onMessage<unknown>(CLIENT_MESSAGES.partyInvite, (client, message) => {
      this.handlePartyInvite(client, message);
    });
    this.onMessage<unknown>(CLIENT_MESSAGES.partyAccept, (client, message) => {
      this.handlePartyInviteReply(client, message, 'accept');
    });
    this.onMessage<unknown>(CLIENT_MESSAGES.partyDecline, (client, message) => {
      this.handlePartyInviteReply(client, message, 'decline');
    });
    this.onMessage<unknown>(CLIENT_MESSAGES.partyLeave, (client, message) => {
      this.handlePartyLeave(client, message);
    });
    this.onMessage<unknown>(CLIENT_MESSAGES.partyTransferLeader, (client, message) => {
      this.handlePartyTransferLeader(client, message);
    });
    this.onMessage<unknown>(CLIENT_MESSAGES.partyKick, (client, message) => {
      this.handlePartyKick(client, message);
    });

    this.clock.setInterval(() => {
      void this.refreshLeases();
    }, LEASE_REFRESH_INTERVAL_MS);
    this.clock.setInterval(() => {
      void this.checkpointAll();
    }, this.checkpointIntervalMs);
    this.clock.setInterval(() => {
      void this.purgeExpiredDrops();
    }, LOOT_DB_PURGE_INTERVAL_MS);
    this.clock.setInterval(() => {
      this.parties.expireInvites();
      this.refreshPartyPresence();
    }, PARTY_INVITE_SWEEP_INTERVAL_MS);
    this.clock.setInterval(() => {
      this.refreshQuestPeriod();
    }, QUEST_PERIOD_SWEEP_INTERVAL_MS);

    options.adminHub?.register({
      roomId: this.roomId,
      snapshot: () => this.adminSnapshot(),
      apply: (command) => this.applyAdminCommand(command),
    });

    options.logger.info(
      {
        roomId: this.roomId,
        mapId: this.map.mapId,
        instanceId: this.map.instanceId,
        tickHz,
        patchRateMs,
        serverId: options.serverId,
        monsters: this.state.monsters.size,
      },
      'world map room created',
    );

    // Unclaimed drops survive a room restart because the item instance and its
    // world drop row are committed before the client is told about them.
    void this.purgeExpiredDrops();
    void this.restoreLoot();
  }

  override async onAuth(client: Client, rawOptions: unknown): Promise<WorldAuthData> {
    const parsed = worldJoinOptionsSchema.safeParse(rawOptions);
    if (!parsed.success) {
      throw new ServerError(ErrorCode.AUTH_FAILED, '进入世界的凭证格式不正确');
    }
    if (parsed.data.protocolVersion !== PROTOCOL_VERSION) {
      throw new ServerError(
        ErrorCode.AUTH_FAILED,
        `Protocol version ${String(PROTOCOL_VERSION)} required`,
      );
    }

    try {
      return await this.authenticateTicket(client, parsed.data.ticket);
    } catch (error) {
      if (error instanceof ServerError) {
        throw error;
      }
      this.options.logger.error(
        { err: error, roomId: this.roomId, sessionId: client.sessionId },
        'game ticket validation failed',
      );
      throw new ServerError(ErrorCode.AUTH_FAILED, '身份校验服务暂不可用，请稍后重试');
    }
  }

  override onJoin(client: Client): void {
    this.instrumentClient(client);

    const auth = authDataSchema.parse(client.auth);
    if (this.registry.hasPlayer(auth.characterId)) {
      throw new ServerError(ErrorCode.AUTH_FAILED, '该角色正在另一台设备上游戏');
    }

    const loaded = this.pendingAssets.get(client.sessionId);
    this.pendingAssets.delete(client.sessionId);
    if (loaded === undefined) {
      throw new ServerError(ErrorCode.AUTH_FAILED, '角色资产加载失败，请重新进入');
    }
    const questRecords = this.pendingQuests.get(client.sessionId) ?? [];
    this.pendingQuests.delete(client.sessionId);
    const snapshot = loaded.snapshot;

    // A character that was last checkpointed at 0 HP re-enters at a spawn point
    // with full vitals; combat never persists a dead character in place.
    const needsRevival = snapshot.hp <= 0;
    const spawn: { tile: TilePoint; position?: { x: number; y: number } } = needsRevival
      ? { tile: this.pickSpawnPoint() }
      : this.resolveSpawn(auth);
    this.simulation.addPlayer({
      id: auth.characterId,
      displayName: auth.displayName,
      spawn: spawn.tile,
      colorIndex: colorIndexFor(auth.characterId),
      ...(spawn.position === undefined ? {} : { position: spawn.position }),
      facing: toFacing(auth.facing),
    });

    const position = this.simulation.getPlayer(auth.characterId);
    try {
      this.combat.addPlayer({
        id: auth.characterId,
        displayName: auth.displayName,
        classId: auth.classId,
        level: snapshot.level,
        hp: needsRevival ? loaded.stats.maxHp : snapshot.hp,
        mp: needsRevival ? loaded.stats.maxMp : snapshot.mp,
        x: position?.x ?? 0,
        y: position?.y ?? 0,
        stats: loaded.stats,
      });
    } catch (error) {
      this.simulation.removePlayer(auth.characterId);
      this.options.logger.error(
        { err: error, roomId: this.roomId, characterId: auth.characterId },
        'failed to initialize combat state',
      );
      throw new ServerError(ErrorCode.AUTH_FAILED, '角色战斗状态初始化失败');
    }
    const combatPlayer = this.combat.getPlayer(auth.characterId);
    if (combatPlayer === undefined || position === undefined) {
      throw new ServerError(ErrorCode.AUTH_FAILED, '角色战斗状态初始化失败');
    }

    const player = new PlayerState();
    player.playerId = auth.characterId;
    player.displayName = auth.displayName;
    player.classId = auth.classId;
    player.level = combatPlayer.level;
    player.colorIndex = colorIndexFor(auth.characterId);
    player.hp = combatPlayer.hp;
    player.maxHp = combatPlayer.maxHp;
    player.mp = combatPlayer.mp;
    player.maxMp = combatPlayer.maxMp;
    player.alive = combatPlayer.alive;
    player.x = position.x;
    player.y = position.y;
    player.facing = position.facing;
    this.state.players.set(auth.characterId, player);
    this.state.playerCount = this.state.players.size;

    const view = new StateView();
    const session: SessionRecord = {
      client,
      playerId: auth.characterId,
      accountId: auth.accountId,
      displayName: auth.displayName,
      mutedUntil: auth.mutedUntil,
      lastSequence: -1,
      recentAcks: new Map(),
      rateBucket: createTokenBucket({
        capacity: this.options.commandRateCapacity ?? DEFAULT_COMMAND_RATE_CAPACITY,
        refillPerSecond:
          this.options.commandRateRefillPerSecond ?? DEFAULT_COMMAND_RATE_REFILL_PER_SECOND,
        startMs: Date.now(),
      }),
      chatBucket: createTokenBucket({
        capacity: this.options.chatRateCapacity ?? DEFAULT_CHAT_RATE_CAPACITY,
        refillPerSecond:
          this.options.chatRateRefillPerSecond ?? DEFAULT_CHAT_RATE_REFILL_PER_SECOND,
        startMs: Date.now(),
      }),
      recentChatIds: new Set(),
      recentCombat: new Map(),
      recentAssets: new Map(),
      recentAutoCommands: new Map(),
      autoAttack: null,
      questNavigation: null,
      recentQuestCommands: new Map(),
      assetSnapshot: {
        ...snapshot,
        level: combatPlayer.level,
        hp: combatPlayer.hp,
        maxHp: combatPlayer.maxHp,
        mp: combatPlayer.mp,
        maxMp: combatPlayer.maxMp,
        attack: combatPlayer.attack,
        defense: combatPlayer.defense,
      },
      questRecords: new Map(questRecords.map((record) => [record.questId, record])),
      recentParty: new Map(),
      hp: combatPlayer.hp,
      mp: combatPlayer.mp,
      terminated: null,
      transferring: false,
      transferTargetMapId: null,
      checkpointing: false,
      lastCheckpointAt: Date.now(),
      view,
      visible: new Set(),
    };
    this.registry.add(session);
    client.view = view;
    this.parties.setPresence({
      playerId: auth.characterId,
      displayName: auth.displayName,
      classId: combatPlayer.classId,
      level: combatPlayer.level,
      hp: combatPlayer.hp,
      maxHp: combatPlayer.maxHp,
      alive: combatPlayer.alive,
      connected: true,
      roomId: this.roomId,
    });

    const affected = this.interest.add(auth.characterId, spawn.tile);
    this.views.refresh(affected);
    this.metrics.setPlayers(this.state.players.size);
    // Deferred so the profile is delivered after the join handshake; a message
    // sent inside onJoin can otherwise race the client's listener registration.
    this.clock.setTimeout(() => {
      const session = this.registry.get(client.sessionId);
      if (session !== undefined) {
        this.sendProfile(session.client, session.playerId);
        this.sendAssetSnapshot(session.client, session);
        this.sendShopCatalog(session.client, session);
        this.sendQuestSnapshot(session.client, session);
        this.sendPartySnapshot(session.client, session);
        // An invitation sent while this character was between maps is still
        // open; deliver it once the new room has registered its listeners.
        const pendingInvite = this.parties.pendingInviteFor(auth.characterId);
        if (pendingInvite !== undefined) {
          this.parties.notifyInvite(pendingInvite);
        }
        this.broadcastSystemNotice(
          'info',
          `${auth.displayName} 来到了 ${this.map.runtime.manifest.name}`,
        );
      }
    }, 50);

    this.metrics.recordWsConnection();
    this.options.logger.info(
      {
        roomId: this.roomId,
        mapId: this.map.mapId,
        characterId: auth.characterId,
        accountId: auth.accountId,
        spawn: spawn.tile,
        clients: this.state.players.size,
      },
      'player joined world',
    );
  }

  override async onReconnect(client: Client): Promise<void> {
    const session = this.registry.get(client.sessionId);
    if (session === undefined) {
      return;
    }
    // A moderator disconnect never grants the grace window, so a modified
    // client cannot use its old reconnection token to restore the session.
    if (session.terminated !== null) {
      this.rejectReconnect(client, session.terminated, '该会话已被管理员断开');
      return;
    }

    // Re-check the durable account state on every reconnection: an outbox
    // command may have banned the account while this socket was in the grace
    // window, and a client-supplied token must not bypass that (TD-SRV-04).
    let account;
    try {
      account = await findAccountById(this.options.database, session.accountId);
    } catch (error) {
      this.options.logger.error(
        { err: error, roomId: this.roomId, characterId: session.playerId },
        'failed to revalidate account on reconnect',
      );
      this.rejectReconnect(client, 'kicked', '身份校验服务暂不可用，请重新登录');
      return;
    }
    if (account === undefined || account.status !== 'active') {
      session.terminated = 'banned';
      this.rejectReconnect(client, 'banned', '该账号已被封禁');
      return;
    }
    session.mutedUntil =
      account.mutedUntil !== null && account.mutedUntil.getTime() > Date.now()
        ? account.mutedUntil.getTime()
        : null;

    // The reconnected transport hands us a fresh Client; without reapplying
    // the wrappers its outbound bytes and inbound messages would be invisible.
    this.instrumentClient(client);
    this.metrics.recordWsReconnect();
    session.client = client;
    client.view = session.view;
    // A refreshed browser starts a fresh client with sequence 0; accepting its
    // commands again must not depend on the pre-refresh sequence counter.
    session.lastSequence = -1;
    session.recentAcks.clear();
    session.recentChatIds.clear();
    session.recentCombat.clear();
    this.setConnected(session.playerId, true);
    this.combat.setPlayerTargetable(session.playerId, true);
    this.clock.setTimeout(() => {
      const current = this.registry.get(client.sessionId);
      if (current !== undefined) {
        this.sendProfile(current.client, current.playerId);
        this.sendAssetSnapshot(current.client, current);
      }
    }, 50);

    if (session.transferring && session.transferTargetMapId !== null) {
      this.sendTransfer(client, session.transferTargetMapId);
    }
    this.options.logger.info(
      { roomId: this.roomId, characterId: session.playerId },
      'player reconnected',
    );
  }

  /** Refuses a reconnection whose durable identity is no longer admissible. */
  private rejectReconnect(client: Client, kind: 'kicked' | 'banned', reason: string): void {
    try {
      client.send(
        SERVER_MESSAGES.sessionKicked,
        sessionKickedSchema.parse({ reason, kind, serverTime: Date.now() }),
      );
    } catch (error) {
      this.options.logger.warn(
        { err: error, roomId: this.roomId },
        'failed to deliver reconnect rejection',
      );
    }
    void client.leave(4000, reason);
  }

  override async onLeave(client: Client, code?: number): Promise<void> {
    this.pendingAssets.delete(client.sessionId);
    const session = this.registry.get(client.sessionId);
    if (session === undefined) {
      return;
    }

    if (code === CloseCode.CONSENTED || session.transferring || session.terminated !== null) {
      await this.removeSession(client.sessionId);
      return;
    }

    this.metrics.recordWsDisconnect();
    // Auto-attack and quest guidance never survive a disconnect; the client
    // re-issues its intent after reconnecting.
    session.autoAttack = null;
    session.questNavigation = null;
    this.setConnected(session.playerId, false);
    this.simulation.clearPath(session.playerId);
    // A dropped player must not be killed by monsters during the grace window.
    this.combat.setPlayerTargetable(session.playerId, false);

    try {
      await this.allowReconnection(
        client,
        this.options.reconnectGraceSeconds ?? DEFAULT_RECONNECT_GRACE_SECONDS,
      );
      // onReconnect may have rejected the durable identity while this promise
      // was pending; a rejected session must not be revived by the grace path.
      if (session.terminated !== null || this.registry.get(client.sessionId) !== session) {
        return;
      }
      this.setConnected(session.playerId, true);
      this.combat.setPlayerTargetable(session.playerId, true);
    } catch {
      await this.removeSession(client.sessionId);
    }
  }

  /**
   * Bandwidth attribution is per client and transport-owned. Wrapping the raw
   * senders counts every patch and message; the raw socket's `message` event
   * yields the inbound payload size before Colyseus decodes it (ADR-024).
   */
  private instrumentClient(client: Client): void {
    const raw = client.raw.bind(client);
    client.raw = (data, options, callback) => {
      this.metrics.recordWsSent(data.byteLength, this.patching);
      raw(data, options, callback);
    };
    const enqueueRaw = client.enqueueRaw.bind(client);
    client.enqueueRaw = (data, options) => {
      this.metrics.recordWsSent(data.byteLength, this.patching);
      enqueueRaw(data, options);
    };
    client.ref.on('message', (data: unknown) => {
      this.metrics.recordWsReceived(payloadByteLength(data));
    });
  }

  override async onDispose(): Promise<void> {
    this.options.adminHub?.unregister(this.roomId);
    this.parties.unregisterRoom(this.roomId);
    const sessionIds = [...this.registry.sessionIds()];
    await Promise.allSettled(sessionIds.map(async (sessionId) => this.removeSession(sessionId)));
    this.options.metrics.unregister(this.roomId);
    this.options.logger.info({ roomId: this.roomId }, 'world map room disposed');
  }

  private async authenticateTicket(client: Client, ticket: string): Promise<WorldAuthData> {
    const now = new Date();
    const consumed = await consumeGameTicket(
      this.options.database,
      hashToken(ticket),
      `${this.options.serverId}:${client.sessionId}`,
      now,
    );
    if (consumed === undefined) {
      throw new ServerError(ErrorCode.AUTH_FAILED, '进入世界的票据无效或已过期，请重新进入');
    }

    const character = await findCharacterById(this.options.database, consumed.characterId);
    if (
      character === undefined ||
      character.accountId !== consumed.accountId ||
      character.realmId !== consumed.realmId
    ) {
      throw new ServerError(ErrorCode.AUTH_FAILED, '角色信息无效，请重新登录');
    }

    const realm = await findRealmById(this.options.database, character.realmId);
    if (realm === undefined || realm.status !== 'active') {
      throw new ServerError(ErrorCode.AUTH_FAILED, '该区服当前不可进入');
    }
    if (this.options.realmCode !== undefined && realm.code !== this.options.realmCode) {
      throw new ServerError(ErrorCode.AUTH_FAILED, '该角色不属于当前区服，请从对应区服进入');
    }

    // A ban persists on the account; an already-issued ticket cannot bypass it.
    const account = await findAccountById(this.options.database, character.accountId);
    if (account === undefined || account.status !== 'active') {
      throw new ServerError(ErrorCode.AUTH_FAILED, '该账号已被封禁');
    }
    const mutedUntil =
      account.mutedUntil !== null && account.mutedUntil.getTime() > now.getTime()
        ? account.mutedUntil.getTime()
        : null;

    // The ticket alone never chooses a map; the persisted character decides,
    // and the room only accepts players whose map matches its instance.
    if (character.mapId !== this.map.mapId) {
      throw new ServerError(ErrorCode.AUTH_FAILED, '角色当前不在此地图，请重新进入');
    }

    const leaseAcquired = await acquireCharacterLease(this.options.database, {
      characterId: character.id,
      sessionId: client.sessionId,
      gameServerId: this.options.serverId,
      leaseExpiresAt: new Date(now.getTime() + LEASE_DURATION_MS),
      now,
    });
    if (!leaseAcquired) {
      throw new ServerError(ErrorCode.AUTH_FAILED, '该角色正在另一台设备上游戏');
    }

    let assets: LoadedAssets;
    let questRecords: QuestRecordState[];
    try {
      [assets, questRecords] = await Promise.all([
        this.assets.loadAssets(character.id),
        this.assets.loadQuestRecords(character.id),
      ]);
    } catch (error) {
      await releaseCharacterLease(this.options.database, character.id, client.sessionId).catch(
        () => undefined,
      );
      this.options.logger.error(
        { err: error, roomId: this.roomId, characterId: character.id },
        'failed to load character assets',
      );
      throw new ServerError(ErrorCode.AUTH_FAILED, '角色资产加载失败，请稍后重试');
    }
    this.pendingAssets.set(client.sessionId, assets);
    this.pendingQuests.set(client.sessionId, questRecords);

    return {
      accountId: character.accountId,
      characterId: character.id,
      realmId: character.realmId,
      displayName: character.name,
      classId: character.classId,
      level: character.level,
      mapId: character.mapId,
      x: character.x,
      y: character.y,
      facing: character.facing,
      hp: character.hp,
      maxHp: character.maxHp,
      mp: character.mp,
      maxMp: character.maxMp,
      mutedUntil,
    };
  }

  private resolveSpawn(auth: WorldAuthData): {
    tile: TilePoint;
    position?: { x: number; y: number };
  } {
    if (auth.mapId === this.map.mapId) {
      const tile = tileOfUnits({ x: auth.x, y: auth.y });
      if (this.map.runtime.isStandable(tile)) {
        return { tile, position: { x: auth.x, y: auth.y } };
      }
      this.options.logger.warn(
        { roomId: this.roomId, characterId: auth.characterId, x: auth.x, y: auth.y },
        'stored character position is not walkable; using a spawn point',
      );
    }
    return { tile: this.pickSpawnPoint() };
  }

  private async refreshLeases(): Promise<void> {
    const sessionIds = [...this.registry.sessionIds()];
    if (sessionIds.length === 0) {
      return;
    }
    const now = new Date();
    try {
      await refreshCharacterLeases(
        this.options.database,
        sessionIds,
        new Date(now.getTime() + LEASE_DURATION_MS),
        now,
      );
    } catch (error) {
      this.options.logger.error(
        { err: error, roomId: this.roomId },
        'failed to refresh character leases',
      );
    }
  }

  /** Merged checkpoint: positions and HP/MP are saved at a throttled interval. */
  private async checkpointAll(): Promise<void> {
    const now = Date.now();
    await Promise.allSettled(
      [...this.registry.all()].map(async (session) => {
        if (session.transferring || session.checkpointing) {
          return;
        }
        if (now - session.lastCheckpointAt < this.checkpointIntervalMs) {
          return;
        }
        const player = this.simulation.getPlayer(session.playerId);
        const combatPlayer = this.combat.getPlayer(session.playerId);
        if (player === undefined || combatPlayer === undefined) {
          return;
        }
        session.checkpointing = true;
        session.lastCheckpointAt = now;
        try {
          await saveCharacterCheckpoint(this.options.database, {
            characterId: session.playerId,
            mapId: this.map.mapId,
            x: player.x,
            y: player.y,
            facing: player.facing,
            hp: combatPlayer.hp,
            mp: combatPlayer.mp,
          });
        } catch (error) {
          this.options.logger.error(
            { err: error, roomId: this.roomId, characterId: session.playerId },
            'failed to checkpoint character position',
          );
        } finally {
          session.checkpointing = false;
        }
      }),
    );
  }

  private simulateTick(): void {
    const started = performance.now();
    this.state.serverTick = this.tick;
    this.tick += 1;

    const stepMs = 1_000 / this.state.tickHz;
    this.simulation.step(stepMs);

    const players = this.simulation.listPlayers();
    const positions = new Map(players.map((player) => [player.id, { x: player.x, y: player.y }]));
    const combatEvents = this.combat.step(stepMs, positions);
    this.applyCombatEvents(combatEvents);
    this.updateQuestNavigation();
    this.updateAutoAttacks();

    this.syncPlayers(players);
    this.syncMonsters();
    if (this.tick % AUTO_PICKUP_INTERVAL_TICKS === 0) {
      this.autoPickupTick();
    }
    if (this.tick % LOOT_EXPIRY_CHECK_TICKS === 0) {
      this.expireLoot();
    }
    if (this.tick % REACH_CHECK_INTERVAL_TICKS === 0) {
      this.reachQuestTick();
    }

    for (const player of players) {
      const sessionId = this.registry.sessionIdForPlayer(player.id);
      const session = sessionId === undefined ? undefined : this.registry.get(sessionId);
      if (session === undefined || session.transferring) {
        continue;
      }
      if (this.combat.getPlayer(player.id)?.alive === false) {
        continue;
      }
      const portal = this.map.runtime.portalAt(tileOfUnits(player));
      if (portal !== undefined) {
        session.transferring = true;
        session.transferTargetMapId = portal.targetMapId;
        this.stopQuestNavigation(session, { silent: true, clearPath: false });
        this.simulation.clearPath(player.id);
        void this.beginTransfer(session, portal, player);
      }
    }

    for (const player of players) {
      this.queueViewRefresh(this.interest.move(player.id, tileOfUnits(player)));
    }
    this.flushViewRefresh();

    this.metrics.recordTick(performance.now() - started);
  }

  /**
   * AOI moves are queued per tick: many entities crossing cells at once would
   * otherwise recompute the same viewer repeatedly. The flush still happens
   * before the tick ends, so `session.visible` is current for the next tick.
   */
  private queueViewRefresh(affected: readonly string[]): void {
    for (const id of affected) {
      this.pendingViewRefresh.add(id);
    }
  }

  private flushViewRefresh(): void {
    if (this.pendingViewRefresh.size === 0) {
      return;
    }
    const affected = [...this.pendingViewRefresh];
    this.pendingViewRefresh.clear();
    this.views.refresh(affected);
  }

  private applyCombatEvents(events: readonly CombatEventPayload[]): void {
    for (const event of events) {
      if (event.kind === 'death' && event.entityType === 'player') {
        this.simulation.clearPath(event.entityId);
      } else if (event.kind === 'respawn') {
        try {
          this.simulation.setPosition(event.entityId, { x: event.x, y: event.y });
        } catch (error) {
          this.options.logger.error(
            { err: error, roomId: this.roomId, characterId: event.entityId },
            'failed to move respawned player',
          );
        }
        const affected = this.interest.move(event.entityId, {
          x: Math.floor(event.x / TILE_UNITS),
          y: Math.floor(event.y / TILE_UNITS),
        });
        if (affected.length > 0) {
          this.views.refresh(affected);
        }
      }
    }

    if (events.length === 0) {
      return;
    }
    const wireEvents = this.toWireEvents(events);
    for (const event of wireEvents) {
      this.broadcastCombatEvent(event);
    }
    this.recordCombatOutcomes(wireEvents);
    this.metrics.recordCombatEvents(wireEvents.length);
  }

  /**
   * Combat events are private to the entities involved and to viewers whose AOI
   * actually contains one of them (TD-SRV-02). A full-room broadcast leaks
   * unrelated fights and, worse, makes a remote heal look like the viewer's own.
   * Public announcements (deaths, level-ups) use `broadcastSystemNotice`.
   */
  private broadcastCombatEvent(event: CombatEvent): void {
    const recipients = new Map<string, Client>();
    const add = (session: SessionRecord): void => {
      recipients.set(session.client.sessionId, session.client);
    };
    const addViewersOf = (entityIds: readonly string[]): void => {
      for (const session of this.registry.all()) {
        if (entityIds.some((id) => session.visible.has(id))) {
          add(session);
        }
      }
    };

    switch (event.kind) {
      case 'respawn':
        // The revive countdown and restored vitals belong to that player only.
        for (const session of this.registry.all()) {
          if (session.playerId === event.entityId) {
            add(session);
          }
        }
        break;
      case 'heal': {
        // Healing is a private exchange: only the caster and the healed player.
        for (const session of this.registry.all()) {
          if (session.playerId === event.sourceId || session.playerId === event.targetId) {
            add(session);
          }
        }
        break;
      }
      case 'spawn':
        addViewersOf([event.entityId]);
        break;
      case 'death':
        addViewersOf(
          event.killerId === undefined ? [event.entityId] : [event.entityId, event.killerId],
        );
        break;
      case 'attack':
      case 'hit':
      case 'miss':
      case 'shield':
      case 'telegraph':
        addViewersOf([event.sourceId, event.targetId]);
        break;
      case 'enrage':
        // The phase change is visible to everyone who can see the boss; the
        // room-wide notice below is a separate, map-level announcement.
        addViewersOf([event.entityId]);
        break;
    }

    for (const client of recipients.values()) {
      client.send(SERVER_MESSAGES.combatEvent, event);
    }
  }

  private syncPlayers(players: readonly SimulationPlayer[]): void {
    for (const player of players) {
      const statePlayer = this.state.players.get(player.id);
      const combatPlayer = this.combat.getPlayer(player.id);
      if (statePlayer === undefined || combatPlayer === undefined) {
        continue;
      }
      statePlayer.x = player.x;
      statePlayer.y = player.y;
      statePlayer.facing = player.facing;
      statePlayer.level = combatPlayer.level;
      statePlayer.moving = combatPlayer.alive && player.moving;
      statePlayer.hp = combatPlayer.hp;
      statePlayer.maxHp = combatPlayer.maxHp;
      statePlayer.mp = combatPlayer.mp;
      statePlayer.maxMp = combatPlayer.maxMp;
      statePlayer.alive = combatPlayer.alive;

      const sessionId = this.registry.sessionIdForPlayer(player.id);
      const session = sessionId === undefined ? undefined : this.registry.get(sessionId);
      if (session !== undefined) {
        session.hp = combatPlayer.hp;
        session.mp = combatPlayer.mp;
      }
    }
  }

  private syncMonsters(): void {
    for (const monster of this.combat.listMonsters()) {
      const stateMonster = this.state.monsters.get(monster.id);
      if (stateMonster === undefined) {
        continue;
      }
      stateMonster.x = monster.x;
      stateMonster.y = monster.y;
      stateMonster.facing = monster.facing;
      stateMonster.hp = monster.hp;
      stateMonster.maxHp = monster.maxHp;
      stateMonster.moving = monster.moving;
      stateMonster.state = MONSTER_STATE_CODES[monster.state];
      stateMonster.enraged = monster.enraged;

      this.queueViewRefresh(this.interest.move(monster.id, tileOfUnits(monster)));
    }
  }

  private async beginTransfer(
    session: SessionRecord,
    portal: MapPortal,
    player: { facing: Facing },
  ): Promise<void> {
    const target = tileCenter(portal.targetTile);
    const combatPlayer = this.combat.getPlayer(session.playerId);
    try {
      await saveCharacterTransfer(this.options.database, {
        characterId: session.playerId,
        mapId: portal.targetMapId,
        x: target.x,
        y: target.y,
        facing: player.facing,
        hp: combatPlayer?.hp ?? session.hp,
        mp: combatPlayer?.mp ?? session.mp,
      });
      await releaseCharacterLease(
        this.options.database,
        session.playerId,
        session.client.sessionId,
      );
    } catch (error) {
      session.transferring = false;
      session.transferTargetMapId = null;
      this.options.logger.error(
        { err: error, roomId: this.roomId, characterId: session.playerId },
        'failed to persist map transfer',
      );
      return;
    }

    session.transferTargetMapId = portal.targetMapId;
    session.lastCheckpointAt = Date.now();
    this.stopAutoAttack(session, 'transferred');

    // The target map is committed: remove the entity from this instance before
    // telling the browser to leave, so the character never exists twice.
    const affected = this.interest.remove(session.playerId);
    this.views.refresh(affected);
    this.simulation.removePlayer(session.playerId);
    this.combat.removePlayer(session.playerId);
    this.state.players.delete(session.playerId);
    this.state.playerCount = this.state.players.size;
    this.metrics.setPlayers(this.state.players.size);
    this.metrics.recordTransfer();
    this.sendTransfer(session.client, portal.targetMapId);

    this.options.logger.info(
      {
        roomId: this.roomId,
        characterId: session.playerId,
        fromMapId: this.map.mapId,
        toMapId: portal.targetMapId,
        portalId: portal.id,
      },
      'player transferred between maps',
    );
  }

  private sendTransfer(client: Client, mapId: string): void {
    const message: SessionTransfer = { mapId, serverTime: Date.now() };
    client.send(SERVER_MESSAGES.sessionTransfer, sessionTransferSchema.parse(message));
  }

  private handleMove(client: Client, raw: unknown): void {
    const session = this.registry.get(client.sessionId);
    if (session === undefined) {
      this.sendRejection(client, {}, 'INVALID_SESSION');
      return;
    }
    if (session.transferring) {
      this.sendRejection(client, extractCommandMeta(raw), 'INVALID_SESSION');
      return;
    }

    const parsed = moveToCommandSchema.safeParse(raw);
    if (!parsed.success) {
      this.sendRejection(client, extractCommandMeta(raw), 'INVALID_PAYLOAD');
      return;
    }

    const command = parsed.data;
    const gate = this.guard.check(session, command, session.recentAcks.has(command.commandId));
    if (gate.kind === 'reject') {
      this.sendRejection(
        client,
        { commandId: command.commandId, clientSequence: command.clientSequence },
        gate.code,
      );
      return;
    }
    if (gate.kind === 'duplicate') {
      const cached = session.recentAcks.get(command.commandId);
      if (cached !== undefined) {
        const replay: CommandAck = { ...cached, deduplicated: true, serverTime: Date.now() };
        client.send(SERVER_MESSAGES.commandAck, commandAckSchema.parse(replay));
      }
      return;
    }

    const player = this.simulation.getPlayer(session.playerId);
    if (player === undefined) {
      this.sendRejection(
        client,
        { commandId: command.commandId, clientSequence: command.clientSequence },
        'INVALID_SESSION',
      );
      return;
    }
    if (this.combat.getPlayer(session.playerId)?.alive === false) {
      this.sendRejection(
        client,
        { commandId: command.commandId, clientSequence: command.clientSequence },
        'PLAYER_DEAD',
      );
      return;
    }

    const target: TilePoint = { x: command.targetTileX, y: command.targetTileY };
    if (!this.map.runtime.isWalkable(target.x, target.y)) {
      this.sendRejection(
        client,
        { commandId: command.commandId, clientSequence: command.clientSequence },
        'INVALID_TARGET',
      );
      return;
    }

    const path = findPath(this.map.runtime.grid, tileOfUnits(player), target);
    if (path === null) {
      this.sendRejection(
        client,
        { commandId: command.commandId, clientSequence: command.clientSequence },
        'UNREACHABLE',
      );
      return;
    }

    this.simulation.setPath(player.id, path);
    // A manual move is an explicit cancel: it must win over the approach path
    // the auto-attack loop would otherwise re-apply on the next tick.
    this.stopAutoAttack(session, 'stopped', false);
    this.stopQuestNavigation(session, { silent: true, clearPath: false });
    session.lastSequence = command.clientSequence;

    const ack: CommandAck = {
      commandId: command.commandId,
      clientSequence: command.clientSequence,
      serverTime: Date.now(),
      deduplicated: false,
      path,
      speedUnitsPerSecond: player.speedUnitsPerSecond,
      startX: player.x,
      startY: player.y,
    };

    this.guard.remember(session.recentAcks, command.commandId, ack);

    client.send(SERVER_MESSAGES.commandAck, commandAckSchema.parse(ack));
    this.metrics.recordAcceptedCommand();
  }

  /** Stops the current path and any auto-attack; the character stays put. */
  private handleMoveStop(client: Client, raw: unknown): void {
    const session = this.registry.get(client.sessionId);
    if (session === undefined) {
      this.sendRejection(client, {}, 'INVALID_SESSION');
      return;
    }
    if (session.transferring) {
      this.sendRejection(client, extractCommandMeta(raw), 'INVALID_SESSION');
      return;
    }

    const parsed = moveStopCommandSchema.safeParse(raw);
    if (!parsed.success) {
      this.sendRejection(client, extractCommandMeta(raw), 'INVALID_PAYLOAD');
      return;
    }

    const command = parsed.data;
    const gate = this.guard.check(session, command, session.recentAcks.has(command.commandId));
    if (gate.kind === 'reject') {
      this.sendRejection(
        client,
        { commandId: command.commandId, clientSequence: command.clientSequence },
        gate.code,
      );
      return;
    }
    if (gate.kind === 'duplicate') {
      const cached = session.recentAcks.get(command.commandId);
      if (cached !== undefined) {
        const replay: CommandAck = { ...cached, deduplicated: true, serverTime: Date.now() };
        client.send(SERVER_MESSAGES.commandAck, commandAckSchema.parse(replay));
      }
      return;
    }

    const player = this.simulation.getPlayer(session.playerId);
    if (player === undefined) {
      this.sendRejection(
        client,
        { commandId: command.commandId, clientSequence: command.clientSequence },
        'INVALID_SESSION',
      );
      return;
    }

    this.simulation.clearPath(player.id);
    this.stopAutoAttack(session, 'stopped', false);
    this.stopQuestNavigation(session, { silent: true, clearPath: false });
    session.lastSequence = command.clientSequence;

    const ack: CommandAck = {
      commandId: command.commandId,
      clientSequence: command.clientSequence,
      serverTime: Date.now(),
      deduplicated: false,
      path: [],
      speedUnitsPerSecond: player.speedUnitsPerSecond,
      startX: player.x,
      startY: player.y,
    };

    this.guard.remember(session.recentAcks, command.commandId, ack);
    client.send(SERVER_MESSAGES.commandAck, commandAckSchema.parse(ack));
    this.metrics.recordAcceptedCommand();
  }

  private handleBasicAttack(client: Client, raw: unknown): void {
    const parsed = combatBasicAttackSchema.safeParse(raw);
    if (!parsed.success) {
      this.sendRejection(client, extractCommandMeta(raw), 'INVALID_PAYLOAD');
      return;
    }
    const command = parsed.data;
    this.runCombatCommand(client, command, (playerId) =>
      this.combat.basicAttack(playerId, command.targetId),
    );
  }

  private handleSkillCast(client: Client, raw: unknown): void {
    const parsed = skillCastSchema.safeParse(raw);
    if (!parsed.success) {
      this.sendRejection(client, extractCommandMeta(raw), 'INVALID_PAYLOAD');
      return;
    }
    const command = parsed.data;
    this.runCombatCommand(client, command, (playerId) =>
      this.combat.castSkill(playerId, command.skillId, command.targetId),
    );
  }

  private handleEngage(client: Client, raw: unknown): void {
    const parsed = combatEngageSchema.safeParse(raw);
    if (!parsed.success) {
      this.sendRejection(client, extractCommandMeta(raw), 'INVALID_PAYLOAD');
      return;
    }
    this.beginAutoAttack(client, parsed.data, parsed.data.targetId);
  }

  private handleAutoAttackStart(client: Client, raw: unknown): void {
    const parsed = combatAutoAttackStartSchema.safeParse(raw);
    if (!parsed.success) {
      this.sendRejection(client, extractCommandMeta(raw), 'INVALID_PAYLOAD');
      return;
    }
    const session = this.registry.get(client.sessionId);
    if (session === undefined) {
      this.sendRejection(client, {}, 'INVALID_SESSION');
      return;
    }
    const targetId = parsed.data.targetId ?? session.autoAttack?.targetId;
    if (targetId === undefined) {
      this.sendRejection(
        client,
        { commandId: parsed.data.commandId, clientSequence: parsed.data.clientSequence },
        'INVALID_TARGET',
      );
      return;
    }
    this.beginAutoAttack(client, parsed.data, targetId);
  }

  private handleAutoAttackStop(client: Client, raw: unknown): void {
    const parsed = combatAutoAttackStopSchema.safeParse(raw);
    if (!parsed.success) {
      this.sendRejection(client, extractCommandMeta(raw), 'INVALID_PAYLOAD');
      return;
    }
    const session = this.acceptAutoAttackCommand(client, parsed.data);
    if (session === null) {
      return;
    }
    session.lastSequence = parsed.data.clientSequence;
    this.rememberAutoCommand(session, parsed.data.commandId);
    this.stopAutoAttack(session, 'stopped');
    this.stopQuestNavigation(session, { silent: true });
    this.metrics.recordAcceptedCommand();
  }

  private beginAutoAttack(
    client: Client,
    command: { commandId: string; clientSequence: number; protocolVersion: number },
    targetId: string,
  ): void {
    const session = this.acceptAutoAttackCommand(client, command);
    if (session === null) {
      return;
    }
    const rejection = this.validateAutoAttackTarget(session, targetId);
    if (rejection !== null) {
      this.sendRejection(
        client,
        { commandId: command.commandId, clientSequence: command.clientSequence },
        rejection,
      );
      return;
    }

    this.stopQuestNavigation(session, { silent: true, clearPath: false });
    session.lastSequence = command.clientSequence;
    this.rememberAutoCommand(session, command.commandId);
    // Switching targets always restarts the approach; the tick decides whether
    // the player is already in range and clears this path immediately.
    this.simulation.clearPath(session.playerId);
    session.autoAttack = {
      targetId,
      phase: 'engaged',
      nextAttackAt: 0,
      nextRepathAt: 0,
      pathTargetTile: null,
    };
    this.notifyTargetChanged(session, 'engaged');
    this.metrics.recordAcceptedCommand();
  }

  /**
   * Session/protocol/sequence/rate/idempotency gate shared by every auto-attack
   * intent. A duplicate command id re-sends the current authoritative state
   * instead of restarting an approach or double-counting a stop.
   */
  private acceptAutoAttackCommand(
    client: Client,
    command: { commandId: string; clientSequence: number; protocolVersion: number },
  ): SessionRecord | null {
    const session = this.registry.get(client.sessionId);
    if (session === undefined) {
      this.sendRejection(client, {}, 'INVALID_SESSION');
      return null;
    }
    const gate = this.guard.check(
      session,
      command,
      session.recentAutoCommands.has(command.commandId),
    );
    if (gate.kind === 'reject') {
      this.sendRejection(
        client,
        { commandId: command.commandId, clientSequence: command.clientSequence },
        gate.code,
      );
      return null;
    }
    if (gate.kind === 'duplicate') {
      this.notifyTargetChanged(session, session.autoAttack === null ? 'stopped' : 'engaged');
      return null;
    }
    return session;
  }

  private rememberAutoCommand(session: SessionRecord, commandId: string): void {
    this.guard.remember(session.recentAutoCommands, commandId, true);
  }

  private validateAutoAttackTarget(
    session: SessionRecord,
    targetId: string,
  ): CommandRejectionCode | null {
    const player = this.combat.getPlayer(session.playerId);
    if (player === undefined) {
      return 'INVALID_SESSION';
    }
    if (!player.alive) {
      return 'PLAYER_DEAD';
    }
    if (targetId === session.playerId) {
      return 'INVALID_TARGET';
    }
    const monster = this.combat.getMonster(targetId);
    if (monster !== undefined) {
      if (monster.state === 'dead') {
        return 'TARGET_DEAD';
      }
      return session.visible.has(targetId) ? null : 'INVALID_TARGET';
    }
    const target = this.combat.getPlayer(targetId);
    if (target === undefined) {
      return 'INVALID_TARGET';
    }
    if (!target.alive) {
      return 'TARGET_DEAD';
    }
    if (this.map.runtime.manifest.pvpMode !== 'open') {
      return 'SAFE_ZONE';
    }
    return session.visible.has(targetId) ? null : 'INVALID_TARGET';
  }

  /**
   * Server-driven attack loop: approach the locked target, swing on the
   * authoritative cooldown, and stop on death, loss of sight, safe zone or a
   * manual move. Clients never send per-swing messages (TD-CLI-01).
   */
  private updateAutoAttacks(): void {
    for (const session of this.registry.all()) {
      const auto = session.autoAttack;
      if (auto === null) {
        continue;
      }
      if (session.transferring) {
        this.stopAutoAttack(session, 'transferred');
        continue;
      }
      const player = this.combat.getPlayer(session.playerId);
      if (player === undefined) {
        this.stopAutoAttack(session, 'target_gone');
        continue;
      }
      if (!player.alive) {
        this.stopAutoAttack(session, 'player_dead');
        continue;
      }

      const monster = this.combat.getMonster(auto.targetId);
      const targetPlayer = monster === undefined ? this.combat.getPlayer(auto.targetId) : undefined;
      const target = monster ?? targetPlayer;
      if (target === undefined) {
        this.stopAutoAttack(session, 'target_gone');
        continue;
      }
      if (monster !== undefined ? monster.state === 'dead' : targetPlayer?.alive !== true) {
        this.stopAutoAttack(session, 'target_dead');
        continue;
      }
      if (monster === undefined) {
        if (this.map.runtime.manifest.pvpMode !== 'open') {
          this.stopAutoAttack(session, 'safe_zone');
          continue;
        }
        if (targetPlayer?.id === session.playerId) {
          this.stopAutoAttack(session, 'target_gone');
          continue;
        }
      }
      if (!session.visible.has(auto.targetId)) {
        this.stopAutoAttack(session, 'target_lost');
        continue;
      }

      const profile = this.combat.getProfile(session.playerId);
      if (profile === undefined) {
        this.stopAutoAttack(session, 'target_gone');
        continue;
      }
      const distance = Math.hypot(player.x - target.x, player.y - target.y) / TILE_UNITS;
      if (distance > profile.attackRangeTiles) {
        if (auto.phase !== 'approaching') {
          auto.phase = 'approaching';
          auto.nextAttackAt = 0;
          auto.nextRepathAt = 0;
          auto.pathTargetTile = null;
        }
        // Repath only when the target leaves its tile or the current path ran
        // out. Recomputing every interval made the player step back to the
        // current tile center on each tick (they were mid-tile), which read as
        // a stutter while chasing a stationary target.
        const playerPath = this.simulation.getPlayer(session.playerId);
        const pathExhausted = playerPath === undefined || playerPath.waypoints.length === 0;
        const targetTile = tileOfUnits(target);
        const targetMoved =
          auto.pathTargetTile === null ||
          auto.pathTargetTile.x !== targetTile.x ||
          auto.pathTargetTile.y !== targetTile.y;
        const canRepath = pathExhausted || this.combat.elapsedMs >= auto.nextRepathAt;
        if ((pathExhausted || targetMoved) && canRepath) {
          auto.nextRepathAt = this.combat.elapsedMs + AUTO_ATTACK_REPATH_INTERVAL_MS;
          const path = findPath(this.map.runtime.grid, tileOfUnits(player), targetTile);
          if (path === null) {
            this.stopAutoAttack(session, 'out_of_range');
            continue;
          }
          this.simulation.setPath(session.playerId, path);
          auto.pathTargetTile = targetTile;
          this.notifyTargetChanged(session, 'approaching', auto.targetId, path);
        }
        continue;
      }

      this.simulation.clearPath(session.playerId);
      if (auto.phase !== 'attacking') {
        auto.phase = 'attacking';
        this.notifyTargetChanged(session, 'attacking');
      }
      if (this.combat.elapsedMs < auto.nextAttackAt) {
        continue;
      }

      const result = this.combat.basicAttack(session.playerId, auto.targetId);
      if (!result.accepted) {
        switch (result.rejection?.code) {
          case 'COOLDOWN':
            auto.nextAttackAt =
              this.combat.elapsedMs + Math.max(50, result.rejection.retryAfterMs ?? 50);
            break;
          case 'OUT_OF_RANGE':
            auto.phase = 'approaching';
            auto.nextRepathAt = 0;
            auto.nextAttackAt = 0;
            this.notifyTargetChanged(session, 'approaching');
            break;
          case 'TARGET_DEAD':
            this.stopAutoAttack(session, 'target_dead');
            break;
          case 'SAFE_ZONE':
            this.stopAutoAttack(session, 'safe_zone');
            break;
          case 'PLAYER_DEAD':
            this.stopAutoAttack(session, 'player_dead');
            break;
          default:
            this.stopAutoAttack(session, 'target_gone');
            break;
        }
        continue;
      }

      auto.nextAttackAt = this.combat.elapsedMs + profile.attackIntervalMs;
      const wireEvents = this.toWireEvents(result.events);
      for (const event of wireEvents) {
        this.broadcastCombatEvent(event);
      }
      this.recordCombatOutcomes(wireEvents);
      this.metrics.recordCombatCommand();
      this.metrics.recordCombatEvents(wireEvents.length);
      this.notifyTargetChanged(session, 'attacking');
    }
  }

  private stopAutoAttack(
    session: SessionRecord,
    reason: CombatTargetChangeReason,
    clearPath = true,
  ): void {
    if (session.autoAttack === null) {
      return;
    }
    if (reason === 'target_dead' && session.questNavigation !== null) {
      // Let the kill reward (and quest progress) commit before picking the
      // next target, otherwise the last needed kill can start one extra hunt.
      session.questNavigation.nextSearchAt = this.combat.elapsedMs + QUEST_RETARGET_DELAY_MS;
    }
    session.autoAttack = null;
    if (clearPath) {
      this.simulation.clearPath(session.playerId);
    }
    this.notifyTargetChanged(session, reason, null);
  }

  private notifyTargetChanged(
    session: SessionRecord,
    reason: CombatTargetChangeReason,
    targetId: string | null = session.autoAttack?.targetId ?? null,
    approachPath?: readonly TilePoint[],
  ): void {
    const profile = this.combat.getProfile(session.playerId);
    if (profile === undefined) {
      return;
    }
    const auto = session.autoAttack;
    const nextAttackAt =
      auto === null ? 0 : Date.now() + Math.max(0, auto.nextAttackAt - this.combat.elapsedMs);
    const player = this.simulation.getPlayer(session.playerId);
    const message: CombatTargetChanged = {
      targetId,
      autoAttack: auto !== null,
      reason,
      attackIntervalMs: profile.attackIntervalMs,
      nextAttackAt,
      serverTime: Date.now(),
      ...(approachPath === undefined
        ? {}
        : {
            path: [...approachPath],
            startX: player?.x ?? 0,
            startY: player?.y ?? 0,
            speedUnitsPerSecond: player?.speedUnitsPerSecond ?? PLAYER_SPEED_UNITS_PER_SECOND,
          }),
    };
    try {
      session.client.send(
        SERVER_MESSAGES.combatTargetChanged,
        combatTargetChangedSchema.parse(message),
      );
    } catch (error) {
      this.options.logger.warn(
        { err: error, roomId: this.roomId, characterId: session.playerId },
        'failed to deliver auto-attack state',
      );
    }
  }

  /**
   * Shared combat command pipeline: session/protocol validation, idempotent
   * replay, sequence and rate limits, then the authoritative domain call. A
   * duplicate command id resends the original events instead of re-rolling.
   */
  private runCombatCommand(
    client: Client,
    command: { commandId: string; clientSequence: number; protocolVersion: number },
    execute: (playerId: string) => CombatCommandResult,
  ): void {
    const session = this.registry.get(client.sessionId);
    if (session === undefined) {
      this.sendRejection(client, {}, 'INVALID_SESSION');
      return;
    }
    const gate = this.guard.check(session, command, session.recentCombat.has(command.commandId));
    if (gate.kind === 'reject') {
      this.sendRejection(
        client,
        { commandId: command.commandId, clientSequence: command.clientSequence },
        gate.code,
      );
      return;
    }
    if (gate.kind === 'duplicate') {
      for (const event of session.recentCombat.get(command.commandId) ?? []) {
        client.send(SERVER_MESSAGES.combatEvent, event);
      }
      return;
    }

    const result = execute(session.playerId);
    if (!result.accepted) {
      const rejection = result.rejection;
      this.sendRejection(
        client,
        { commandId: command.commandId, clientSequence: command.clientSequence },
        rejection?.code ?? 'INVALID_TARGET',
        {
          ...(rejection?.message === undefined ? {} : { message: rejection.message }),
          ...(rejection?.retryAfterMs === undefined
            ? {}
            : { retryAfterMs: rejection.retryAfterMs }),
        },
      );
      return;
    }

    session.lastSequence = command.clientSequence;
    const wireEvents = this.toWireEvents(result.events);
    this.guard.remember(session.recentCombat, command.commandId, wireEvents);
    for (const event of wireEvents) {
      this.broadcastCombatEvent(event);
    }
    this.recordCombatOutcomes(wireEvents);
    this.metrics.recordCombatCommand();
    this.metrics.recordCombatEvents(wireEvents.length);
    this.metrics.recordAcceptedCommand();
  }

  /**
   * Wire events carry the `eventId` that makes death costs idempotent, so the
   * shared post-processing step takes the converted events, not the payloads.
   */
  private recordCombatOutcomes(events: readonly CombatEvent[]): void {
    for (const event of events) {
      if (event.kind === 'enrage') {
        const monster = this.combat.getMonster(event.entityId);
        if (monster?.boss === true) {
          this.broadcastSystemNotice('warning', `${monster.displayName}陷入狂暴，攻势更加凶猛！`);
        }
        continue;
      }
      if (event.kind === 'spawn') {
        if (this.isBossTemplate(event.templateId)) {
          this.broadcastSystemNotice('warning', `${event.displayName}重新苏醒了`);
        }
        continue;
      }
      if (event.kind !== 'death') {
        continue;
      }
      if (event.entityType === 'monster') {
        this.metrics.recordMonsterKill();
        this.scheduleKillReward(event);
        const monster = this.combat.getMonster(event.entityId);
        if (monster?.boss === true) {
          const creditedId = event.ownerId ?? event.killerId;
          const creditedName =
            creditedId === undefined ? undefined : this.state.players.get(creditedId)?.displayName;
          this.broadcastSystemNotice(
            'info',
            creditedName === undefined
              ? `${monster.displayName}被击败了`
              : `${monster.displayName}被 ${creditedName} 击败了`,
          );
        }
        continue;
      }

      this.metrics.recordPlayerDeath();
      const victimName = this.state.players.get(event.entityId)?.displayName ?? '一名玩家';
      const killerId = event.killerId;
      const killerName =
        killerId === undefined
          ? undefined
          : (this.state.players.get(killerId)?.displayName ??
            this.combat.getMonster(killerId)?.displayName);
      const killedByPlayer = killerId !== undefined && this.state.players.has(killerId);
      if (killedByPlayer) {
        this.metrics.recordPvpKill();
      }
      const reviveSeconds = Math.max(1, Math.ceil((event.reviveInMs ?? 3_000) / 1_000));
      this.broadcastSystemNotice(
        'warning',
        killerName === undefined
          ? `${victimName} 倒下了，${String(reviveSeconds)} 秒后复活`
          : `${victimName} 被 ${killerName} 击败，${String(reviveSeconds)} 秒后复活`,
      );

      // PvP deaths stay penalty-free (ADR-021); only a monster kill costs
      // experience, and only when the room's release carries the rule.
      const killedByMonster =
        killerId !== undefined && !killedByPlayer && this.combat.getMonster(killerId) !== undefined;
      if (killedByMonster) {
        this.scheduleDeathPenalty(event);
      }
    }
  }

  private toWireEvents(events: readonly CombatEventPayload[]): CombatEvent[] {
    return events.map((payload) =>
      combatEventSchema.parse({
        ...payload,
        eventId: randomUUID(),
        serverTime: Date.now(),
      }),
    );
  }

  private sendProfile(client: Client, playerId: string): void {
    const profile = this.combat.getProfile(playerId);
    if (profile === undefined) {
      return;
    }
    const deathPenalty = this.content.bundle.rules?.deathPenalty;
    const message: CombatProfile = {
      characterId: playerId,
      ...profile,
      ...(deathPenalty === undefined ? {} : { deathPenalty }),
    };
    client.send(SERVER_MESSAGES.combatProfile, combatProfileSchema.parse(message));
  }

  private handleChat(client: Client, raw: unknown): void {
    const session = this.registry.get(client.sessionId);
    if (session === undefined) {
      this.sendRejection(client, {}, 'INVALID_SESSION');
      return;
    }
    if (session.transferring) {
      this.sendRejection(client, {}, 'INVALID_SESSION');
      return;
    }

    const parsed = chatSendSchema.safeParse(raw);
    if (!parsed.success) {
      this.sendRejection(client, {}, 'INVALID_PAYLOAD');
      return;
    }
    if (parsed.data.protocolVersion !== PROTOCOL_VERSION) {
      this.sendRejection(client, {}, 'PROTOCOL_MISMATCH');
      return;
    }

    if (session.recentChatIds.has(parsed.data.clientMessageId)) {
      return;
    }
    if (!session.chatBucket.take(Date.now())) {
      this.sendRejection(client, {}, 'RATE_LIMITED');
      return;
    }

    const nowMs = Date.now();
    if (session.mutedUntil !== null && session.mutedUntil > nowMs) {
      this.metrics.recordChatMuted();
      const seconds = Math.ceil((session.mutedUntil - nowMs) / 1_000);
      this.sendSystemNotice(client, 'warning', `你已被管理员禁言，剩余 ${String(seconds)} 秒`);
      return;
    }
    if (session.mutedUntil !== null) {
      session.mutedUntil = null;
    }

    session.recentChatIds.add(parsed.data.clientMessageId);
    if (session.recentChatIds.size > RECENT_CHAT_WINDOW) {
      const oldest = session.recentChatIds.values().next();
      if (!oldest.done) {
        session.recentChatIds.delete(oldest.value);
      }
    }

    const statePlayer = this.state.players.get(session.playerId);
    const displayName = statePlayer?.displayName ?? '';
    if (displayName.length === 0) {
      this.sendRejection(client, {}, 'INVALID_SESSION');
      return;
    }

    const filter = this.options.chatFilter ?? defaultChatFilter;
    const filtered = filter(parsed.data.message);
    if (!filtered.accepted) {
      this.metrics.recordChatFiltered();
      this.sendSystemNotice(client, 'warning', filtered.reason);
      return;
    }

    const channel = parsed.data.channel;
    let partyMemberIds: readonly string[] | null = null;
    if (channel === 'party') {
      const party = this.parties.partyOf(session.playerId);
      if (party === undefined) {
        this.sendRejection(client, {}, 'PARTY_NOT_IN_PARTY');
        return;
      }
      partyMemberIds = party.memberIds;
    }

    const message: ChatMessage = {
      messageId: randomUUID(),
      playerId: session.playerId,
      displayName,
      message: filtered.text.slice(0, CHAT_MESSAGE_MAX_LENGTH),
      channel,
      serverTime: Date.now(),
    };
    if (partyMemberIds === null) {
      this.broadcast(SERVER_MESSAGES.chatMessage, chatMessageSchema.parse(message));
    } else {
      // Party chat follows membership across maps, not the room broadcast.
      this.parties.deliverChat(partyMemberIds, chatMessageSchema.parse(message));
    }
    this.metrics.recordChatMessage();
  }

  private isBossTemplate(templateId: string): boolean {
    return this.content.bundle.monsters[templateId]?.boss === true;
  }

  private broadcastSystemNotice(kind: SystemNotice['kind'], message: string): void {
    const notice: SystemNotice = {
      kind,
      message: message.slice(0, 200),
      serverTime: Date.now(),
    };
    this.broadcast(SERVER_MESSAGES.systemNotice, systemNoticeSchema.parse(notice));
  }

  private sendSystemNotice(client: Client, kind: SystemNotice['kind'], message: string): void {
    const notice: SystemNotice = {
      kind,
      message: message.slice(0, 200),
      serverTime: Date.now(),
    };
    client.send(SERVER_MESSAGES.systemNotice, systemNoticeSchema.parse(notice));
  }

  private adminSnapshot(): AdminRoom {
    const tick = this.metrics.snapshot().tick;
    return {
      roomId: this.roomId,
      mapId: this.map.mapId,
      instanceId: this.map.instanceId,
      players: this.state.players.size,
      tickP50Ms: tick.p50Ms,
      tickP95Ms: tick.p95Ms,
      tickP99Ms: tick.p99Ms,
      contentVersion: this.content.version,
      contentChecksum: this.content.checksum,
    };
  }

  /**
   * Applies a command delivered by the Control API outbox. Operations only
   * touch this process's live sessions; persisted ban/mute state was already
   * committed by the Control API (ADR-022).
   */
  private applyAdminCommand(command: AdminCommandEnvelope): number {
    switch (command.type) {
      case 'kick': {
        const session = this.findSessionByPlayerId(command.characterId);
        if (session === undefined) {
          return 0;
        }
        this.kickSession(session, 'kicked', command.reason);
        return 1;
      }
      case 'ban': {
        const matching = [...this.registry.all()].filter(
          (session) => session.accountId === command.accountId,
        );
        for (const session of matching) {
          this.kickSession(session, 'banned', command.reason);
        }
        return matching.length;
      }
      case 'mute': {
        const matching = [...this.registry.all()].filter(
          (session) => session.accountId === command.accountId,
        );
        const until = new Date(command.mutedUntil).getTime();
        for (const session of matching) {
          session.mutedUntil = until;
          this.sendSystemNotice(session.client, 'warning', '你已被管理员禁言');
        }
        return matching.length;
      }
    }
  }

  private findSessionByPlayerId(playerId: string): SessionRecord | undefined {
    return this.registry.findByPlayerId(playerId);
  }

  private kickSession(session: SessionRecord, kind: 'kicked' | 'banned', reason: string): void {
    // Set before closing: onLeave must remove the session outright instead of
    // offering the ordinary 15-second reconnection window.
    session.terminated = kind;
    session.autoAttack = null;
    this.simulation.clearPath(session.playerId);
    this.combat.setPlayerTargetable(session.playerId, false);
    try {
      session.client.send(
        SERVER_MESSAGES.sessionKicked,
        sessionKickedSchema.parse({ reason, kind, serverTime: Date.now() }),
      );
    } catch (error) {
      this.options.logger.warn(
        { err: error, roomId: this.roomId, characterId: session.playerId },
        'failed to deliver session kicked notice',
      );
    }
    this.options.logger.info(
      { roomId: this.roomId, characterId: session.playerId, accountId: session.accountId, kind },
      'admin disconnected session',
    );
    void session.client.leave(4000, reason);
  }

  private async purgeExpiredDrops(): Promise<void> {
    try {
      const result = await this.assets.purgeExpiredDrops({ mapId: this.map.mapId });
      if (result.removedUnclaimed > 0 || result.archivedClaimed > 0) {
        this.options.logger.info(
          {
            roomId: this.roomId,
            mapId: this.map.mapId,
            removedUnclaimed: result.removedUnclaimed,
            archivedClaimed: result.archivedClaimed,
          },
          'purged expired world drops',
        );
      }
    } catch (error) {
      this.options.logger.error(
        { err: error, roomId: this.roomId, mapId: this.map.mapId },
        'failed to purge expired world drops',
      );
    }
  }

  private async restoreLoot(): Promise<void> {
    try {
      const unknownTemplates = new Set<string>();
      const drops = await this.assets.loadOpenDrops(this.map.mapId, (templateId) => {
        unknownTemplates.add(templateId);
      });
      if (unknownTemplates.size > 0) {
        this.options.logger.warn(
          {
            roomId: this.roomId,
            mapId: this.map.mapId,
            templates: [...unknownTemplates],
          },
          'skipped open drops whose item template is missing from this content version',
        );
      }
      for (const drop of drops) {
        this.addLootState(drop);
      }
      if (drops.length > 0) {
        this.options.logger.info(
          { roomId: this.roomId, mapId: this.map.mapId, drops: drops.length },
          'restored open world drops',
        );
      }
    } catch (error) {
      this.options.logger.error(
        { err: error, roomId: this.roomId, mapId: this.map.mapId },
        'failed to restore world drops',
      );
    }
  }

  private addLootState(drop: LootDropView): void {
    if (this.state.loot.has(drop.dropId)) {
      return;
    }
    const loot = new LootState();
    loot.dropId = drop.dropId;
    loot.itemId = drop.itemId;
    loot.templateId = drop.templateId;
    loot.displayName = drop.displayName;
    loot.quantity = drop.quantity;
    loot.x = drop.x;
    loot.y = drop.y;
    loot.ownerId = drop.ownerId;
    loot.ownerExpiresAt = drop.ownerExpiresAt ?? 0;
    loot.pickupLockedUntil = drop.pickupLockedUntil ?? 0;
    loot.expiresAt = drop.expiresAt;
    this.state.loot.set(drop.dropId, loot);

    const affected = this.interest.add(drop.dropId, tileOfUnits({ x: drop.x, y: drop.y }));
    if (affected.length > 0) {
      this.views.refresh(affected);
    }
  }

  private removeLootState(dropId: string): void {
    if (!this.state.loot.has(dropId)) {
      return;
    }
    this.autoPickupBackoffUntil.delete(dropId);
    this.autoPickupNotified.delete(dropId);
    const affected = this.interest.remove(dropId);
    this.state.loot.delete(dropId);
    if (affected.length > 0) {
      this.views.refresh(affected);
    }
  }

  private expireLoot(): void {
    const now = Date.now();
    const expired: string[] = [];
    this.state.loot.forEach((loot, dropId) => {
      if (loot.expiresAt <= now) {
        expired.push(dropId);
      }
    });
    for (const dropId of expired) {
      this.removeLootState(dropId);
    }
  }

  /**
   * Owned drops inside the owner's auto-pickup radius fly into the bag on
   * their own (ADR-041). The pickup still goes through the asset transaction,
   * so bag capacity, ownership and the owner window are re-checked there.
   */
  private autoPickupTick(): void {
    if (!this.autoPickupEnabled) {
      return;
    }
    const now = Date.now();
    for (const [dropId, loot] of this.state.loot) {
      if (loot.ownerId === '' || loot.pickupLockedUntil !== 0) {
        continue;
      }
      if (loot.ownerExpiresAt <= now || loot.expiresAt <= now) {
        continue;
      }
      if (this.autoPickupInFlight.has(dropId)) {
        continue;
      }
      if ((this.autoPickupBackoffUntil.get(dropId) ?? 0) > now) {
        continue;
      }
      const session = this.registry.findByPlayerId(loot.ownerId);
      const player = this.combat.getPlayer(loot.ownerId);
      if (session === undefined || player === undefined) {
        continue;
      }
      if (!player.alive || session.transferring) {
        continue;
      }
      if (this.state.players.get(loot.ownerId)?.connected !== true) {
        continue;
      }
      const distance = Math.hypot(player.x - loot.x, player.y - loot.y) / TILE_UNITS;
      if (distance > this.autoPickupRangeTiles) {
        continue;
      }
      this.startAutoPickup(session, dropId);
    }
  }

  private startAutoPickup(session: SessionRecord, dropId: string): void {
    const ownerId = session.playerId;
    this.autoPickupInFlight.add(dropId);
    void this.enqueueAsset(() =>
      this.assets.pickup({
        characterId: ownerId,
        commandId: randomUUID(),
        dropId,
        mapId: this.map.mapId,
        partyMemberIds: [],
      }),
    )
      .then((outcome) => {
        if (outcome.claimed === null) {
          return;
        }
        this.removeLootState(dropId);
        this.autoPickupBackoffUntil.delete(dropId);
        this.autoPickupNotified.delete(dropId);
        this.broadcast(SERVER_MESSAGES.lootClaimed, lootClaimedSchema.parse(outcome.claimed));
        this.metrics.recordLootPickedUp();
        const current = this.registry.findByPlayerId(ownerId);
        if (current !== undefined) {
          current.assetSnapshot = outcome.snapshot;
          this.sendAssetSnapshot(current.client, current);
          // Quest progress for collect objectives is derived from the bag; an
          // auto-pick bypasses asset commands, so refresh the views here too.
          if (this.hasActiveCollectQuest(current)) {
            this.sendQuestSnapshot(current.client, current);
          }
        }
      })
      .catch((error: unknown) => {
        const now = Date.now();
        if (error instanceof AssetError) {
          if (
            error.code === 'ALREADY_CLAIMED' ||
            error.code === 'DROP_EXPIRED' ||
            error.code === 'ITEM_NOT_FOUND'
          ) {
            this.removeLootState(dropId);
            return;
          }
          if (error.code === 'INVENTORY_FULL') {
            this.autoPickupBackoffUntil.set(dropId, now + AUTO_PICKUP_FULL_BACKOFF_MS);
            if (!this.autoPickupNotified.has(dropId)) {
              this.autoPickupNotified.add(dropId);
              this.sendSystemNotice(session.client, 'warning', '背包已满，战利品留在原地');
            }
            return;
          }
        }
        this.autoPickupBackoffUntil.set(dropId, now + AUTO_PICKUP_RETRY_BACKOFF_MS);
        this.options.logger.warn(
          { err: error, roomId: this.roomId, dropId, characterId: ownerId },
          'auto pickup failed',
        );
      })
      .finally(() => {
        this.autoPickupInFlight.delete(dropId);
      });
  }

  /**
   * Arrival quests complete from the authoritative simulation, never from a
   * client message (ADR-042). The 4 Hz scan is cheap for a small radius and the
   * commit runs on the asset queue, so the 20 Hz loop never waits on SQL.
   */
  private reachQuestTick(): void {
    const now = Date.now();
    for (const session of this.registry.all()) {
      if (session.transferring) {
        continue;
      }
      const player = this.simulation.getPlayer(session.playerId);
      if (player === undefined || this.combat.getPlayer(session.playerId)?.alive !== true) {
        continue;
      }
      const tile = tileOfUnits(player);
      for (const record of session.questRecords.values()) {
        if (record.status !== 'active') {
          continue;
        }
        const quest = this.content.bundle.quests?.[record.questId];
        if (quest === undefined || quest.objective.kind !== 'reach') {
          continue;
        }
        // A daily row from an earlier period is history; only the current
        // period's row can complete (ADR-038).
        if (quest.repeat === 'daily' && record.periodKey !== this.questPeriodKey) {
          continue;
        }
        if (!reachObjectiveMet(quest.objective, this.map.mapId, tile)) {
          continue;
        }
        const key = `${session.playerId}:${record.questId}`;
        if (this.reachInFlight.has(key)) {
          continue;
        }
        if ((this.reachBackoffUntil.get(key) ?? 0) > now) {
          continue;
        }
        this.completeReachQuest(session, record.questId, key);
      }
    }
  }

  private completeReachQuest(session: SessionRecord, questId: string, key: string): void {
    const characterId = session.playerId;
    this.reachInFlight.add(key);
    void this.enqueueAsset(() => this.assets.completeReachQuest({ characterId, questId }))
      .then((outcome) => {
        if (!outcome.completedNow) {
          return;
        }
        this.reachBackoffUntil.delete(key);
        const current = this.registry.findByPlayerId(characterId);
        if (current === undefined) {
          return;
        }
        current.questRecords.set(outcome.record.questId, outcome.record);
        const view = this.sendQuestUpdate(current, outcome.record);
        if (view !== null) {
          this.sendSystemNotice(
            current.client,
            'info',
            `任务完成：${view.title}，回到${view.giverNpcName}处交付`,
          );
        }
        if (
          current.questNavigation?.questId === questId &&
          current.questNavigation.purpose === 'hunt'
        ) {
          this.stopQuestNavigation(current, { status: 'completed' });
        }
      })
      .catch((error: unknown) => {
        this.reachBackoffUntil.set(key, Date.now() + REACH_RETRY_BACKOFF_MS);
        // A completed/expired row is an expected race with daily resets and
        // claims; only unexpected failures deserve a warning.
        if (
          error instanceof AssetError &&
          (error.code === 'QUEST_NOT_ACTIVE' ||
            error.code === 'QUEST_UNAVAILABLE' ||
            error.code === 'INVALID_SESSION')
        ) {
          return;
        }
        this.options.logger.warn(
          { err: error, roomId: this.roomId, characterId, questId },
          'reach quest completion failed',
        );
      })
      .finally(() => {
        this.reachInFlight.delete(key);
      });
  }

  private enqueueAsset<T>(task: () => Promise<T>): Promise<T> {
    const startedAt = performance.now();
    const run = this.assetQueue.then(task, task);
    run.then(
      () => this.metrics.recordAssetDuration(performance.now() - startedAt),
      () => this.metrics.recordAssetDuration(performance.now() - startedAt),
    );
    this.assetQueue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private scheduleKillReward(event: {
    entityId: string;
    killerId?: string | undefined;
    ownerId?: string | undefined;
  }): void {
    // Rewards follow the monster's claim owner, not the last hitter (ADR-041).
    const ownerId = event.ownerId ?? event.killerId;
    if (ownerId === undefined || !this.state.players.has(ownerId)) {
      return;
    }
    const monster = this.combat.getMonster(event.entityId);
    if (monster === undefined) {
      return;
    }
    const reference = `${this.options.serverId}:${this.roomId}:${monster.id}:${String(
      ++this.killSequence,
    )}`;
    const input: KillRewardInput = {
      characterId: ownerId,
      mapId: this.map.mapId,
      reference,
      monsterTemplateId: monster.templateId,
      x: monster.x,
      y: monster.y,
    };
    void this.enqueueAsset(() => this.grantRewardWithRetry(input)).catch((error: unknown) => {
      this.metrics.recordAssetFailure();
      this.options.logger.error(
        { err: error, roomId: this.roomId, reference, characterId: ownerId },
        'failed to grant kill reward',
      );
    });
    this.schedulePartyAssists(ownerId, reference, monster);
  }

  /**
   * Shares the kill's base experience with living, connected party members
   * inside the configured radius (ADR-035). Assists never receive gold, drops
   * or quest progress, and each share is its own idempotent transaction queued
   * behind the killer's reward.
   */
  private schedulePartyAssists(
    ownerId: string,
    reference: string,
    monster: { templateId: string; x: number; y: number },
  ): void {
    if (this.partyRule.assistSharePermille <= 0) {
      return;
    }
    const party = this.parties.partyOf(ownerId);
    if (party === undefined) {
      return;
    }
    for (const memberId of party.memberIds) {
      if (memberId === ownerId) {
        continue;
      }
      const session = this.registry.findByPlayerId(memberId);
      const member = this.combat.getPlayer(memberId);
      if (session === undefined || member === undefined) {
        continue;
      }
      if (!member.alive || this.state.players.get(memberId)?.connected !== true) {
        continue;
      }
      const distance = Math.hypot(member.x - monster.x, member.y - monster.y) / TILE_UNITS;
      if (distance > this.partyRule.assistRangeTiles) {
        continue;
      }
      const input: PartyKillRewardInput = {
        characterId: memberId,
        reference,
        monsterTemplateId: monster.templateId,
        sharePermille: this.partyRule.assistSharePermille,
      };
      void this.enqueueAsset(() => this.grantPartyRewardWithRetry(input)).catch(
        (error: unknown) => {
          this.metrics.recordAssetFailure();
          this.options.logger.error(
            { err: error, roomId: this.roomId, reference, characterId: memberId },
            'failed to grant party assist reward',
          );
        },
      );
    }
  }

  private async grantPartyRewardWithRetry(input: PartyKillRewardInput): Promise<void> {
    for (let attempt = 1; attempt <= REWARD_RETRY_ATTEMPTS; attempt += 1) {
      try {
        const outcome = await this.assets.grantPartyKillExperience(input);
        if (outcome !== null) {
          this.applyPartyReward(input.characterId, outcome);
        }
        return;
      } catch (error) {
        if (attempt >= REWARD_RETRY_ATTEMPTS) {
          throw error;
        }
        this.options.logger.warn(
          { err: error, roomId: this.roomId, reference: input.reference, attempt },
          'party assist transaction failed; retrying',
        );
        await new Promise<void>((resolve) => setTimeout(resolve, 200 * attempt));
      }
    }
  }

  private applyPartyReward(characterId: string, outcome: PartyKillRewardOutcome): void {
    this.combat.updatePlayerProgress(characterId, {
      level: outcome.snapshot.level,
      stats: outcome.stats,
      refill: outcome.leveledUp,
    });
    const session = this.registry.findByPlayerId(characterId);
    if (session === undefined) {
      // The database is already authoritative; the next join loads it.
      return;
    }
    session.assetSnapshot = outcome.snapshot;
    this.sendProgress(session, outcome.leveledUp);
    this.sendProfile(session.client, characterId);
    if (outcome.leveledUp) {
      this.broadcastSystemNotice(
        'info',
        `${session.displayName} 升到了 Lv.${String(outcome.snapshot.level)}`,
      );
    }
  }

  private async grantRewardWithRetry(input: KillRewardInput): Promise<void> {
    for (let attempt = 1; attempt <= REWARD_RETRY_ATTEMPTS; attempt += 1) {
      try {
        const outcome = await this.assets.grantKillReward(input);
        if (outcome !== null) {
          this.applyKillReward(input.characterId, outcome);
        }
        return;
      } catch (error) {
        if (attempt >= REWARD_RETRY_ATTEMPTS) {
          throw error;
        }
        this.options.logger.warn(
          { err: error, roomId: this.roomId, reference: input.reference, attempt },
          'kill reward transaction failed; retrying',
        );
        await new Promise<void>((resolve) => setTimeout(resolve, 200 * attempt));
      }
    }
  }

  private scheduleDeathPenalty(event: Extract<CombatEvent, { kind: 'death' }>): void {
    const input: DeathPenaltyInput = { characterId: event.entityId, deathId: event.eventId };
    void this.enqueueAsset(() => this.applyDeathPenaltyWithRetry(input)).catch((error: unknown) => {
      this.metrics.recordAssetFailure();
      this.options.logger.error(
        { err: error, roomId: this.roomId, characterId: input.characterId, deathId: input.deathId },
        'failed to apply death penalty',
      );
    });
  }

  private async applyDeathPenaltyWithRetry(input: DeathPenaltyInput): Promise<void> {
    for (let attempt = 1; attempt <= REWARD_RETRY_ATTEMPTS; attempt += 1) {
      try {
        const outcome = await this.assets.applyDeathPenalty(input);
        if (outcome !== null) {
          this.applyDeathPenaltyOutcome(input.characterId, outcome);
        }
        return;
      } catch (error) {
        if (attempt >= REWARD_RETRY_ATTEMPTS) {
          throw error;
        }
        this.options.logger.warn(
          { err: error, roomId: this.roomId, deathId: input.deathId, attempt },
          'death penalty transaction failed; retrying',
        );
        await new Promise<void>((resolve) => setTimeout(resolve, 200 * attempt));
      }
    }
  }

  private applyDeathPenaltyOutcome(characterId: string, outcome: DeathPenaltyOutcome): void {
    if (outcome.xpLost === 0 && !outcome.protectedByLevel) {
      return;
    }
    const sessionId = this.registry.sessionIdForPlayer(characterId);
    const session = sessionId === undefined ? undefined : this.registry.get(sessionId);
    if (session === undefined) {
      // The database is already authoritative; the next join loads it.
      return;
    }
    session.assetSnapshot = outcome.snapshot;
    if (outcome.xpLost > 0) {
      this.sendProgress(session, false);
      this.sendSystemNotice(
        session.client,
        'warning',
        `你损失了 ${String(outcome.xpLost)} 点经验（当前等级进度的一部分）`,
      );
      return;
    }
    this.sendSystemNotice(session.client, 'info', '新手保护：本次死亡没有损失经验');
  }

  private applyKillReward(characterId: string, outcome: KillRewardOutcome): void {
    this.metrics.recordExpGranted(outcome.expGained);
    this.metrics.recordGoldGranted(outcome.goldGained);
    this.metrics.recordLootSpawned(outcome.drops.length);
    for (const drop of outcome.drops) {
      this.addLootState(drop);
    }

    this.combat.updatePlayerProgress(characterId, {
      level: outcome.snapshot.level,
      stats: outcome.stats,
      refill: outcome.leveledUp,
    });

    const sessionId = this.registry.sessionIdForPlayer(characterId);
    const session = sessionId === undefined ? undefined : this.registry.get(sessionId);
    if (session === undefined) {
      return;
    }
    session.assetSnapshot = outcome.snapshot;
    this.applyQuestUpdates(session, outcome.questUpdates);
    // A level gained from the kill can satisfy a quest's level requirement;
    // re-send the resolved chain so locked entries unlock without a rejoin.
    if (outcome.leveledUp) {
      this.sendQuestSnapshot(session.client, session);
    }
    this.sendProgress(session, outcome.leveledUp);
    this.sendProfile(session.client, session.playerId);
    if (outcome.leveledUp) {
      this.broadcastSystemNotice(
        'info',
        `${session.displayName} 升到了 Lv.${String(outcome.snapshot.level)}`,
      );
    }
  }

  private mergedSnapshot(session: SessionRecord): InventorySnapshot {
    const player = this.combat.getPlayer(session.playerId);
    if (player === undefined) {
      return session.assetSnapshot;
    }
    return {
      ...session.assetSnapshot,
      level: player.level,
      hp: player.hp,
      maxHp: player.maxHp,
      mp: player.mp,
      maxMp: player.maxMp,
      attack: player.attack,
      defense: player.defense,
    };
  }

  private sendAssetSnapshot(client: Client, session: SessionRecord): void {
    client.send(
      SERVER_MESSAGES.inventorySnapshot,
      inventorySnapshotSchema.parse(this.mergedSnapshot(session)),
    );
  }

  private sendProgress(session: SessionRecord, leveledUp: boolean): void {
    const snapshot = this.mergedSnapshot(session);
    const progress: CharacterProgress = {
      level: snapshot.level,
      exp: snapshot.exp,
      expToNextLevel: snapshot.expToNextLevel,
      gold: snapshot.gold,
      hp: snapshot.hp,
      maxHp: snapshot.maxHp,
      mp: snapshot.mp,
      maxMp: snapshot.maxMp,
      attack: snapshot.attack,
      defense: snapshot.defense,
      serverTime: Date.now(),
    };
    session.client.send(SERVER_MESSAGES.characterProgress, characterProgressSchema.parse(progress));

    if (leveledUp && snapshot.level >= 2) {
      const levelUp: LevelUp = {
        level: snapshot.level,
        maxHp: snapshot.maxHp,
        maxMp: snapshot.maxMp,
        attack: snapshot.attack,
        defense: snapshot.defense,
        serverTime: Date.now(),
      };
      session.client.send(SERVER_MESSAGES.characterLevelUp, levelUpSchema.parse(levelUp));
    }
  }

  private sendAssetResult(
    client: Client,
    session: SessionRecord,
    commandId: string,
    kind: AssetCommandKind,
    deduplicated: boolean,
  ): void {
    const message: AssetResult = {
      commandId,
      kind,
      deduplicated,
      snapshot: this.mergedSnapshot(session),
      serverTime: Date.now(),
    };
    client.send(SERVER_MESSAGES.assetResult, assetResultSchema.parse(message));
  }

  private handleLootPickup(client: Client, raw: unknown): void {
    const parsed = lootPickupSchema.safeParse(raw);
    if (!parsed.success) {
      this.sendRejection(client, extractCommandMeta(raw), 'INVALID_PAYLOAD');
      return;
    }
    const command = parsed.data;
    const loot = this.state.loot.get(command.dropId);
    if (loot !== undefined && loot.pickupLockedUntil > Date.now()) {
      this.sendRejection(
        client,
        { commandId: command.commandId, clientSequence: command.clientSequence },
        'DROP_LOCKED',
        { retryAfterMs: loot.pickupLockedUntil - Date.now() },
      );
      return;
    }
    void this.runAssetCommand(
      client,
      command,
      'loot_pickup',
      (session) => {
        const drop = this.state.loot.get(command.dropId);
        if (drop === undefined) {
          return 'ITEM_NOT_FOUND';
        }
        const player = this.combat.getPlayer(session.playerId);
        if (player === undefined) {
          return 'INVALID_SESSION';
        }
        if (!player.alive) {
          return 'PLAYER_DEAD';
        }
        const distance = Math.hypot(player.x - drop.x, player.y - drop.y) / TILE_UNITS;
        return distance > PICKUP_RANGE_TILES ? 'OUT_OF_RANGE' : null;
      },
      (session) =>
        this.assets.pickup({
          characterId: session.playerId,
          commandId: command.commandId,
          dropId: command.dropId,
          mapId: this.map.mapId,
          // Parties share the owner's loot window; membership is transient and
          // owned by this room, so the room supplies it (ADR-035).
          partyMemberIds: this.parties.partyOf(session.playerId)?.memberIds ?? [],
        }),
      (_session, outcome) => {
        if (outcome.claimed !== null) {
          this.removeLootState(command.dropId);
          this.broadcast(SERVER_MESSAGES.lootClaimed, lootClaimedSchema.parse(outcome.claimed));
          this.metrics.recordLootPickedUp();
        }
      },
    );
  }

  private handleInventoryEquip(client: Client, raw: unknown): void {
    const parsed = inventoryEquipSchema.safeParse(raw);
    if (!parsed.success) {
      this.sendRejection(client, extractCommandMeta(raw), 'INVALID_PAYLOAD');
      return;
    }
    const command = parsed.data;
    void this.runAssetCommand(
      client,
      command,
      'inventory_equip',
      (session) => this.requireAlive(session),
      (session) =>
        this.assets.equip({
          characterId: session.playerId,
          commandId: command.commandId,
          itemId: command.itemId,
        }),
      (session, outcome) => {
        this.combat.updatePlayerProgress(session.playerId, {
          level: outcome.snapshot.level,
          stats: outcome.stats,
        });
        this.sendProfile(session.client, session.playerId);
      },
    );
  }

  private handleInventoryUnequip(client: Client, raw: unknown): void {
    const parsed = inventoryUnequipSchema.safeParse(raw);
    if (!parsed.success) {
      this.sendRejection(client, extractCommandMeta(raw), 'INVALID_PAYLOAD');
      return;
    }
    const command = parsed.data;
    void this.runAssetCommand(
      client,
      command,
      'inventory_unequip',
      (session) => this.requireAlive(session),
      (session) =>
        this.assets.unequip({
          characterId: session.playerId,
          commandId: command.commandId,
          slot: command.slot,
        }),
      (session, outcome) => {
        this.combat.updatePlayerProgress(session.playerId, {
          level: outcome.snapshot.level,
          stats: outcome.stats,
        });
        this.sendProfile(session.client, session.playerId);
      },
    );
  }

  private handleInventoryUse(client: Client, raw: unknown): void {
    const parsed = inventoryUseSchema.safeParse(raw);
    if (!parsed.success) {
      this.sendRejection(client, extractCommandMeta(raw), 'INVALID_PAYLOAD');
      return;
    }
    const command = parsed.data;
    void this.runAssetCommand(
      client,
      command,
      'inventory_use',
      (session) => this.requireAlive(session),
      (session) => {
        const player = this.combat.getPlayer(session.playerId);
        return this.assets.use({
          characterId: session.playerId,
          commandId: command.commandId,
          itemId: command.itemId,
          vitals: { hp: player?.hp ?? 0, mp: player?.mp ?? 0 },
        });
      },
      (session, outcome) => {
        if (outcome.vitals !== undefined) {
          this.combat.setPlayerVitals(session.playerId, outcome.vitals);
        }
      },
    );
  }

  private handleShopBuy(client: Client, raw: unknown): void {
    const parsed = shopBuySchema.safeParse(raw);
    if (!parsed.success) {
      this.sendRejection(client, extractCommandMeta(raw), 'INVALID_PAYLOAD');
      return;
    }
    const command = parsed.data;
    void this.runAssetCommand(
      client,
      command,
      'shop_buy',
      (session) => {
        const alive = this.requireAlive(session);
        return alive ?? this.validateMerchant(session, command.merchantId);
      },
      (session) =>
        this.assets.buy({
          characterId: session.playerId,
          commandId: command.commandId,
          merchantId: command.merchantId,
          templateId: command.templateId,
          quantity: command.quantity,
        }),
      () => undefined,
    );
  }

  private handleShopSell(client: Client, raw: unknown): void {
    const parsed = shopSellSchema.safeParse(raw);
    if (!parsed.success) {
      this.sendRejection(client, extractCommandMeta(raw), 'INVALID_PAYLOAD');
      return;
    }
    const command = parsed.data;
    void this.runAssetCommand(
      client,
      command,
      'shop_sell',
      (session) => {
        const alive = this.requireAlive(session);
        return alive ?? this.validateMerchant(session, command.merchantId);
      },
      (session) =>
        this.assets.sell({
          characterId: session.playerId,
          commandId: command.commandId,
          merchantId: command.merchantId,
          itemId: command.itemId,
          quantity: command.quantity,
        }),
      () => undefined,
    );
  }

  private validateMerchant(
    session: SessionRecord,
    merchantId: string,
  ): CommandRejectionCode | null {
    const player = this.combat.getPlayer(session.playerId);
    if (player === undefined) {
      return 'INVALID_SESSION';
    }
    const merchant = this.map.runtime.manifest.npcPoints.find(
      (npc) => npc.id === merchantId && npc.role === 'merchant',
    );
    if (merchant === undefined) {
      return 'SHOP_UNAVAILABLE';
    }
    const tile = tileOfUnits(player);
    const distance = Math.hypot(tile.x - merchant.tile.x, tile.y - merchant.tile.y);
    return distance > SHOP_RANGE_TILES ? 'SHOP_UNAVAILABLE' : null;
  }

  private sendShopCatalog(client: Client, session: SessionRecord): void {
    const player = this.state.players.get(session.playerId);
    const merchants: ShopMerchant[] = [];
    for (const npc of this.map.runtime.manifest.npcPoints) {
      if (npc.role !== 'merchant') {
        continue;
      }
      const parsed = shopMerchantSchema.safeParse({
        id: npc.id,
        name: npc.name,
        tile: npc.tile,
      });
      if (!parsed.success) {
        this.options.logger.warn(
          { roomId: this.roomId, npcId: npc.id },
          'skipping merchant with an id the shop protocol cannot carry',
        );
        continue;
      }
      merchants.push(parsed.data);
    }
    const items = Object.values(this.content.bundle.items);
    const offers: ShopOffer[] = items
      .filter(
        (item) =>
          itemBuyPrice(item) > 0 &&
          (item.classId === undefined || item.classId === player?.classId),
      )
      .map((item) => ({
        templateId: item.id,
        name: item.name,
        kind: item.kind,
        ...(item.quality === undefined ? {} : { quality: item.quality }),
        buyPrice: itemBuyPrice(item),
        levelRequirement: item.levelRequirement,
        stackable: item.stackable,
        maxStack: item.maxStack,
        attackBonus: item.attackBonus,
        defenseBonus: item.defenseBonus,
        maxHpBonus: item.maxHpBonus,
        maxMpBonus: item.maxMpBonus,
        healHp: item.healHp,
        healMp: item.healMp,
      }));
    const sellPrices: ShopSellPrice[] = items
      .filter((item) => itemSellPrice(item) > 0)
      .map((item) => ({ templateId: item.id, sellPrice: itemSellPrice(item) }));
    const catalog: ShopCatalog = { merchants, offers, sellPrices };
    // A hand-edited map or a very large release must degrade to "no shop",
    // never throw inside the deferred join timer.
    const parsed = shopCatalogSchema.safeParse(catalog);
    if (!parsed.success) {
      this.options.logger.error(
        { roomId: this.roomId, issues: parsed.error.issues.length },
        'shop catalog failed validation; players cannot trade in this room',
      );
      return;
    }
    client.send(SERVER_MESSAGES.shopCatalog, parsed.data);
  }

  private handleQuestAccept(client: Client, raw: unknown): void {
    const parsed = questAcceptSchema.safeParse(raw);
    if (!parsed.success) {
      this.sendRejection(client, extractCommandMeta(raw), 'INVALID_PAYLOAD');
      return;
    }
    const command = parsed.data;
    void this.runAssetCommand(
      client,
      command,
      'quest_accept',
      (session) => {
        const alive = this.requireAlive(session);
        return alive ?? this.validateQuestNpc(session, command.questId);
      },
      (session) =>
        this.assets.acceptQuest({
          characterId: session.playerId,
          commandId: command.commandId,
          questId: command.questId,
        }),
      (session, outcome) => {
        session.questRecords.set(outcome.record.questId, outcome.record);
        const view = this.sendQuestUpdate(session, outcome.record);
        if (!outcome.deduplicated && view !== null) {
          this.sendSystemNotice(session.client, 'info', `已接取任务：${view.title}`);
        }
      },
    );
  }

  private handleQuestClaim(client: Client, raw: unknown): void {
    const parsed = questClaimSchema.safeParse(raw);
    if (!parsed.success) {
      this.sendRejection(client, extractCommandMeta(raw), 'INVALID_PAYLOAD');
      return;
    }
    const command = parsed.data;
    void this.runAssetCommand(
      client,
      command,
      'quest_claim',
      (session) => {
        const alive = this.requireAlive(session);
        return alive ?? this.validateQuestNpc(session, command.questId);
      },
      (session) =>
        this.assets.claimQuest({
          characterId: session.playerId,
          commandId: command.commandId,
          questId: command.questId,
        }),
      (session, outcome) => {
        session.questRecords.set(outcome.record.questId, outcome.record);
        this.combat.updatePlayerProgress(session.playerId, {
          level: outcome.snapshot.level,
          stats: outcome.stats,
          refill: outcome.leveledUp,
        });
        this.sendProgress(session, outcome.leveledUp);
        this.sendProfile(session.client, session.playerId);
        const view = this.sendQuestUpdate(session, outcome.record);
        // Claiming (and any level gained with it) can unlock the next quest or
        // make it available, so the whole chain is re-resolved, not just the
        // claimed quest. The same snapshot covers a client that missed a
        // duplicate command's result.
        this.sendQuestSnapshot(session.client, session);
        if (outcome.deduplicated || view === null) {
          return;
        }
        const rewardParts = [
          outcome.expGained > 0 ? `经验 +${String(outcome.expGained)}` : '',
          outcome.goldGained > 0 ? `金币 +${String(outcome.goldGained)}` : '',
          ...view.rewards.items.map((item) => `${item.name} ×${String(item.quantity)}`),
        ].filter((part) => part.length > 0);
        this.sendSystemNotice(
          session.client,
          'info',
          `任务完成：${view.title}${rewardParts.length > 0 ? `（${rewardParts.join('，')}）` : ''}`,
        );
        if (outcome.leveledUp) {
          this.broadcastSystemNotice(
            'info',
            `${session.displayName} 升到了 Lv.${String(outcome.snapshot.level)}`,
          );
        }
      },
    );
  }

  /**
   * One-click quest guidance (ADR-039). The browser states the intent; the
   * room decides the route, picks targets and owns every movement step.
   */
  private handleQuestNavigate(client: Client, raw: unknown): void {
    const parsed = questNavigateSchema.safeParse(raw);
    if (!parsed.success) {
      this.sendRejection(client, extractCommandMeta(raw), 'INVALID_PAYLOAD');
      return;
    }
    const command = parsed.data;
    const session = this.registry.get(client.sessionId);
    if (session === undefined) {
      this.sendRejection(client, {}, 'INVALID_SESSION');
      return;
    }
    if (session.transferring) {
      this.sendRejection(
        client,
        { commandId: command.commandId, clientSequence: command.clientSequence },
        'INVALID_SESSION',
      );
      return;
    }
    const gate = this.guard.check(
      session,
      command,
      session.recentQuestCommands.has(command.commandId),
    );
    if (gate.kind === 'reject') {
      this.sendRejection(
        client,
        { commandId: command.commandId, clientSequence: command.clientSequence },
        gate.code,
      );
      return;
    }
    if (gate.kind === 'duplicate') {
      if (session.questNavigation !== null) {
        this.sendQuestNavigation(session, session.questNavigation, true);
      }
      return;
    }

    if (command.purpose === 'stop') {
      session.lastSequence = command.clientSequence;
      this.rememberQuestCommand(session, command.commandId);
      this.stopQuestNavigation(session, { reason: 'manual' });
      this.metrics.recordAcceptedCommand();
      return;
    }

    const alive = this.requireAlive(session);
    if (alive !== null) {
      this.sendRejection(
        client,
        { commandId: command.commandId, clientSequence: command.clientSequence },
        alive,
      );
      return;
    }
    const quest = this.content.bundle.quests?.[command.questId];
    if (quest === undefined) {
      this.sendRejection(
        client,
        { commandId: command.commandId, clientSequence: command.clientSequence },
        'QUEST_UNAVAILABLE',
      );
      return;
    }
    const record = session.questRecords.get(command.questId);
    if (command.purpose === 'hunt') {
      if (record === undefined || record.status !== 'active') {
        this.sendRejection(
          client,
          { commandId: command.commandId, clientSequence: command.clientSequence },
          'QUEST_NOT_ACTIVE',
        );
        return;
      }
    } else if (command.purpose === 'return') {
      if (record?.status === 'claimed') {
        this.sendRejection(
          client,
          { commandId: command.commandId, clientSequence: command.clientSequence },
          'QUEST_ALREADY_CLAIMED',
        );
        return;
      }
      if (!this.questCompletedFor(session, quest, record)) {
        this.sendRejection(
          client,
          { commandId: command.commandId, clientSequence: command.clientSequence },
          'QUEST_NOT_COMPLETE',
        );
        return;
      }
    } else {
      // Accept guidance only makes sense while the quest is still available.
      const view = questViewFor(
        quest,
        record,
        session.assetSnapshot.level,
        this.questContext(this.inventoryCountsFor(session)),
        session.questRecords,
      );
      if (view.status !== 'available') {
        this.sendRejection(
          client,
          { commandId: command.commandId, clientSequence: command.clientSequence },
          record?.status === 'claimed' ? 'QUEST_ALREADY_CLAIMED' : 'QUEST_UNAVAILABLE',
        );
        return;
      }
    }

    this.stopQuestNavigation(session, { silent: true, clearPath: false });
    this.stopAutoAttack(session, 'stopped', false);
    const navigation: QuestNavigationState = {
      questId: command.questId,
      purpose: command.purpose,
      status: 'moving',
      nextSearchAt: 0,
      lastSentKey: null,
    };
    const failure = this.planQuestNavigation(session, quest, command.purpose, navigation);
    if (failure !== null) {
      session.questNavigation = navigation;
      this.stopQuestNavigation(session, { silent: true, clearPath: true });
      this.sendRejection(
        client,
        { commandId: command.commandId, clientSequence: command.clientSequence },
        failure === 'no_route' ? 'UNREACHABLE' : 'QUEST_UNAVAILABLE',
      );
      return;
    }
    session.questNavigation = navigation;
    session.lastSequence = command.clientSequence;
    this.rememberQuestCommand(session, command.commandId);
    this.sendQuestNavigation(session, navigation, true);
    this.metrics.recordAcceptedCommand();
  }

  private rememberQuestCommand(session: SessionRecord, commandId: string): void {
    this.guard.remember(session.recentQuestCommands, commandId, true);
  }

  /**
   * Plans the next leg of a quest route. Returns a failure reason instead of
   * throwing so the command handler can answer with a rejection code.
   */
  private planQuestNavigation(
    session: SessionRecord,
    quest: QuestContent,
    purpose: 'hunt' | 'return' | 'accept',
    navigation: QuestNavigationState,
  ): QuestNavigationReason | null {
    const player = this.combat.getPlayer(session.playerId);
    if (player === undefined) {
      return 'quest_changed';
    }
    const map = this.map.runtime.manifest;
    const reach = quest.objective.kind === 'reach' ? quest.objective : null;
    const huntTargets =
      purpose === 'hunt' && reach === null ? this.huntMonsterIdsFor(quest) : new Set<string>();
    const targetMapIds =
      purpose === 'hunt'
        ? reach === null
          ? mapsWithAnyMonsterSpawn(MAP_MANIFESTS, huntTargets)
          : [reach.mapId]
        : mapsWithNpc(MAP_MANIFESTS, quest.giverNpcId);
    if (targetMapIds.length === 0) {
      return 'no_route';
    }
    if (!targetMapIds.includes(map.mapId)) {
      const hop = nextPortalToward(MAP_MANIFESTS, map.mapId, new Set(targetMapIds));
      if (hop === null) {
        return 'no_route';
      }
      const path = findPath(this.map.runtime.grid, tileOfUnits(player), hop.portalTile);
      if (path === null) {
        return 'no_route';
      }
      this.simulation.setPath(session.playerId, path);
      navigation.status = 'moving';
      navigation.nextMapId = hop.mapId;
      return null;
    }

    navigation.nextMapId = undefined;
    if (purpose === 'hunt' && reach !== null) {
      const currentTile = tileOfUnits(player);
      if (reachObjectiveMet(reach, map.mapId, currentTile)) {
        this.simulation.clearPath(session.playerId);
        navigation.status = 'moving';
        return null;
      }
      const path = findApproachPath(this.map.runtime, reach.tile, currentTile, reach.radiusTiles);
      if (path === null) {
        return 'no_route';
      }
      this.simulation.setPath(session.playerId, path);
      navigation.status = 'moving';
      return null;
    }
    if (purpose === 'hunt') {
      const targetId = this.nearestVisibleQuestMonsterId(session, huntTargets);
      if (targetId !== null) {
        this.startQuestAutoAttack(session, targetId);
        navigation.status = 'moving';
        return null;
      }
      const spawn = nearestSpawnTileAmong(map, huntTargets, tileOfUnits(player));
      if (spawn === null) {
        return 'no_route';
      }
      const path = findPath(this.map.runtime.grid, tileOfUnits(player), spawn);
      if (path === null) {
        return 'no_route';
      }
      if (path.length > 0) {
        this.simulation.setPath(session.playerId, path);
        navigation.status = 'moving';
      } else {
        this.simulation.clearPath(session.playerId);
        navigation.status = 'waiting';
        navigation.nextSearchAt = this.combat.elapsedMs + QUEST_NAV_WAIT_MS;
      }
      return null;
    }

    const giver = map.npcPoints.find((npc) => npc.id === quest.giverNpcId);
    if (giver === undefined) {
      return 'no_route';
    }
    if (this.tileDistanceTo(player, giver.tile) <= QUEST_NPC_RANGE_TILES) {
      this.simulation.clearPath(session.playerId);
      navigation.status = 'arrived';
      return null;
    }
    const path = findApproachPath(
      this.map.runtime,
      giver.tile,
      tileOfUnits(player),
      QUEST_NPC_RANGE_TILES,
    );
    if (path === null) {
      return 'no_route';
    }
    this.simulation.setPath(session.playerId, path);
    navigation.status = 'moving';
    return null;
  }

  private updateQuestNavigation(): void {
    for (const session of this.registry.all()) {
      const navigation = session.questNavigation;
      if (navigation === null) {
        continue;
      }
      if (session.transferring) {
        this.stopQuestNavigation(session, { silent: true, clearPath: false });
        continue;
      }
      const player = this.combat.getPlayer(session.playerId);
      if (player === undefined) {
        this.stopQuestNavigation(session, { reason: 'target_gone' });
        continue;
      }
      if (!player.alive) {
        this.stopQuestNavigation(session, { reason: 'player_dead' });
        continue;
      }
      const quest = this.content.bundle.quests?.[navigation.questId];
      if (quest === undefined) {
        this.stopQuestNavigation(session, { reason: 'quest_changed' });
        continue;
      }
      const record = session.questRecords.get(navigation.questId);
      if (navigation.purpose === 'hunt') {
        if (record === undefined || record.status !== 'active') {
          this.stopQuestNavigation(
            session,
            record?.status === 'completed' ? { status: 'completed' } : { reason: 'quest_changed' },
          );
          continue;
        }
        // Arrival objectives walk to a place, not a monster: stop at the
        // radius and let the room's position scan commit the completion.
        if (quest.objective.kind === 'reach') {
          const playerTile = tileOfUnits(player);
          if (reachObjectiveMet(quest.objective, this.map.mapId, playerTile)) {
            this.simulation.clearPath(session.playerId);
            navigation.status = 'moving';
            continue;
          }
          if (!this.questPathExhausted(session)) {
            continue;
          }
          const failure = this.planQuestNavigation(session, quest, 'hunt', navigation);
          if (failure !== null) {
            this.stopQuestNavigation(session, { reason: failure });
            continue;
          }
          this.sendQuestNavigation(session, navigation);
          continue;
        }
        // The auto-attack loop owns movement while a target is locked.
        if (session.autoAttack !== null) {
          continue;
        }
        if (this.combat.elapsedMs < navigation.nextSearchAt) {
          continue;
        }
        // A collect quest is done the moment the bag holds enough items; stop
        // hunting so the player can walk back and hand them in (ADR-040).
        if (quest.objective.kind === 'collect' && this.collectSatisfied(session, quest)) {
          this.stopQuestNavigation(session, { status: 'completed' });
          continue;
        }
        const targetId = this.nearestVisibleQuestMonsterId(session, this.huntMonsterIdsFor(quest));
        if (targetId !== null) {
          this.startQuestAutoAttack(session, targetId);
          navigation.status = 'moving';
          this.sendQuestNavigation(session, navigation);
          continue;
        }
        if (!this.questPathExhausted(session)) {
          continue;
        }
        const failure = this.planQuestNavigation(session, quest, 'hunt', navigation);
        if (failure !== null) {
          this.stopQuestNavigation(session, { reason: failure });
          continue;
        }
        this.sendQuestNavigation(session, navigation);
        continue;
      }

      if (navigation.purpose === 'accept') {
        if (record !== undefined) {
          // The client accepted at the giver; its hunt intent takes over.
          this.stopQuestNavigation(session, { silent: true, clearPath: true });
          continue;
        }
      } else {
        if (record?.status === 'claimed') {
          this.stopQuestNavigation(session, { silent: true, clearPath: true });
          continue;
        }
        if (!this.questCompletedFor(session, quest, record)) {
          this.stopQuestNavigation(session, { reason: 'quest_changed' });
          continue;
        }
      }
      const giver = this.map.runtime.manifest.npcPoints.find((npc) => npc.id === quest.giverNpcId);
      if (giver !== undefined && this.tileDistanceTo(player, giver.tile) <= QUEST_NPC_RANGE_TILES) {
        if (navigation.status !== 'arrived') {
          this.simulation.clearPath(session.playerId);
          navigation.status = 'arrived';
          navigation.nextMapId = undefined;
          this.sendQuestNavigation(session, navigation);
        }
        continue;
      }
      if (navigation.status === 'arrived') {
        navigation.status = 'moving';
      }
      if (!this.questPathExhausted(session)) {
        continue;
      }
      const failure = this.planQuestNavigation(session, quest, navigation.purpose, navigation);
      if (failure !== null) {
        this.stopQuestNavigation(session, { reason: failure });
        continue;
      }
      this.sendQuestNavigation(session, navigation);
    }
  }

  /** True once the bag holds enough of a collect objective's item. */
  private collectSatisfied(session: SessionRecord, quest: QuestContent): boolean {
    return (
      quest.objective.kind === 'collect' &&
      (this.inventoryCountsFor(session).get(quest.objective.templateId) ?? 0) >=
        quest.objective.count
    );
  }

  /**
   * A collect record stays `active` until the claim transaction; for guidance
   * and return validation it already counts as completed when the bag is full.
   */
  private questCompletedFor(
    session: SessionRecord,
    quest: QuestContent,
    record: QuestRecordState | undefined,
  ): boolean {
    if (record?.status === 'completed') {
      return true;
    }
    return record?.status === 'active' && this.collectSatisfied(session, quest);
  }

  /**
   * Monsters a hunt should target. Kill quests name one monster; collect quests
   * target every monster whose loot table drops the item (ADR-040).
   */
  private huntMonsterIdsFor(quest: QuestContent): Set<string> {
    if (quest.objective.kind === 'kill') {
      return new Set([quest.objective.monsterId]);
    }
    if (quest.objective.kind !== 'collect') {
      return new Set();
    }
    const templateId = quest.objective.templateId;
    const ids = new Set<string>();
    for (const [monsterId, table] of Object.entries(this.content.bundle.lootTables)) {
      if (table.entries.some((entry) => entry.templateId === templateId)) {
        ids.add(monsterId);
      }
    }
    return ids;
  }

  private nearestVisibleQuestMonsterId(
    session: SessionRecord,
    monsterIds: ReadonlySet<string>,
  ): string | null {
    const player = this.simulation.getPlayer(session.playerId);
    if (player === undefined) {
      return null;
    }
    let bestId: string | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const monster of this.combat.listMonsters()) {
      if (!monsterIds.has(monster.templateId) || monster.state === 'dead') {
        continue;
      }
      if (!session.visible.has(monster.id)) {
        continue;
      }
      const distance = (monster.x - player.x) ** 2 + (monster.y - player.y) ** 2;
      if (distance < bestDistance) {
        bestId = monster.id;
        bestDistance = distance;
      }
    }
    return bestId;
  }

  private startQuestAutoAttack(session: SessionRecord, targetId: string): void {
    this.simulation.clearPath(session.playerId);
    session.autoAttack = {
      targetId,
      phase: 'engaged',
      nextAttackAt: 0,
      nextRepathAt: 0,
      pathTargetTile: null,
    };
    this.notifyTargetChanged(session, 'engaged');
  }

  private questPathExhausted(session: SessionRecord): boolean {
    const player = this.simulation.getPlayer(session.playerId);
    return player === undefined || player.waypoints.length === 0;
  }

  private tileDistanceTo(player: { x: number; y: number }, tile: TilePoint): number {
    const current = tileOfUnits(player);
    return Math.hypot(current.x - tile.x, current.y - tile.y);
  }

  private sendQuestNavigation(
    session: SessionRecord,
    navigation: QuestNavigationState,
    force = false,
  ): void {
    const key = `${navigation.status}:${navigation.nextMapId ?? ''}`;
    if (!force && navigation.lastSentKey === key) {
      return;
    }
    navigation.lastSentKey = key;
    const message: QuestNavigation = {
      questId: navigation.questId,
      purpose: navigation.purpose,
      status: navigation.status,
      ...(navigation.nextMapId === undefined ? {} : { mapId: navigation.nextMapId }),
      serverTime: Date.now(),
    };
    const parsed = questNavigationSchema.safeParse(message);
    if (!parsed.success) {
      this.options.logger.warn(
        { roomId: this.roomId, questId: navigation.questId },
        'quest navigation failed validation',
      );
      return;
    }
    session.client.send(SERVER_MESSAGES.questNavigation, parsed.data);
  }

  private stopQuestNavigation(
    session: SessionRecord,
    options: {
      reason?: QuestNavigationReason;
      status?: 'stopped' | 'completed';
      silent?: boolean;
      clearPath?: boolean;
    } = {},
  ): void {
    const navigation = session.questNavigation;
    if (navigation === null) {
      return;
    }
    session.questNavigation = null;
    this.stopAutoAttack(session, 'stopped', options.clearPath ?? true);
    if (options.silent === true) {
      return;
    }
    const message: QuestNavigation = {
      questId: navigation.questId,
      purpose: navigation.purpose,
      status: options.status ?? 'stopped',
      ...(options.reason === undefined ? {} : { reason: options.reason }),
      serverTime: Date.now(),
    };
    const parsed = questNavigationSchema.safeParse(message);
    if (!parsed.success) {
      return;
    }
    session.client.send(SERVER_MESSAGES.questNavigation, parsed.data);
  }

  private validateQuestNpc(session: SessionRecord, questId: string): CommandRejectionCode | null {
    const quest = this.content.bundle.quests?.[questId];
    if (quest === undefined) {
      return 'QUEST_UNAVAILABLE';
    }
    const player = this.combat.getPlayer(session.playerId);
    if (player === undefined) {
      return 'INVALID_SESSION';
    }
    // The giver must stand on this map; a quest whose NPC lives elsewhere can
    // never be accepted from here (the client cannot choose another map).
    const npc = this.map.runtime.manifest.npcPoints.find((point) => point.id === quest.giverNpcId);
    if (npc === undefined) {
      return 'QUEST_UNAVAILABLE';
    }
    const tile = tileOfUnits(player);
    const distance = Math.hypot(tile.x - npc.tile.x, tile.y - npc.tile.y);
    return distance > QUEST_NPC_RANGE_TILES ? 'OUT_OF_RANGE' : null;
  }

  private questContext(inventory: ReadonlyMap<string, number>): QuestViewContext {
    const rule = this.content.bundle.rules?.dailyReset;
    const now = new Date();
    return {
      quests: this.content.bundle.quests ?? {},
      items: this.content.bundle.items,
      monsters: this.content.bundle.monsters,
      npcNames: this.npcNames,
      mapNames: this.mapNames,
      currentPeriodKey: rule === undefined ? '' : dailyPeriodKey(now, rule),
      ...(rule === undefined ? {} : { nextResetAt: nextDailyResetAt(now, rule) }),
      inventory,
    };
  }

  /** Bag totals by template; collect objectives read their progress from here. */
  private inventoryCountsFor(session: SessionRecord): Map<string, number> {
    const counts = new Map<string, number>();
    for (const item of session.assetSnapshot.items) {
      counts.set(item.templateId, (counts.get(item.templateId) ?? 0) + item.quantity);
    }
    return counts;
  }

  private hasActiveCollectQuest(session: SessionRecord): boolean {
    for (const record of session.questRecords.values()) {
      if (record.status !== 'active') {
        continue;
      }
      const quest = this.content.bundle.quests?.[record.questId];
      if (quest?.objective.kind === 'collect') {
        return true;
      }
    }
    return false;
  }

  /**
   * Re-sends quest snapshots after the realm day rolls over so an online
   * player sees the daily quests become available again without rejoining
   * (ADR-038). The per-quest views ignore records from older periods, so this
   * needs no database read.
   */
  private refreshQuestPeriod(): void {
    const rule = this.content.bundle.rules?.dailyReset;
    if (rule === undefined) {
      return;
    }
    const periodKey = dailyPeriodKey(new Date(), rule);
    const previous = this.questPeriodKey;
    this.questPeriodKey = periodKey;
    if (previous === null || previous === periodKey) {
      return;
    }
    for (const session of this.registry.all()) {
      this.sendQuestSnapshot(session.client, session);
    }
    if (this.hasDailyQuests()) {
      this.broadcastSystemNotice('info', '每日任务已重置，可以重新接取。');
    }
  }

  private hasDailyQuests(): boolean {
    const quests = this.content.bundle.quests;
    return quests !== undefined && Object.values(quests).some((quest) => quest.repeat === 'daily');
  }

  private sendQuestSnapshot(client: Client, session: SessionRecord): void {
    const context = this.questContext(this.inventoryCountsFor(session));
    const views = questViewsFor(
      context.quests,
      [...session.questRecords.values()],
      session.assetSnapshot.level,
      {
        items: context.items,
        monsters: context.monsters,
        npcNames: context.npcNames,
        mapNames: context.mapNames,
        currentPeriodKey: context.currentPeriodKey,
        inventory: context.inventory,
        ...(context.nextResetAt === undefined ? {} : { nextResetAt: context.nextResetAt }),
      },
    );
    const snapshot: QuestSnapshot = { quests: views, serverTime: Date.now() };
    // Content grows over releases; a release with too many quests must degrade
    // to "no quests" instead of throwing inside the deferred join timer.
    const parsed = questSnapshotSchema.safeParse(snapshot);
    if (!parsed.success) {
      this.options.logger.error(
        { roomId: this.roomId, issues: parsed.error.issues.length },
        'quest snapshot failed validation; players cannot see quests in this room',
      );
      return;
    }
    client.send(SERVER_MESSAGES.questSnapshot, parsed.data);
  }

  private sendQuestUpdate(session: SessionRecord, record: QuestRecordState): QuestView | null {
    const context = this.questContext(this.inventoryCountsFor(session));
    const quest = context.quests[record.questId];
    if (quest === undefined) {
      return null;
    }
    const view = questViewFor(
      quest,
      record,
      session.assetSnapshot.level,
      context,
      session.questRecords,
    );
    const update: QuestUpdate = { quest: view, serverTime: Date.now() };
    const parsed = questUpdateSchema.safeParse(update);
    if (!parsed.success) {
      this.options.logger.warn(
        { roomId: this.roomId, questId: record.questId },
        'quest update failed validation',
      );
      return null;
    }
    session.client.send(SERVER_MESSAGES.questUpdate, parsed.data);
    return view;
  }

  private applyQuestUpdates(session: SessionRecord, updates: readonly KillQuestUpdate[]): void {
    for (const update of updates) {
      session.questRecords.set(update.record.questId, update.record);
      const view = this.sendQuestUpdate(session, update.record);
      if (view !== null && update.completedNow) {
        this.sendSystemNotice(
          session.client,
          'info',
          `任务完成：${view.title}，回到${view.giverNpcName}处交付`,
        );
      }
    }
  }

  private handlePartyInvite(client: Client, raw: unknown): void {
    const parsed = partyInviteCommandSchema.safeParse(raw);
    if (!parsed.success) {
      this.sendRejection(client, extractCommandMeta(raw), 'INVALID_PAYLOAD');
      return;
    }
    const command = parsed.data;
    this.runPartyCommand(
      client,
      command,
      (session) => this.validatePartyInvite(session, command.targetPlayerId),
      (session) => {
        const result = this.parties.createInvite(session.playerId, command.targetPlayerId);
        if (result.kind === 'rejected') {
          return result.reason === 'party_full' ? 'PARTY_FULL' : 'PARTY_TARGET_BUSY';
        }
        // Delivery is routed by the service: the invited player may be hosted
        // by another map room than the inviter.
        this.parties.notifyInvite(result.invite);
        const targetName = this.parties.presenceOf(command.targetPlayerId)?.displayName ?? '玩家';
        this.sendSystemNotice(session.client, 'info', `已邀请 ${targetName} 组队`);
        return null;
      },
    );
  }

  private validatePartyInvite(
    session: SessionRecord,
    targetPlayerId: string,
  ): CommandRejectionCode | null {
    if (targetPlayerId === session.playerId) {
      return 'PARTY_SELF';
    }
    const target = this.registry.findByPlayerId(targetPlayerId);
    const self = this.combat.getPlayer(session.playerId);
    const other = this.combat.getPlayer(targetPlayerId);
    if (target === undefined || other === undefined || self === undefined) {
      return 'PARTY_TARGET_UNAVAILABLE';
    }
    if (this.state.players.get(targetPlayerId)?.connected !== true) {
      return 'PARTY_TARGET_UNAVAILABLE';
    }
    if (this.parties.isMember(targetPlayerId)) {
      return 'PARTY_TARGET_BUSY';
    }
    const selfParty = this.parties.partyOf(session.playerId);
    if (selfParty !== undefined && selfParty.memberIds.length >= this.parties.maxMembers) {
      return 'PARTY_FULL';
    }
    const distance = Math.hypot(self.x - other.x, self.y - other.y) / TILE_UNITS;
    return distance > PARTY_INVITE_RANGE_TILES ? 'PARTY_TARGET_UNAVAILABLE' : null;
  }

  private handlePartyInviteReply(client: Client, raw: unknown, mode: 'accept' | 'decline'): void {
    const schema = mode === 'accept' ? partyAcceptCommandSchema : partyDeclineCommandSchema;
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      this.sendRejection(client, extractCommandMeta(raw), 'INVALID_PAYLOAD');
      return;
    }
    const command = parsed.data;
    this.runPartyCommand(
      client,
      command,
      () => null,
      (session) => {
        if (mode === 'decline') {
          const invite = this.parties.pendingInviteFor(session.playerId);
          const declined = this.parties.declineInvite(command.inviteId, session.playerId);
          if (!declined) {
            return 'PARTY_INVITE_EXPIRED';
          }
          if (invite !== undefined) {
            const inviter = this.registry.findByPlayerId(invite.fromPlayerId);
            if (inviter !== undefined) {
              this.sendSystemNotice(
                inviter.client,
                'info',
                `${session.displayName} 拒绝了组队邀请`,
              );
            }
          }
          this.sendPartySnapshot(client, session);
          return null;
        }

        const result = this.parties.acceptInvite(command.inviteId, session.playerId);
        if (result.kind === 'rejected') {
          switch (result.reason) {
            case 'already_in_party':
              return 'PARTY_ALREADY_IN_PARTY';
            case 'party_full':
              return 'PARTY_FULL';
            default:
              return 'PARTY_INVITE_EXPIRED';
          }
        }
        // The service refreshes every member's room, including across maps.
        for (const memberId of result.party.memberIds) {
          if (memberId === session.playerId) {
            continue;
          }
          const member = this.registry.findByPlayerId(memberId);
          if (member !== undefined) {
            this.sendSystemNotice(member.client, 'info', `${session.displayName} 加入了队伍`);
          }
        }
        return null;
      },
    );
  }

  private handlePartyLeave(client: Client, raw: unknown): void {
    const parsed = partyLeaveCommandSchema.safeParse(raw);
    if (!parsed.success) {
      this.sendRejection(client, extractCommandMeta(raw), 'INVALID_PAYLOAD');
      return;
    }
    const command = parsed.data;
    this.runPartyCommand(
      client,
      command,
      (session) => (this.parties.isMember(session.playerId) ? null : 'PARTY_NOT_IN_PARTY'),
      (session) => {
        const result = this.parties.leave(session.playerId);
        // The service drops the leaver's presence, so their own room sends the
        // empty snapshot explicitly; remaining members are refreshed by it.
        this.sendPartySnapshot(client, session);
        if (result.party !== null) {
          for (const memberId of result.party.memberIds) {
            const member = this.registry.findByPlayerId(memberId);
            if (member !== undefined) {
              this.sendSystemNotice(member.client, 'info', `${session.displayName} 离开了队伍`);
            }
          }
        }
        return null;
      },
    );
  }

  private handlePartyTransferLeader(client: Client, raw: unknown): void {
    const parsed = partyTransferLeaderCommandSchema.safeParse(raw);
    if (!parsed.success) {
      this.sendRejection(client, extractCommandMeta(raw), 'INVALID_PAYLOAD');
      return;
    }
    const command = parsed.data;
    this.runPartyCommand(
      client,
      command,
      (session) => this.validatePartyManagement(session, command.targetPlayerId),
      (session) => {
        const result = this.parties.transferLeader(session.playerId, command.targetPlayerId);
        if (result.kind === 'rejected') {
          return this.partyManagementRejectionCode(result.reason);
        }
        const targetName = this.parties.presenceOf(command.targetPlayerId)?.displayName ?? '队友';
        this.sendSystemNotice(session.client, 'info', `已把队长交给 ${targetName}`);
        for (const memberId of result.party.memberIds) {
          if (memberId === session.playerId) {
            continue;
          }
          const member = this.registry.findByPlayerId(memberId);
          if (member !== undefined) {
            this.sendSystemNotice(
              member.client,
              'info',
              `${session.displayName} 把队长交给了 ${targetName}`,
            );
          }
        }
        return null;
      },
    );
  }

  private handlePartyKick(client: Client, raw: unknown): void {
    const parsed = partyKickCommandSchema.safeParse(raw);
    if (!parsed.success) {
      this.sendRejection(client, extractCommandMeta(raw), 'INVALID_PAYLOAD');
      return;
    }
    const command = parsed.data;
    this.runPartyCommand(
      client,
      command,
      (session) => this.validatePartyManagement(session, command.targetPlayerId),
      (session) => {
        const result = this.parties.kick(session.playerId, command.targetPlayerId);
        if (result.kind === 'rejected') {
          return this.partyManagementRejectionCode(result.reason);
        }
        // Presence outlives membership, so the kicked player's name is still
        // readable here even though their roster has been cleared.
        const kickedName = this.parties.presenceOf(result.kickedId)?.displayName ?? '队友';
        // The kicked player's roster is cleared by the service refresh, which
        // is routed to whichever room hosts them (it may not be this one).
        for (const memberId of result.party.memberIds) {
          const member = this.registry.findByPlayerId(memberId);
          if (member !== undefined) {
            this.sendSystemNotice(member.client, 'info', `${kickedName} 已被队长移出队伍`);
          }
        }
        return null;
      },
    );
  }

  /** Shared permission rule for leader-only roster changes. */
  private validatePartyManagement(
    session: SessionRecord,
    targetPlayerId: string,
  ): CommandRejectionCode | null {
    const party = this.parties.partyOf(session.playerId);
    if (party === undefined) {
      return 'PARTY_NOT_IN_PARTY';
    }
    if (party.leaderId !== session.playerId) {
      return 'PARTY_NOT_LEADER';
    }
    if (targetPlayerId === session.playerId) {
      return 'PARTY_TARGET_SELF';
    }
    return party.memberIds.includes(targetPlayerId) ? null : 'PARTY_TARGET_NOT_MEMBER';
  }

  private partyManagementRejectionCode(reason: PartyManagementRejection): CommandRejectionCode {
    switch (reason) {
      case 'not_in_party':
        return 'PARTY_NOT_IN_PARTY';
      case 'not_leader':
        return 'PARTY_NOT_LEADER';
      case 'target_self':
        return 'PARTY_TARGET_SELF';
      case 'target_not_member':
        return 'PARTY_TARGET_NOT_MEMBER';
    }
  }

  /**
   * Party commands change only in-memory state, so they share the command gate
   * with assets (protocol, duplicate id, sequence, rate limit) but run
   * synchronously instead of entering the asset queue.
   */
  private runPartyCommand(
    client: Client,
    command: { commandId: string; clientSequence: number; protocolVersion: number },
    validate: (session: SessionRecord) => CommandRejectionCode | null,
    apply: (session: SessionRecord) => CommandRejectionCode | null,
  ): void {
    const meta = { commandId: command.commandId, clientSequence: command.clientSequence };
    const session = this.registry.get(client.sessionId);
    if (session === undefined) {
      this.sendRejection(client, meta, 'INVALID_SESSION');
      return;
    }
    const gate = this.guard.check(session, command, session.recentParty.has(command.commandId));
    if (gate.kind === 'reject') {
      this.sendRejection(client, meta, gate.code);
      return;
    }
    if (gate.kind === 'duplicate') {
      this.sendPartySnapshot(client, session);
      return;
    }
    const rejection = validate(session);
    if (rejection !== null) {
      this.sendRejection(client, meta, rejection);
      return;
    }

    session.lastSequence = command.clientSequence;
    this.guard.remember(session.recentParty, command.commandId, true);
    const outcome = apply(session);
    if (outcome !== null) {
      session.recentParty.delete(command.commandId);
      this.sendRejection(client, meta, outcome);
      return;
    }
    this.metrics.recordAcceptedCommand();
  }

  /**
   * The roster is built from the process-wide presence table, so it includes
   * members hosted by other maps (ADR-036). Presence is refreshed once a second
   * from each host room and immediately on join/leave.
   */
  private refreshPartyPresence(): void {
    for (const session of this.registry.all()) {
      const player = this.combat.getPlayer(session.playerId);
      const statePlayer = this.state.players.get(session.playerId);
      if (player === undefined || statePlayer === undefined) {
        continue;
      }
      this.parties.setPresence({
        playerId: session.playerId,
        displayName: session.displayName,
        classId: player.classId,
        level: player.level,
        hp: player.hp,
        maxHp: player.maxHp,
        alive: player.alive,
        connected: statePlayer.connected,
        roomId: this.roomId,
      });
      if (this.parties.isMember(session.playerId)) {
        this.sendPartySnapshot(session.client, session);
      }
    }
  }

  private sendPartySnapshot(client: Client, session: SessionRecord): void {
    const party = this.parties.partyOf(session.playerId);
    const snapshot: PartySnapshot = {
      party: party === undefined ? null : this.partyView(party),
      serverTime: Date.now(),
    };
    const parsed = partySnapshotSchema.safeParse(snapshot);
    if (!parsed.success) {
      this.options.logger.error(
        { roomId: this.roomId, issues: parsed.error.issues.length },
        'party snapshot failed validation',
      );
      return;
    }
    client.send(SERVER_MESSAGES.partySnapshot, parsed.data);
  }

  private partyView(party: PartyState): PartyView | null {
    const members: PartyMemberView[] = [];
    for (const memberId of party.memberIds) {
      const presence = this.parties.presenceOf(memberId);
      if (presence === undefined) {
        continue;
      }
      members.push({
        playerId: memberId,
        displayName: presence.displayName,
        classId: presence.classId,
        level: presence.level,
        hp: presence.hp,
        maxHp: presence.maxHp,
        alive: presence.alive,
        connected: presence.connected,
        leader: memberId === party.leaderId,
      });
    }
    if (members.length === 0) {
      return null;
    }
    return {
      partyId: party.partyId,
      leaderId: party.leaderId,
      maxMembers: this.parties.maxMembers,
      members,
    };
  }

  private requireAlive(session: SessionRecord): CommandRejectionCode | null {
    const player = this.combat.getPlayer(session.playerId);
    if (player === undefined) {
      return 'INVALID_SESSION';
    }
    return player.alive ? null : 'PLAYER_DEAD';
  }

  private async runAssetCommand<
    T extends { snapshot: InventorySnapshot; stats: CombatStats; deduplicated: boolean },
  >(
    client: Client,
    command: { commandId: string; clientSequence: number; protocolVersion: number },
    kind: AssetCommandKind,
    validate: (session: SessionRecord) => CommandRejectionCode | null,
    operation: (session: SessionRecord) => Promise<T>,
    afterCommit: (session: SessionRecord, outcome: T) => void,
  ): Promise<void> {
    const meta = { commandId: command.commandId, clientSequence: command.clientSequence };
    const session = this.registry.get(client.sessionId);
    if (session === undefined) {
      this.sendRejection(client, meta, 'INVALID_SESSION');
      return;
    }
    const gate = this.guard.check(session, command, session.recentAssets.has(command.commandId));
    if (gate.kind === 'reject') {
      this.sendRejection(client, meta, gate.code);
      return;
    }
    if (gate.kind === 'duplicate') {
      this.sendAssetResult(client, session, command.commandId, kind, true);
      return;
    }
    const rejection = validate(session);
    if (rejection !== null) {
      this.sendRejection(client, meta, rejection);
      return;
    }

    session.lastSequence = command.clientSequence;
    this.guard.remember(session.recentAssets, command.commandId, kind);
    this.metrics.recordAssetCommand();

    let outcome: T;
    try {
      outcome = await this.enqueueAsset(() => operation(session));
    } catch (error) {
      session.recentAssets.delete(command.commandId);
      this.metrics.recordAssetFailure();
      if (error instanceof AssetError) {
        this.sendRejection(client, meta, error.code);
        return;
      }
      this.options.logger.error(
        { err: error, roomId: this.roomId, characterId: session.playerId, kind },
        'asset command failed',
      );
      this.sendRejection(client, meta, 'SERVICE_UNAVAILABLE');
      return;
    }

    // The transaction has committed. A failure while mirroring the result into
    // memory or the socket must never be reported as a rejected asset command.
    session.assetSnapshot = outcome.snapshot;
    try {
      afterCommit(session, outcome);
    } catch (error) {
      this.options.logger.error(
        { err: error, roomId: this.roomId, characterId: session.playerId, kind },
        'failed to apply committed asset result',
      );
    }
    if (this.registry.get(client.sessionId) === session) {
      try {
        this.sendAssetResult(client, session, command.commandId, kind, outcome.deduplicated);
      } catch (error) {
        this.options.logger.warn(
          { err: error, roomId: this.roomId, characterId: session.playerId, kind },
          'failed to deliver asset result',
        );
      }
      // A collect quest's progress is its bag count, so any inventory change
      // must re-render the resolved views (ADR-040).
      if (this.hasActiveCollectQuest(session)) {
        try {
          this.sendQuestSnapshot(client, session);
        } catch (error) {
          this.options.logger.warn(
            { err: error, roomId: this.roomId, characterId: session.playerId, kind },
            'failed to refresh quest views after an inventory change',
          );
        }
      }
    }
    this.metrics.recordAcceptedCommand();
  }

  private sendRejection(
    client: Client,
    meta: { commandId?: string; clientSequence?: number },
    code: CommandRejectionCode,
    options: { message?: string; retryAfterMs?: number } = {},
  ): void {
    const rejection: CommandRejected = {
      code,
      message: options.message ?? COMMAND_REJECTION_MESSAGES[code],
      serverTime: Date.now(),
      ...(meta.commandId === undefined ? {} : { commandId: meta.commandId }),
      ...(meta.clientSequence === undefined ? {} : { clientSequence: meta.clientSequence }),
      ...(options.retryAfterMs === undefined ? {} : { retryAfterMs: options.retryAfterMs }),
    };

    client.send(SERVER_MESSAGES.commandRejected, commandRejectedSchema.parse(rejection));
    this.metrics.recordRejectedCommand(code);
    this.options.logger.debug(
      { roomId: this.roomId, sessionId: client.sessionId, code },
      'command rejected',
    );
  }

  private setConnected(playerId: string, connected: boolean): void {
    const statePlayer: PlayerStateInstance | undefined = this.state.players.get(playerId);
    if (statePlayer !== undefined) {
      statePlayer.connected = connected;
      statePlayer.moving = false;
    }
  }

  private pickSpawnPoint(): TilePoint {
    const occupied = new Set(
      this.simulation.listPlayers().map((player) => {
        const tile = tileOfUnits(player);
        return `${String(tile.x)}:${String(tile.y)}`;
      }),
    );

    for (const point of this.map.runtime.manifest.spawnPoints) {
      if (!occupied.has(`${String(point.x)}:${String(point.y)}`)) {
        return point;
      }
    }

    const spawnPoints = this.map.runtime.manifest.spawnPoints;
    const fallbackIndex = this.simulation.listPlayers().length % spawnPoints.length;
    return spawnPoints[fallbackIndex] ?? tilePointSchema.parse({ x: 1, y: 1 });
  }

  private async removeSession(sessionId: string): Promise<void> {
    const session = this.registry.get(sessionId);
    if (session === undefined) {
      return;
    }

    const player = this.simulation.getPlayer(session.playerId);
    const combatPlayer = this.combat.getPlayer(session.playerId);
    const displayName = session.displayName;
    this.registry.remove(sessionId);
    const reachPrefix = `${session.playerId}:`;
    for (const key of this.reachBackoffUntil.keys()) {
      if (key.startsWith(reachPrefix)) {
        this.reachBackoffUntil.delete(key);
      }
    }

    // A map transfer keeps the party (ADR-036): the member is marked offline
    // until the destination room reports presence. A final leave removes the
    // member, and the service refreshes every remaining member's room. The
    // removed session is already gone from the registry, so it cannot receive
    // its own departure.
    const formerParty = this.parties.partyOf(session.playerId);
    if (formerParty !== undefined) {
      if (session.transferring) {
        this.parties.markOffline(session.playerId);
        this.parties.refreshMembers(formerParty.memberIds);
      } else {
        this.parties.removePlayer(session.playerId);
        for (const memberId of formerParty.memberIds) {
          if (memberId === session.playerId) {
            continue;
          }
          const member = this.registry.findByPlayerId(memberId);
          if (member !== undefined) {
            this.sendSystemNotice(member.client, 'info', `${displayName} 离开了队伍`);
          }
        }
      }
    }

    const affected = this.interest.remove(session.playerId);
    this.views.refresh(affected);
    this.simulation.removePlayer(session.playerId);
    this.combat.removePlayer(session.playerId);
    this.state.players.delete(session.playerId);
    this.state.playerCount = this.state.players.size;
    this.metrics.setPlayers(this.state.players.size);

    delete session.client.view;
    session.view.dispose();

    if (!session.transferring) {
      if (player !== undefined) {
        try {
          await saveCharacterCheckpoint(this.options.database, {
            characterId: session.playerId,
            mapId: this.map.mapId,
            x: player.x,
            y: player.y,
            facing: player.facing,
            hp: combatPlayer?.hp ?? session.hp,
            mp: combatPlayer?.mp ?? session.mp,
          });
        } catch (error) {
          this.options.logger.error(
            { err: error, roomId: this.roomId, characterId: session.playerId },
            'failed to checkpoint character position',
          );
        }
      }

      try {
        await releaseCharacterLease(this.options.database, session.playerId, sessionId);
      } catch (error) {
        this.options.logger.error(
          { err: error, roomId: this.roomId, characterId: session.playerId },
          'failed to release character lease',
        );
      }
    }

    if (!session.transferring && this.registry.size > 0) {
      this.broadcastSystemNotice('info', `${displayName} 离开了地图`);
    }

    this.options.logger.info(
      {
        roomId: this.roomId,
        characterId: session.playerId,
        transferred: session.transferring,
        clients: this.state.players.size,
      },
      'player left world',
    );
  }
}
