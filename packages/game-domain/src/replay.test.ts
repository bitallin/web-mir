import type { CombatEventPayload } from '@web-legend/contracts';
import { describe, expect, it } from 'vitest';

import { center, createTestWorld, positions } from './testSupport';

function describeEvent(event: CombatEventPayload): string {
  switch (event.kind) {
    case 'attack':
      return `attack ${event.sourceType}:${event.sourceId} -> ${event.targetType}:${event.targetId}${
        event.skillId === undefined ? '' : ` [${event.skillId}]`
      }`;
    case 'hit':
      return `hit ${event.sourceId} -> ${event.targetId} ${String(event.damage)}${
        event.critical ? ' crit' : ''
      } hp=${String(event.targetHp)}/${String(event.targetMaxHp)}`;
    case 'miss':
      return `miss ${event.sourceId} -> ${event.targetId}`;
    case 'heal':
      return `heal ${event.targetId} +${String(event.amount)} hp=${String(event.targetHp)}`;
    case 'shield':
      return `shield ${event.targetId} ${String(event.amount)} for ${String(event.expiresInMs)}ms`;
    case 'death':
      return `death ${event.entityType}:${event.entityId}`;
    case 'spawn':
      return `spawn ${event.entityId} hp=${String(event.hp)}`;
    case 'respawn':
      return `respawn ${event.entityId} at ${String(event.x)},${String(event.y)} hp=${String(event.hp)}`;
    case 'telegraph':
      return `telegraph ${event.sourceId} -> ${event.targetId} at ${String(event.x)},${String(event.y)} in ${String(event.impactInMs)}ms`;
  }
}

/**
 * A fixed 12-second skirmish used as the phase-4 combat replay fixture. The
 * inline snapshot proves that the same seed, inputs and tick count produce the
 * same authoritative event stream.
 */
describe('combat replay fixture', () => {
  it('produces a stable event summary for a seeded two-player fight', () => {
    const world = createTestWorld({ seed: 'phase4-replay', monsterRespawnMs: 4_000 });
    world.addPlayer({
      id: 'warrior-1',
      displayName: 'Iron',
      classId: 'warrior',
      level: 1,
      hp: 120,
      mp: 30,
      ...center({ x: 4, y: 5 }),
    });
    world.addPlayer({
      id: 'mage-1',
      displayName: 'Ember',
      classId: 'mage',
      level: 1,
      hp: 80,
      mp: 80,
      ...center({ x: 5, y: 7 }),
    });

    const events: CombatEventPayload[] = [];
    const tickMs = 50;
    const durationMs = 12_000;
    for (let elapsed = 0; elapsed < durationMs; elapsed += tickMs) {
      if (elapsed % 900 === 0) {
        events.push(...world.basicAttack('warrior-1', 'wilds_slime_1').events);
      }
      if (elapsed % 3_000 === 0) {
        events.push(...world.castSkill('mage-1', 'mage_fireball', 'wilds_slime_1').events);
      }
      events.push(...world.step(tickMs, positions(world)));
    }

    const counts: Record<string, number> = {};
    for (const event of events) {
      counts[event.kind] = (counts[event.kind] ?? 0) + 1;
    }

    const summary = {
      durationMs,
      tickMs,
      counts,
      events: events.map(describeEvent),
      players: world.listPlayers().map((player) => ({
        id: player.id,
        hp: player.hp,
        mp: player.mp,
        alive: player.alive,
      })),
      monsters: world.listMonsters().map((monster) => ({
        id: monster.id,
        state: monster.state,
        hp: monster.hp,
        x: monster.x,
        y: monster.y,
      })),
    };

    expect(summary).toMatchInlineSnapshot(`
      {
        "counts": {
          "attack": 14,
          "death": 2,
          "hit": 13,
          "miss": 1,
          "spawn": 1,
        },
        "durationMs": 12000,
        "events": [
          "attack player:warrior-1 -> monster:wilds_slime_1",
          "hit warrior-1 -> wilds_slime_1 10 hp=40/50",
          "attack player:mage-1 -> monster:wilds_slime_1 [mage_fireball]",
          "hit mage-1 -> wilds_slime_1 16 hp=24/50",
          "attack monster:wilds_slime_1 -> player:warrior-1",
          "hit wilds_slime_1 -> warrior-1 2 hp=118/120",
          "attack player:warrior-1 -> monster:wilds_slime_1",
          "hit warrior-1 -> wilds_slime_1 11 hp=13/50",
          "attack monster:wilds_slime_1 -> player:warrior-1",
          "miss wilds_slime_1 -> warrior-1",
          "attack player:warrior-1 -> monster:wilds_slime_1",
          "hit warrior-1 -> wilds_slime_1 10 hp=3/50",
          "attack player:warrior-1 -> monster:wilds_slime_1",
          "hit warrior-1 -> wilds_slime_1 11 hp=0/50",
          "death monster:wilds_slime_1",
          "spawn wilds_slime_1 hp=50",
          "attack monster:wilds_slime_1 -> player:warrior-1",
          "hit wilds_slime_1 -> warrior-1 2 hp=116/120",
          "attack player:warrior-1 -> monster:wilds_slime_1",
          "hit warrior-1 -> wilds_slime_1 10 hp=40/50",
          "attack player:warrior-1 -> monster:wilds_slime_1",
          "hit warrior-1 -> wilds_slime_1 11 hp=29/50",
          "attack monster:wilds_slime_1 -> player:warrior-1",
          "hit wilds_slime_1 -> warrior-1 2 hp=114/120",
          "attack player:warrior-1 -> monster:wilds_slime_1",
          "hit warrior-1 -> wilds_slime_1 12 hp=17/50",
          "attack player:mage-1 -> monster:wilds_slime_1 [mage_fireball]",
          "hit mage-1 -> wilds_slime_1 16 hp=1/50",
          "attack player:warrior-1 -> monster:wilds_slime_1",
          "hit warrior-1 -> wilds_slime_1 12 hp=0/50",
          "death monster:wilds_slime_1",
        ],
        "monsters": [
          {
            "hp": 0,
            "id": "wilds_slime_1",
            "state": "dead",
            "x": 5500,
            "y": 5500,
          },
        ],
        "players": [
          {
            "alive": true,
            "hp": 114,
            "id": "warrior-1",
            "mp": 30,
          },
          {
            "alive": true,
            "hp": 80,
            "id": "mage-1",
            "mp": 79,
          },
        ],
        "tickMs": 50,
      }
    `);
  });
});
