import { describe, expect, it } from 'vitest';

import {
  CHARACTER_CLASSES,
  CHARACTER_CLASS_CATALOG,
  characterNameSchema,
  createCharacterRequestSchema,
  gameTicketResponseSchema,
  normalizeCharacterName,
} from './character';

const validCharacterView = {
  id: '0192f0a0-0000-7000-8000-000000000001',
  name: '烈焰',
  classId: 'warrior',
  level: 1,
  exp: 0,
  hp: 120,
  maxHp: 120,
  mp: 30,
  maxMp: 30,
  mapId: 'starter_town',
  x: 15_500,
  y: 10_500,
  facing: 2,
  realmId: '0192f0a0-0000-7000-8000-000000000002',
  realmCode: 'classic-01',
  createdAt: '2026-11-24T10:00:00.000Z',
};

describe('character names', () => {
  it('normalizes width and case for uniqueness', () => {
    expect(normalizeCharacterName('  Ａlice  ')).toBe('alice');
    expect(normalizeCharacterName('烈焰')).toBe('烈焰');
  });

  it('trims and NFKC-normalizes accepted names', () => {
    expect(characterNameSchema.parse('  Ａlice  ')).toBe('Alice');
  });

  it('accepts Chinese, letters, digits and underscore', () => {
    for (const name of ['烈焰', 'Alice_01', '道2士']) {
      expect(characterNameSchema.safeParse(name).success).toBe(true);
    }
  });

  it('rejects names that are too short, too long or contain symbols', () => {
    for (const name of ['焰', 'x'.repeat(13), 'a b', 'a-b', 'a<script>']) {
      expect(characterNameSchema.safeParse(name).success).toBe(false);
    }
  });
});

describe('character classes', () => {
  it('exposes a complete catalog with positive base stats', () => {
    expect(CHARACTER_CLASSES).toEqual(['warrior', 'mage', 'taoist']);
    for (const id of CHARACTER_CLASSES) {
      const definition = CHARACTER_CLASS_CATALOG[id];
      expect(definition.id).toBe(id);
      expect(definition.name.length).toBeGreaterThan(0);
      expect(definition.baseMaxHp).toBeGreaterThan(0);
      expect(definition.baseMaxMp).toBeGreaterThan(0);
    }
  });

  it('rejects unknown classes and extra client-supplied fields', () => {
    expect(
      createCharacterRequestSchema.safeParse({ name: '烈焰', classId: 'assassin' }).success,
    ).toBe(false);
    expect(
      createCharacterRequestSchema.safeParse({ name: '烈焰', classId: 'warrior', level: 99 })
        .success,
    ).toBe(false);
  });
});

describe('game ticket response', () => {
  it('binds the ticket to the server-rendered character view', () => {
    const parsed = gameTicketResponseSchema.parse({
      ticket: 't'.repeat(43),
      expiresAt: '2026-11-24T10:01:00.000Z',
      character: validCharacterView,
    });

    expect(parsed.character.id).toBe(validCharacterView.id);
  });

  it('rejects a character view missing realm information', () => {
    const { realmCode: _realmCode, ...incomplete } = validCharacterView;
    expect(
      gameTicketResponseSchema.safeParse({
        ticket: 't'.repeat(43),
        expiresAt: '2026-11-24T10:01:00.000Z',
        character: incomplete,
      }).success,
    ).toBe(false);
  });
});
