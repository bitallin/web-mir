import type { CombatEventPayload, MapMonsterSpawn } from '@web-legend/contracts';
import { describe, expect, it } from 'vitest';

import { center, createTestWorld, positions } from './testSupport';

const WOLF_SPAWN: MapMonsterSpawn = {
  id: 'wolf_1',
  monsterId: 'forest_wolf',
  tile: { x: 5, y: 5 },
};

function run(
  world: ReturnType<typeof createTestWorld>,
  totalMs: number,
  stepMs = 50,
): CombatEventPayload[] {
  const events: CombatEventPayload[] = [];
  let elapsed = 0;
  while (elapsed < totalMs) {
    const step = Math.min(stepMs, totalMs - elapsed);
    events.push(...world.step(step, positions(world)));
    elapsed += step;
  }
  return events;
}

function addTaoist(world: ReturnType<typeof createTestWorld>, level: number, id = 'taoist-1') {
  world.addPlayer({
    id,
    displayName: 'Herbalist',
    classId: 'taoist',
    level,
    hp: 151,
    mp: 84,
    ...center({ x: 4, y: 5 }),
  });
  return id;
}

describe('damage-over-time effects', () => {
  it('ticks once per second for the full duration and stops afterwards', () => {
    const world = createTestWorld({ spawns: [WOLF_SPAWN], seed: 'dot-ticks' });
    const playerId = addTaoist(world, 5);

    const cast = world.castSkill(playerId, 'taoist_poison', 'wolf_1');
    expect(cast.accepted).toBe(true);

    const beforeFirstTick = run(world, 950);
    expect(
      beforeFirstTick.filter((event) => event.kind === 'hit' && event.periodic === true),
    ).toHaveLength(0);

    const events = run(world, 6_000);
    const ticks = events.filter((event) => event.kind === 'hit' && event.periodic === true);
    expect(ticks).toHaveLength(6);
    for (const tick of ticks) {
      if (tick.kind !== 'hit') {
        throw new Error('unreachable');
      }
      expect(tick.skillId).toBe('taoist_poison');
      expect(tick.damage).toBe(11);
      expect(tick.sourceId).toBe(playerId);
    }

    const after = run(world, 3_000);
    expect(after.filter((event) => event.kind === 'hit' && event.periodic === true)).toHaveLength(
      0,
    );
    expect(world.getMonster('wolf_1')?.hp).toBe(80 - 6 * 11);
  });

  it('kills the target through the caster and clears the effect', () => {
    const world = createTestWorld({ seed: 'dot-kill' });
    const playerId = addTaoist(world, 5);

    expect(world.castSkill(playerId, 'taoist_poison', 'wilds_slime_1').accepted).toBe(true);

    const events = run(world, 5_200);
    const deaths = events.filter((event) => event.kind === 'death');
    expect(deaths).toEqual([
      expect.objectContaining({
        entityId: 'wilds_slime_1',
        entityType: 'monster',
        killerId: playerId,
      }),
    ]);
    expect(world.getMonster('wilds_slime_1')?.state).toBe('dead');

    // The respawn clears the remaining ticks; no damage lands on a dead monster.
    const afterRespawn = run(world, 1_500);
    expect(afterRespawn.filter((event) => event.kind === 'hit' && event.periodic === true)).toEqual(
      [],
    );
    expect(afterRespawn.some((event) => event.kind === 'spawn')).toBe(true);
  });

  it('does not draw RNG, so a seeded follow-up attack keeps its outcome', () => {
    const withDot = createTestWorld({ spawns: [WOLF_SPAWN], seed: 'dot-rng' });
    const withoutDot = createTestWorld({ spawns: [WOLF_SPAWN], seed: 'dot-rng' });
    const dotPlayer = addTaoist(withDot, 5);
    const plainPlayer = addTaoist(withoutDot, 5);

    withDot.castSkill(dotPlayer, 'taoist_poison', 'wolf_1');
    run(withDot, 3_000);
    run(withoutDot, 3_000);

    const summarize = (events: CombatEventPayload[]) =>
      events.map((event) =>
        event.kind === 'hit'
          ? { kind: event.kind, damage: event.damage, critical: event.critical }
          : { kind: event.kind },
      );
    const dotAttack = withDot.basicAttack(dotPlayer, 'wolf_1');
    const plainAttack = withoutDot.basicAttack(plainPlayer, 'wolf_1');
    expect(summarize(dotAttack.events)).toEqual(summarize(plainAttack.events));
  });

  it('gates poison behind level 5 in the combat profile', () => {
    const lowWorld = createTestWorld({ spawns: [WOLF_SPAWN], seed: 'dot-level-4' });
    const lowId = addTaoist(lowWorld, 4);
    expect(lowWorld.getProfile(lowId)?.skills.map((skill) => skill.id)).toEqual(['taoist_heal']);
    expect(lowWorld.castSkill(lowId, 'taoist_poison', 'wolf_1').rejection?.code).toBe(
      'INVALID_TARGET',
    );

    const highWorld = createTestWorld({ spawns: [WOLF_SPAWN], seed: 'dot-level-5' });
    const highId = addTaoist(highWorld, 5);
    expect(highWorld.getProfile(highId)?.skills.map((skill) => skill.id)).toEqual([
      'taoist_heal',
      'taoist_poison',
    ]);
    expect(highWorld.castSkill(highId, 'taoist_poison', 'wolf_1').accepted).toBe(true);
  });
});

describe('shield effects', () => {
  function addWarrior(world: ReturnType<typeof createTestWorld>, level: number) {
    const id = 'warrior-1';
    world.addPlayer({
      id,
      displayName: 'Iron',
      classId: 'warrior',
      level,
      hp: 192,
      mp: 42,
      ...center({ x: 4, y: 5 }),
    });
    return id;
  }

  it('absorbs incoming damage before HP and reports the absorbed amount', () => {
    const world = createTestWorld({ seed: 'shield-absorb' });
    const playerId = addWarrior(world, 5);

    const cast = world.castSkill(playerId, 'warrior_iron_skin', playerId);
    expect(cast.accepted).toBe(true);
    expect(cast.events).toContainEqual(
      expect.objectContaining({ kind: 'shield', amount: 64, expiresInMs: 8_000 }),
    );
    expect(world.getPlayer(playerId)?.shield).toBe(64);

    const events = run(world, 600);
    const hits = events.filter(
      (event): event is Extract<CombatEventPayload, { kind: 'hit' }> =>
        event.kind === 'hit' && event.targetId === playerId,
    );
    expect(hits.length).toBeGreaterThan(0);
    for (const hit of hits) {
      expect(hit.absorbed).toBeGreaterThan(0);
      expect(hit.targetHp).toBe(192);
    }
    expect(world.getPlayer(playerId)?.shield).toBe(
      64 - hits.reduce((sum, hit) => sum + (hit.absorbed ?? 0), 0),
    );
  });

  it('expires after its duration and clears the profile value', () => {
    const world = createTestWorld({ seed: 'shield-expire' });
    const playerId = addWarrior(world, 5);

    world.castSkill(playerId, 'warrior_iron_skin', playerId);
    const events = run(world, 8_100);
    const expiry = events.filter(
      (event) => event.kind === 'shield' && event.targetId === playerId && event.amount === 0,
    );
    expect(expiry).toHaveLength(1);
    expect(world.getPlayer(playerId)?.shield).toBe(0);
    expect(world.getProfile(playerId)?.shield).toBe(0);
  });

  it('gates the shield behind level 5', () => {
    const world = createTestWorld({ seed: 'shield-level' });
    const playerId = addWarrior(world, 4);
    expect(world.castSkill(playerId, 'warrior_iron_skin', playerId).rejection?.code).toBe(
      'INVALID_TARGET',
    );
    expect(world.getProfile(playerId)?.skills).toHaveLength(1);
  });
});
