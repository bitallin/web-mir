import { useEffect, useMemo, useRef } from 'react';

import { mapBundleFor } from '../game/mapCatalog';
import type { LootView, MonsterView, PlayerView } from '../net/worldClient';

const MAP_WIDTH = 220;
const COLOR_HEX = ['#9fc4e0', '#e0b087', '#a8d6a1', '#cf9fe0', '#e0d18f', '#8fd0d0'];

export type MinimapProps = {
  mapId: string;
  selfId: string;
  players: PlayerView[];
  monsters: MonsterView[];
  loot: LootView[];
};

type Background = {
  mapId: string;
  canvas: HTMLCanvasElement;
};

/**
 * Server state rendered as a top-down minimap. The static collision layout is
 * stamped once per map, then each snapshot only paints entities, so a 20Hz
 * state update never redraws the whole terrain.
 */
export function Minimap({ mapId, selfId, players, monsters, loot }: MinimapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const backgroundRef = useRef<Background | null>(null);
  const bundle = useMemo(() => mapBundleFor(mapId), [mapId]);
  const manifest = bundle.manifest;
  const height = Math.round((MAP_WIDTH * manifest.height) / manifest.width);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) {
      return;
    }
    const ratio = window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
    canvas.width = Math.round(MAP_WIDTH * ratio);
    canvas.height = Math.round(height * ratio);
    const context = canvas.getContext('2d');
    if (context === null) {
      return;
    }
    context.setTransform(ratio, 0, 0, ratio, 0, 0);

    let background = backgroundRef.current;
    if (background === null || background.mapId !== manifest.mapId) {
      background = { mapId: manifest.mapId, canvas: buildBackground(manifest) };
      backgroundRef.current = background;
    }
    context.clearRect(0, 0, MAP_WIDTH, height);
    context.drawImage(background.canvas, 0, 0, MAP_WIDTH, height);

    const scaleX = MAP_WIDTH / manifest.width;
    const scaleY = height / manifest.height;
    const dot = (x: number, y: number, radius: number, color: string): void => {
      context.beginPath();
      context.arc((x / 1000) * scaleX, (y / 1000) * scaleY, radius, 0, Math.PI * 2);
      context.fillStyle = color;
      context.fill();
    };

    for (const drop of loot) {
      dot(drop.x, drop.y, 1.6, '#c9a227');
    }
    for (const monster of monsters) {
      if (monster.state === 'dead') {
        continue;
      }
      dot(monster.x, monster.y, 2, '#b8544a');
    }
    for (const player of players) {
      if (!player.alive) {
        continue;
      }
      const color = COLOR_HEX[player.colorIndex % COLOR_HEX.length] ?? COLOR_HEX[0];
      dot(player.x, player.y, player.playerId === selfId ? 3.2 : 2.4, color ?? '#9fc4e0');
      if (player.playerId === selfId) {
        context.beginPath();
        context.arc((player.x / 1000) * scaleX, (player.y / 1000) * scaleY, 4.4, 0, Math.PI * 2);
        context.strokeStyle = '#e5c15a';
        context.lineWidth = 1.4;
        context.stroke();
      }
    }
  }, [manifest, height, players, monsters, loot, selfId]);

  const self = players.find((player) => player.playerId === selfId);

  return (
    <div
      className="minimap"
      data-testid="minimap"
      data-map-id={manifest.mapId}
      data-self-x={self?.x ?? ''}
      data-self-y={self?.y ?? ''}
    >
      <div className="minimap-heading">
        <span>小地图</span>
        <span className="minimap-mode">
          {manifest.pvpMode === 'open' ? '野外 · 可 PK' : '安全区 · 禁止 PK'}
        </span>
      </div>
      <canvas
        ref={canvasRef}
        className="minimap-canvas"
        style={{ width: `${String(MAP_WIDTH)}px`, height: `${String(height)}px` }}
        aria-label={`${manifest.name} 小地图`}
      />
      <p className="minimap-legend">
        <span className="legend-self">你</span>
        <span className="legend-player">玩家</span>
        <span className="legend-monster">怪物</span>
        <span className="legend-loot">掉落</span>
      </p>
    </div>
  );
}

function buildBackground(manifest: ReturnType<typeof mapBundleFor>['manifest']): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = manifest.width;
  canvas.height = manifest.height;
  const context = canvas.getContext('2d');
  if (context === null) {
    return canvas;
  }
  for (let y = 0; y < manifest.height; y += 1) {
    for (let x = 0; x < manifest.width; x += 1) {
      const blocked = manifest.layers.collision[y * manifest.width + x] !== 0;
      context.fillStyle = blocked ? '#0d1116' : '#1b2229';
      context.fillRect(x, y, 1, 1);
    }
  }
  for (const portal of manifest.portals) {
    context.fillStyle = '#3f8f8f';
    context.fillRect(portal.tile.x, portal.tile.y, 1, 1);
  }
  for (const spawn of manifest.spawnPoints) {
    context.fillStyle = '#5c4d22';
    context.fillRect(spawn.x, spawn.y, 1, 1);
  }
  return canvas;
}
