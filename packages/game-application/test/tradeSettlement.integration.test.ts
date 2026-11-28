import { randomUUID } from 'node:crypto';

import { INVENTORY_CAPACITY } from '@web-legend/contracts';
import { STARTER_KIT, combatStatsFor } from '@web-legend/game-domain';
import {
  assetCommands,
  createDatabase,
  currencyLedger,
  insertAccount,
  insertCharacterWithItems,
  itemInstances,
  realms,
  wallets,
  type Character,
  type CharacterClassId,
  type Database,
  type DatabaseHandle,
} from '@web-legend/persistence';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AssetError, AssetService } from '../src/index';

const databaseUrl = process.env.DATABASE_URL;
const PASSWORD_HASH = 'alpha-three-trade-hash';
const REALM_CODE = 'classic-01';

let sequence = 0;

function suffix(): string {
  sequence += 1;
  return `${randomUUID().replace(/-/gu, '').slice(0, 6)}${sequence.toString(36)}`;
}

async function createCharacter(
  db: Database,
  classId: CharacterClassId,
  gold: number,
): Promise<Character> {
  const [realm] = await db.select().from(realms).where(eq(realms.code, REALM_CODE)).limit(1);
  if (realm === undefined) {
    throw new Error('test realm is missing');
  }
  const token = suffix();
  const account = await insertAccount(db, {
    username: `trade_${token}`.slice(0, 24),
    usernameNormalized: `trade_${token}`.slice(0, 24),
    passwordHash: PASSWORD_HASH,
  });
  const stats = combatStatsFor(classId, 1);
  return insertCharacterWithItems(
    db,
    {
      accountId: account.id,
      realmId: realm.id,
      name: `T${token}`.slice(0, 12),
      nameNormalized: `t${token}`.slice(0, 12).toLowerCase(),
      classId,
      level: 1,
      exp: 0,
      hp: stats.maxHp,
      maxHp: stats.maxHp,
      mp: stats.maxMp,
      maxMp: stats.maxMp,
      mapId: 'starter_town',
      x: 2_500,
      y: 16_500,
      facing: 2,
    },
    STARTER_KIT[classId],
    gold,
  );
}

async function bagRows(db: Database, characterId: string) {
  return db
    .select()
    .from(itemInstances)
    .where(
      and(eq(itemInstances.characterId, characterId), eq(itemInstances.container, 'inventory')),
    );
}

async function bagQuantity(db: Database, characterId: string, templateId: string): Promise<number> {
  const rows = await bagRows(db, characterId);
  return rows
    .filter((row) => row.templateId === templateId)
    .reduce((total, row) => total + row.quantity, 0);
}

async function addBagItem(
  db: Database,
  characterId: string,
  templateId: string,
  quantity: number,
  slotIndex: number,
): Promise<{ id: string; quantity: number }> {
  const [row] = await db
    .insert(itemInstances)
    .values({
      templateId,
      characterId,
      container: 'inventory',
      slotIndex,
      quantity,
    })
    .returning({ id: itemInstances.id });
  if (row === undefined) {
    throw new Error('item insert returned no row');
  }
  return { id: row.id, quantity };
}

async function walletBalance(db: Database, characterId: string): Promise<number> {
  const [row] = await db.select().from(wallets).where(eq(wallets.characterId, characterId));
  return row?.balance ?? 0;
}

describe.skipIf(databaseUrl === undefined)('AssetService.settleTrade with PostgreSQL', () => {
  let handle: DatabaseHandle;
  let db: Database;
  let service: AssetService;

  beforeAll(async () => {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Refusing to run database-mutating tests with NODE_ENV=production');
    }
    handle = createDatabase(databaseUrl as string, { max: 10 });
    db = handle.db;
    await db
      .insert(realms)
      .values({ code: REALM_CODE, name: '经典一区', status: 'active' })
      .onConflictDoNothing({ target: realms.code });
    service = new AssetService(db, { rng: () => 0.5 });
  });

  afterAll(async () => {
    await handle.close();
  });

  it('moves items and gold between both bags in one transaction', async () => {
    const alice = await createCharacter(db, 'warrior', 100);
    const bob = await createCharacter(db, 'mage', 10);
    const aliceHp = await bagRows(db, alice.id);
    const bobMp = await bagRows(db, bob.id);
    const alicePotion = aliceHp.find((row) => row.templateId === 'small_hp_potion');
    const bobPotion = bobMp.find((row) => row.templateId === 'small_mp_potion');
    if (alicePotion === undefined || bobPotion === undefined) {
      throw new Error('starter potions missing');
    }
    const tradeId = randomUUID();

    const outcome = await service.settleTrade({
      tradeId,
      sides: [
        {
          characterId: alice.id,
          items: [{ itemId: alicePotion.id, quantity: alicePotion.quantity }],
          gold: 25,
        },
        {
          characterId: bob.id,
          items: [{ itemId: bobPotion.id, quantity: bobPotion.quantity }],
          gold: 0,
        },
      ],
    });

    expect(outcome.deduplicated).toBe(false);
    expect(await bagQuantity(db, alice.id, 'small_hp_potion')).toBe(0);
    expect(await bagQuantity(db, alice.id, 'small_mp_potion')).toBe(4);
    expect(await bagQuantity(db, bob.id, 'small_hp_potion')).toBe(5);
    expect(await bagQuantity(db, bob.id, 'small_mp_potion')).toBe(0);
    expect(await walletBalance(db, alice.id)).toBe(75);
    expect(await walletBalance(db, bob.id)).toBe(35);

    const ledger = await db
      .select()
      .from(currencyLedger)
      .where(eq(currencyLedger.reason, 'trade_settle'));
    const rows = ledger.filter((row) => row.referenceId === tradeId);
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.delta).sort((left, right) => left - right)).toEqual([-25, 25]);
    expect(rows.map((row) => row.balanceAfter).sort((left, right) => left - right)).toEqual([
      35, 75,
    ]);

    const claims = await db
      .select()
      .from(assetCommands)
      .where(
        and(
          eq(assetCommands.kind, 'trade_settle'),
          eq(assetCommands.idempotencyKey, `cmd:${alice.id}:trade_settle:${tradeId}`),
        ),
      );
    expect(claims).toHaveLength(1);
  });

  it('swaps equipment that occupies the same slot on both sides', async () => {
    const alice = await createCharacter(db, 'warrior', 0);
    const bob = await createCharacter(db, 'mage', 0);
    const aliceArmor = await addBagItem(db, alice.id, 'cloth_armor', 1, 10);
    const bobArmor = await addBagItem(db, bob.id, 'leather_armor', 1, 10);

    await service.settleTrade({
      tradeId: randomUUID(),
      sides: [
        {
          characterId: alice.id,
          items: [{ itemId: aliceArmor.id, quantity: 1 }],
          gold: 0,
        },
        {
          characterId: bob.id,
          items: [{ itemId: bobArmor.id, quantity: 1 }],
          gold: 0,
        },
      ],
    });

    const aliceBag = await bagRows(db, alice.id);
    const bobBag = await bagRows(db, bob.id);
    const aliceGot = aliceBag.find((row) => row.templateId === 'leather_armor');
    const bobGot = bobBag.find((row) => row.templateId === 'cloth_armor');
    // Item identity survives the swap, so drop/audit references stay valid.
    expect(aliceGot?.id).toBe(bobArmor.id);
    expect(bobGot?.id).toBe(aliceArmor.id);
    expect(aliceBag.some((row) => row.templateId === 'cloth_armor')).toBe(false);
    expect(bobBag.some((row) => row.templateId === 'leather_armor')).toBe(false);
  });

  it('is idempotent when the same trade id is submitted twice', async () => {
    const alice = await createCharacter(db, 'warrior', 100);
    const bob = await createCharacter(db, 'mage', 10);
    const alicePotion = (await bagRows(db, alice.id)).find(
      (row) => row.templateId === 'small_hp_potion',
    );
    if (alicePotion === undefined) {
      throw new Error('starter potion missing');
    }
    const tradeId = randomUUID();
    const input = {
      tradeId,
      sides: [
        {
          characterId: alice.id,
          items: [{ itemId: alicePotion.id, quantity: alicePotion.quantity }],
          gold: 0,
        },
        { characterId: bob.id, items: [], gold: 0 },
      ],
    } as const;

    const first = await service.settleTrade(input);
    const second = await service.settleTrade(input);
    expect(first.deduplicated).toBe(false);
    expect(second.deduplicated).toBe(true);
    expect(await bagQuantity(db, bob.id, 'small_hp_potion')).toBe(5);
    expect(await bagQuantity(db, alice.id, 'small_hp_potion')).toBe(0);
  });

  it('serializes two concurrent submissions of one trade', async () => {
    const alice = await createCharacter(db, 'warrior', 100);
    const bob = await createCharacter(db, 'mage', 10);
    const alicePotion = (await bagRows(db, alice.id)).find(
      (row) => row.templateId === 'small_hp_potion',
    );
    if (alicePotion === undefined) {
      throw new Error('starter potion missing');
    }
    const tradeId = randomUUID();
    const input = {
      tradeId,
      sides: [
        {
          characterId: alice.id,
          items: [{ itemId: alicePotion.id, quantity: alicePotion.quantity }],
          gold: 0,
        },
        { characterId: bob.id, items: [], gold: 0 },
      ],
    } as const;

    const results = await Promise.all([service.settleTrade(input), service.settleTrade(input)]);
    expect(results.filter((result) => !result.deduplicated)).toHaveLength(1);
    expect(results.filter((result) => result.deduplicated)).toHaveLength(1);
    expect(await bagQuantity(db, bob.id, 'small_hp_potion')).toBe(5);
    expect(await bagQuantity(db, alice.id, 'small_hp_potion')).toBe(0);
  });

  it('rolls back both sides when the receiver has no free slot', async () => {
    const alice = await createCharacter(db, 'warrior', 100);
    const bob = await createCharacter(db, 'mage', 10);
    const gel = await addBagItem(db, alice.id, 'slime_gel', 2, 3);
    // Fill every remaining slot with a non-stackable item so a material cannot
    // merge and has nowhere to go.
    const taken = new Set((await bagRows(db, bob.id)).map((row) => row.slotIndex ?? 0));
    const fillers = [];
    for (let slot = 0; slot < INVENTORY_CAPACITY; slot += 1) {
      if (!taken.has(slot)) {
        fillers.push({
          templateId: 'cloth_armor',
          characterId: bob.id,
          container: 'inventory' as const,
          slotIndex: slot,
          quantity: 1,
        });
      }
    }
    await db.insert(itemInstances).values(fillers);

    await expect(
      service.settleTrade({
        tradeId: randomUUID(),
        sides: [
          {
            characterId: alice.id,
            items: [{ itemId: gel.id, quantity: gel.quantity }],
            gold: 0,
          },
          { characterId: bob.id, items: [], gold: 0 },
        ],
      }),
    ).rejects.toMatchObject({ code: 'INVENTORY_FULL' });
    expect(await bagQuantity(db, alice.id, 'slime_gel')).toBe(2);
    expect(await bagQuantity(db, bob.id, 'slime_gel')).toBe(0);
    expect(await walletBalance(db, alice.id)).toBe(100);
  });

  it('rejects an offer whose item changed after it was locked', async () => {
    const alice = await createCharacter(db, 'warrior', 100);
    const bob = await createCharacter(db, 'mage', 10);
    const potion = (await bagRows(db, alice.id)).find(
      (row) => row.templateId === 'small_hp_potion',
    );
    if (potion === undefined) {
      throw new Error('starter potion missing');
    }
    await db.delete(itemInstances).where(eq(itemInstances.id, potion.id));

    await expect(
      service.settleTrade({
        tradeId: randomUUID(),
        sides: [
          {
            characterId: alice.id,
            items: [{ itemId: potion.id, quantity: potion.quantity }],
            gold: 0,
          },
          { characterId: bob.id, items: [], gold: 0 },
        ],
      }),
    ).rejects.toMatchObject({ code: 'TRADE_ITEM_UNAVAILABLE' });
    expect(await walletBalance(db, alice.id)).toBe(100);
    expect(await walletBalance(db, bob.id)).toBe(10);
  });

  it('rejects insufficient gold and a bound starter weapon', async () => {
    const alice = await createCharacter(db, 'warrior', 100);
    const bob = await createCharacter(db, 'mage', 10);
    const sword = (await bagRows(db, alice.id)).find((row) => row.templateId === 'warrior_sword');
    if (sword === undefined) {
      throw new Error('starter weapon missing');
    }

    await expect(
      service.settleTrade({
        tradeId: randomUUID(),
        sides: [
          { characterId: alice.id, items: [], gold: 200 },
          { characterId: bob.id, items: [], gold: 0 },
        ],
      }),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_GOLD' });

    await expect(
      service.settleTrade({
        tradeId: randomUUID(),
        sides: [
          {
            characterId: alice.id,
            items: [{ itemId: sword.id, quantity: 1 }],
            gold: 0,
          },
          { characterId: bob.id, items: [], gold: 0 },
        ],
      }),
    ).rejects.toMatchObject({ code: 'TRADE_ITEM_UNAVAILABLE' });

    expect(await bagQuantity(db, bob.id, 'warrior_sword')).toBe(0);
    expect(await walletBalance(db, alice.id)).toBe(100);
  });

  it('never turns a rejected settlement into a claim row', async () => {
    const alice = await createCharacter(db, 'warrior', 100);
    const bob = await createCharacter(db, 'mage', 10);
    const tradeId = randomUUID();
    await expect(
      service.settleTrade({
        tradeId,
        sides: [
          { characterId: alice.id, items: [], gold: 500 },
          { characterId: bob.id, items: [], gold: 0 },
        ],
      }),
    ).rejects.toBeInstanceOf(AssetError);

    const claims = await db
      .select()
      .from(assetCommands)
      .where(eq(assetCommands.idempotencyKey, `cmd:${alice.id}:trade_settle:${tradeId}`));
    expect(claims).toHaveLength(0);
  });
});
