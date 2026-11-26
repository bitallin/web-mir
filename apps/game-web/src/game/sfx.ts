/**
 * Placeholder combat audio. The project ships no sound assets yet, so each cue
 * is a short synthesized tone instead of a faked/missing sound. The player is
 * created lazily after a user gesture because browsers suspend AudioContext
 * until then; failures leave the game silent rather than breaking the session.
 */

export type SfxKind =
  'attack' | 'hit' | 'hurt' | 'kill' | 'death' | 'heal' | 'loot' | 'levelup' | 'warn';

type Tone = {
  frequency: number;
  endFrequency?: number;
  durationMs: number;
  type: OscillatorType;
  gain: number;
  delayMs?: number;
};

const TONES: Record<SfxKind, readonly Tone[]> = {
  attack: [{ frequency: 210, endFrequency: 160, durationMs: 70, type: 'square', gain: 0.05 }],
  hit: [{ frequency: 120, endFrequency: 80, durationMs: 80, type: 'sawtooth', gain: 0.06 }],
  hurt: [{ frequency: 90, endFrequency: 60, durationMs: 120, type: 'sawtooth', gain: 0.07 }],
  kill: [
    { frequency: 160, endFrequency: 110, durationMs: 140, type: 'triangle', gain: 0.06 },
    {
      frequency: 240,
      endFrequency: 160,
      durationMs: 140,
      type: 'triangle',
      gain: 0.04,
      delayMs: 70,
    },
  ],
  death: [
    { frequency: 140, endFrequency: 60, durationMs: 420, type: 'sine', gain: 0.08 },
    { frequency: 70, endFrequency: 40, durationMs: 520, type: 'sine', gain: 0.05, delayMs: 120 },
  ],
  heal: [
    { frequency: 520, endFrequency: 720, durationMs: 180, type: 'sine', gain: 0.04 },
    { frequency: 780, endFrequency: 940, durationMs: 160, type: 'sine', gain: 0.03, delayMs: 90 },
  ],
  loot: [
    { frequency: 880, durationMs: 70, type: 'triangle', gain: 0.05 },
    { frequency: 1_180, durationMs: 90, type: 'triangle', gain: 0.04, delayMs: 60 },
  ],
  levelup: [
    { frequency: 523, durationMs: 110, type: 'triangle', gain: 0.05 },
    { frequency: 659, durationMs: 110, type: 'triangle', gain: 0.05, delayMs: 100 },
    { frequency: 784, durationMs: 220, type: 'triangle', gain: 0.06, delayMs: 200 },
  ],
  warn: [{ frequency: 330, endFrequency: 260, durationMs: 180, type: 'square', gain: 0.045 }],
};

const STORAGE_KEY = 'web-legend.sfx-muted';
const MIN_INTERVAL_MS = 35;

function readMuted(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function storeMuted(muted: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, muted ? '1' : '0');
  } catch {
    // Storage is optional; the session keeps its in-memory setting.
  }
}

export function isSfxMuted(): boolean {
  return readMuted();
}

export class SfxPlayer {
  private context: AudioContext | null = null;
  private muted = readMuted();
  private lastPlayedAt = 0;
  private readonly onGesture = (): void => {
    this.unlock();
  };

  constructor() {
    window.addEventListener('pointerdown', this.onGesture, { passive: true });
    window.addEventListener('keydown', this.onGesture);
  }

  get isMuted(): boolean {
    return this.muted;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    storeMuted(muted);
  }

  play(kind: SfxKind): void {
    if (this.muted) {
      return;
    }
    const now = performance.now();
    if (now - this.lastPlayedAt < MIN_INTERVAL_MS) {
      return;
    }
    const context = this.ensureContext();
    if (context === null || context.state !== 'running') {
      return;
    }
    this.lastPlayedAt = now;
    const startedAt = context.currentTime;
    for (const tone of TONES[kind]) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const delay = (tone.delayMs ?? 0) / 1_000;
      const duration = tone.durationMs / 1_000;
      const start = startedAt + delay;
      const end = start + duration;

      oscillator.type = tone.type;
      oscillator.frequency.setValueAtTime(tone.frequency, start);
      if (tone.endFrequency !== undefined) {
        oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, tone.endFrequency), end);
      }
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(tone.gain, start + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, end);

      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(start);
      oscillator.stop(end + 0.02);
    }
  }

  dispose(): void {
    window.removeEventListener('pointerdown', this.onGesture);
    window.removeEventListener('keydown', this.onGesture);
    const context = this.context;
    this.context = null;
    if (context !== null) {
      void context.close().catch(() => undefined);
    }
  }

  private unlock(): void {
    const context = this.ensureContext();
    if (context !== null && context.state === 'suspended') {
      void context.resume().catch(() => undefined);
    }
  }

  private ensureContext(): AudioContext | null {
    if (this.context !== null) {
      return this.context;
    }
    try {
      this.context = new AudioContext();
      return this.context;
    } catch {
      return null;
    }
  }
}
