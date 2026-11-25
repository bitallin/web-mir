import { describe, expect, it } from 'vitest';

import type { MetricsSnapshot } from './metrics';
import { renderGameServerPrometheus } from './prometheus';

const snapshot: MetricsSnapshot = {
  service: 'game-server',
  rooms: [
    {
      roomId: 'room-1',
      mapId: 'starter_town',
      instanceId: '1',
      contentVersion: 'baseline',
      players: 3,
      wsSentBytes: 2048,
      wsPatchBytes: 1024,
      wsReceivedBytes: 512,
      wsConnections: 3,
      wsDisconnects: 1,
      wsReconnects: 1,
      acceptedCommands: 10,
      rejectedCommands: 1,
      rejectionsByCode: { RATE_LIMITED: 1 },
      chatMessages: 2,
      chatFiltered: 0,
      chatMuted: 0,
      transfers: 0,
      combatCommands: 0,
      combatEvents: 0,
      monsterKills: 0,
      playerDeaths: 0,
      pvpKills: 0,
      assetCommands: 1,
      assetFailures: 0,
      lootSpawned: 1,
      lootPickedUp: 1,
      goldGranted: 5,
      expGranted: 10,
      tick: { samples: 4, p50Ms: 1, p95Ms: 2, p99Ms: 3, maxMs: 4 },
      assetTx: { samples: 2, p50Ms: 5, p95Ms: 9, p99Ms: 9 },
    },
  ],
  totals: {
    activeRooms: 1,
    roomsCreated: 1,
    acceptedCommands: 10,
    rejectedCommands: 1,
    wsSentBytes: 2048,
    wsPatchBytes: 1024,
    wsReceivedBytes: 512,
    wsConnections: 3,
    wsDisconnects: 1,
    wsReconnects: 1,
    chatMessages: 2,
    chatFiltered: 0,
    chatMuted: 0,
    transfers: 0,
    combatCommands: 0,
    combatEvents: 0,
    monsterKills: 0,
    playerDeaths: 0,
    pvpKills: 0,
    assetCommands: 1,
    assetFailures: 0,
    lootSpawned: 1,
    lootPickedUp: 1,
    goldGranted: 5,
    expGranted: 10,
  },
  timestamp: '2026-11-25T00:00:00.000Z',
};

const runtime = {
  uptimeSeconds: 12,
  rssBytes: 1024,
  heapUsedBytes: 512,
  heapTotalBytes: 1024,
  externalBytes: 32,
  cpuUserSeconds: 1,
  cpuSystemSeconds: 0.5,
  eventLoop: { p50Ms: 1, p95Ms: 2, p99Ms: 3, maxMs: 4 },
  gcPauseSeconds: 0.01,
  gcCount: 2,
  eventLoopUtilization: 0.1,
};

describe('renderGameServerPrometheus', () => {
  it('labels rooms with realm, map and content version', () => {
    const text = renderGameServerPrometheus(snapshot, runtime, 'classic-01', '0.1.0');

    expect(text).toContain(
      'web_legend_game_server_room_players{room="room-1",realm="classic-01",map="starter_town",instance="1"} 3',
    );
    expect(text).toContain(
      'web_legend_game_server_room_content_info{room="room-1",realm="classic-01",map="starter_town",instance="1",version="baseline"} 1',
    );
    expect(text).toContain('web_legend_game_server_patch_bytes_total{room="room-1"');
    expect(text).toContain(
      'web_legend_game_server_ws_received_bytes_total{room="room-1",realm="classic-01",map="starter_town",instance="1"} 512',
    );
    expect(text).toContain('web_legend_game_server_ws_connections_total{room="room-1"');
    expect(text).toContain('web_legend_game_server_ws_disconnects_total{room="room-1"');
    expect(text).toContain('web_legend_game_server_ws_reconnects_total{room="room-1"');
    expect(text).toContain('web_legend_game_server_tick_duration_ms');
    expect(text).toContain('nodejs_gc_pause_seconds_total');
  });
});
