import { describe, expect, it } from 'vitest';

import type { CharacterAnimations } from '@web-legend/contracts';

import { animationFor, frameIndexFor, oneShotMs, resolveClip } from './playerAnimation';

const animations: CharacterAnimations = {
  idle: { frames: [0], frameMs: 400, loop: true },
  walk: { frames: [1, 2], frameMs: 100, loop: true },
  attack: { frames: [3, 4], frameMs: 120, loop: false },
  death: { frames: [8, 9], frameMs: 240, loop: false },
};

describe('player animation clips', () => {
  it('prefers death over movement and one-shot clips', () => {
    expect(
      resolveClip({ alive: false, moving: true, oneShot: { clip: 'attack', endMs: 10_000 } }, 0),
    ).toBe('death');
  });

  it('plays a one-shot clip until it ends, then returns to the walk', () => {
    const oneShot = { clip: 'attack' as const, endMs: 500 };
    expect(resolveClip({ alive: true, moving: true, oneShot }, 100)).toBe('attack');
    expect(resolveClip({ alive: true, moving: true, oneShot }, 500)).toBe('walk');
  });

  it('stands idle when no clip is active and the player is still', () => {
    expect(resolveClip({ alive: true, moving: false, oneShot: null }, 0)).toBe('idle');
  });

  it('loops a walking clip across its frames', () => {
    const walk = animations.walk;
    if (walk === undefined) {
      throw new Error('walk clip is missing');
    }
    expect(frameIndexFor(walk, 0)).toBe(1);
    expect(frameIndexFor(walk, 99)).toBe(1);
    expect(frameIndexFor(walk, 100)).toBe(2);
    expect(frameIndexFor(walk, 200)).toBe(1);
  });

  it('holds the last frame of a one-shot clip instead of wrapping', () => {
    const attack = animations.attack;
    if (attack === undefined) {
      throw new Error('attack clip is missing');
    }
    expect(frameIndexFor(attack, 0)).toBe(3);
    expect(frameIndexFor(attack, 120)).toBe(4);
    expect(frameIndexFor(attack, 10_000)).toBe(4);
  });

  it('returns a single frame without waiting for its frame time', () => {
    const idle = animations.idle;
    if (idle === undefined) {
      throw new Error('idle clip is missing');
    }
    expect(frameIndexFor(idle, 0)).toBe(0);
    expect(frameIndexFor(idle, 1_000)).toBe(0);
  });

  it('reports the full one-shot duration and zero for a missing clip', () => {
    expect(oneShotMs(animations, 'attack')).toBe(240);
    expect(oneShotMs(animations, 'cast')).toBe(0);
    expect(animationFor(animations, 'cast')).toBeUndefined();
  });
});
