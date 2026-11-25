import {
  INVENTORY_CAPACITY,
  LOOT_EXPIRY_MS,
  LOOT_OWNER_WINDOW_MS,
  type AssetCommandKind,
  type ContentBundle,
  type EquipmentSlot,
  type InventorySnapshot,
  type ItemView,
  type LootClaimed,
} from '@web-legend/contracts';
import {
  DEFAULT_CONTENT_BUNDLE,
  applyExperience,
  canEquip,
  combatStatsFor,
  equipmentBonuses,
  experienceForNextLevel,
  findInventoryPlacement,
  isConsumable,
  requireItem,
  requireLootTable,
  rollLoot,
  statsWithEquipment,
  type CombatStats,
  type ItemCatalog,
  type Rng,
} from '@web-legend/game-domain';
import {
  assetCommands,
  characters,
  currencyLedger,
  findWallet,
  itemInstances,
  listEquippedItems,
  listInventoryItems,
  listOpenWorldDrops,
  wallets,
  worldDrops,
  type Character,
  type Database,
  type DbExecutor,
  type ItemInstance,
} from '@web-legend/persistence';
import { and, eq, sql } from 'drizzle-orm';

import { AssetError } from './errors';

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
  ownerId: string;
  expiresAt: number;
};

export type KillRewardOutcome = {
  snapshot: InventorySnapshot;
  stats: CombatStats;
  expGained: number;
  goldGained: number;
  leveledUp: boolean;
  drops: LootDropView[];
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

export type PickupInput = {
  characterId: string;
  commandId: string;
  dropId: string;
  mapId: string;
};

export type EquipInput = { characterId: string; commandId: string; itemId: string };
export type UnequipInput = { characterId: string; commandId: string; slot: EquipmentSlot };
export type UseInput = {
  characterId: string;
  commandId: string;
  itemId: string;
  vitals: { hp: number; mp: number };
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
    levelRequirement: definition.levelRequirement,
    attackBonus: definition.attackBonus,
    defenseBonus: definition.defenseBonus,
    maxHpBonus: definition.maxHpBonus,
    maxMpBonus: definition.maxMpBonus,
    healHp: definition.healHp,
    healMp: definition.healMp,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
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

  /** Unclaimed drops used to restore a room's loot after a restart. */
  async loadOpenDrops(mapId: string): Promise<LootDropView[]> {
    const now = this.now();
    const rows = await listOpenWorldDrops(this.db, mapId, now);
    return rows.map(({ drop, item }) => {
      const definition = requireItem(item.templateId, this.content.items);
      const ownerActive =
        drop.ownerCharacterId !== null &&
        drop.ownerExpiresAt !== null &&
        drop.ownerExpiresAt.getTime() > now.getTime();
      return {
        dropId: drop.id,
        itemId: item.id,
        templateId: item.templateId,
        displayName: definition.name,
        quantity: item.quantity,
        x: drop.x,
        y: drop.y,
        ownerId: ownerActive && drop.ownerCharacterId !== null ? drop.ownerCharacterId : '',
        expiresAt: drop.expiresAt.getTime(),
      };
    });
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

      const [character] = await tx
        .select()
        .from(characters)
        .where(eq(characters.id, input.characterId))
        .for('update');
      if (character === undefined) {
        throw new AssetError('INVALID_SESSION');
      }

      const roll = rollLoot(table, this.rng);
      const progression = applyExperience(character.level, character.exp, roll.exp);
      const leveledUp = progression.levelsGained > 0;
      const base = combatStatsFor(character.classId, progression.level, this.content);
      const hp = leveledUp ? base.maxHp : clamp(character.hp, 0, base.maxHp);
      const mp = leveledUp ? base.maxMp : clamp(character.mp, 0, base.maxMp);

      await tx
        .update(characters)
        .set({
          level: progression.level,
          exp: progression.exp,
          hp,
          mp,
          maxHp: base.maxHp,
          maxMp: base.maxMp,
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
        const [drop] = await tx
          .insert(worldDrops)
          .values({
            mapId: input.mapId,
            x: input.x + offset.x,
            y: input.y + offset.y,
            itemInstanceId: item.id,
            ownerCharacterId: character.id,
            ownerExpiresAt: new Date(now.getTime() + LOOT_OWNER_WINDOW_MS),
            expiresAt: new Date(now.getTime() + LOOT_EXPIRY_MS),
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
          ownerId: character.id,
          expiresAt: drop.expiresAt.getTime(),
        });
      }

      const loaded = await this.loadAssetsWithin(tx, character.id);
      return {
        snapshot: loaded.snapshot,
        stats: loaded.stats,
        expGained: roll.exp,
        goldGained: roll.gold,
        leveledUp,
        drops,
      };
    });
  }

  async pickup(input: PickupInput): Promise<PickupOutcome> {
    const now = this.now();
    return this.db.transaction(async (tx) => {
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
      if (
        drop.ownerCharacterId !== null &&
        drop.ownerCharacterId !== input.characterId &&
        drop.ownerExpiresAt !== null &&
        drop.ownerExpiresAt.getTime() > now.getTime()
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

      const [character] = await tx
        .select()
        .from(characters)
        .where(eq(characters.id, input.characterId))
        .for('update');
      if (character === undefined) {
        throw new AssetError('INVALID_SESSION');
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
      if (!(await this.claimCommand(tx, input.characterId, 'inventory_equip', input.commandId))) {
        const current = await this.loadAssetsWithin(tx, input.characterId);
        return { snapshot: current.snapshot, stats: current.stats, deduplicated: true };
      }

      const [character] = await tx
        .select()
        .from(characters)
        .where(eq(characters.id, input.characterId))
        .for('update');
      if (character === undefined) {
        throw new AssetError('INVALID_SESSION');
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
      if (!(await this.claimCommand(tx, input.characterId, 'inventory_unequip', input.commandId))) {
        const current = await this.loadAssetsWithin(tx, input.characterId);
        return { snapshot: current.snapshot, stats: current.stats, deduplicated: true };
      }

      // Serialize every bag mutation for this character so two operations can
      // never pick the same free slot.
      const [character] = await tx
        .select()
        .from(characters)
        .where(eq(characters.id, input.characterId))
        .for('update');
      if (character === undefined) {
        throw new AssetError('INVALID_SESSION');
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
      if (!(await this.claimCommand(tx, input.characterId, 'inventory_use', input.commandId))) {
        const current = await this.loadAssetsWithin(tx, input.characterId);
        return { snapshot: current.snapshot, stats: current.stats, deduplicated: true };
      }

      const [character] = await tx
        .select()
        .from(characters)
        .where(eq(characters.id, input.characterId))
        .for('update');
      if (character === undefined) {
        throw new AssetError('INVALID_SESSION');
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
        idempotencyKey: `cmd:${kind}:${commandId}`,
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
