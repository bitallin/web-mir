import { describe, expect, it } from 'vitest';

import { MetricsRegistry, RoomMetrics } from './metrics';

describe('RoomMetrics', () => {
  it('computes tick percentiles from the sliding window', () => {
    const metrics = new RoomMetrics('room-1', 4);
    for (const duration of [1, 2, 3, 100, 4]) {
      metrics.recordTick(duration);
    }

    // The first sample fell out of the four-sample window.
    const stats = metrics.tickStats();
    expect(stats.samples).toBe(4);
    expect(stats.p50Ms).toBe(3);
    expect(stats.p95Ms).toBe(100);
    expect(stats.maxMs).toBe(100);
  });

  it('counts accepted and rejected commands by code', () => {
    const metrics = new RoomMetrics('room-1');
    metrics.recordAcceptedCommand();
    metrics.recordRejectedCommand('RATE_LIMITED');
    metrics.recordRejectedCommand('INVALID_TARGET');

    const snapshot = metrics.snapshot();
    expect(snapshot.acceptedCommands).toBe(1);
    expect(snapshot.rejectedCommands).toBe(2);
    expect(snapshot.rejectionsByCode).toEqual({
      RATE_LIMITED: 1,
      INVALID_TARGET: 1,
    });
  });
});

describe('MetricsRegistry', () => {
  it('reports active rooms and carries totals after a room is disposed', () => {
    const registry = new MetricsRegistry();
    const first = registry.register('room-1');
    first.recordAcceptedCommand();
    first.recordRejectedCommand('UNREACHABLE');
    first.setPlayers(2);

    const active = registry.snapshot();
    expect(active.rooms).toHaveLength(1);
    expect(active.rooms[0]?.players).toBe(2);
    expect(active.totals.acceptedCommands).toBe(1);

    registry.unregister('room-1');
    const disposed = registry.snapshot();
    expect(disposed.rooms).toHaveLength(0);
    expect(disposed.totals.roomsCreated).toBe(1);
    expect(disposed.totals.acceptedCommands).toBe(1);
    expect(disposed.totals.rejectedCommands).toBe(1);
  });
});
