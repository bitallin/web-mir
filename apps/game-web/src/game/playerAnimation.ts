import type { CharacterAnimation, CharacterAnimations, CharacterClip } from '@web-legend/contracts';

/** Two-frame walk used by sheets that predate the clip table. */
export const FALLBACK_ANIMATIONS: CharacterAnimations = {
  idle: { frames: [0], frameMs: 400, loop: true },
  walk: { frames: [0, 1], frameMs: 150, loop: true },
};

export type OneShot = {
  clip: CharacterClip;
  /** Scene clock value (ms) at which the clip returns to walk/idle. */
  endMs: number;
};

export type ClipState = {
  alive: boolean;
  moving: boolean;
  oneShot: OneShot | null;
};

/** Death wins over everything; a one-shot clip wins over movement. */
export function resolveClip(state: ClipState, nowMs: number): CharacterClip {
  if (!state.alive) {
    return 'death';
  }
  if (state.oneShot !== null && nowMs < state.oneShot.endMs) {
    return state.oneShot.clip;
  }
  return state.moving ? 'walk' : 'idle';
}

export function animationFor(
  animations: CharacterAnimations | undefined,
  clip: CharacterClip,
): CharacterAnimation | undefined {
  return animations?.[clip];
}

/** Looping clips wrap; one-shot clips hold their last frame. */
export function frameIndexFor(animation: CharacterAnimation, elapsedMs: number): number {
  const first = animation.frames[0] ?? 0;
  if (animation.frames.length <= 1) {
    return first;
  }
  const steps = Math.floor(Math.max(0, elapsedMs) / animation.frameMs);
  const index = animation.loop
    ? steps % animation.frames.length
    : Math.min(steps, animation.frames.length - 1);
  return animation.frames[index] ?? first;
}

export function oneShotMs(
  animations: CharacterAnimations | undefined,
  clip: CharacterClip,
): number {
  const animation = animationFor(animations, clip);
  if (animation === undefined) {
    return 0;
  }
  return animation.frames.length * animation.frameMs;
}
