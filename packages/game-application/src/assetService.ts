import {
  DEFAULT_CONTESTED_DELAY_MS,
  INVENTORY_CAPACITY,
  LOOT_EXPIRY_MS,
  LOOT_OWNER_WINDOW_MS,
  TRADE_MAX_GOLD,
  TRADE_MAX_ITEM_STACKS,
  type AssetCommandKind,
  type ContentBundle,
  type EquipmentSlot,
  type InventorySnapshot,
  type ItemView,
  type LootClaimed,
  type QuestContent,
} from '@web-legend/contracts';
import {
  DEFAULT_CONTENT_BUNDLE,
  advanceQuestOnKill,
  applyDeathPenalty,
  applyExperience,
  dailyPeriodKey,
  canEquip,
  combatStatsFor,
  equipmentBonuses,
  experienceForNextLevel,
  findInventoryPlacement,
  isConsumable,
  isShopQuantityAllowed,
  isTradeableItem,
  itemBuyPrice,
  itemSellPrice,
  purchaseCost,
  requireItem,
  requireLootTable,
  rollLoot,
  saleValue,
  statsWithEquipment,
  type CombatStats,
  type ItemCatalog,
  type ItemDefinition,
  type QuestRecordState,
  type Rng,
} from '@web-legend/game-domain';
import {
  advanceCharacterQuest,
  assetCommands,
  characters,
  currencyLedger,
  findCharacterQuestForUpdate,
  findWallet,
  insertCharacterQuest,
  itemInstances,
  listCharacterQuestsForPeriod,
  listEquippedItems,
  listInventoryItems,
  listOpenWorldDrops,
  lockInventoryItemsByTemplate,
  markCharacterQuestClaimed,
  purgeExpiredWorldDrops,
  wallets,
  worldDrops,
  type Character,
  type Database,
  type DbExecutor,
  type ExpiredDropCleanup,
  type ItemInstance,
} from '@web-legend/persistence';
import { and, asc, eq, gte, inArray, sql } from 'drizzle-orm';

import { AssetError } from './errors';

/** Claimed drop rows remain as audit history for a week after expiry. */
const DEFAULT_CLAIMED_DROP_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;

const DROP_OFFSETS = [
  { x: 0, y: 0 },
  { x: 450, y: 180 },
  { x: -420, y: 360 },
  { x: 320, y: -360 },
] as const;

export type AssetServiceOptions = {
  now?: () => Date;
  rng?: Rng;
  /** Fixed Room content release; omitted means the shipped baseline (ADR-022). */
  content?: ContentBundle;
};

export type LoadedAssets = {
  character: Character;
  snapshot: InventorySnapshot;
  stats: CombatStats;
};

export type LootDropView = {
  dropId: string;
  itemId: string;
  templateId: string;
  displayName: string;
  quantity: number;
  x: number;
  y: number;
  /** Empty for contested drops, which have no owner (ADR-041). */
  ownerId: string;
  /** Epoch ms when the owner window ends; 0 when there is no owner. */
  ownerExpiresAt?: number;
  /** Epoch ms before which a contested drop cannot be picked; 0 when unlocked. */
  pickupLockedUntil?: number;
  expiresAt: number;
};

export type KillQuestUpdate = {
  record: QuestRecordState;
  /** True when this kill completed the objective. */
  completedNow: boolean;
};

export type KillRewardOutcome = {
  snapshot: InventorySnapshot;
  stats: CombatStats;
  expGained: number;
  goldGained: number;
  leveledUp: boolean;
  drops: LootDropView[];
  /** Active quests whose progress advanced in this same transaction. */
  questUpdates: KillQuestUpdate[];
};

export type PickupOutcome = {
  snapshot: InventorySnapshot;
  stats: CombatStats;
  deduplicated: boolean;
  claimed: LootClaimed | null;
};

export type AssetCommandOutcome = {
  snapshot: InventorySnapshot;
  stats: CombatStats;
  deduplicated: boolean;
  /** Present after a consumable changed the authoritative vitals. */
  vitals?: { hp: number; mp: number };
};

export type KillRewardInput = {
  characterId: string;
  mapId: string;
  /** Globally unique per monster death; the idempotency key derives from it. */
  reference: string;
  monsterTemplateId: string;
  x: number;
  y: number;
};

export type DeathPenaltyInput = {
  characterId: string;
  /** Death event id; one penalty per death, however often the event is seen. */
  deathId: string;
};

export type PartyKillRewardInput = {
  characterId: string;
  /** The killer's reward reference; one assist share per kill and member. */
  reference: string;
  monsterTemplateId: string;
  /** Share of the monster's base experience, in per-mille. */
  sharePermille: number;
};

export type PartyKillRewardOutcome = {
  snapshot: InventorySnapshot;
  stats: CombatStats;
  expGained: number;
  leveledUp: boolean;
};

export type DeathPenaltyOutcome = {
  snapshot: InventorySnapshot;
  xpLost: number;
  protectedByLevel: boolean;
};

export type PickupInput = {
  characterId: string;
  commandId: string;
  dropId: string;
  mapId: string;
  /**
   * The picker's current party members, including the picker. The room is the
   * authority for transient party state; a drop's owner window also admits the
   * owner's party (ADR-035).
   */
  partyMemberIds?: readonly string[];
};

export type EquipInput = { characterId: string; commandId: string; itemId: string };
export type UnequipInput = { characterId: string; commandId: string; slot: EquipmentSlot };
export type UseInput = {
  characterId: string;
  commandId: string;
  itemId: string;
  vitals: { hp: number; mp: number };
};

export type BuyInput = {
  characterId: string;
  commandId: string;
  merchantId: string;
  templateId: string;
  quantity: number;
};

export type SellInput = {
  characterId: string;
  commandId: string;
  merchantId: string;
  itemId: string;
  quantity: number;
};

/** One side of a trade as the room last observed it (ADR-050). */
export type TradeSettlementSide = {
  characterId: string;
  items: readonly { itemId: string; quantity: number }[];
  gold: number;
};

export type TradeSettlementInput = {
  tradeId: string;
  sides: readonly [TradeSettlementSide, TradeSettlementSide];
};

export type TradeSettlementSideResult = {
  characterId: string;
  snapshot: InventorySnapshot;
  stats: CombatStats;
};

export type TradeSettlementOutcome = {
  deduplicated: boolean;
  sides: TradeSettlementSideResult[];
};

export type ShopBuyOutcome = AssetCommandOutcome & {
  purchased: {
    templateId: string;
    quantity: number;
    unitPrice: number;
    totalCost: number;
  } | null;
};

export type ShopSellOutcome = AssetCommandOutcome & {
  sold: {
    itemId: string;
    templateId: string;
    quantity: number;
    unitPrice: number;
    totalValue: number;
  } | null;
};

export type QuestCommandInput = { characterId: string; commandId: string; questId: string };

export type AcceptQuestOutcome = AssetCommandOutcome & { record: QuestRecordState };

/**
 * Arrival completion is not an asset change and carries no client command: the
 * room observes the authoritative position and this transaction records it
 * idempotently under the character row lock (ADR-042).
 */
export type ReachQuestOutcome = {
  record: QuestRecordState;
  completedNow: boolean;
};

export type ClaimQuestOutcome = AssetCommandOutcome & {
  record: QuestRecordState;
  leveledUp: boolean;
  expGained: number;
  goldGained: number;
};

function itemView(row: ItemInstance, catalog: ItemCatalog): ItemView {
  const definition = requireItem(row.templateId, catalog);
  return {
    itemId: row.id,
    templateId: row.templateId,
    name: definition.name,
    kind: definition.kind,
    quantity: row.quantity,
    ...(row.slotIndex === null ? {} : { slotIndex: row.slotIndex }),
    ...(definition.equipSlot === undefined ? {} : { equipSlot: definition.equipSlot }),
    ...(definition.quality === undefined ? {} : { quality: definition.quality }),
    levelRequirement: definition.levelRequirement,
    attackBonus: definition.attackBonus,
    defenseBonus: definition.defenseBonus,
    maxHpBonus: definition.maxHpBonus,
    maxMpBonus: definition.maxMpBonus,
    healHp: definition.healHp,
    healMp: definition.healMp,
    tradeable: isTradeableItem(definition),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function questRecordOf(row: {
  questId: string;
  periodKey: string;
  status: 'active' | 'completed' | 'claimed';
  progress: number;
}): QuestRecordState {
  return {
    questId: row.questId,
    periodKey: row.periodKey,
    status: row.status,
    progress: row.progress,
  };
}

/**
 * Transactional asset use cases for phase 5 (ADR-020). Every mutation here runs
 * in one PostgreSQL transaction, uses a unique idempotency key and reads the
 * committed state back inside the same transaction. The game room calls these
 * from an async queue; the fixed tick never awaits them.
 */
export class AssetService {
  private readonly now: () => Date;
  private readonly rng: Rng;
  private readonly content: ContentBundle;

  constructor(
    private readonly db: Database,
    options: AssetServiceOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.rng = options.rng ?? Math.random;
    this.content = options.content ?? DEFAULT_CONTENT_BUNDLE;
  }

  async loadAssets(characterId: string): Promise<LoadedAssets> {
    return this.loadAssetsWithin(this.db, characterId);
  }

  /** Quest rows for the join handshake; separate from the asset snapshot. */
  async loadQuestRecords(characterId: string): Promise<QuestRecordState[]> {
    const periodKey = this.currentPeriodKey(this.now());
    const rows = await listCharacterQuestsForPeriod(this.db, characterId, periodKey);
    return rows.map((row) => questRecordOf(row));
  }

  /** Empty for one-time quests, the realm day for dailies, null if misconfigured. */
  private periodKeyForQuest(quest: QuestContent, now: Date): string | null {
    if (quest.repeat !== 'daily') {
      return '';
    }
    const rule = this.content.rules?.dailyReset;
    return rule === undefined ? null : dailyPeriodKey(now, rule);
  }

  private currentPeriodKey(now: Date): string {
    const rule = this.content.rules?.dailyReset;
    return rule === undefined ? '' : dailyPeriodKey(now, rule);
  }

  /**
   * Unclaimed drops used to restore a room's loot after a restart. A retired
   * template is skipped and reported instead of failing the whole map: one bad
   * row must not hide every other drop (TD-DATA-04).
   */
  async loadOpenDrops(
    mapId: string,
    onUnknownTemplate?: (templateId: string) => void,
  ): Promise<LootDropView[]> {
    const now = this.now();
    const rows = await listOpenWorldDrops(this.db, mapId, now);
    const drops: LootDropView[] = [];
    for (const { drop, item } of rows) {
      let definition: ItemDefinition;
      try {
        definition = requireItem(item.templateId, this.content.items);
      } catch {
        onUnknownTemplate?.(item.templateId);
        continue;
      }
      const ownerActive =
        drop.ownerCharacterId !== null &&
        drop.ownerExpiresAt !== null &&
        drop.ownerExpiresAt.getTime() > now.getTime();
      drops.push({
        dropId: drop.id,
        itemId: item.id,
        templateId: item.templateId,
        displayName: definition.name,
        quantity: item.quantity,
        x: drop.x,
        y: drop.y,
        ownerId: ownerActive && drop.ownerCharacterId !== null ? drop.ownerCharacterId : '',
        ownerExpiresAt: drop.ownerExpiresAt?.getTime() ?? 0,
        pickupLockedUntil: drop.pickupLockedUntil?.getTime() ?? 0,
        expiresAt: drop.expiresAt.getTime(),
      });
    }
    return drops;
  }

  /**
   * Removes expired unclaimed drops (and their ground item rows) plus old
   * claimed history. Safe to run from a room maintenance timer: it takes no
   * player lock and touches no live asset.
   */
  async purgeExpiredDrops(
    options: { mapId?: string; limit?: number; claimedRetentionMs?: number } = {},
  ): Promise<ExpiredDropCleanup> {
    const now = this.now();
    return this.db.transaction((tx) =>
      purgeExpiredWorldDrops(tx, {
        now,
        claimedRetentionMs: options.claimedRetentionMs ?? DEFAULT_CLAIMED_DROP_RETENTION_MS,
        ...(options.mapId === undefined ? {} : { mapId: options.mapId }),
        ...(options.limit === undefined ? {} : { limit: options.limit }),
      }),
    );
  }

  /**
   * Grants experience, gold and ground drops for one monster death. Returns
   * `null` when the kill reference was already settled, so a retry can never
   * pay twice.
   */
  async grantKillReward(input: KillRewardInput): Promise<KillRewardOutcome | null> {
    const now = this.now();
    const table = requireLootTable(input.monsterTemplateId, this.content.lootTables);

    return this.db.transaction(async (tx) => {
      // Lock the character before writing the idempotency row: the foreign key
      // takes a share lock on the same row, and share-then-exclusive ordering
      // deadlocks under concurrency (EL-012).
      const [character] = await tx
        .select()
        .from(characters)
        .where(eq(characters.id, input.characterId))
        .for('update');
      if (character === undefined) {
        throw new AssetError('INVALID_SESSION');
      }

      const claimed = await tx
        .insert(assetCommands)
        .values({
          characterId: input.characterId,
          kind: 'kill_reward',
          idempotencyKey: `kill:${input.reference}`,
          createdAt: now,
        })
        .onConflictDoNothing({ target: assetCommands.idempotencyKey })
        .returning({ id: assetCommands.id });
      if (claimed.length === 0) {
        return null;
      }

      const roll = rollLoot(table, this.rng);
      const progression = applyExperience(character.level, character.exp, roll.exp);
      const leveledUp = progression.levelsGained > 0;
      // Persist the effective (equipment-adjusted) maxima, not the base class
      // table: otherwise a kill silently lowers a geared character's HP cap
      // until the next equipment change rewrites it (TD-DATA-01).
      const equipped = await listEquippedItems(tx, character.id);
      const stats = statsWithEquipment(
        combatStatsFor(character.classId, progression.level, this.content),
        equipmentBonuses(
          equipped.map((entry) => requireItem(entry.templateId, this.content.items)),
        ),
      );
      const hp = leveledUp ? stats.maxHp : clamp(character.hp, 0, stats.maxHp);
      const mp = leveledUp ? stats.maxMp : clamp(character.mp, 0, stats.maxMp);

      await tx
        .update(characters)
        .set({
          level: progression.level,
          exp: progression.exp,
          hp,
          mp,
          maxHp: stats.maxHp,
          maxMp: stats.maxMp,
          version: sql`${characters.version} + 1`,
          updatedAt: now,
        })
        .where(eq(characters.id, character.id));

      if (roll.gold > 0) {
        const [wallet] = await tx
          .insert(wallets)
          .values({ characterId: character.id, balance: roll.gold, version: 1, updatedAt: now })
          .onConflictDoUpdate({
            target: wallets.characterId,
            set: {
              balance: sql`${wallets.balance} + ${roll.gold}`,
              version: sql`${wallets.version} + 1`,
              updatedAt: now,
            },
          })
          .returning({ balance: wallets.balance });
        if (wallet === undefined) {
          throw new AssetError('SERVICE_UNAVAILABLE');
        }
        await tx.insert(currencyLedger).values({
          characterId: character.id,
          currencyType: 'gold',
          delta: roll.gold,
          balanceAfter: wallet.balance,
          reason: 'monster_kill',
          referenceId: input.reference,
          idempotencyKey: `kill:${input.reference}:gold`,
          createdAt: now,
        });
      }

      const contestedDelayMs =
        this.content.rules?.loot?.contestedDelayMs ?? DEFAULT_CONTESTED_DELAY_MS;
      const drops: LootDropView[] = [];
      for (const [index, entry] of roll.items.entries()) {
        const definition = requireItem(entry.templateId, this.content.items);
        const [item] = await tx
          .insert(itemInstances)
          .values({
            templateId: entry.templateId,
            container: 'ground',
            quantity: entry.quantity,
            createdAt: now,
            updatedAt: now,
          })
          .returning();
        if (item === undefined) {
          throw new AssetError('SERVICE_UNAVAILABLE');
        }
        const offset = DROP_OFFSETS[index % DROP_OFFSETS.length] ?? DROP_OFFSETS[0];
        // Contested drops are unowned, locked for a while and hand-picked only;
        // they also live long enough to contest after the lock (ADR-041).
        const contested = entry.contested === true;
        const ownerExpiresAt = contested ? null : new Date(now.getTime() + LOOT_OWNER_WINDOW_MS);
        const pickupLockedUntil = contested ? new Date(now.getTime() + contestedDelayMs) : null;
        const expiresAt = new Date(
          now.getTime() + (contested ? contestedDelayMs : 0) + LOOT_EXPIRY_MS,
        );
        const [drop] = await tx
          .insert(worldDrops)
          .values({
            mapId: input.mapId,
            x: input.x + offset.x,
            y: input.y + offset.y,
            itemInstanceId: item.id,
            ownerCharacterId: contested ? null : character.id,
            ownerExpiresAt,
            pickupLockedUntil,
            expiresAt,
            createdAt: now,
          })
          .returning();
        if (drop === undefined) {
          throw new AssetError('SERVICE_UNAVAILABLE');
        }
        drops.push({
          dropId: drop.id,
          itemId: item.id,
          templateId: item.templateId,
          displayName: definition.name,
          quantity: item.quantity,
          x: drop.x,
          y: drop.y,
          ownerId: contested ? '' : character.id,
          ownerExpiresAt: ownerExpiresAt?.getTime() ?? 0,
          pickupLockedUntil: pickupLockedUntil?.getTime() ?? 0,
          expiresAt: drop.expiresAt.getTime(),
        });
      }

      // Quest progress shares the reward transaction: a committed kill always
      // advances its objective exactly once, and a rolled-back reward cannot
      // leave a quest half-credited (ADR-034).
      const questUpdates = await this.advanceQuestsOnKill(
        tx,
        character.id,
        input.monsterTemplateId,
        now,
      );

      const loaded = await this.loadAssetsWithin(tx, character.id);
      return {
        snapshot: loaded.snapshot,
        stats: loaded.stats,
        expGained: roll.exp,
        goldGained: roll.gold,
        leveledUp,
        drops,
        questUpdates,
      };
    });
  }

  /**
   * Shares one monster kill with a nearby party member (ADR-035). The killer's
   * transaction already rolled the full reward; assists receive a fixed share
   * of the loot table's base experience, so the amount is deterministic and a
   * retry cannot re-roll it. Gold, drops and quest progress stay killer-only.
   * Returns `null` when the share was already settled or the table pays none.
   */
  async grantPartyKillExperience(
    input: PartyKillRewardInput,
  ): Promise<PartyKillRewardOutcome | null> {
    const table = requireLootTable(input.monsterTemplateId, this.content.lootTables);
    const share = Math.floor((table.exp * input.sharePermille) / 1_000);
    if (share <= 0) {
      return null;
    }
    const now = this.now();

    return this.db.transaction(async (tx) => {
      const [character] = await tx
        .select()
        .from(characters)
        .where(eq(characters.id, input.characterId))
        .for('update');
      if (character === undefined) {
        throw new AssetError('INVALID_SESSION');
      }

      const claimed = await tx
        .insert(assetCommands)
        .values({
          characterId: input.characterId,
          kind: 'party_kill_reward',
          idempotencyKey: `party_kill:${input.reference}:${input.characterId}`,
          createdAt: now,
        })
        .onConflictDoNothing({ target: assetCommands.idempotencyKey })
        .returning({ id: assetCommands.id });
      if (claimed.length === 0) {
        return null;
      }

      const progression = applyExperience(character.level, character.exp, share);
      const leveledUp = progression.levelsGained > 0;
      const equipped = await listEquippedItems(tx, character.id);
      const stats = statsWithEquipment(
        combatStatsFor(character.classId, progression.level, this.content),
        equipmentBonuses(
          equipped.map((entry) => requireItem(entry.templateId, this.content.items)),
        ),
      );
      const hp = leveledUp ? stats.maxHp : clamp(character.hp, 0, stats.maxHp);
      const mp = leveledUp ? stats.maxMp : clamp(character.mp, 0, stats.maxMp);

      await tx
        .update(characters)
        .set({
          level: progression.level,
          exp: progression.exp,
          hp,
          mp,
          maxHp: stats.maxHp,
          maxMp: stats.maxMp,
          version: sql`${characters.version} + 1`,
          updatedAt: now,
        })
        .where(eq(characters.id, character.id));

      const loaded = await this.loadAssetsWithin(tx, character.id);
      return {
        snapshot: loaded.snapshot,
        stats: loaded.stats,
        expGained: share,
        leveledUp,
      };
    });
  }

  /**
   * PvE death cost: removes a content-configured share of the experience
   * progress inside the current level. Runs in the same asset queue as kill
   * rewards, locks the character row first and records one idempotency row per
   * death, so a retried or duplicated death event can never double-charge.
   * Releases without a `rules.deathPenalty` section keep death penalty-free.
   */
  async applyDeathPenalty(input: DeathPenaltyInput): Promise<DeathPenaltyOutcome | null> {
    const rule = this.content.rules?.deathPenalty;
    if (rule === undefined) {
      return null;
    }
    const now = this.now();

    return this.db.transaction(async (tx) => {
      const [character] = await tx
        .select()
        .from(characters)
        .where(eq(characters.id, input.characterId))
        .for('update');
      if (character === undefined) {
        throw new AssetError('INVALID_SESSION');
      }

      const claimed = await tx
        .insert(assetCommands)
        .values({
          characterId: input.characterId,
          kind: 'death_penalty',
          idempotencyKey: `death:${input.deathId}`,
          createdAt: now,
        })
        .onConflictDoNothing({ target: assetCommands.idempotencyKey })
        .returning({ id: assetCommands.id });
      if (claimed.length === 0) {
        return null;
      }

      const protectedByLevel = character.level < rule.protectBelowLevel;
      const penalty = applyDeathPenalty(character.level, character.exp, rule);
      if (penalty.lost > 0) {
        await tx
          .update(characters)
          .set({
            exp: penalty.exp,
            version: sql`${characters.version} + 1`,
            updatedAt: now,
          })
          .where(eq(characters.id, character.id));
      }

      const loaded = await this.loadAssetsWithin(tx, character.id);
      return {
        snapshot: loaded.snapshot,
        xpLost: penalty.lost,
        protectedByLevel,
      };
    });
  }

  async pickup(input: PickupInput): Promise<PickupOutcome> {
    const now = this.now();
    return this.db.transaction(async (tx) => {
      const [character] = await tx
        .select()
        .from(characters)
        .where(eq(characters.id, input.characterId))
        .for('update');
      if (character === undefined) {
        throw new AssetError('INVALID_SESSION');
      }

      const inserted = await this.claimCommand(
        tx,
        input.characterId,
        'loot_pickup',
        input.commandId,
      );
      if (!inserted) {
        const current = await this.loadAssetsWithin(tx, input.characterId);
        return {
          snapshot: current.snapshot,
          stats: current.stats,
          deduplicated: true,
          claimed: null,
        };
      }

      const [drop] = await tx
        .select()
        .from(worldDrops)
        .where(eq(worldDrops.id, input.dropId))
        .for('update');
      if (drop === undefined || drop.mapId !== input.mapId) {
        throw new AssetError('ITEM_NOT_FOUND');
      }
      if (drop.claimedAt !== null) {
        throw new AssetError('ALREADY_CLAIMED');
      }
      if (drop.expiresAt.getTime() <= now.getTime()) {
        throw new AssetError('DROP_EXPIRED');
      }
      if (drop.pickupLockedUntil !== null && drop.pickupLockedUntil.getTime() > now.getTime()) {
        throw new AssetError('DROP_LOCKED');
      }
      if (
        drop.ownerCharacterId !== null &&
        drop.ownerCharacterId !== input.characterId &&
        drop.ownerExpiresAt !== null &&
        drop.ownerExpiresAt.getTime() > now.getTime() &&
        !(input.partyMemberIds ?? []).includes(drop.ownerCharacterId)
      ) {
        throw new AssetError('NOT_OWNER');
      }

      const [item] = await tx
        .select()
        .from(itemInstances)
        .where(eq(itemInstances.id, drop.itemInstanceId))
        .for('update');
      if (item === undefined || item.container !== 'ground' || item.characterId !== null) {
        throw new AssetError('ITEM_NOT_FOUND');
      }

      const inventory = await listInventoryItems(tx, input.characterId);
      const placement = findInventoryPlacement(
        {
          items: inventory.map((entry) => ({
            itemId: entry.id,
            templateId: entry.templateId,
            quantity: entry.quantity,
            slotIndex: entry.slotIndex ?? 0,
          })),
          templateId: item.templateId,
          quantity: item.quantity,
          capacity: INVENTORY_CAPACITY,
        },
        this.content.items,
      );
      if (placement === null) {
        throw new AssetError('INVENTORY_FULL');
      }

      if (placement.kind === 'merge') {
        await tx
          .update(itemInstances)
          .set({
            quantity: placement.resultingQuantity,
            version: sql`${itemInstances.version} + 1`,
            updatedAt: now,
          })
          .where(eq(itemInstances.id, placement.targetItemId));
        // The ground instance is absorbed; the drop row cascades away with it.
        await tx.delete(itemInstances).where(eq(itemInstances.id, item.id));
      } else {
        await tx
          .update(itemInstances)
          .set({
            characterId: input.characterId,
            container: 'inventory',
            slotIndex: placement.slotIndex,
            equipSlot: null,
            version: sql`${itemInstances.version} + 1`,
            updatedAt: now,
          })
          .where(eq(itemInstances.id, item.id));
        await tx
          .update(worldDrops)
          .set({ claimedAt: now, claimedByCharacterId: input.characterId })
          .where(eq(worldDrops.id, drop.id));
      }

      const definition = requireItem(item.templateId, this.content.items);
      const loaded = await this.loadAssetsWithin(tx, input.characterId);
      return {
        snapshot: loaded.snapshot,
        stats: loaded.stats,
        deduplicated: false,
        claimed: {
          dropId: drop.id,
          itemId: item.id,
          templateId: item.templateId,
          name: definition.name,
          quantity: item.quantity,
          claimerId: input.characterId,
          claimerName: character.name,
          serverTime: now.getTime(),
        },
      };
    });
  }

  async equip(input: EquipInput): Promise<AssetCommandOutcome> {
    const now = this.now();
    return this.db.transaction(async (tx) => {
      const [character] = await tx
        .select()
        .from(characters)
        .where(eq(characters.id, input.characterId))
        .for('update');
      if (character === undefined) {
        throw new AssetError('INVALID_SESSION');
      }
      if (!(await this.claimCommand(tx, input.characterId, 'inventory_equip', input.commandId))) {
        const current = await this.loadAssetsWithin(tx, input.characterId);
        return { snapshot: current.snapshot, stats: current.stats, deduplicated: true };
      }

      const [item] = await tx
        .select()
        .from(itemInstances)
        .where(
          and(
            eq(itemInstances.id, input.itemId),
            eq(itemInstances.characterId, input.characterId),
            eq(itemInstances.container, 'inventory'),
          ),
        )
        .for('update');
      if (item === undefined) {
        throw new AssetError('ITEM_NOT_FOUND');
      }

      const definition = requireItem(item.templateId, this.content.items);
      const equippable = canEquip(definition, character.classId, character.level);
      if (equippable === 'notEquippable') {
        throw new AssetError('ITEM_NOT_EQUIPPABLE');
      }
      if (equippable === 'wrongClass') {
        throw new AssetError('CLASS_RESTRICTED');
      }
      if (equippable === 'levelTooLow') {
        throw new AssetError('LEVEL_TOO_LOW');
      }

      const slot = definition.equipSlot;
      if (slot === undefined) {
        throw new AssetError('ITEM_NOT_EQUIPPABLE');
      }
      const [current] = await tx
        .select()
        .from(itemInstances)
        .where(
          and(
            eq(itemInstances.characterId, input.characterId),
            eq(itemInstances.container, 'equipment'),
            eq(itemInstances.equipSlot, slot),
          ),
        )
        .for('update');

      await tx
        .update(itemInstances)
        .set({
          container: 'equipment',
          equipSlot: slot,
          slotIndex: null,
          version: sql`${itemInstances.version} + 1`,
          updatedAt: now,
        })
        .where(eq(itemInstances.id, item.id));

      if (current !== undefined) {
        await tx
          .update(itemInstances)
          .set({
            container: 'inventory',
            equipSlot: null,
            slotIndex: item.slotIndex,
            version: sql`${itemInstances.version} + 1`,
            updatedAt: now,
          })
          .where(eq(itemInstances.id, current.id));
      }

      const loaded = await this.loadAssetsWithin(tx, input.characterId);
      return { snapshot: loaded.snapshot, stats: loaded.stats, deduplicated: false };
    });
  }

  async unequip(input: UnequipInput): Promise<AssetCommandOutcome> {
    const now = this.now();
    return this.db.transaction(async (tx) => {
      // Serialize every bag mutation for this character so two operations can
      // never pick the same free slot. The character lock must come before the
      // idempotency insert: its foreign key takes a share lock on the same row,
      // and share-then-exclusive ordering deadlocks under concurrency (EL-012).
      const [character] = await tx
        .select()
        .from(characters)
        .where(eq(characters.id, input.characterId))
        .for('update');
      if (character === undefined) {
        throw new AssetError('INVALID_SESSION');
      }
      if (!(await this.claimCommand(tx, input.characterId, 'inventory_unequip', input.commandId))) {
        const current = await this.loadAssetsWithin(tx, input.characterId);
        return { snapshot: current.snapshot, stats: current.stats, deduplicated: true };
      }

      const [equipped] = await tx
        .select()
        .from(itemInstances)
        .where(
          and(
            eq(itemInstances.characterId, input.characterId),
            eq(itemInstances.container, 'equipment'),
            eq(itemInstances.equipSlot, input.slot),
          ),
        )
        .for('update');
      if (equipped === undefined) {
        throw new AssetError('SLOT_EMPTY');
      }

      const inventory = await listInventoryItems(tx, input.characterId);
      const placement = findInventoryPlacement(
        {
          items: inventory.map((entry) => ({
            itemId: entry.id,
            templateId: entry.templateId,
            quantity: entry.quantity,
            slotIndex: entry.slotIndex ?? 0,
          })),
          templateId: equipped.templateId,
          quantity: equipped.quantity,
          capacity: INVENTORY_CAPACITY,
        },
        this.content.items,
      );
      if (placement === null || placement.kind !== 'slot') {
        throw new AssetError('INVENTORY_FULL');
      }

      await tx
        .update(itemInstances)
        .set({
          container: 'inventory',
          equipSlot: null,
          slotIndex: placement.slotIndex,
          version: sql`${itemInstances.version} + 1`,
          updatedAt: now,
        })
        .where(eq(itemInstances.id, equipped.id));

      const loaded = await this.loadAssetsWithin(tx, input.characterId);
      return { snapshot: loaded.snapshot, stats: loaded.stats, deduplicated: false };
    });
  }

  async use(input: UseInput): Promise<AssetCommandOutcome> {
    const now = this.now();
    return this.db.transaction(async (tx) => {
      const [character] = await tx
        .select()
        .from(characters)
        .where(eq(characters.id, input.characterId))
        .for('update');
      if (character === undefined) {
        throw new AssetError('INVALID_SESSION');
      }
      if (!(await this.claimCommand(tx, input.characterId, 'inventory_use', input.commandId))) {
        const current = await this.loadAssetsWithin(tx, input.characterId);
        return { snapshot: current.snapshot, stats: current.stats, deduplicated: true };
      }

      const [item] = await tx
        .select()
        .from(itemInstances)
        .where(
          and(
            eq(itemInstances.id, input.itemId),
            eq(itemInstances.characterId, input.characterId),
            eq(itemInstances.container, 'inventory'),
          ),
        )
        .for('update');
      if (item === undefined) {
        throw new AssetError('ITEM_NOT_FOUND');
      }

      const definition = requireItem(item.templateId, this.content.items);
      if (!isConsumable(definition)) {
        throw new AssetError('ITEM_NOT_USABLE');
      }
      if (character.level < definition.levelRequirement) {
        throw new AssetError('LEVEL_TOO_LOW');
      }

      const equipped = await listEquippedItems(tx, input.characterId);
      const stats = statsWithEquipment(
        combatStatsFor(character.classId, character.level, this.content),
        equipmentBonuses(
          equipped.map((entry) => requireItem(entry.templateId, this.content.items)),
        ),
      );

      const currentHp = clamp(Math.floor(input.vitals.hp), 0, stats.maxHp);
      const currentMp = clamp(Math.floor(input.vitals.mp), 0, stats.maxMp);
      if (currentHp <= 0) {
        throw new AssetError('PLAYER_DEAD');
      }
      const nextHp = Math.min(stats.maxHp, currentHp + definition.healHp);
      const nextMp = Math.min(stats.maxMp, currentMp + definition.healMp);
      if (nextHp === currentHp && nextMp === currentMp) {
        throw new AssetError('ITEM_NOT_USABLE');
      }

      await tx
        .update(characters)
        .set({
          hp: nextHp,
          mp: nextMp,
          version: sql`${characters.version} + 1`,
          updatedAt: now,
        })
        .where(eq(characters.id, character.id));

      if (item.quantity > 1) {
        await tx
          .update(itemInstances)
          .set({
            quantity: item.quantity - 1,
            version: sql`${itemInstances.version} + 1`,
            updatedAt: now,
          })
          .where(eq(itemInstances.id, item.id));
      } else {
        await tx.delete(itemInstances).where(eq(itemInstances.id, item.id));
      }

      const loaded = await this.loadAssetsWithin(tx, input.characterId);
      return {
        snapshot: loaded.snapshot,
        stats: loaded.stats,
        deduplicated: false,
        vitals: { hp: nextHp, mp: nextMp },
      };
    });
  }

  async buy(input: BuyInput): Promise<ShopBuyOutcome> {
    const now = this.now();
    return this.db.transaction(async (tx) => {
      const [character] = await tx
        .select()
        .from(characters)
        .where(eq(characters.id, input.characterId))
        .for('update');
      if (character === undefined) {
        throw new AssetError('INVALID_SESSION');
      }

      const inserted = await this.claimCommand(tx, input.characterId, 'shop_buy', input.commandId);
      if (!inserted) {
        const current = await this.loadAssetsWithin(tx, input.characterId);
        return {
          snapshot: current.snapshot,
          stats: current.stats,
          deduplicated: true,
          purchased: null,
        };
      }

      const definition = this.content.items[input.templateId];
      if (definition === undefined || itemBuyPrice(definition) <= 0) {
        throw new AssetError('NOT_SOLD_HERE');
      }
      if (definition.classId !== undefined && definition.classId !== character.classId) {
        throw new AssetError('CLASS_RESTRICTED');
      }
      if (!isShopQuantityAllowed(definition, input.quantity)) {
        throw new AssetError('INVALID_QUANTITY');
      }

      const unitPrice = itemBuyPrice(definition);
      const totalCost = purchaseCost(definition, input.quantity);

      // Conditional update makes the balance check and the debit one atomic
      // step; a concurrent purchase can never drive the wallet negative.
      const [wallet] = await tx
        .update(wallets)
        .set({
          balance: sql`${wallets.balance} - ${totalCost}`,
          version: sql`${wallets.version} + 1`,
          updatedAt: now,
        })
        .where(and(eq(wallets.characterId, input.characterId), gte(wallets.balance, totalCost)))
        .returning({ balance: wallets.balance });
      if (wallet === undefined) {
        throw new AssetError('INSUFFICIENT_GOLD');
      }

      const inventory = await listInventoryItems(tx, input.characterId);
      const placement = findInventoryPlacement(
        {
          items: inventory.map((entry) => ({
            itemId: entry.id,
            templateId: entry.templateId,
            quantity: entry.quantity,
            slotIndex: entry.slotIndex ?? 0,
          })),
          templateId: input.templateId,
          quantity: input.quantity,
          capacity: INVENTORY_CAPACITY,
        },
        this.content.items,
      );
      if (placement === null) {
        throw new AssetError('INVENTORY_FULL');
      }

      if (placement.kind === 'merge') {
        await tx
          .update(itemInstances)
          .set({
            quantity: sql`${itemInstances.quantity} + ${input.quantity}`,
            version: sql`${itemInstances.version} + 1`,
            updatedAt: now,
          })
          .where(eq(itemInstances.id, placement.targetItemId));
      } else {
        await tx.insert(itemInstances).values({
          templateId: input.templateId,
          characterId: input.characterId,
          container: 'inventory',
          slotIndex: placement.slotIndex,
          quantity: input.quantity,
          createdAt: now,
          updatedAt: now,
        });
      }

      await tx.insert(currencyLedger).values({
        characterId: input.characterId,
        currencyType: 'gold',
        delta: -totalCost,
        balanceAfter: wallet.balance,
        reason: 'shop_purchase',
        referenceId: `${input.merchantId}:${input.templateId}`,
        // Include the kind: asset_commands claims are kind-scoped, so the same
        // commandId must also produce distinct ledger keys for buy and sell.
        idempotencyKey: `shop_buy:${input.characterId}:${input.commandId}:gold`,
        createdAt: now,
      });

      const loaded = await this.loadAssetsWithin(tx, input.characterId);
      return {
        snapshot: loaded.snapshot,
        stats: loaded.stats,
        deduplicated: false,
        purchased: {
          templateId: input.templateId,
          quantity: input.quantity,
          unitPrice,
          totalCost,
        },
      };
    });
  }

  async sell(input: SellInput): Promise<ShopSellOutcome> {
    const now = this.now();
    return this.db.transaction(async (tx) => {
      const [character] = await tx
        .select()
        .from(characters)
        .where(eq(characters.id, input.characterId))
        .for('update');
      if (character === undefined) {
        throw new AssetError('INVALID_SESSION');
      }

      const inserted = await this.claimCommand(tx, input.characterId, 'shop_sell', input.commandId);
      if (!inserted) {
        const current = await this.loadAssetsWithin(tx, input.characterId);
        return {
          snapshot: current.snapshot,
          stats: current.stats,
          deduplicated: true,
          sold: null,
        };
      }

      const [item] = await tx
        .select()
        .from(itemInstances)
        .where(eq(itemInstances.id, input.itemId))
        .for('update');
      if (
        item === undefined ||
        item.characterId !== input.characterId ||
        item.container !== 'inventory'
      ) {
        throw new AssetError('ITEM_NOT_FOUND');
      }

      const definition = requireItem(item.templateId, this.content.items);
      const unitPrice = itemSellPrice(definition);
      if (unitPrice <= 0) {
        throw new AssetError('CANNOT_SELL');
      }
      if (!isShopQuantityAllowed(definition, input.quantity) || input.quantity > item.quantity) {
        throw new AssetError('INVALID_QUANTITY');
      }

      const totalValue = saleValue(definition, input.quantity);
      if (input.quantity === item.quantity) {
        await tx.delete(itemInstances).where(eq(itemInstances.id, item.id));
      } else {
        await tx
          .update(itemInstances)
          .set({
            quantity: sql`${itemInstances.quantity} - ${input.quantity}`,
            version: sql`${itemInstances.version} + 1`,
            updatedAt: now,
          })
          .where(eq(itemInstances.id, item.id));
      }

      const [wallet] = await tx
        .insert(wallets)
        .values({
          characterId: input.characterId,
          balance: totalValue,
          version: 1,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: wallets.characterId,
          set: {
            balance: sql`${wallets.balance} + ${totalValue}`,
            version: sql`${wallets.version} + 1`,
            updatedAt: now,
          },
        })
        .returning({ balance: wallets.balance });
      if (wallet === undefined) {
        throw new AssetError('SERVICE_UNAVAILABLE');
      }

      await tx.insert(currencyLedger).values({
        characterId: input.characterId,
        currencyType: 'gold',
        delta: totalValue,
        balanceAfter: wallet.balance,
        reason: 'shop_sale',
        referenceId: `${input.merchantId}:${item.id}`,
        idempotencyKey: `shop_sell:${input.characterId}:${input.commandId}:gold`,
        createdAt: now,
      });

      const loaded = await this.loadAssetsWithin(tx, input.characterId);
      return {
        snapshot: loaded.snapshot,
        stats: loaded.stats,
        deduplicated: false,
        sold: {
          itemId: item.id,
          templateId: item.templateId,
          quantity: input.quantity,
          unitPrice,
          totalValue,
        },
      };
    });
  }

  /**
   * Settles one face-to-face trade atomically (ADR-050). Both character rows
   * are locked in UUID order before anything else, so two crossed trades cannot
   * deadlock; every offered row, wallet and ledger entry then changes inside
   * the same transaction. The room has already verified ownership in memory,
   * but this transaction re-checks everything against PostgreSQL because the
   * offer is only a client-observed intention.
   */
  async settleTrade(input: TradeSettlementInput): Promise<TradeSettlementOutcome> {
    const now = this.now();
    const [left, right] = [...input.sides].sort((a, b) =>
      a.characterId < b.characterId ? -1 : a.characterId > b.characterId ? 1 : 0,
    ) as [TradeSettlementSide, TradeSettlementSide];
    if (left.characterId === right.characterId) {
      throw new AssetError('TRADE_SELF');
    }
    for (const side of [left, right]) {
      if (
        side.items.length > TRADE_MAX_ITEM_STACKS ||
        !Number.isSafeInteger(side.gold) ||
        side.gold < 0 ||
        side.gold > TRADE_MAX_GOLD
      ) {
        throw new AssetError('INVALID_QUANTITY');
      }
      if (new Set(side.items.map((entry) => entry.itemId)).size !== side.items.length) {
        throw new AssetError('TRADE_ITEM_UNAVAILABLE');
      }
    }

    return this.db.transaction(async (tx) => {
      const lockedCharacters = await tx
        .select({ id: characters.id })
        .from(characters)
        .where(inArray(characters.id, [left.characterId, right.characterId]))
        .orderBy(asc(characters.id))
        .for('update');
      if (lockedCharacters.length !== 2) {
        throw new AssetError('INVALID_SESSION');
      }

      const leftClaimed = await this.claimCommand(
        tx,
        left.characterId,
        'trade_settle',
        input.tradeId,
      );
      const rightClaimed = await this.claimCommand(
        tx,
        right.characterId,
        'trade_settle',
        input.tradeId,
      );
      if (leftClaimed !== rightClaimed) {
        throw new AssetError('SERVICE_UNAVAILABLE');
      }
      if (!leftClaimed) {
        const leftAssets = await this.loadAssetsWithin(tx, left.characterId);
        const rightAssets = await this.loadAssetsWithin(tx, right.characterId);
        return {
          deduplicated: true,
          sides: [
            {
              characterId: left.characterId,
              snapshot: leftAssets.snapshot,
              stats: leftAssets.stats,
            },
            {
              characterId: right.characterId,
              snapshot: rightAssets.snapshot,
              stats: rightAssets.stats,
            },
          ],
        };
      }

      const itemIds = [...left.items, ...right.items].map((entry) => entry.itemId);
      const itemRows =
        itemIds.length === 0
          ? []
          : await tx
              .select()
              .from(itemInstances)
              .where(inArray(itemInstances.id, itemIds))
              .orderBy(asc(itemInstances.id))
              .for('update');
      const itemById = new Map(itemRows.map((row) => [row.id, row]));
      for (const side of [left, right]) {
        for (const entry of side.items) {
          const row = itemById.get(entry.itemId);
          const definition = row === undefined ? undefined : this.content.items[row.templateId];
          if (
            row === undefined ||
            definition === undefined ||
            row.characterId !== side.characterId ||
            row.container !== 'inventory' ||
            row.quantity !== entry.quantity ||
            !isTradeableItem(definition)
          ) {
            throw new AssetError('TRADE_ITEM_UNAVAILABLE');
          }
        }
      }

      const walletRows = await tx
        .select()
        .from(wallets)
        .where(inArray(wallets.characterId, [left.characterId, right.characterId]))
        .orderBy(asc(wallets.characterId))
        .for('update');
      const walletByCharacter = new Map(walletRows.map((row) => [row.characterId, row]));
      for (const side of [left, right]) {
        const balance = walletByCharacter.get(side.characterId)?.balance ?? 0;
        if (side.gold > balance) {
          throw new AssetError('INSUFFICIENT_GOLD');
        }
      }

      // Simulate the receiver's inventory after its own offers leave, then plan
      // each incoming stack against those slots. The real rows are parked in
      // the next step, so a swap never needs two rows in one slot.
      const leftInventory = await listInventoryItems(tx, left.characterId);
      const rightInventory = await listInventoryItems(tx, right.characterId);
      const leftOffered = new Set(left.items.map((entry) => entry.itemId));
      const rightOffered = new Set(right.items.map((entry) => entry.itemId));
      type SimulatedStack = {
        itemId: string;
        templateId: string;
        quantity: number;
        slotIndex: number;
      };
      const leftState: SimulatedStack[] = leftInventory
        .filter((row) => !leftOffered.has(row.id))
        .map((row) => ({
          itemId: row.id,
          templateId: row.templateId,
          quantity: row.quantity,
          slotIndex: row.slotIndex ?? 0,
        }));
      const rightState: SimulatedStack[] = rightInventory
        .filter((row) => !rightOffered.has(row.id))
        .map((row) => ({
          itemId: row.id,
          templateId: row.templateId,
          quantity: row.quantity,
          slotIndex: row.slotIndex ?? 0,
        }));

      type PlacementPlan = {
        source: ItemInstance;
        toCharacterId: string;
        placement: ReturnType<typeof findInventoryPlacement>;
      };
      const plans: PlacementPlan[] = [];
      const planIncoming = (
        offeredIds: readonly string[],
        toCharacterId: string,
        state: SimulatedStack[],
      ): void => {
        const offeredRows = offeredIds
          .map((itemId) => itemById.get(itemId))
          .filter((row): row is ItemInstance => row !== undefined)
          .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
        for (const row of offeredRows) {
          const placement = findInventoryPlacement(
            {
              items: state,
              templateId: row.templateId,
              quantity: row.quantity,
              capacity: INVENTORY_CAPACITY,
            },
            this.content.items,
          );
          if (placement === null) {
            throw new AssetError('INVENTORY_FULL');
          }
          if (placement.kind === 'merge') {
            const target = state.find((entry) => entry.itemId === placement.targetItemId);
            if (target === undefined) {
              throw new AssetError('SERVICE_UNAVAILABLE');
            }
            target.quantity = placement.resultingQuantity;
          } else {
            state.push({
              itemId: row.id,
              templateId: row.templateId,
              quantity: row.quantity,
              slotIndex: placement.slotIndex,
            });
          }
          plans.push({ source: row, toCharacterId, placement });
        }
      };
      planIncoming(
        left.items.map((entry) => entry.itemId),
        right.characterId,
        rightState,
      );
      planIncoming(
        right.items.map((entry) => entry.itemId),
        left.characterId,
        leftState,
      );

      const moves: {
        source: ItemInstance;
        toCharacterId: string;
        slotIndex: number;
      }[] = [];
      const merges: { source: ItemInstance; targetItemId: string }[] = [];
      for (const plan of plans) {
        if (plan.placement === null) {
          throw new AssetError('SERVICE_UNAVAILABLE');
        }
        if (plan.placement.kind === 'merge') {
          merges.push({ source: plan.source, targetItemId: plan.placement.targetItemId });
        } else {
          moves.push({
            source: plan.source,
            toCharacterId: plan.toCharacterId,
            slotIndex: plan.placement.slotIndex,
          });
        }
      }

      // A swap can make two rows want each other's slot. Park every moving row
      // under its new owner with a unique negative slot first, consume merged
      // stacks next, then assign the real slots. Item ids survive the move, so
      // drop/audit rows that reference an instance stay valid.
      for (const [index, move] of moves.entries()) {
        await tx
          .update(itemInstances)
          .set({
            characterId: move.toCharacterId,
            slotIndex: -(index + 1),
            version: sql`${itemInstances.version} + 1`,
            updatedAt: now,
          })
          .where(eq(itemInstances.id, move.source.id));
      }
      for (const merge of merges) {
        await tx.delete(itemInstances).where(eq(itemInstances.id, merge.source.id));
        await tx
          .update(itemInstances)
          .set({
            quantity: sql`${itemInstances.quantity} + ${merge.source.quantity}`,
            version: sql`${itemInstances.version} + 1`,
            updatedAt: now,
          })
          .where(eq(itemInstances.id, merge.targetItemId));
      }
      for (const move of moves) {
        await tx
          .update(itemInstances)
          .set({
            slotIndex: move.slotIndex,
            version: sql`${itemInstances.version} + 1`,
            updatedAt: now,
          })
          .where(eq(itemInstances.id, move.source.id));
      }

      const walletDeltas: [TradeSettlementSide, number][] = [
        [left, right.gold - left.gold],
        [right, left.gold - right.gold],
      ];
      for (const [side, delta] of walletDeltas) {
        if (delta === 0) {
          continue;
        }
        const wallet = walletByCharacter.get(side.characterId);
        const balanceAfter = (wallet?.balance ?? 0) + delta;
        if (balanceAfter < 0) {
          throw new AssetError('INSUFFICIENT_GOLD');
        }
        if (wallet === undefined) {
          await tx.insert(wallets).values({
            characterId: side.characterId,
            balance: balanceAfter,
            version: 1,
            updatedAt: now,
          });
        } else {
          await tx
            .update(wallets)
            .set({
              balance: balanceAfter,
              version: sql`${wallets.version} + 1`,
              updatedAt: now,
            })
            .where(eq(wallets.characterId, side.characterId));
        }
        await tx.insert(currencyLedger).values({
          characterId: side.characterId,
          currencyType: 'gold',
          delta,
          balanceAfter,
          reason: 'trade_settle',
          referenceId: input.tradeId,
          idempotencyKey: `trade_settle:${side.characterId}:${input.tradeId}:gold`,
          createdAt: now,
        });
      }

      const leftAssets = await this.loadAssetsWithin(tx, left.characterId);
      const rightAssets = await this.loadAssetsWithin(tx, right.characterId);
      return {
        deduplicated: false,
        sides: [
          {
            characterId: left.characterId,
            snapshot: leftAssets.snapshot,
            stats: leftAssets.stats,
          },
          {
            characterId: right.characterId,
            snapshot: rightAssets.snapshot,
            stats: rightAssets.stats,
          },
        ],
      };
    });
  }

  /**
   * Accepts one quest at its giver. The Room validates NPC proximity; this
   * transaction re-checks the level and prerequisite chain so a forged command
   * cannot skip the story (ADR-034).
   */
  async acceptQuest(input: QuestCommandInput): Promise<AcceptQuestOutcome> {
    const now = this.now();
    return this.db.transaction(async (tx) => {
      const [character] = await tx
        .select()
        .from(characters)
        .where(eq(characters.id, input.characterId))
        .for('update');
      if (character === undefined) {
        throw new AssetError('INVALID_SESSION');
      }

      const quest = this.content.quests?.[input.questId];
      if (quest === undefined) {
        throw new AssetError('QUEST_UNAVAILABLE');
      }
      // A daily quest without a reset rule can never be scheduled; treat it as
      // unavailable instead of failing the transaction later (ADR-038).
      const periodKey = this.periodKeyForQuest(quest, now);
      if (periodKey === null) {
        throw new AssetError('QUEST_UNAVAILABLE');
      }

      const inserted = await this.claimCommand(
        tx,
        input.characterId,
        'quest_accept',
        input.commandId,
      );
      if (!inserted) {
        const existing = await findCharacterQuestForUpdate(
          tx,
          input.characterId,
          input.questId,
          periodKey,
        );
        if (existing === undefined) {
          throw new AssetError('QUEST_UNAVAILABLE');
        }
        const current = await this.loadAssetsWithin(tx, input.characterId);
        return {
          snapshot: current.snapshot,
          stats: current.stats,
          deduplicated: true,
          record: questRecordOf(existing),
        };
      }

      if (character.level < quest.levelRequirement) {
        throw new AssetError('QUEST_UNAVAILABLE');
      }
      const existing = await findCharacterQuestForUpdate(
        tx,
        input.characterId,
        input.questId,
        periodKey,
      );
      if (existing !== undefined) {
        throw new AssetError(
          existing.status === 'claimed' ? 'QUEST_ALREADY_CLAIMED' : 'QUEST_UNAVAILABLE',
        );
      }
      if (quest.prerequisiteQuestId !== undefined) {
        // Content validation forbids daily quests as prerequisites, so chain
        // steps only ever look at one-time rows (periodKey '').
        const prerequisite = await findCharacterQuestForUpdate(
          tx,
          input.characterId,
          quest.prerequisiteQuestId,
          '',
        );
        if (prerequisite?.status !== 'claimed') {
          throw new AssetError('QUEST_UNAVAILABLE');
        }
      }

      const row = await insertCharacterQuest(tx, {
        characterId: input.characterId,
        questId: quest.id,
        periodKey,
        now,
      });
      if (row === undefined) {
        throw new AssetError('SERVICE_UNAVAILABLE');
      }

      const loaded = await this.loadAssetsWithin(tx, input.characterId);
      return {
        snapshot: loaded.snapshot,
        stats: loaded.stats,
        deduplicated: false,
        record: questRecordOf(row),
      };
    });
  }

  /**
   * Marks an arrival quest completed once the room has observed the character
   * inside its target area. Repeated observations are harmless: only an active
   * row is advanced, under the same character lock as accept and claim.
   */
  async completeReachQuest(input: {
    characterId: string;
    questId: string;
  }): Promise<ReachQuestOutcome> {
    const now = this.now();
    return this.db.transaction(async (tx) => {
      const [character] = await tx
        .select()
        .from(characters)
        .where(eq(characters.id, input.characterId))
        .for('update');
      if (character === undefined) {
        throw new AssetError('INVALID_SESSION');
      }

      const quest = this.content.quests?.[input.questId];
      if (quest === undefined || quest.objective.kind !== 'reach') {
        throw new AssetError('QUEST_UNAVAILABLE');
      }
      const periodKey = this.periodKeyForQuest(quest, now);
      if (periodKey === null) {
        throw new AssetError('QUEST_UNAVAILABLE');
      }

      const record = await findCharacterQuestForUpdate(
        tx,
        input.characterId,
        input.questId,
        periodKey,
      );
      if (record === undefined) {
        throw new AssetError('QUEST_NOT_ACTIVE');
      }
      if (record.status === 'completed' || record.status === 'claimed') {
        return { record: questRecordOf(record), completedNow: false };
      }

      const updated = await advanceCharacterQuest(tx, {
        characterId: input.characterId,
        questId: quest.id,
        periodKey,
        progress: 1,
        completed: true,
        now,
      });
      if (updated === undefined) {
        throw new AssetError('SERVICE_UNAVAILABLE');
      }
      return { record: questRecordOf(updated), completedNow: true };
    });
  }

  /**
   * Turns in a completed quest: experience, gold and items commit together with
   * the claimed row. A broken bag or a duplicate command never pays twice.
   */
  async claimQuest(input: QuestCommandInput): Promise<ClaimQuestOutcome> {
    const now = this.now();
    return this.db.transaction(async (tx) => {
      const [character] = await tx
        .select()
        .from(characters)
        .where(eq(characters.id, input.characterId))
        .for('update');
      if (character === undefined) {
        throw new AssetError('INVALID_SESSION');
      }

      const quest = this.content.quests?.[input.questId];
      if (quest === undefined) {
        throw new AssetError('QUEST_UNAVAILABLE');
      }
      const periodKey = this.periodKeyForQuest(quest, now);
      if (periodKey === null) {
        throw new AssetError('QUEST_UNAVAILABLE');
      }

      const inserted = await this.claimCommand(
        tx,
        input.characterId,
        'quest_claim',
        input.commandId,
      );
      if (!inserted) {
        const existing = await findCharacterQuestForUpdate(
          tx,
          input.characterId,
          input.questId,
          periodKey,
        );
        if (existing === undefined) {
          throw new AssetError('QUEST_NOT_ACTIVE');
        }
        const current = await this.loadAssetsWithin(tx, input.characterId);
        return {
          snapshot: current.snapshot,
          stats: current.stats,
          deduplicated: true,
          record: questRecordOf(existing),
          leveledUp: false,
          expGained: 0,
          goldGained: 0,
        };
      }

      const record = await findCharacterQuestForUpdate(
        tx,
        input.characterId,
        input.questId,
        periodKey,
      );
      if (record === undefined) {
        throw new AssetError('QUEST_NOT_ACTIVE');
      }
      if (record.status === 'claimed') {
        throw new AssetError('QUEST_ALREADY_CLAIMED');
      }
      if (quest.objective.kind === 'collect') {
        // Turn-in consumes the bag items in the same transaction that pays the
        // reward, so a retry or a concurrent claim can never pay twice (ADR-040).
        const consumed = await this.consumeCollectItems(
          tx,
          character.id,
          quest.objective.templateId,
          quest.objective.count,
          now,
        );
        if (!consumed) {
          throw new AssetError('QUEST_ITEMS_MISSING');
        }
        if (record.status === 'active') {
          const completed = await advanceCharacterQuest(tx, {
            characterId: input.characterId,
            questId: quest.id,
            periodKey,
            progress: quest.objective.count,
            completed: true,
            now,
          });
          if (completed === undefined) {
            throw new AssetError('SERVICE_UNAVAILABLE');
          }
        }
      } else if (record.status !== 'completed') {
        throw new AssetError('QUEST_NOT_COMPLETE');
      }

      const progression = applyExperience(character.level, character.exp, quest.rewards.exp);
      const leveledUp = progression.levelsGained > 0;
      const equipped = await listEquippedItems(tx, character.id);
      const stats = statsWithEquipment(
        combatStatsFor(character.classId, progression.level, this.content),
        equipmentBonuses(
          equipped.map((entry) => requireItem(entry.templateId, this.content.items)),
        ),
      );
      const hp = leveledUp ? stats.maxHp : clamp(character.hp, 0, stats.maxHp);
      const mp = leveledUp ? stats.maxMp : clamp(character.mp, 0, stats.maxMp);

      await tx
        .update(characters)
        .set({
          level: progression.level,
          exp: progression.exp,
          hp,
          mp,
          maxHp: stats.maxHp,
          maxMp: stats.maxMp,
          version: sql`${characters.version} + 1`,
          updatedAt: now,
        })
        .where(eq(characters.id, character.id));

      if (quest.rewards.gold > 0) {
        const [wallet] = await tx
          .insert(wallets)
          .values({
            characterId: character.id,
            balance: quest.rewards.gold,
            version: 1,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: wallets.characterId,
            set: {
              balance: sql`${wallets.balance} + ${quest.rewards.gold}`,
              version: sql`${wallets.version} + 1`,
              updatedAt: now,
            },
          })
          .returning({ balance: wallets.balance });
        if (wallet === undefined) {
          throw new AssetError('SERVICE_UNAVAILABLE');
        }
        await tx.insert(currencyLedger).values({
          characterId: character.id,
          currencyType: 'gold',
          delta: quest.rewards.gold,
          balanceAfter: wallet.balance,
          reason: 'quest_reward',
          referenceId: quest.id,
          idempotencyKey: `quest_claim:${input.characterId}:${input.commandId}:gold`,
          createdAt: now,
        });
      }

      await this.placeQuestRewardItems(tx, character.id, quest.rewards.items, now);

      const claimed = await markCharacterQuestClaimed(tx, {
        characterId: input.characterId,
        questId: quest.id,
        periodKey,
        now,
      });
      if (claimed === undefined) {
        throw new AssetError('SERVICE_UNAVAILABLE');
      }

      const loaded = await this.loadAssetsWithin(tx, input.characterId);
      return {
        snapshot: loaded.snapshot,
        stats: loaded.stats,
        deduplicated: false,
        record: questRecordOf(claimed),
        leveledUp,
        expGained: quest.rewards.exp,
        goldGained: quest.rewards.gold,
      };
    });
  }

  /**
   * Removes `count` items of one template from the bag, earliest slot first.
   * Returns false without touching anything when the bag holds too few, so the
   * caller can reject the turn-in cleanly.
   */
  private async consumeCollectItems(
    executor: DbExecutor,
    characterId: string,
    templateId: string,
    count: number,
    now: Date,
  ): Promise<boolean> {
    const stacks = await lockInventoryItemsByTemplate(executor, characterId, templateId);
    const total = stacks.reduce((sum, stack) => sum + stack.quantity, 0);
    if (total < count) {
      return false;
    }
    let remaining = count;
    for (const stack of stacks) {
      if (remaining <= 0) {
        break;
      }
      if (stack.quantity <= remaining) {
        await executor.delete(itemInstances).where(eq(itemInstances.id, stack.id));
        remaining -= stack.quantity;
      } else {
        await executor
          .update(itemInstances)
          .set({
            quantity: sql`${itemInstances.quantity} - ${remaining}`,
            version: sql`${itemInstances.version} + 1`,
            updatedAt: now,
          })
          .where(eq(itemInstances.id, stack.id));
        remaining = 0;
      }
    }
    return true;
  }

  private async advanceQuestsOnKill(
    executor: DbExecutor,
    characterId: string,
    monsterId: string,
    now: Date,
  ): Promise<KillQuestUpdate[]> {
    const quests = this.content.quests;
    if (quests === undefined) {
      return [];
    }
    const periodKey = this.currentPeriodKey(now);
    const records = await listCharacterQuestsForPeriod(executor, characterId, periodKey);
    const updates: KillQuestUpdate[] = [];
    for (const row of records) {
      const quest = quests[row.questId];
      if (quest === undefined) {
        continue;
      }
      const change = advanceQuestOnKill(quest, questRecordOf(row), monsterId, periodKey);
      if (change === null) {
        continue;
      }
      const updated = await advanceCharacterQuest(executor, {
        characterId,
        questId: quest.id,
        periodKey: row.periodKey,
        progress: change.progress,
        completed: change.completed,
        now,
      });
      if (updated !== undefined) {
        updates.push({ record: questRecordOf(updated), completedNow: change.completed });
      }
    }
    return updates;
  }

  private async placeQuestRewardItems(
    executor: DbExecutor,
    characterId: string,
    items: readonly { templateId: string; quantity: number }[],
    now: Date,
  ): Promise<void> {
    if (items.length === 0) {
      return;
    }
    const inventory = await listInventoryItems(executor, characterId);
    const simulated = inventory.map((entry) => ({
      itemId: entry.id,
      templateId: entry.templateId,
      quantity: entry.quantity,
      slotIndex: entry.slotIndex ?? 0,
    }));
    for (const reward of items) {
      const placement = findInventoryPlacement(
        {
          items: simulated,
          templateId: reward.templateId,
          quantity: reward.quantity,
          capacity: INVENTORY_CAPACITY,
        },
        this.content.items,
      );
      if (placement === null) {
        throw new AssetError('INVENTORY_FULL');
      }
      if (placement.kind === 'merge') {
        await executor
          .update(itemInstances)
          .set({
            quantity: sql`${itemInstances.quantity} + ${reward.quantity}`,
            version: sql`${itemInstances.version} + 1`,
            updatedAt: now,
          })
          .where(eq(itemInstances.id, placement.targetItemId));
        const target = simulated.find((entry) => entry.itemId === placement.targetItemId);
        if (target !== undefined) {
          target.quantity = placement.resultingQuantity;
        }
        continue;
      }
      await executor.insert(itemInstances).values({
        templateId: reward.templateId,
        characterId,
        container: 'inventory',
        slotIndex: placement.slotIndex,
        quantity: reward.quantity,
        createdAt: now,
        updatedAt: now,
      });
      simulated.push({
        itemId: `reward-${String(simulated.length)}-${reward.templateId}`,
        templateId: reward.templateId,
        quantity: reward.quantity,
        slotIndex: placement.slotIndex,
      });
    }
  }

  private async claimCommand(
    executor: DbExecutor,
    characterId: string,
    kind: AssetCommandKind,
    commandId: string,
  ): Promise<boolean> {
    const inserted = await executor
      .insert(assetCommands)
      .values({
        characterId,
        kind,
        // Scope the key to the character: a client-generated command id is not
        // globally unique, and two players may legitimately reuse one (TD-DATA-06).
        idempotencyKey: `cmd:${characterId}:${kind}:${commandId}`,
        createdAt: this.now(),
      })
      .onConflictDoNothing({ target: assetCommands.idempotencyKey })
      .returning({ id: assetCommands.id });
    return inserted.length > 0;
  }

  private async loadAssetsWithin(executor: DbExecutor, characterId: string): Promise<LoadedAssets> {
    const [character] = await executor
      .select()
      .from(characters)
      .where(eq(characters.id, characterId))
      .limit(1);
    if (character === undefined) {
      throw new AssetError('INVALID_SESSION');
    }

    const inventory = await listInventoryItems(executor, characterId);
    const equipped = await listEquippedItems(executor, characterId);
    const wallet = await findWallet(executor, characterId);
    const equippedDefinitions = equipped.map((entry) =>
      requireItem(entry.templateId, this.content.items),
    );
    const stats = statsWithEquipment(
      combatStatsFor(character.classId, character.level, this.content),
      equipmentBonuses(equippedDefinitions),
    );
    const weapon = equipped.find((entry) => entry.equipSlot === 'weapon');
    const armor = equipped.find((entry) => entry.equipSlot === 'armor');

    const snapshot: InventorySnapshot = {
      characterId: character.id,
      level: character.level,
      exp: character.exp,
      expToNextLevel: experienceForNextLevel(character.level),
      gold: wallet?.balance ?? 0,
      hp: clamp(character.hp, 0, stats.maxHp),
      maxHp: stats.maxHp,
      mp: clamp(character.mp, 0, stats.maxMp),
      maxMp: stats.maxMp,
      attack: stats.attack,
      defense: stats.defense,
      capacity: INVENTORY_CAPACITY,
      items: inventory.map((entry) => itemView(entry, this.content.items)),
      equipment: {
        weapon: weapon === undefined ? null : itemView(weapon, this.content.items),
        armor: armor === undefined ? null : itemView(armor, this.content.items),
      },
    };

    return { character, snapshot, stats };
  }
}
