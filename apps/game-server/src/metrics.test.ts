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

  it('counts combat commands, events and outcomes', () => {
    const metrics = new RoomMetrics('room-1');
    metrics.recordCombatCommand();
    metrics.recordCombatEvents(3);
    metrics.recordMonsterKill();
    metrics.recordPlayerDeath();
    metrics.recordPvpKill();

    const snapshot = metrics.snapshot();
    expect(snapshot.combatCommands).toBe(1);
    expect(snapshot.combatEvents).toBe(3);
    expect(snapshot.monsterKills).toBe(1);
    expect(snapshot.playerDeaths).toBe(1);
    expect(snapshot.pvpKills).toBe(1);
  });

  it('separates patch bytes from other outbound bytes', () => {
    const metrics = new RoomMetrics('room-1');
    metrics.recordWsSent(100, false);
    metrics.recordWsSent(60, true);
    metrics.recordWsSent(40, true);

    const snapshot = metrics.snapshot();
    expect(snapshot.wsSentBytes).toBe(200);
    expect(snapshot.wsPatchBytes).toBe(100);
  });

  it('counts inbound bytes and the connection lifecycle', () => {
    const metrics = new RoomMetrics('room-1');
    metrics.recordWsReceived(120);
    metrics.recordWsReceived(80);
    metrics.recordWsReceived(0);
    metrics.recordWsConnection();
    metrics.recordWsDisconnect();
    metrics.recordWsReconnect();

    const snapshot = metrics.snapshot();
    expect(snapshot.wsReceivedBytes).toBe(200);
    expect(snapshot.wsConnections).toBe(1);
    expect(snapshot.wsDisconnects).toBe(1);
    expect(snapshot.wsReconnects).toBe(1);
  });

  it('counts accepted and filtered chat separately', () => {
    const metrics = new RoomMetrics('room-1');
    metrics.recordChatMessage();
    metrics.recordChatFiltered();

    const snapshot = metrics.snapshot();
    expect(snapshot.chatMessages).toBe(1);
    expect(snapshot.chatFiltered).toBe(1);
  });
});

describe('MetricsRegistry', () => {
  it('reports active rooms and carries totals after a room is disposed', () => {
    const registry = new MetricsRegistry();
    const first = registry.register('room-1');
    first.recordAcceptedCommand();
    first.recordRejectedCommand('UNREACHABLE');
    first.recordChatFiltered();
    first.recordPvpKill();
    first.recordWsReceived(64);
    first.recordWsConnection();
    first.recordWsDisconnect();
    first.recordWsReconnect();
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
    expect(disposed.totals.chatFiltered).toBe(1);
    expect(disposed.totals.pvpKills).toBe(1);
    expect(disposed.totals.wsReceivedBytes).toBe(64);
    expect(disposed.totals.wsConnections).toBe(1);
    expect(disposed.totals.wsDisconnects).toBe(1);
    expect(disposed.totals.wsReconnects).toBe(1);
  });
});
