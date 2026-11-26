import { describe, expect, it } from 'vitest';

import { LABEL_PADDING, resolveVisibleLabels, rectsOverlap } from './labelLayout';

const rect = (x: number, y: number): { x: number; y: number; width: number; height: number } => ({
  x,
  y,
  width: 40,
  height: 14,
});

describe('resolveVisibleLabels', () => {
  it('keeps every label when none of them touch', () => {
    const visible = resolveVisibleLabels([
      { id: 'self', priority: 1000, distance: 0, rect: rect(0, 0) },
      { id: 'npc', priority: 700, distance: 40, rect: rect(0, 40) },
      { id: 'wolf', priority: 400, distance: 60, rect: rect(80, 40) },
    ]);

    expect([...visible].sort()).toEqual(['npc', 'self', 'wolf']);
  });

  it('hides the lower priority label when two plates collide', () => {
    const visible = resolveVisibleLabels([
      { id: 'self', priority: 1000, distance: 0, rect: rect(0, 0) },
      { id: 'npc', priority: 700, distance: 4, rect: rect(2, 6) },
    ]);

    expect(visible.has('self')).toBe(true);
    expect(visible.has('npc')).toBe(false);
  });

  it('lets a nearer candidate win among equals and hides the farther one', () => {
    const visible = resolveVisibleLabels([
      { id: 'far', priority: 400, distance: 30, rect: rect(0, 0) },
      { id: 'near', priority: 400, distance: 10, rect: rect(4, 4) },
    ]);

    expect(visible.has('near')).toBe(true);
    expect(visible.has('far')).toBe(false);
  });

  it('breaks exact ties by id so the same frame always wins', () => {
    const visible = resolveVisibleLabels([
      { id: 'b', priority: 400, distance: 10, rect: rect(0, 0) },
      { id: 'a', priority: 400, distance: 10, rect: rect(0, 0) },
    ]);

    expect(visible.has('a')).toBe(true);
    expect(visible.has('b')).toBe(false);
  });

  it('treats the padding gap as a collision', () => {
    const a = rect(0, 0);
    const b = rect(0, 14 + LABEL_PADDING - 1);
    expect(rectsOverlap(a, b)).toBe(true);

    const c = rect(0, 14 + LABEL_PADDING);
    expect(rectsOverlap(a, c)).toBe(false);
    expect(
      resolveVisibleLabels([
        { id: 'a', priority: 10, distance: 0, rect: a },
        { id: 'c', priority: 10, distance: 1, rect: c },
      ]),
    ).toEqual(new Set(['a', 'c']));
  });

  it('returns an empty set when there are no labels', () => {
    expect(resolveVisibleLabels([])).toEqual(new Set());
  });
});
