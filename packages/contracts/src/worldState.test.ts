import { describe, expect, it } from 'vitest';

import { PlayerState, WorldState } from './worldState';

describe('WorldState schema', () => {
  it('holds players in a synchronized map', () => {
    const state = new WorldState();
    state.mapId = 'starter_town';
    state.playerCount = 1;

    const player = new PlayerState();
    player.playerId = 'player-1';
    player.displayName = 'Alice';
    player.x = 15_500;
    player.y = 10_500;
    state.players.set(player.playerId, player);

    const stored = state.players.get('player-1');
    expect(stored?.displayName).toBe('Alice');
    expect(stored?.connected).toBe(true);
    expect(state.players.size).toBe(1);

    state.players.delete('player-1');
    expect(state.players.size).toBe(0);
  });

  it('carries protocol-level simulation parameters', () => {
    const state = new WorldState();
    expect(state.tickHz).toBe(20);
    expect(state.speedUnitsPerSecond).toBe(4_000);
  });
});
