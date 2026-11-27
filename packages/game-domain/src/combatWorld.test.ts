import { TILE_UNITS, type CombatEventPayload, type ContentBundle } from '@web-legend/contracts';
import { BASE_CONTENT_BUNDLE } from '@web-legend/content-schema/base';
import { describe, expect, it } from 'vitest';

import { MONSTER_CATALOG, requireMonster } from './content';
import { equipmentBonuses, requireItem, statsWithEquipment } from './items';
import { monsterStatsAtPhase } from './monsterPhase';
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

describe('CombatWorld player combat', () => {
  // Away from the default slime spawn (5,5) so monster aggro cannot interfere
  // with a duel.
  function addDuelists(world: ReturnType<typeof createTestWorld>, targetHp = 120): void {
    world.addPlayer(warrior(center({ x: 12, y: 12 })));
    world.addPlayer({
      id: 'player-2',
      displayName: 'Bob',
      classId: 'warrior',
      level: 1,
      hp: targetHp,
      mp: 30,
      ...center({ x: 13, y: 12 }),
    });
  }

  it('rejects player attacks on a safe-zone map without changing hp', () => {
    const world = createTestWorld({ pvpEnabled: false });
    addDuelists(world);

    const attack = world.basicAttack('player-1', 'player-2');
    expect(attack.accepted).toBe(false);
    expect(attack.rejection?.code).toBe('SAFE_ZONE');
    const skill = world.castSkill('player-1', 'warrior_heavy_strike', 'player-2');
    expect(skill.rejection?.code).toBe('SAFE_ZONE');
    expect(world.getPlayer('player-2')?.hp).toBe(120);
    expect(world.getPlayer('player-1')?.mp).toBe(30);
  });

  it('deals damage, kills another player and revives them at the respawn point', () => {
    const world = createTestWorld({ pvpEnabled: true, playerRespawnMs: 500 });
    addDuelists(world, 10);

    const events: CombatEventPayload[] = [];
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const result = world.basicAttack('player-1', 'player-2');
      expect(result.accepted).toBe(true);
      events.push(...result.events);
      const target = world.getPlayer('player-2');
      if (target?.alive === false) {
        break;
      }
      expect(target?.hp).toBeLessThanOrEqual(10);
      advance(world, 900);
    }

    const death = events.find((event) => event.kind === 'death');
    expect(death?.kind).toBe('death');
    if (death?.kind !== 'death') {
      return;
    }
    expect(death.entityId).toBe('player-2');
    expect(death.entityType).toBe('player');
    expect(death.killerId).toBe('player-1');
    expect(death.reviveInMs).toBe(500);
    expect(world.getPlayer('player-2')?.alive).toBe(false);

    advance(world, 500);
    const resurrected = world.getPlayer('player-2');
    expect(resurrected?.alive).toBe(true);
    expect(resurrected?.hp).toBe(resurrected?.maxHp);
    const respawnPosition = center({ x: 1, y: 1 });
    expect(resurrected?.x).toBe(respawnPosition.x);
    expect(resurrected?.y).toBe(respawnPosition.y);
  });

  it('rejects self, dead, disconnected and out-of-range player targets', () => {
    const world = createTestWorld({ pvpEnabled: true });
    addDuelists(world, 10);

    expect(world.basicAttack('player-1', 'player-1').rejection?.code).toBe('INVALID_TARGET');

    world.setPlayerTargetable('player-2', false);
    expect(world.basicAttack('player-1', 'player-2').rejection?.code).toBe('INVALID_TARGET');
    world.setPlayerTargetable('player-2', true);

    const farWorld = createTestWorld({ pvpEnabled: true });
    farWorld.addPlayer(warrior(center({ x: 1, y: 1 })));
    farWorld.addPlayer({
      id: 'player-2',
      displayName: 'Bob',
      classId: 'warrior',
      level: 1,
      hp: 120,
      mp: 30,
      ...center({ x: 10, y: 10 }),
    });
    expect(farWorld.basicAttack('player-1', 'player-2').rejection?.code).toBe('OUT_OF_RANGE');

    // Kill the adjacent target once, then a dead player can no longer be hit.
    for (let attempt = 0; attempt < 20; attempt += 1) {
      world.basicAttack('player-1', 'player-2');
      if (world.getPlayer('player-2')?.alive === false) {
        break;
      }
      advance(world, 900);
    }
    expect(world.getPlayer('player-2')?.alive).toBe(false);
    expect(world.basicAttack('player-1', 'player-2').rejection?.code).toBe('TARGET_DEAD');
  });

  it('applies a damage skill to another player and spends its mana', () => {
    const world = createTestWorld({ pvpEnabled: true });
    world.addPlayer(warrior(center({ x: 12, y: 12 })));
    world.addPlayer({
      id: 'player-2',
      displayName: 'Bob',
      classId: 'warrior',
      level: 1,
      hp: 120,
      mp: 30,
      ...center({ x: 13, y: 12 }),
    });

    const cast = world.castSkill('player-1', 'warrior_heavy_strike', 'player-2');
    expect(cast.accepted).toBe(true);
    expect(cast.events[0]?.kind).toBe('attack');
    expect(world.getPlayer('player-1')?.mp).toBe(24);
    const target = world.getPlayer('player-2');
    expect(target?.hp).toBeLessThan(120);
  });

  it('reports the room pvp rule and revive time in the combat profile', () => {
    const world = createTestWorld({ pvpEnabled: true, playerRespawnMs: 2_500 });
    addDuelists(world);
    const profile = world.getProfile('player-1');
    expect(profile?.pvpEnabled).toBe(true);
    expect(profile?.reviveMs).toBe(2_500);
  });
});

describe('CombatWorld mana regeneration', () => {
  it('restores class mana once per second and caps at max', () => {
    const world = createTestWorld();
    world.addPlayer(warrior({ classId: 'mage', hp: 80, mp: 0 }));

    advance(world, 500);
    expect(world.getPlayer('player-1')?.mp).toBe(0);
    advance(world, 500);
    expect(world.getPlayer('player-1')?.mp).toBe(3);
    advance(world, 2_000);
    expect(world.getPlayer('player-1')?.mp).toBe(9);
    advance(world, 60_000);
    expect(world.getPlayer('player-1')?.mp).toBe(80);
  });

  it('does not regenerate while dead', () => {
    const world = createTestWorld({ playerRespawnMs: 60_000 });
    world.addPlayer(warrior({ classId: 'mage', hp: 0, mp: 0 }));

    advance(world, 5_000);
    expect(world.getPlayer('player-1')?.alive).toBe(false);
    expect(world.getPlayer('player-1')?.mp).toBe(0);
  });

  it('reads the rate from the injected content release', () => {
    const bundle = JSON.parse(JSON.stringify(BASE_CONTENT_BUNDLE)) as ContentBundle;
    bundle.classes.warrior.mpRegenPerSecond = 0;
    bundle.classes.mage.mpRegenPerSecond = 10;
    const world = createTestWorld({ content: bundle });
    world.addPlayer(warrior({ mp: 0 }));
    world.addPlayer(
      warrior({
        id: 'player-2',
        classId: 'mage',
        hp: 80,
        mp: 0,
        ...center({ x: 7, y: 5 }),
      }),
    );

    advance(world, 2_000);
    expect(world.getPlayer('player-1')?.mp).toBe(0);
    expect(world.getPlayer('player-2')?.mp).toBe(20);
  });
});

describe('CombatWorld mana regen carry', () => {
  it('keeps the partial second across an HP-only consumable', () => {
    const world = createTestWorld();
    world.addPlayer(warrior({ classId: 'mage', hp: 40, mp: 0 }));

    advance(world, 900);
    expect(world.getPlayer('player-1')?.mp).toBe(0);
    world.setPlayerVitals('player-1', { hp: 80, mp: 0 });
    advance(world, 100);
    expect(world.getPlayer('player-1')?.mp).toBe(3);
  });

  it('resets the carry when a consumable changes MP', () => {
    const world = createTestWorld();
    world.addPlayer(warrior({ classId: 'mage', hp: 40, mp: 0 }));

    advance(world, 900);
    world.setPlayerVitals('player-1', { hp: 80, mp: 10 });
    advance(world, 500);
    expect(world.getPlayer('player-1')?.mp).toBe(10);
    advance(world, 500);
    expect(world.getPlayer('player-1')?.mp).toBe(13);
  });
});

const ALPHA_SPAWN = {
  id: 'wilds_alpha_1',
  monsterId: 'alpha_wolf',
  tile: { x: 5, y: 5 },
} as const;

function contentWithMonster(
  monsterId: string,
  mutate: (monster: ContentBundle['monsters'][string]) => void,
): ContentBundle {
  const bundle = JSON.parse(JSON.stringify(BASE_CONTENT_BUNDLE)) as ContentBundle;
  mutate(bundle.monsters[monsterId] as ContentBundle['monsters'][string]);
  return bundle;
}

describe('CombatWorld monster threat', () => {
  it('telegraphs the impact point and only rolls damage when it lands', () => {
    const content = contentWithMonster('alpha_wolf', (alpha) => {
      alpha.hitChance = 1;
    });
    const world = createTestWorld({ spawns: [ALPHA_SPAWN], content, monsterRespawnMs: 60_000 });
    world.addPlayer(warrior());

    const opening = world.step(50, positions(world));
    const telegraph = opening.find((event) => event.kind === 'telegraph');
    expect(telegraph).toMatchObject({
      sourceId: ALPHA_SPAWN.id,
      sourceType: 'monster',
      targetId: 'player-1',
      radiusTiles: 1.5,
      impactInMs: 900,
      x: center({ x: 4, y: 5 }).x,
      y: center({ x: 4, y: 5 }).y,
    });
    expect(opening.some((event) => event.kind === 'hit' || event.kind === 'attack')).toBe(false);
    expect(world.getPlayer('player-1')?.hp).toBe(120);

    advance(world, 900);
    expect(world.getPlayer('player-1')?.hp).toBeLessThan(120);
  });

  it('misses when the target leaves the telegraphed radius', () => {
    const content = contentWithMonster('alpha_wolf', (alpha) => {
      alpha.hitChance = 1;
    });
    const world = createTestWorld({ spawns: [ALPHA_SPAWN], content, monsterRespawnMs: 60_000 });
    world.addPlayer(warrior());
    world.step(50, positions(world));

    // Step out of the pounce area before the wind-up finishes.
    const moved = new Map([['player-1', center({ x: 9, y: 5 })]]);
    const events: CombatEventPayload[] = [];
    for (let elapsed = 0; elapsed < 900; elapsed += 50) {
      events.push(...world.step(50, moved));
    }

    expect(eventKinds(events)).toContain('miss');
    expect(events.some((event) => event.kind === 'hit')).toBe(false);
    expect(world.getPlayer('player-1')?.hp).toBe(120);
  });

  it('cancels a committed attack when the monster dies during the wind-up', () => {
    const content = contentWithMonster('alpha_wolf', (alpha) => {
      alpha.maxHp = 1;
      alpha.defense = 0;
    });
    const world = createTestWorld({ spawns: [ALPHA_SPAWN], content, monsterRespawnMs: 60_000 });
    world.addPlayer(warrior());
    world.step(50, positions(world));

    const kill = world.basicAttack('player-1', ALPHA_SPAWN.id);
    expect(kill.accepted).toBe(true);
    expect(world.getMonster(ALPHA_SPAWN.id)?.state).toBe('dead');

    advance(world, 1_500);
    expect(world.getPlayer('player-1')?.hp).toBe(120);
  });

  it('freezes the monster in place while the attack is committed', () => {
    const world = createTestWorld({
      spawns: [{ ...ALPHA_SPAWN, tile: { x: 6, y: 5 } }],
      monsterRespawnMs: 60_000,
    });
    world.addPlayer(warrior());
    world.step(50, positions(world));
    const committedAt = world.getMonster(ALPHA_SPAWN.id)?.x;

    // The target runs; the committed pounce must not turn into a chase until
    // the impact resolves.
    const fleeing = new Map([['player-1', center({ x: 1, y: 5 })]]);
    for (let elapsed = 0; elapsed < 800; elapsed += 50) {
      world.step(50, fleeing);
      expect(world.getMonster(ALPHA_SPAWN.id)?.moving).toBe(false);
      expect(world.getMonster(ALPHA_SPAWN.id)?.x).toBe(committedAt);
    }

    advance(world, 300);
    expect(world.getMonster(ALPHA_SPAWN.id)?.x).not.toBe(committedAt);
  });

  it('lets a ranged monster attack without closing to melee', () => {
    const spawn = {
      id: 'wilds_spider_1',
      monsterId: 'venom_spider',
      tile: { x: 5, y: 5 },
    } as const;
    const content = contentWithMonster('venom_spider', (spider) => {
      spider.hitChance = 1;
    });
    const world = createTestWorld({ spawns: [spawn], content, monsterRespawnMs: 60_000 });
    world.addPlayer(warrior({ ...center({ x: 8, y: 5 }) }));
    const startX = world.getMonster(spawn.id)?.x;

    const events = world.step(100, positions(world));

    expect(eventKinds(events)).toContain('attack');
    expect(world.getPlayer('player-1')?.hp).toBeLessThan(120);
    expect(world.getMonster(spawn.id)?.x).toBe(startX);
  });
});

const BOSS_SPAWN = {
  id: 'ruins_colossus_1',
  monsterId: 'ashen_colossus',
  tile: { x: 5, y: 5 },
} as const;

function bossWorld(maxHp: number, monsterRespawnMs = 60_000) {
  const content = contentWithMonster('ashen_colossus', (boss) => {
    boss.maxHp = maxHp;
  });
  return createTestWorld({ spawns: [BOSS_SPAWN], content, monsterRespawnMs });
}

function bossFighter() {
  return warrior({ level: 10, hp: 280, mp: 30, ...center({ x: 4, y: 5 }) });
}

function attackUntilEnrage(world: ReturnType<typeof createTestWorld>): CombatEventPayload[] {
  const events: CombatEventPayload[] = [];
  for (let attempt = 0; attempt < 20; attempt += 1) {
    events.push(...world.basicAttack('player-1', BOSS_SPAWN.id).events);
    if (events.some((event) => event.kind === 'enrage')) {
      break;
    }
    advance(world, 900);
  }
  return events;
}

describe('CombatWorld boss enrage phase', () => {
  it('computes the content phase multipliers for the baseline boss', () => {
    const boss = requireMonster('ashen_colossus');
    expect(monsterStatsAtPhase(boss, false)).toEqual({
      attack: 44,
      attackIntervalMs: 3_200,
      moveSpeedUnitsPerSecond: 800,
      windupRadiusTiles: 1.9,
    });
    expect(monsterStatsAtPhase(boss, true)).toEqual({
      attack: 55,
      attackIntervalMs: 2_400,
      moveSpeedUnitsPerSecond: 960,
      windupRadiusTiles: 2.6,
    });
    // A monster without an enrage phase keeps its base stats forever.
    const slime = requireMonster('wild_slime');
    expect(monsterStatsAtPhase(slime, true)).toEqual(monsterStatsAtPhase(slime, false));
  });

  it('switches phase once when hp crosses the threshold and reports it', () => {
    const world = bossWorld(100);
    world.addPlayer(bossFighter());

    const events = attackUntilEnrage(world);
    expect(countKind(events, 'enrage')).toBe(1);
    const enrage = events.find((event) => event.kind === 'enrage');
    expect(enrage).toMatchObject({
      entityId: BOSS_SPAWN.id,
      entityType: 'monster',
      maxHp: 100,
    });
    expect(enrage?.kind === 'enrage' ? enrage.hp : -1).toBeLessThanOrEqual(50);
    expect(world.getMonster(BOSS_SPAWN.id)?.boss).toBe(true);
    expect(world.getMonster(BOSS_SPAWN.id)?.enraged).toBe(true);

    // Further damage stays in the same phase; the transition is not repeated.
    const later: CombatEventPayload[] = [];
    for (let attempt = 0; attempt < 4; attempt += 1) {
      later.push(...world.basicAttack('player-1', BOSS_SPAWN.id).events);
      advance(world, 900);
    }
    expect(countKind(later, 'enrage')).toBe(0);
  });

  it('does not enrage when the killing blow crosses the threshold', () => {
    const world = bossWorld(20);
    world.addPlayer(bossFighter());

    const result = world.basicAttack('player-1', BOSS_SPAWN.id);
    expect(result.accepted).toBe(true);
    expect(countKind(result.events, 'death')).toBe(1);
    expect(countKind(result.events, 'enrage')).toBe(0);
    expect(world.getMonster(BOSS_SPAWN.id)?.state).toBe('dead');
    expect(world.getMonster(BOSS_SPAWN.id)?.enraged).toBe(false);
  });

  it('resets the phase on respawn so the next pull starts calm', () => {
    const world = bossWorld(100, 1_000);
    world.addPlayer(bossFighter());
    attackUntilEnrage(world);
    expect(world.getMonster(BOSS_SPAWN.id)?.enraged).toBe(true);

    while (world.getMonster(BOSS_SPAWN.id)?.state !== 'dead') {
      world.basicAttack('player-1', BOSS_SPAWN.id);
      advance(world, 900);
    }
    expect(world.getMonster(BOSS_SPAWN.id)?.enraged).toBe(false);

    const respawn = world.step(1_000, positions(world));
    expect(respawn.some((event) => event.kind === 'spawn')).toBe(true);
    expect(world.getMonster(BOSS_SPAWN.id)?.hp).toBe(100);
    expect(world.getMonster(BOSS_SPAWN.id)?.enraged).toBe(false);
  });
});

function countKind(events: readonly CombatEventPayload[], kind: string): number {
  return events.filter((event) => event.kind === kind).length;
}
