import { describe, expect, it } from 'vitest';

import { InterestManager } from './interest';

const config = { cellSize: 8, radiusCells: 1 };

describe('InterestManager', () => {
  it('includes nearby cells and excludes distant ones', () => {
    const interest = new InterestManager(config);
    interest.add('alice', { x: 10, y: 10 });
    interest.add('bob', { x: 20, y: 12 });
    interest.add('carol', { x: 36, y: 26 });

    expect([...interest.visibleIdsFor('alice')].sort()).toEqual(['alice', 'bob']);
    expect([...interest.visibleIdsFor('bob')].sort()).toEqual(['alice', 'bob']);
    expect([...interest.visibleIdsFor('carol')]).toEqual(['carol']);
  });

  it('collects visible ids into a caller-owned set without clearing it', () => {
    const interest = new InterestManager(config);
    interest.add('alice', { x: 10, y: 10 });
    interest.add('bob', { x: 11, y: 10 });

    const seen = new Set(['carol']);
    interest.collectVisibleIds('alice', seen);
    expect([...seen].sort()).toEqual(['alice', 'bob', 'carol']);

    const empty = new Set<string>();
    interest.collectVisibleIds('missing', empty);
    expect(empty.size).toBe(0);
  });

  it('reports both neighbourhoods when an entity crosses a cell boundary', () => {
    const interest = new InterestManager(config);
    interest.add('alice', { x: 10, y: 10 });
    interest.add('bob', { x: 20, y: 12 });
    interest.add('carol', { x: 36, y: 26 });

    const affected = interest.move('alice', { x: 26, y: 18 }).sort();

    expect(affected).toEqual(['alice', 'bob', 'carol']);
    expect([...interest.visibleIdsFor('alice')].sort()).toEqual(['alice', 'bob', 'carol']);
    expect([...interest.visibleIdsFor('carol')].sort()).toEqual(['alice', 'carol']);
    expect([...interest.visibleIdsFor('bob')].sort()).toEqual(['alice', 'bob']);
  });

  it('ignores movement inside one cell', () => {
    const interest = new InterestManager(config);
    interest.add('alice', { x: 10, y: 10 });
    interest.add('bob', { x: 12, y: 11 });

    expect(interest.move('alice', { x: 14, y: 10 })).toEqual([]);
  });

  it('removes an entity from every other entity interest set', () => {
    const interest = new InterestManager(config);
    interest.add('alice', { x: 10, y: 10 });
    interest.add('bob', { x: 12, y: 11 });

    const affected = interest.remove('bob').sort();

    expect(affected).toEqual(['alice', 'bob']);
    expect([...interest.visibleIdsFor('alice')]).toEqual(['alice']);
    expect(interest.visibleIdsFor('bob').size).toBe(0);
    expect(interest.size()).toBe(1);
  });

  it('supports a zero radius and rejects invalid configuration', () => {
    const local = new InterestManager({ cellSize: 4, radiusCells: 0 });
    local.add('alice', { x: 1, y: 1 });
    local.add('bob', { x: 6, y: 1 });
    expect([...local.visibleIdsFor('alice')]).toEqual(['alice']);

    expect(() => new InterestManager({ cellSize: 0, radiusCells: 1 })).toThrow(RangeError);
    expect(() => new InterestManager({ cellSize: 4, radiusCells: -1 })).toThrow(RangeError);
  });

  it('does not duplicate ids when a cell is reached through several neighbours', () => {
    const interest = new InterestManager(config);
    interest.add('alice', { x: 10, y: 10 });
    interest.add('bob', { x: 15, y: 15 });
    const affected = interest.move('bob', { x: 16, y: 16 });
    expect(new Set(affected).size).toBe(affected.length);
  });
});
