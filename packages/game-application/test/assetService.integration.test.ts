import { randomUUID } from 'node:crypto';

import { INVENTORY_CAPACITY, LOOT_EXPIRY_MS, type ContentBundle } from '@web-legend/contracts';
import {
  DEFAULT_CONTENT_BUNDLE,
  STARTER_KIT,
  combatStatsFor,
  requireItem,
} from '@web-legend/game-domain';
import {
  characters,
  createDatabase,
  currencyLedger,
  insertAccount,
  insertCharacterWithItems,
  itemInstances,
  realms,
  worldDrops,
  type Character,
  type CharacterClassId,
  type Database,
  type DatabaseHandle,
} from '@web-legend/persistence';
import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AssetError, AssetService } from '../src/index';

const databaseUrl = process.env.DATABASE_URL;
const PASSWORD_HASH = 'phase-five-test-hash';
const REALM_CODE = 'classic-01';

function requireDatabaseUrl(): string {
  if (databaseUrl === undefined || databaseUrl.length === 0) {
    throw new Error('DATABASE_URL is required for asset application integration tests');
  }
  return databaseUrl;
}

let sequence = 0;

function suffix(): string {
  sequence += 1;
  return `${randomUUID().replace(/-/gu, '').slice(0, 6)}${sequence.toString(36)}`;
}

async function createCharacter(
  db: Database,
  classId: CharacterClassId,
  options: { level?: number; exp?: number; hp?: number; mp?: number; gold?: number } = {},
): Promise<Character> {
  const [realm] = await db.select().from(realms).where(eq(realms.code, REALM_CODE)).limit(1);
  if (realm === undefined) {
    throw new Error('test realm is missing');
  }
  const token = suffix();
  const account = await insertAccount(db, {
    username: `asset_${token}`.slice(0, 24),
    usernameNormalized: `asset_${token}`.slice(0, 24),
    passwordHash: PASSWORD_HASH,
  });
  const level = options.level ?? 1;
  const stats = combatStatsFor(classId, level);
  const character = await insertCharacterWithItems(
    db,
    {
      accountId: account.id,
      realmId: realm.id,
      name: `A${token}`.slice(0, 12),
      nameNormalized: `a${token}`.slice(0, 12).toLowerCase(),
      classId,
      level,
      exp: options.exp ?? 0,
      hp: options.hp ?? stats.maxHp,
      maxHp: stats.maxHp,
      mp: options.mp ?? stats.maxMp,
      maxMp: stats.maxMp,
      mapId: 'starter_wilds',
      x: 7_500,
      y: 15_500,
      facing: 2,
    },
    STARTER_KIT[classId],
    options.gold ?? 0,
  );
  return character;
}

async function inventoryItem(
  db: Database,
  characterId: string,
  templateId: string,
): Promise<{ id: string; slotIndex: number | null; quantity: number }> {
  const rows = await db
    .select()
    .from(itemInstances)
    .where(eq(itemInstances.characterId, characterId));
  const row = rows.find(
    (entry) => entry.templateId === templateId && entry.container === 'inventory',
  );
  if (row === undefined) {
    throw new Error(`no inventory item "${templateId}"`);
  }
  return { id: row.id, slotIndex: row.slotIndex, quantity: row.quantity };
}

async function ownerDrops(service: AssetService, mapId = 'starter_wilds') {
  const drops = await service.loadOpenDrops(mapId);
  return drops;
}

describe.runIf(databaseUrl !== undefined)('AssetService with PostgreSQL', () => {
  let handle: DatabaseHandle;
  let db: Database;
  let service: AssetService;
  let clock: Date;

  beforeAll(async () => {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Refusing to run database-mutating tests with NODE_ENV=production');
    }
    handle = createDatabase(requireDatabaseUrl(), { max: 10 });
    db = handle.db;
    await db
      .insert(realms)
      .values({ code: REALM_CODE, name: '经典一区', status: 'active' })
      .onConflictDoNothing({ target: realms.code });
    // Start ahead of real time. The test database is shared with game-server
    // integration tests whose rooms purge expired drops on a real clock; a
    // fixture dated in the past would be deleted before this file can assert
    // on it (TD-QA-10).
    clock = new Date(Date.now() + 24 * 60 * 60 * 1_000);
    service = new AssetService(db, { now: () => clock, rng: () => 0 });
  });

  afterAll(async () => {
    await handle?.close();
  });

  it('grants kill rewards once and writes wallet plus ledger atomically', async () => {
    const character = await createCharacter(db, 'warrior');
    const reference = `test-kill-${randomUUID()}`;

    const outcome = await service.grantKillReward({
      characterId: character.id,
      mapId: 'starter_wilds',
      reference,
      monsterTemplateId: 'wild_slime',
      x: 7_500,
      y: 15_500,
    });
    expect(outcome).not.toBeNull();
    expect(outcome?.expGained).toBe(12);
    expect(outcome?.goldGained).toBe(2);
    expect(outcome?.leveledUp).toBe(false);
    expect(outcome?.snapshot.exp).toBe(12);
    expect(outcome?.snapshot.gold).toBe(2);
    expect(outcome?.drops.map((drop) => drop.templateId).sort()).toEqual([
      'slime_gel',
      'small_hp_potion',
    ]);

    const repeat = await service.grantKillReward({
      characterId: character.id,
      mapId: 'starter_wilds',
      reference,
      monsterTemplateId: 'wild_slime',
      x: 7_500,
      y: 15_500,
    });
    expect(repeat).toBeNull();

    const loaded = await service.loadAssets(character.id);
    expect(loaded.snapshot.exp).toBe(12);
    expect(loaded.snapshot.gold).toBe(2);

    const ledger = await db
      .select()
      .from(currencyLedger)
      .where(eq(currencyLedger.characterId, character.id));
    expect(ledger).toHaveLength(1);
    expect(ledger[0]?.delta).toBe(2);
    expect(ledger[0]?.balanceAfter).toBe(2);
    expect(ledger[0]?.idempotencyKey).toBe(`kill:${reference}:gold`);
  });

  it('levels up, refills vitals and recomputes max hp from the level', async () => {
    const character = await createCharacter(db, 'warrior', { exp: 25, hp: 40, mp: 10 });

    const outcome = await service.grantKillReward({
      characterId: character.id,
      mapId: 'starter_wilds',
      reference: `test-level-${randomUUID()}`,
      monsterTemplateId: 'wild_slime',
      x: 7_500,
      y: 15_500,
    });

    const levelTwo = combatStatsFor('warrior', 2);
    expect(outcome?.leveledUp).toBe(true);
    expect(outcome?.snapshot.level).toBe(2);
    expect(outcome?.snapshot.exp).toBe(7);
    expect(outcome?.snapshot.maxHp).toBe(levelTwo.maxHp);
    expect(outcome?.snapshot.hp).toBe(levelTwo.maxHp);
    expect(outcome?.stats.maxHp).toBe(levelTwo.maxHp);

    const [stored] = await db.select().from(characters).where(eq(characters.id, character.id));
    expect(stored?.level).toBe(2);
    expect(stored?.hp).toBe(levelTwo.maxHp);
  });

  it('persists equipment-adjusted maxima after a kill (TD-DATA-01)', async () => {
    const character = await createCharacter(db, 'warrior', {
      level: 3,
      exp: 0,
    });
    const [armor] = await db
      .insert(itemInstances)
      .values({
        templateId: 'leather_armor',
        characterId: character.id,
        container: 'inventory',
        slotIndex: 20,
        quantity: 1,
      })
      .returning();
    expect(armor).toBeDefined();

    await service.equip({
      characterId: character.id,
      commandId: randomUUID(),
      itemId: armor!.id,
    });

    const outcome = await service.grantKillReward({
      characterId: character.id,
      mapId: 'starter_wilds',
      reference: `test-geared-${randomUUID()}`,
      monsterTemplateId: 'wild_slime',
      x: 7_500,
      y: 15_500,
    });
    const expectedMaxHp = combatStatsFor('warrior', 3).maxHp + 15;
    expect(outcome?.snapshot.maxHp).toBe(expectedMaxHp);
    expect(outcome?.stats.maxHp).toBe(expectedMaxHp);

    const [stored] = await db.select().from(characters).where(eq(characters.id, character.id));
    expect(stored?.maxHp).toBe(expectedMaxHp);
    expect(stored?.hp).toBeLessThanOrEqual(expectedMaxHp);
  });

  it('purges expired unclaimed drops and archives claimed history (TD-DATA-02)', async () => {
    const character = await createCharacter(db, 'warrior');
    const reference = `test-purge-${randomUUID()}`;
    const outcome = await service.grantKillReward({
      characterId: character.id,
      mapId: 'starter_wilds',
      reference,
      monsterTemplateId: 'wild_slime',
      x: 7_500,
      y: 15_500,
    });
    const drops = outcome?.drops ?? [];
    expect(drops.length).toBeGreaterThan(0);

    // Claim one drop, leave the rest on the ground, then pass the expiry and
    // the claimed-history retention window in one jump.
    const claimed = drops[0]!;
    await service.pickup({
      characterId: character.id,
      commandId: randomUUID(),
      dropId: claimed.dropId,
      mapId: 'starter_wilds',
    });
    clock = new Date(clock.getTime() + LOOT_EXPIRY_MS + 8 * 24 * 60 * 60 * 1_000);

    const result = await service.purgeExpiredDrops({ mapId: 'starter_wilds' });
    expect(result.removedUnclaimed).toBeGreaterThanOrEqual(drops.length - 1);
    expect(result.archivedClaimed).toBeGreaterThanOrEqual(1);

    const remainingInstances = await db
      .select()
      .from(itemInstances)
      .where(
        inArray(
          itemInstances.id,
          drops.filter((drop) => drop.dropId !== claimed.dropId).map((drop) => drop.itemId),
        ),
      );
    expect(remainingInstances).toHaveLength(0);

    const claimedInstance = await db
      .select()
      .from(itemInstances)
      .where(eq(itemInstances.id, claimed.itemId));
    expect(claimedInstance[0]?.container).toBe('inventory');

    const remainingDrops = await db
      .select()
      .from(worldDrops)
      .where(
        inArray(
          worldDrops.id,
          drops.map((drop) => drop.dropId),
        ),
      );
    expect(remainingDrops).toHaveLength(0);
  });

  it('reserves drops for the killer, then lets another player claim them', async () => {
    const killer = await createCharacter(db, 'warrior');
    const other = await createCharacter(db, 'warrior');
    const reference = `test-owner-${randomUUID()}`;
    const outcome = await service.grantKillReward({
      characterId: killer.id,
      mapId: 'starter_wilds',
      reference,
      monsterTemplateId: 'wild_slime',
      x: 7_500,
      y: 15_500,
    });
    const drop = outcome?.drops[0];
    expect(drop).toBeDefined();

    await expect(
      service.pickup({
        characterId: other.id,
        commandId: randomUUID(),
        dropId: drop!.dropId,
        mapId: 'starter_wilds',
      }),
    ).rejects.toMatchObject({ code: 'NOT_OWNER' } satisfies Partial<AssetError>);

    clock = new Date(clock.getTime() + 31_000);
    const claimed = await service.pickup({
      characterId: other.id,
      commandId: randomUUID(),
      dropId: drop!.dropId,
      mapId: 'starter_wilds',
    });
    expect(claimed.deduplicated).toBe(false);
    expect(claimed.claimed?.claimerId).toBe(other.id);
    expect(claimed.snapshot.items.some((item) => item.templateId === drop!.templateId)).toBe(true);
  });

  it('settles concurrent pickups of one drop exactly once', async () => {
    const first = await createCharacter(db, 'warrior');
    const second = await createCharacter(db, 'warrior');
    const reference = `test-race-${randomUUID()}`;
    const outcome = await service.grantKillReward({
      characterId: first.id,
      mapId: 'starter_wilds',
      reference,
      monsterTemplateId: 'wild_slime',
      x: 7_500,
      y: 15_500,
    });
    const drop = outcome?.drops[0];
    clock = new Date(clock.getTime() + 31_000);

    const results = await Promise.allSettled([
      service.pickup({
        characterId: first.id,
        commandId: randomUUID(),
        dropId: drop!.dropId,
        mapId: 'starter_wilds',
      }),
      service.pickup({
        characterId: second.id,
        commandId: randomUUID(),
        dropId: drop!.dropId,
        mapId: 'starter_wilds',
      }),
    ]);

    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    const reason = (rejected[0] as PromiseRejectedResult).reason as AssetError;
    expect(reason).toBeInstanceOf(AssetError);
    expect(['ALREADY_CLAIMED', 'ITEM_NOT_FOUND']).toContain(reason.code);
  });

  it('keeps a drop on the ground when the bag is full', async () => {
    const character = await createCharacter(db, 'warrior');
    const reference = `test-full-${randomUUID()}`;
    const outcome = await service.grantKillReward({
      characterId: character.id,
      mapId: 'starter_wilds',
      reference,
      monsterTemplateId: 'wild_slime',
      x: 7_500,
      y: 15_500,
    });
    const drop = outcome?.drops.find((entry) => entry.templateId === 'slime_gel');
    expect(drop).toBeDefined();

    const fillers = Array.from({ length: INVENTORY_CAPACITY }, (_, index) => ({
      templateId: 'wolf_pelt',
      characterId: character.id,
      container: 'inventory' as const,
      slotIndex: index,
      quantity: 1,
    }));
    await db.delete(itemInstances).where(eq(itemInstances.characterId, character.id));
    await db.insert(itemInstances).values(fillers);

    await expect(
      service.pickup({
        characterId: character.id,
        commandId: randomUUID(),
        dropId: drop!.dropId,
        mapId: 'starter_wilds',
      }),
    ).rejects.toMatchObject({ code: 'INVENTORY_FULL' } satisfies Partial<AssetError>);

    const open = await ownerDrops(service);
    expect(open.some((entry) => entry.dropId === drop!.dropId)).toBe(true);
  });

  it('equips, swaps and enforces class and level rules with committed stats', async () => {
    const warrior = await createCharacter(db, 'warrior');
    const sword = await inventoryItem(db, warrior.id, 'warrior_sword');

    const equipped = await service.equip({
      characterId: warrior.id,
      commandId: randomUUID(),
      itemId: sword.id,
    });
    expect(equipped.snapshot.equipment.weapon?.itemId).toBe(sword.id);
    expect(equipped.snapshot.attack).toBe(combatStatsFor('warrior', 1).attack + 6);
    expect(equipped.snapshot.items.some((item) => item.itemId === sword.id)).toBe(false);

    const [secondSword] = await db
      .insert(itemInstances)
      .values({
        templateId: 'warrior_sword',
        characterId: warrior.id,
        container: 'inventory',
        slotIndex: 10,
        quantity: 1,
      })
      .returning();
    const swapped = await service.equip({
      characterId: warrior.id,
      commandId: randomUUID(),
      itemId: secondSword!.id,
    });
    expect(swapped.snapshot.equipment.weapon?.itemId).toBe(secondSword!.id);
    expect(swapped.snapshot.items.find((item) => item.itemId === sword.id)?.slotIndex).toBe(
      secondSword!.slotIndex,
    );

    const mage = await createCharacter(db, 'mage');
    const [wrongClass] = await db
      .insert(itemInstances)
      .values({
        templateId: 'warrior_sword',
        characterId: mage.id,
        container: 'inventory',
        slotIndex: 10,
        quantity: 1,
      })
      .returning();
    await expect(
      service.equip({ characterId: mage.id, commandId: randomUUID(), itemId: wrongClass!.id }),
    ).rejects.toMatchObject({ code: 'CLASS_RESTRICTED' } satisfies Partial<AssetError>);

    const [heavyArmor] = await db
      .insert(itemInstances)
      .values({
        templateId: 'leather_armor',
        characterId: mage.id,
        container: 'inventory',
        slotIndex: 11,
        quantity: 1,
      })
      .returning();
    await expect(
      service.equip({ characterId: mage.id, commandId: randomUUID(), itemId: heavyArmor!.id }),
    ).rejects.toMatchObject({ code: 'LEVEL_TOO_LOW' } satisfies Partial<AssetError>);

    const unequipped = await service.unequip({
      characterId: warrior.id,
      commandId: randomUUID(),
      slot: 'weapon',
    });
    expect(unequipped.snapshot.equipment.weapon).toBeNull();
    expect(unequipped.snapshot.items.some((item) => item.itemId === secondSword!.id)).toBe(true);
  });

  it('scopes asset idempotency keys to the character (TD-DATA-06)', async () => {
    const first = await createCharacter(db, 'warrior');
    const second = await createCharacter(db, 'warrior');
    const firstSword = await inventoryItem(db, first.id, 'warrior_sword');
    const secondSword = await inventoryItem(db, second.id, 'warrior_sword');
    const sharedCommandId = randomUUID();

    const firstOutcome = await service.equip({
      characterId: first.id,
      commandId: sharedCommandId,
      itemId: firstSword.id,
    });
    const secondOutcome = await service.equip({
      characterId: second.id,
      commandId: sharedCommandId,
      itemId: secondSword.id,
    });

    expect(firstOutcome.deduplicated).toBe(false);
    expect(secondOutcome.deduplicated).toBe(false);
    expect(firstOutcome.snapshot.equipment.weapon?.itemId).toBe(firstSword.id);
    expect(secondOutcome.snapshot.equipment.weapon?.itemId).toBe(secondSword.id);
  });

  it('refuses to unequip into a full bag', async () => {
    const warrior = await createCharacter(db, 'warrior');
    const sword = await inventoryItem(db, warrior.id, 'warrior_sword');
    await service.equip({ characterId: warrior.id, commandId: randomUUID(), itemId: sword.id });

    const rows = await db
      .select()
      .from(itemInstances)
      .where(eq(itemInstances.characterId, warrior.id));
    const used = new Set(rows.map((row) => row.slotIndex));
    const fillers = Array.from({ length: INVENTORY_CAPACITY }, (_, index) => index)
      .filter((slot) => !used.has(slot))
      .map((slot) => ({
        templateId: 'wolf_pelt',
        characterId: warrior.id,
        container: 'inventory' as const,
        slotIndex: slot,
        quantity: 1,
      }));
    await db.insert(itemInstances).values(fillers);

    await expect(
      service.unequip({
        characterId: warrior.id,
        commandId: randomUUID(),
        slot: 'weapon',
      }),
    ).rejects.toMatchObject({ code: 'INVENTORY_FULL' } satisfies Partial<AssetError>);
  });

  it('consumes a potion idempotently and persists the healed vitals', async () => {
    const warrior = await createCharacter(db, 'warrior', { hp: 40, mp: 0 });
    const potion = await inventoryItem(db, warrior.id, 'small_hp_potion');
    const commandId = randomUUID();

    const used = await service.use({
      characterId: warrior.id,
      commandId,
      itemId: potion.id,
      vitals: { hp: 40, mp: 0 },
    });
    expect(used.vitals).toEqual({ hp: 80, mp: 0 });
    expect(used.snapshot.hp).toBe(80);
    const remaining = used.snapshot.items.find((item) => item.itemId === potion.id);
    expect(remaining?.quantity).toBe(2);

    const repeat = await service.use({
      characterId: warrior.id,
      commandId,
      itemId: potion.id,
      vitals: { hp: 40, mp: 0 },
    });
    expect(repeat.deduplicated).toBe(true);
    expect(repeat.snapshot.items.find((item) => item.itemId === potion.id)?.quantity).toBe(2);

    const [stored] = await db.select().from(characters).where(eq(characters.id, warrior.id));
    expect(stored?.hp).toBe(80);
  });

  it('refuses a potion at full health and an item that is not consumable', async () => {
    const warrior = await createCharacter(db, 'warrior');
    const potion = await inventoryItem(db, warrior.id, 'small_hp_potion');
    const armor = requireItem('cloth_armor');
    const [armorRow] = await db
      .insert(itemInstances)
      .values({
        templateId: armor.id,
        characterId: warrior.id,
        container: 'inventory',
        slotIndex: 10,
        quantity: 1,
      })
      .returning();

    await expect(
      service.use({
        characterId: warrior.id,
        commandId: randomUUID(),
        itemId: potion.id,
        vitals: { hp: combatStatsFor('warrior', 1).maxHp, mp: 30 },
      }),
    ).rejects.toMatchObject({ code: 'ITEM_NOT_USABLE' } satisfies Partial<AssetError>);

    await expect(
      service.use({
        characterId: warrior.id,
        commandId: randomUUID(),
        itemId: armorRow!.id,
        vitals: { hp: 50, mp: 30 },
      }),
    ).rejects.toMatchObject({ code: 'ITEM_NOT_USABLE' } satisfies Partial<AssetError>);
  });

  it('reloads the committed bag, equipment and progress for a relogin', async () => {
    const warrior = await createCharacter(db, 'warrior');
    const sword = await inventoryItem(db, warrior.id, 'warrior_sword');
    await service.equip({ characterId: warrior.id, commandId: randomUUID(), itemId: sword.id });
    const reference = `test-relogin-${randomUUID()}`;
    await service.grantKillReward({
      characterId: warrior.id,
      mapId: 'starter_wilds',
      reference,
      monsterTemplateId: 'wild_slime',
      x: 7_500,
      y: 15_500,
    });

    const reloaded = await new AssetService(handle.db).loadAssets(warrior.id);
    expect(reloaded.snapshot.equipment.weapon?.templateId).toBe('warrior_sword');
    expect(reloaded.snapshot.gold).toBeGreaterThan(0);
    expect(reloaded.snapshot.exp).toBe(12);
    expect(reloaded.snapshot.items.length).toBeGreaterThan(0);
    expect(reloaded.stats.attack).toBe(combatStatsFor('warrior', 1).attack + 6);
  });

  it('uses the injected content release for stats, loot and item names', async () => {
    const bundle = JSON.parse(JSON.stringify(DEFAULT_CONTENT_BUNDLE)) as ContentBundle;
    const slimeLoot = bundle.lootTables['wild_slime'];
    const gel = bundle.items['slime_gel'];
    expect(slimeLoot).toBeDefined();
    expect(gel).toBeDefined();
    if (slimeLoot === undefined || gel === undefined) {
      return;
    }
    slimeLoot.exp = 999;
    gel.name = '训练凝胶';
    bundle.classes.mage.baseMaxMp = 200;
    const themed = new AssetService(db, { now: () => clock, rng: () => 0, content: bundle });
    const character = await createCharacter(db, 'mage');

    const loaded = await themed.loadAssets(character.id);
    expect(loaded.snapshot.maxMp).toBe(200);

    const outcome = await themed.grantKillReward({
      characterId: character.id,
      mapId: 'starter_wilds',
      reference: `test-content-${randomUUID()}`,
      monsterTemplateId: 'wild_slime',
      x: 7_500,
      y: 15_500,
    });
    expect(outcome?.expGained).toBe(999);
    expect(outcome?.drops.map((drop) => drop.displayName)).toContain('训练凝胶');
  });

  it('buys from the merchant with wallet and ledger committed once', async () => {
    const character = await createCharacter(db, 'warrior', { gold: 100 });
    const commandId = randomUUID();

    const outcome = await service.buy({
      characterId: character.id,
      commandId,
      merchantId: 'town_merchant',
      templateId: 'small_hp_potion',
      quantity: 2,
    });
    expect(outcome.purchased).toEqual({
      templateId: 'small_hp_potion',
      quantity: 2,
      unitPrice: 15,
      totalCost: 30,
    });
    expect(outcome.snapshot.gold).toBe(70);

    const ledgerRows = await db
      .select()
      .from(currencyLedger)
      .where(
        and(
          eq(currencyLedger.characterId, character.id),
          eq(currencyLedger.reason, 'shop_purchase'),
        ),
      );
    expect(ledgerRows).toHaveLength(1);
    expect(ledgerRows[0]?.delta).toBe(-30);
    expect(ledgerRows[0]?.balanceAfter).toBe(70);

    const replay = await service.buy({
      characterId: character.id,
      commandId,
      merchantId: 'town_merchant',
      templateId: 'small_hp_potion',
      quantity: 2,
    });
    expect(replay.deduplicated).toBe(true);
    expect(replay.snapshot.gold).toBe(70);
    expect(
      await db
        .select()
        .from(currencyLedger)
        .where(
          and(
            eq(currencyLedger.characterId, character.id),
            eq(currencyLedger.reason, 'shop_purchase'),
          ),
        ),
    ).toHaveLength(1);
  });

  it('rejects purchases the character cannot afford without side effects', async () => {
    const character = await createCharacter(db, 'warrior', { gold: 10 });
    await expect(
      service.buy({
        characterId: character.id,
        commandId: randomUUID(),
        merchantId: 'town_merchant',
        templateId: 'small_hp_potion',
        quantity: 1,
      }),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_GOLD' } satisfies Partial<AssetError>);

    const loaded = await service.loadAssets(character.id);
    expect(loaded.snapshot.gold).toBe(10);
    expect(
      await db
        .select()
        .from(currencyLedger)
        .where(
          and(
            eq(currencyLedger.characterId, character.id),
            eq(currencyLedger.reason, 'shop_purchase'),
          ),
        ),
    ).toHaveLength(0);
  });

  it('rolls a purchase back when the bag is full', async () => {
    const character = await createCharacter(db, 'warrior', { gold: 100 });
    await db.delete(itemInstances).where(eq(itemInstances.characterId, character.id));
    await db.insert(itemInstances).values(
      Array.from({ length: INVENTORY_CAPACITY }, (_, slot) => ({
        templateId: 'wolf_pelt',
        characterId: character.id,
        container: 'inventory' as const,
        slotIndex: slot,
        quantity: 1,
      })),
    );

    await expect(
      service.buy({
        characterId: character.id,
        commandId: randomUUID(),
        merchantId: 'town_merchant',
        templateId: 'small_hp_potion',
        quantity: 1,
      }),
    ).rejects.toMatchObject({ code: 'INVENTORY_FULL' } satisfies Partial<AssetError>);

    const loaded = await service.loadAssets(character.id);
    expect(loaded.snapshot.gold).toBe(100);
  });

  it('never lets concurrent purchases overdraw the wallet', async () => {
    const character = await createCharacter(db, 'warrior', { gold: 20 });
    const buy = () =>
      service.buy({
        characterId: character.id,
        commandId: randomUUID(),
        merchantId: 'town_merchant',
        templateId: 'small_hp_potion',
        quantity: 1,
      });
    const results = await Promise.allSettled([buy(), buy()]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(rejected?.status === 'rejected' ? rejected.reason : null).toMatchObject({
      code: 'INSUFFICIENT_GOLD',
    });

    const loaded = await service.loadAssets(character.id);
    expect(loaded.snapshot.gold).toBe(5);
  });

  it('sells a stack partially and then clears it', async () => {
    const character = await createCharacter(db, 'warrior', { gold: 0 });
    const potion = await inventoryItem(db, character.id, 'small_hp_potion');
    expect(potion.quantity).toBeGreaterThanOrEqual(2);

    const partial = await service.sell({
      characterId: character.id,
      commandId: randomUUID(),
      merchantId: 'town_merchant',
      itemId: potion.id,
      quantity: 1,
    });
    expect(partial.sold?.totalValue).toBe(5);
    expect(partial.snapshot.gold).toBe(5);

    const rest = await service.sell({
      characterId: character.id,
      commandId: randomUUID(),
      merchantId: 'town_merchant',
      itemId: potion.id,
      quantity: potion.quantity - 1,
    });
    expect(rest.sold?.quantity).toBe(potion.quantity - 1);
    expect(rest.snapshot.gold).toBe(5 * potion.quantity);
    const rows = await db.select().from(itemInstances).where(eq(itemInstances.id, potion.id));
    expect(rows).toHaveLength(0);

    const ledgerRows = await db
      .select()
      .from(currencyLedger)
      .where(
        and(eq(currencyLedger.characterId, character.id), eq(currencyLedger.reason, 'shop_sale')),
      );
    expect(ledgerRows).toHaveLength(2);
    expect(ledgerRows.reduce((sum, row) => sum + row.delta, 0)).toBe(5 * potion.quantity);
  });

  it('refuses to buy what the merchant does not stock or sell', async () => {
    const character = await createCharacter(db, 'warrior', { gold: 500 });
    await expect(
      service.buy({
        characterId: character.id,
        commandId: randomUUID(),
        merchantId: 'town_merchant',
        templateId: 'slime_gel',
        quantity: 1,
      }),
    ).rejects.toMatchObject({ code: 'NOT_SOLD_HERE' } satisfies Partial<AssetError>);
    await expect(
      service.buy({
        characterId: character.id,
        commandId: randomUUID(),
        merchantId: 'town_merchant',
        templateId: 'cloth_armor',
        quantity: 2,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_QUANTITY' } satisfies Partial<AssetError>);
  });

  it('refuses to sell equipped, foreign or price-less items', async () => {
    const warrior = await createCharacter(db, 'warrior', { gold: 0 });
    const sword = await inventoryItem(db, warrior.id, 'warrior_sword');
    await service.equip({ characterId: warrior.id, commandId: randomUUID(), itemId: sword.id });
    await expect(
      service.sell({
        characterId: warrior.id,
        commandId: randomUUID(),
        merchantId: 'town_merchant',
        itemId: sword.id,
        quantity: 1,
      }),
    ).rejects.toMatchObject({ code: 'ITEM_NOT_FOUND' } satisfies Partial<AssetError>);

    const other = await createCharacter(db, 'warrior', { gold: 0 });
    const otherPotion = await inventoryItem(db, other.id, 'small_hp_potion');
    await expect(
      service.sell({
        characterId: warrior.id,
        commandId: randomUUID(),
        merchantId: 'town_merchant',
        itemId: otherPotion.id,
        quantity: 1,
      }),
    ).rejects.toMatchObject({ code: 'ITEM_NOT_FOUND' } satisfies Partial<AssetError>);

    const bundle = JSON.parse(JSON.stringify(DEFAULT_CONTENT_BUNDLE)) as ContentBundle;
    const gel = bundle.items['slime_gel'];
    expect(gel).toBeDefined();
    if (gel === undefined) {
      return;
    }
    gel.sellPrice = 0;
    const noSale = new AssetService(db, { now: () => clock, rng: () => 0, content: bundle });
    await db.delete(itemInstances).where(eq(itemInstances.characterId, warrior.id));
    const [item] = await db
      .insert(itemInstances)
      .values({
        templateId: 'slime_gel',
        characterId: warrior.id,
        container: 'inventory',
        slotIndex: 0,
        quantity: 3,
      })
      .returning();
    await expect(
      noSale.sell({
        characterId: warrior.id,
        commandId: randomUUID(),
        merchantId: 'town_merchant',
        itemId: item!.id,
        quantity: 1,
      }),
    ).rejects.toMatchObject({ code: 'CANNOT_SELL' } satisfies Partial<AssetError>);
  });
});
