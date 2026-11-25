import { describe, expect, it } from 'vitest';

import {
  MONSTER_STATE_CODES,
  MONSTER_STATES,
  combatBasicAttackSchema,
  combatEventSchema,
  combatProfileSchema,
  monsterStateKindFromCode,
  skillCastSchema,
} from './combat';

const commandId = '0190f2b4-7c1e-7a3c-9f2e-1b2c3d4e5f60';

describe('combat commands', () => {
  it('accepts a basic attack with an intent-only body', () => {
    const parsed = combatBasicAttackSchema.parse({
      protocolVersion: 1,
      commandId,
      clientSequence: 12,
      targetId: 'wilds_slime_1',
    });
    expect(parsed.targetId).toBe('wilds_slime_1');
  });

  it('rejects forged damage fields and malformed targets', () => {
    expect(
      combatBasicAttackSchema.safeParse({
        protocolVersion: 1,
        commandId,
        clientSequence: 0,
        targetId: 'wilds_slime_1',
        damage: 999,
      }).success,
    ).toBe(false);
    expect(
      combatBasicAttackSchema.safeParse({
        protocolVersion: 1,
        commandId,
        clientSequence: -1,
        targetId: 'wilds_slime_1',
      }).success,
    ).toBe(false);
    expect(
      combatBasicAttackSchema.safeParse({
        protocolVersion: 1,
        commandId,
        clientSequence: 0,
        targetId: '../../etc/passwd',
      }).success,
    ).toBe(false);
  });

  it('accepts skill casts and rejects unknown skill ids', () => {
    expect(
      skillCastSchema.safeParse({
        protocolVersion: 1,
        commandId,
        clientSequence: 1,
        skillId: 'warrior_heavy_strike',
        targetId: 'wilds_slime_1',
      }).success,
    ).toBe(true);
    expect(
      skillCastSchema.safeParse({
        protocolVersion: 1,
        commandId,
        clientSequence: 1,
        skillId: 'Fire Ball',
        targetId: 'wilds_slime_1',
      }).success,
    ).toBe(false);
  });
});

describe('combat events', () => {
  it('validates every event variant', () => {
    const base = { eventId: commandId, serverTime: 1_000 };
    const events = [
      {
        ...base,
        kind: 'attack',
        sourceId: 'player-1',
        sourceType: 'player',
        targetId: 'wilds_slime_1',
        targetType: 'monster',
        skillId: 'warrior_heavy_strike',
      },
      {
        ...base,
        kind: 'hit',
        sourceId: 'player-1',
        sourceType: 'player',
        targetId: 'wilds_slime_1',
        targetType: 'monster',
        damage: 12,
        critical: true,
        targetHp: 38,
        targetMaxHp: 50,
      },
      {
        ...base,
        kind: 'miss',
        sourceId: 'wilds_slime_1',
        sourceType: 'monster',
        targetId: 'player-1',
        targetType: 'player',
      },
      {
        ...base,
        kind: 'heal',
        sourceId: 'player-1',
        targetId: 'player-1',
        amount: 30,
        targetHp: 90,
        targetMaxHp: 95,
      },
      {
        ...base,
        kind: 'death',
        entityId: 'wilds_slime_1',
        entityType: 'monster',
        killerId: 'player-1',
      },
      {
        ...base,
        kind: 'death',
        entityId: 'player-2',
        entityType: 'player',
        killerId: 'player-1',
        reviveInMs: 3_000,
      },
      {
        ...base,
        kind: 'spawn',
        entityId: 'wilds_slime_1',
        entityType: 'monster',
        templateId: 'wild_slime',
        displayName: '野地史莱姆',
        x: 20_500,
        y: 10_500,
        hp: 50,
        maxHp: 50,
      },
      {
        ...base,
        kind: 'respawn',
        entityId: 'player-1',
        entityType: 'player',
        x: 2_500,
        y: 16_500,
        hp: 120,
        maxHp: 120,
        mp: 30,
        maxMp: 30,
      },
    ];

    for (const event of events) {
      expect(combatEventSchema.safeParse(event).success).toBe(true);
    }
  });

  it('rejects a hit event without a positive damage value', () => {
    expect(
      combatEventSchema.safeParse({
        eventId: commandId,
        serverTime: 1,
        kind: 'hit',
        sourceId: 'player-1',
        sourceType: 'player',
        targetId: 'wilds_slime_1',
        targetType: 'monster',
        damage: 0,
        critical: false,
        targetHp: 50,
        targetMaxHp: 50,
      }).success,
    ).toBe(false);
  });
});

describe('combat profile and monster states', () => {
  it('parses a server-built profile', () => {
    const profile = combatProfileSchema.parse({
      characterId: '0190f2b4-7c1e-7a3c-9f2e-1b2c3d4e5f60',
      classId: 'warrior',
      level: 1,
      attack: 12,
      defense: 8,
      attackIntervalMs: 900,
      attackRangeTiles: 1.4,
      pvpEnabled: true,
      reviveMs: 3_000,
      hp: 120,
      maxHp: 120,
      mp: 30,
      maxMp: 30,
      skills: [
        {
          id: 'warrior_heavy_strike',
          name: '重击',
          description: '蓄力劈砍',
          mpCost: 6,
          cooldownMs: 5_000,
          rangeTiles: 1.6,
          target: 'enemy',
          hotkey: '1',
          cooldownRemainingMs: 0,
        },
      ],
    });
    expect(profile.skills).toHaveLength(1);
    expect(profile.pvpEnabled).toBe(true);
    expect(profile.reviveMs).toBe(3_000);
  });

  it('requires the server-decided pvp rule in a profile', () => {
    expect(
      combatProfileSchema.safeParse({
        characterId: '0190f2b4-7c1e-7a3c-9f2e-1b2c3d4e5f60',
        classId: 'warrior',
        level: 1,
        attack: 12,
        defense: 8,
        attackIntervalMs: 900,
        attackRangeTiles: 1.4,
        hp: 120,
        maxHp: 120,
        mp: 30,
        maxMp: 30,
        skills: [],
      }).success,
    ).toBe(false);
  });

  it('round-trips every monster state code', () => {
    for (const state of MONSTER_STATES) {
      expect(monsterStateKindFromCode(MONSTER_STATE_CODES[state])).toBe(state);
    }
    expect(monsterStateKindFromCode(99)).toBe('idle');
  });
});
