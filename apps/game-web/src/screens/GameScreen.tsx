import { CHARACTER_CLASS_CATALOG, TILE_UNITS, type CharacterView } from '@web-legend/contracts';
import { useCallback, useRef } from 'react';

import { issueGameTicket } from '../api/client';
import { TECHNICAL_MAP } from '../game/technicalMap';
import type { ConnectionStatus } from '../net/worldClient';
import { useWorldSession } from '../session/useWorldSession';

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  connecting: '连接中',
  connected: '已连接',
  reconnecting: '重连中',
  disconnected: '已断开',
  failed: '连接失败',
};

const COLOR_HEX = ['#7fa8c9', '#c98f6a', '#8fbf8a', '#b48fc9', '#c9b56a', '#6aa8a8'];

function tileOf(player: { x: number; y: number }): { x: number; y: number } {
  return {
    x: Math.floor(player.x / TILE_UNITS),
    y: Math.floor(player.y / TILE_UNITS),
  };
}

export type GameScreenProps = {
  character: CharacterView;
  onExit: () => void;
};

export function GameScreen({ character, onExit }: GameScreenProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const requestTicket = useCallback(async () => {
    const response = await issueGameTicket(character.id);
    return response.ticket;
  }, [character.id]);
  const { state, rejoin } = useWorldSession(containerRef, { character, requestTicket });

  const classDefinition = CHARACTER_CLASS_CATALOG[character.classId];
  const selfName = state.players.find((player) => player.playerId === state.selfId)?.displayName;

  return (
    <div className="shell">
      <div className="canvas-layer" ref={containerRef} aria-hidden="true" />

      <header className="hud hud-top">
        <div className="brand">
          <p className="eyebrow">浏览器原生 · 实时多人</p>
          <h1>Web Legend</h1>
          <p className="phase">
            {character.name} · {classDefinition.name} Lv.{character.level}
            <span>阶段 2</span>
          </p>
        </div>

        <section className={`connection connection-${state.status}`} aria-live="polite">
          <div className="connection-heading">
            <span className="connection-label">世界连接</span>
            <span
              className="connection-value"
              data-testid="connection-status"
              data-status={state.status}
            >
              {STATUS_LABEL[state.status]}
            </span>
          </div>
          <p className="connection-detail">
            {state.detail}
            {selfName !== undefined ? ` · ${selfName}` : ''}
          </p>
          <div className="connection-meta">
            <span data-testid="latency">{state.latencyMs ?? '—'} ms</span>
            <span data-testid="room-id">{state.roomId ?? '—'}</span>
            <span>{TECHNICAL_MAP.name}</span>
            {(state.status === 'failed' || state.status === 'disconnected') && (
              <button type="button" className="rejoin" onClick={rejoin}>
                重新加入
              </button>
            )}
            <button type="button" className="rejoin" data-testid="exit-world" onClick={onExit}>
              返回角色
            </button>
          </div>
        </section>
      </header>

      <aside className="hud players-panel" aria-label="在线玩家">
        <div className="panel-heading">
          <h2>在线玩家</h2>
          <span data-testid="player-count">{state.players.length}</span>
        </div>
        <ul>
          {state.players.map((player) => {
            const tile = tileOf(player);
            const isSelf = player.playerId === state.selfId;
            return (
              <li
                key={player.playerId}
                data-testid="player-row"
                data-player-id={player.playerId}
                data-name={player.displayName}
                data-self={isSelf ? 'true' : 'false'}
                data-tile-x={tile.x}
                data-tile-y={tile.y}
                data-connected={player.connected ? 'true' : 'false'}
                data-moving={player.moving ? 'true' : 'false'}
              >
                <span
                  className="swatch"
                  style={{
                    background: COLOR_HEX[player.colorIndex % COLOR_HEX.length] ?? COLOR_HEX[0],
                  }}
                />
                <span className="player-name">
                  {player.displayName}
                  {isSelf ? <em>你</em> : null}
                </span>
                <span className="player-coords">
                  {tile.x},{tile.y}
                </span>
                <span className={`player-state ${player.connected ? '' : 'offline'}`}>
                  {player.connected ? '在线' : '断线'}
                </span>
              </li>
            );
          })}
          {state.players.length === 0 ? <li className="empty">等待其他玩家进入世界</li> : null}
        </ul>
      </aside>

      <footer className="hud hud-bottom">
        <p>点击地面移动 · 服务端 20Hz 权威模拟</p>
        <p data-testid="command-count">指令 {state.commandCount}</p>
        <p>tick {state.serverTick}</p>
        <p>协议 v1 · 一次性票据 · Colyseus 0.18</p>
      </footer>

      {state.notice !== null ? (
        <div
          className={`notice notice-${state.notice.kind}`}
          data-testid="last-notice"
          role="status"
        >
          {state.notice.message}
        </div>
      ) : null}
    </div>
  );
}
