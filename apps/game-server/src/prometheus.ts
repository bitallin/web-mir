import {
  renderPrometheus,
  runtimeMetricSamples,
  type PrometheusMetric,
  type RuntimeSnapshot,
} from '@web-legend/observability';

import type { MetricsSnapshot } from './metrics';

type RoomLabels = {
  room: string;
  realm: string;
  map: string;
  instance: string;
};

function labelsFor(room: MetricsSnapshot['rooms'][number], realm: string): RoomLabels {
  return {
    room: room.roomId,
    realm,
    map: room.mapId,
    instance: room.instanceId,
  };
}

/**
 * Renders the Game Server snapshot in Prometheus text format. The JSON
 * `/metrics` endpoint stays for existing load tooling; both read the same
 * registry.
 */
export function renderGameServerPrometheus(
  snapshot: MetricsSnapshot,
  runtime: RuntimeSnapshot,
  realm: string,
  serviceVersion: string,
): string {
  const rooms = snapshot.rooms;
  const metrics: PrometheusMetric[] = [
    {
      name: 'web_legend_game_server_up',
      help: 'Game server liveness as seen by the process itself.',
      type: 'gauge',
      points: [{ labels: { realm, version: serviceVersion }, value: 1 }],
    },
    {
      name: 'web_legend_game_server_rooms_active',
      help: 'Number of live map rooms.',
      type: 'gauge',
      points: [{ labels: { realm }, value: snapshot.totals.activeRooms }],
    },
    {
      name: 'web_legend_game_server_rooms_created_total',
      help: 'Rooms created since process start.',
      type: 'counter',
      points: [{ labels: { realm }, value: snapshot.totals.roomsCreated }],
    },
    {
      name: 'web_legend_game_server_room_players',
      help: 'Players connected to each room.',
      type: 'gauge',
      points: rooms.map((room) => ({ labels: labelsFor(room, realm), value: room.players })),
    },
    {
      name: 'web_legend_game_server_tick_duration_ms',
      help: 'Room tick duration percentiles.',
      type: 'gauge',
      points: rooms.flatMap((room) => {
        const labels = labelsFor(room, realm);
        return [
          { labels: { ...labels, quantile: '0.5' }, value: room.tick.p50Ms },
          { labels: { ...labels, quantile: '0.95' }, value: room.tick.p95Ms },
          { labels: { ...labels, quantile: '0.99' }, value: room.tick.p99Ms },
          { labels: { ...labels, quantile: '1' }, value: room.tick.maxMs },
        ];
      }),
    },
    {
      name: 'web_legend_game_server_tick_samples',
      help: 'Tick samples currently in the sliding window.',
      type: 'gauge',
      points: rooms.map((room) => ({ labels: labelsFor(room, realm), value: room.tick.samples })),
    },
    {
      name: 'web_legend_game_server_commands_total',
      help: 'Player commands accepted by result.',
      type: 'counter',
      points: rooms.flatMap((room) => {
        const labels = labelsFor(room, realm);
        return [
          { labels: { ...labels, result: 'accepted' }, value: room.acceptedCommands },
          { labels: { ...labels, result: 'rejected' }, value: room.rejectedCommands },
        ];
      }),
    },
    {
      name: 'web_legend_game_server_command_rejections_total',
      help: 'Player commands rejected by reason.',
      type: 'counter',
      points: rooms.flatMap((room) =>
        Object.entries(room.rejectionsByCode).map(([code, value]) => ({
          labels: { ...labelsFor(room, realm), reason: code },
          value,
        })),
      ),
    },
    {
      name: 'web_legend_game_server_ws_sent_bytes_total',
      help: 'WebSocket bytes written to clients, including state patches.',
      type: 'counter',
      points: rooms.map((room) => ({ labels: labelsFor(room, realm), value: room.wsSentBytes })),
    },
    {
      name: 'web_legend_game_server_patch_bytes_total',
      help: 'WebSocket bytes written during Colyseus state patch broadcasts.',
      type: 'counter',
      points: rooms.map((room) => ({ labels: labelsFor(room, realm), value: room.wsPatchBytes })),
    },
    {
      name: 'web_legend_game_server_chat_messages_total',
      help: 'Chat messages broadcast, filtered or blocked by mute.',
      type: 'counter',
      points: rooms.flatMap((room) => {
        const labels = labelsFor(room, realm);
        return [
          { labels: { ...labels, result: 'broadcast' }, value: room.chatMessages },
          { labels: { ...labels, result: 'filtered' }, value: room.chatFiltered },
          { labels: { ...labels, result: 'muted' }, value: room.chatMuted },
        ];
      }),
    },
    {
      name: 'web_legend_game_server_combat_events_total',
      help: 'Combat events broadcast.',
      type: 'counter',
      points: rooms.map((room) => ({ labels: labelsFor(room, realm), value: room.combatEvents })),
    },
    {
      name: 'web_legend_game_server_kills_total',
      help: 'Monster and player kills.',
      type: 'counter',
      points: rooms.flatMap((room) => {
        const labels = labelsFor(room, realm);
        return [
          { labels: { ...labels, kind: 'monster' }, value: room.monsterKills },
          { labels: { ...labels, kind: 'pvp' }, value: room.pvpKills },
        ];
      }),
    },
    {
      name: 'web_legend_game_server_asset_commands_total',
      help: 'Asset commands, split by success and failure.',
      type: 'counter',
      points: rooms.flatMap((room) => {
        const labels = labelsFor(room, realm);
        return [
          { labels: { ...labels, result: 'ok' }, value: room.assetCommands },
          { labels: { ...labels, result: 'failed' }, value: room.assetFailures },
        ];
      }),
    },
    {
      name: 'web_legend_game_server_asset_tx_duration_ms',
      help: 'Asset transaction queue latency percentiles (queue wait + commit).',
      type: 'gauge',
      points: rooms.flatMap((room) => {
        const labels = labelsFor(room, realm);
        return [
          { labels: { ...labels, quantile: '0.5' }, value: room.assetTx.p50Ms },
          { labels: { ...labels, quantile: '0.95' }, value: room.assetTx.p95Ms },
          { labels: { ...labels, quantile: '0.99' }, value: room.assetTx.p99Ms },
        ];
      }),
    },
    {
      name: 'web_legend_game_server_loot_total',
      help: 'Ground loot spawned and picked up.',
      type: 'counter',
      points: rooms.flatMap((room) => {
        const labels = labelsFor(room, realm);
        return [
          { labels: { ...labels, result: 'spawned' }, value: room.lootSpawned },
          { labels: { ...labels, result: 'picked_up' }, value: room.lootPickedUp },
        ];
      }),
    },
    {
      name: 'web_legend_game_server_progress_total',
      help: 'Experience and gold granted through committed asset transactions.',
      type: 'counter',
      points: rooms.flatMap((room) => {
        const labels = labelsFor(room, realm);
        return [
          { labels: { ...labels, kind: 'exp' }, value: room.expGranted },
          { labels: { ...labels, kind: 'gold' }, value: room.goldGranted },
        ];
      }),
    },
    {
      name: 'web_legend_game_server_transfers_total',
      help: 'Map transfers completed.',
      type: 'counter',
      points: rooms.map((room) => ({ labels: labelsFor(room, realm), value: room.transfers })),
    },
    {
      name: 'web_legend_game_server_room_content_info',
      help: 'Content version and checksum fixed when the room was created.',
      type: 'gauge',
      points: rooms.map((room) => ({
        labels: { ...labelsFor(room, realm), version: room.contentVersion },
        value: 1,
      })),
    },
    ...runtimeMetricSamples(runtime),
  ];

  return renderPrometheus(metrics);
}
