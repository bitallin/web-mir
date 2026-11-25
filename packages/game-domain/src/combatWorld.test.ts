import { TILE_UNITS, type CombatEventPayload } from '@web-legend/contracts';
import { describe, expect, it } from 'vitest';

import { MONSTER_CATALOG, requireMonster } from './content';
import { equipmentBonuses, requireItem, statsWithEquipment } from './items';
import { combatStatsFor } from './stats';
import {
  DEFAULT_SLIME_SPAWN,
  advance,
  center,
  createFlatGrid,
  createTestWorld,
  positions,
} from './testSupport';

function warrior(
  overrides: Partial<Parameters<ReturnType<typeof createTestWorld>['addPlayer']>[0]> = {},
) {
  return {
    id: 'player-1',
    displayName: 'Alice',
    classId: 'warrior' as const,
    level: 1,
    hp: 120,
    mp: 30,
    ...center({ x: 4, y: 5 }),
    ...overrides,
  };
}

function eventKinds(events: readonly CombatEventPayload[]): string[] {
  return events.map((event) => event.kind);
}

function killSlime(world: ReturnType<typeof createTestWorld>): CombatEventPayload[] {
  const events: CombatEventPayload[] = [];
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const result = world.basicAttack('player-1', DEFAULT_SLIME_SPAWN.id);
    events.push(...result.events);
    if (world.getMonster(DEFAULT_SLIME_SPAWN.id)?.state === 'dead') {
      break;
    }
    advance(world, 900);
  }
  return events;
}

describe('CombatWorld basic attacks', () => {
  it('deals authoritative damage and enforces the attack interval', () => {
    const world = createTestWorld();
    world.addPlayer(warrior());

    const first = world.basicAttack('player-1', DEFAULT_SLIME_SPAWN.id);
    expect(first.accepted).toBe(true);
    expect(eventKinds(first.events)).toEqual(['attack', 'hit']);
    const hpAfterFirst = world.getMonster(DEFAULT_SLIME_SPAWN.id)?.hp ?? 0;
    expect(hpAfterFirst).toBeLessThan(50);

    const second = world.basicAttack('player-1', DEFAULT_SLIME_SPAWN.id);
    expect(second.accepted).toBe(false);
    expect(second.rejection?.code).toBe('COOLDOWN');
    expect(second.rejection?.retryAfterMs).toBe(900);

    advance(world, 900);
    const third = world.basicAttack('player-1', DEFAULT_SLIME_SPAWN.id);
    expect(third.accepted).toBe(true);
  });

  it('rejects out-of-range attacks without touching monster hp', () => {
    const world = createTestWorld();
    world.addPlayer(warrior(center({ x: 12, y: 5 })));

    const result = world.basicAttack('player-1', DEFAULT_SLIME_SPAWN.id);
    expect(result.rejection?.code).toBe('OUT_OF_RANGE');
    expect(world.getMonster(DEFAULT_SLIME_SPAWN.id)?.hp).toBe(50);
  });

  it('keeps two attackers on one authoritative hp value', () => {
    const world = createTestWorld({ monsterRespawnMs: 60_000 });
    world.addPlayer(warrior());
    world.addPlayer({
      id: 'player-2',
      displayName: 'Bob',
      classId: 'warrior',
      level: 1,
      hp: 120,
      mp: 30,
      ...center({ x: 6, y: 5 }),
    });

    const first = world.basicAttack('player-1', DEFAULT_SLIME_SPAWN.id);
    const second = world.basicAttack('player-2', DEFAULT_SLIME_SPAWN.id);
    const lastHit = second.events.find((event) => event.kind === 'hit');
    expect(lastHit?.kind).toBe('hit');
    if (lastHit?.kind !== 'hit') {
      return;
    }
    expect(lastHit.targetHp).toBe(world.getMonster(DEFAULT_SLIME_SPAWN.id)?.hp);
    expect(first.accepted && second.accepted).toBe(true);

    const events = killSlime(world);
    const death = events.find((event) => event.kind === 'death');
    expect(death?.kind).toBe('death');
    expect(death?.entityId).toBe(DEFAULT_SLIME_SPAWN.id);
    expect(world.getMonster(DEFAULT_SLIME_SPAWN.id)?.state).toBe('dead');

    const afterDeath = world.basicAttack('player-1', DEFAULT_SLIME_SPAWN.id);
    expect(afterDeath.rejection?.code).toBe('TARGET_DEAD');
  });
});

describe('CombatWorld skills', () => {
  it('spends mana, starts a cooldown and rejects a second cast', () => {
    const world = createTestWorld();
    world.addPlayer(warrior());

    const cast = world.castSkill('player-1', 'warrior_heavy_strike', DEFAULT_SLIME_SPAWN.id);
    expect(cast.accepted).toBe(true);
    expect(eventKinds(cast.events)).toEqual(['attack', 'hit']);
    expect(world.getPlayer('player-1')?.mp).toBe(24);
    expect(world.getMonster(DEFAULT_SLIME_SPAWN.id)?.hp).toBeLessThan(50);

    const repeat = world.castSkill('player-1', 'warrior_heavy_strike', DEFAULT_SLIME_SPAWN.id);
    expect(repeat.rejection?.code).toBe('COOLDOWN');
    expect(repeat.rejection?.retryAfterMs).toBe(5_000);

    advance(world, 5_000);
    const ready = world.castSkill('player-1', 'warrior_heavy_strike', DEFAULT_SLIME_SPAWN.id);
    expect(ready.accepted).toBe(true);
  });

  it('rejects insufficient mana and skills from another class', () => {
    const world = createTestWorld();
    world.addPlayer(warrior({ mp: 2 }));

    expect(
      world.castSkill('player-1', 'warrior_heavy_strike', DEFAULT_SLIME_SPAWN.id).rejection?.code,
    ).toBe('INSUFFICIENT_RESOURCE');

    const mageWorld = createTestWorld();
    mageWorld.addPlayer({
      id: 'mage-1',
      displayName: 'Mira',
      classId: 'mage',
      level: 1,
      hp: 80,
      mp: 80,
      ...center({ x: 4, y: 5 }),
    });
    expect(
      mageWorld.castSkill('mage-1', 'warrior_heavy_strike', DEFAULT_SLIME_SPAWN.id).rejection?.code,
    ).toBe('INVALID_TARGET');
  });

  it('uses the skill range rather than the basic attack range', () => {
    const world = createTestWorld();
    world.addPlayer({
      id: 'mage-1',
      displayName: 'Mira',
      classId: 'mage',
      level: 1,
      hp: 80,
      mp: 80,
      ...center({ x: 10, y: 5 }),
    });

    const fireball = world.castSkill('mage-1', 'mage_fireball', DEFAULT_SLIME_SPAWN.id);
    expect(fireball.accepted).toBe(true);

    const farWorld = createTestWorld();
    farWorld.addPlayer({
      id: 'mage-1',
      displayName: 'Mira',
      classId: 'mage',
      level: 1,
      hp: 80,
      mp: 80,
      ...center({ x: 13, y: 5 }),
    });
    expect(
      farWorld.castSkill('mage-1', 'mage_fireball', DEFAULT_SLIME_SPAWN.id).rejection?.code,
    ).toBe('OUT_OF_RANGE');
  });

  it('heals the caster and never exceeds max hp', () => {
    const world = createTestWorld();
    world.addPlayer({
      id: 'taoist-1',
      displayName: 'Tao',
      classId: 'taoist',
      level: 1,
      hp: 10,
      mp: 60,
      ...center({ x: 4, y: 5 }),
    });

    const cast = world.castSkill('taoist-1', 'taoist_heal', 'taoist-1');
    expect(cast.accepted).toBe(true);
    const heal = cast.events.find((event) => event.kind === 'heal');
    expect(heal?.kind).toBe('heal');
    if (heal?.kind !== 'heal') {
      return;
    }
    expect(heal.amount).toBe(30);
    expect(world.getPlayer('taoist-1')?.hp).toBe(40);
    expect(world.getPlayer('taoist-1')?.mp).toBe(48);
  });
});

describe('CombatWorld monsters', () => {
  it('chases and attacks a nearby player', () => {
    const world = createTestWorld();
    world.addPlayer(warrior(center({ x: 8, y: 5 })));

    advance(world, 200);
    expect(world.getMonster(DEFAULT_SLIME_SPAWN.id)?.state).toBe('chase');

    advance(world, 3_000);
    const player = world.getPlayer('player-1');
    const monster = world.getMonster(DEFAULT_SLIME_SPAWN.id);
    expect(player?.hp).toBeLessThan(120);
    expect(monster?.state).toBe('attack');
    expect(
      Math.hypot((monster?.x ?? 0) - (player?.x ?? 0), (monster?.y ?? 0) - (player?.y ?? 0)) /
        TILE_UNITS,
    ).toBeLessThan(1.2);
  });

  it('does not chase or damage a player who became untargetable', () => {
    const world = createTestWorld();
    world.addPlayer(warrior(center({ x: 8, y: 5 })));
    advance(world, 200);
    world.setPlayerTargetable('player-1', false);

    advance(world, 3_000);
    expect(world.getPlayer('player-1')?.hp).toBe(120);

    world.setPlayerTargetable('player-1', true);
    advance(world, 3_000);
    expect(world.getPlayer('player-1')?.hp).toBeLessThan(120);
  });

  it('returns to its spawn when no player is in aggro range', () => {
    const world = createTestWorld();
    world.addPlayer(warrior(center({ x: 8, y: 5 })));
    advance(world, 2_000);

    const farAway = new Map([['player-1', center({ x: 19, y: 19 })]]);
    for (let elapsed = 0; elapsed < 6_000; elapsed += 50) {
      world.step(50, farAway);
    }

    const monster = world.getMonster(DEFAULT_SLIME_SPAWN.id);
    expect(monster?.state === 'idle' || monster?.state === 'patrol').toBe(true);
    // Patrol may wander around the spawn, but never back into chase/attack.
    const spawnPosition = center(DEFAULT_SLIME_SPAWN.tile);
    const distanceFromSpawn =
      Math.hypot((monster?.x ?? 0) - spawnPosition.x, (monster?.y ?? 0) - spawnPosition.y) /
      TILE_UNITS;
    expect(distanceFromSpawn).toBeLessThanOrEqual(2.5);
  });

  it('dies once and respawns at the same spawn after the configured delay', () => {
    const world = createTestWorld({ monsterRespawnMs: 600 });
    world.addPlayer(warrior());

    const events = killSlime(world);
    expect(eventKinds(events)).toContain('death');
    expect(world.getMonster(DEFAULT_SLIME_SPAWN.id)?.state).toBe('dead');

    const respawnEvents = advanceEvent(world, 600);
    expect(eventKinds(respawnEvents)).toContain('spawn');
    const monster = world.getMonster(DEFAULT_SLIME_SPAWN.id);
    expect(monster?.state).toBe('idle');
    expect(monster?.hp).toBe(50);
  });

  it('kills a low-health player and respawns them at the fixed point', () => {
    const brute = {
      ...requireMonster('wild_slime'),
      id: 'test_brute',
      name: '测试蛮兽',
      attack: 40,
      attackIntervalMs: 100,
      maxHp: 999,
    };
    const world = createTestWorld({
      spawns: [{ id: 'brute_1', monsterId: 'test_brute', tile: { x: 5, y: 5 } }],
      playerRespawnMs: 300,
      tuning: { monsters: { ...MONSTER_CATALOG, test_brute: brute } },
    });
    world.addPlayer(warrior({ hp: 5, ...center({ x: 5, y: 6 }) }));

    let died = false;
    for (let attempt = 0; attempt < 40 && !died; attempt += 1) {
      const events = advanceEvent(world, 50);
      died = events.some((event) => event.kind === 'death');
    }
    expect(died).toBe(true);
    expect(world.getPlayer('player-1')?.alive).toBe(false);
    expect(world.basicAttack('player-1', 'brute_1').rejection?.code).toBe('PLAYER_DEAD');

    const respawn = advanceEvent(world, 300);
    expect(eventKinds(respawn)).toContain('respawn');
    const player = world.getPlayer('player-1');
    expect(player?.alive).toBe(true);
    expect(player?.hp).toBe(player?.maxHp);
    expect(player?.x).toBe(center({ x: 1, y: 1 }).x);
    expect(player?.y).toBe(center({ x: 1, y: 1 }).y);
  });

  it('replays identically from the same seed and inputs', () => {
    const run = (): { events: string[]; monster: unknown; player: unknown } => {
      const world = createTestWorld({ seed: 'replay-seed' });
      world.addPlayer(warrior(center({ x: 6, y: 5 })));
      const events: CombatEventPayload[] = [];
      events.push(...world.basicAttack('player-1', DEFAULT_SLIME_SPAWN.id).events);
      for (let elapsed = 0; elapsed < 4_000; elapsed += 50) {
        events.push(...world.step(50, positions(world)));
      }
      events.push(...world.basicAttack('player-1', DEFAULT_SLIME_SPAWN.id).events);
      return {
        events: events.map((event) => JSON.stringify(event)),
        monster: world.getMonster(DEFAULT_SLIME_SPAWN.id),
        player: world.getPlayer('player-1'),
      };
    };

    expect(run()).toEqual(run());
  });
});

describe('CombatWorld configuration', () => {
  it('rejects unknown monsters, duplicate spawn ids and blocked spawns', () => {
    expect(() =>
      createTestWorld({
        spawns: [{ id: 'bad', monsterId: 'missing', tile: { x: 3, y: 3 } }],
      }),
    ).toThrow(RangeError);

    expect(() => createTestWorld({ spawns: [DEFAULT_SLIME_SPAWN, DEFAULT_SLIME_SPAWN] })).toThrow(
      RangeError,
    );

    expect(() =>
      createTestWorld({
        grid: createFlatGrid(20, [{ x: 5, y: 5 }]),
        spawns: [DEFAULT_SLIME_SPAWN],
      }),
    ).toThrow(RangeError);
  });

  it('rejects a non-positive step', () => {
    const world = createTestWorld();
    expect(() => world.step(0, new Map())).toThrow(RangeError);
  });
});

function advanceEvent(
  world: ReturnType<typeof createTestWorld>,
  totalMs: number,
): CombatEventPayload[] {
  const events: CombatEventPayload[] = [];
  let elapsed = 0;
  while (elapsed < totalMs) {
    const step = Math.min(50, totalMs - elapsed);
    events.push(...world.step(step, positions(world)));
    elapsed += step;
  }
  return events;
}

describe('CombatWorld equipment and vitals', () => {
  it('uses injected equipment-adjusted stats and clamps vitals to them', () => {
    const world = createTestWorld();
    const baseline = combatStatsFor('warrior', 1);
    const equipped = statsWithEquipment(
      baseline,
      equipmentBonuses([requireItem('warrior_sword'), requireItem('cloth_armor')]),
    );
    world.addPlayer(warrior({ hp: 999, mp: 999, stats: equipped }));

    const player = world.getPlayer('player-1');
    expect(player?.maxHp).toBe(baseline.maxHp);
    expect(player?.hp).toBe(baseline.maxHp);
    expect(player?.mp).toBe(baseline.maxMp);
    expect(player?.attack).toBe(baseline.attack + 6);
    expect(player?.defense).toBe(baseline.defense + 2);
  });

  it('applies a level-up refill and clamps vitals after an equipment downgrade', () => {
    const world = createTestWorld();
    world.addPlayer(warrior({ hp: 40, mp: 5 }));

    const levelTwo = combatStatsFor('warrior', 2);
    expect(
      world.updatePlayerProgress('player-1', { level: 2, stats: levelTwo, refill: true }),
    ).toBe(true);
    expect(world.getPlayer('player-1')?.hp).toBe(levelTwo.maxHp);
    expect(world.getPlayer('player-1')?.mp).toBe(levelTwo.maxMp);
    expect(world.getPlayer('player-1')?.level).toBe(2);

    const noBonus = combatStatsFor('warrior', 1);
    world.updatePlayerProgress('player-1', { level: 1, stats: noBonus });
    expect(world.getPlayer('player-1')?.hp).toBe(noBonus.maxHp);
    expect(world.getPlayer('player-1')?.maxHp).toBe(noBonus.maxHp);
  });

  it('applies server-decided consumable vitals', () => {
    const world = createTestWorld();
    world.addPlayer(warrior({ hp: 20, mp: 0 }));

    expect(world.setPlayerVitals('player-1', { hp: 60, mp: 10 })).toBe(true);
    expect(world.getPlayer('player-1')?.hp).toBe(60);
    expect(world.getPlayer('player-1')?.mp).toBe(10);
    expect(world.getPlayer('player-1')?.alive).toBe(true);

    world.setPlayerVitals('player-1', { hp: 9_999, mp: 9_999 });
    expect(world.getPlayer('player-1')?.hp).toBe(120);
    expect(world.getPlayer('player-1')?.mp).toBe(30);
  });
});
