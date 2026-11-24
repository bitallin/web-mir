import {
  CHAT_MESSAGE_MAX_LENGTH,
  CHARACTER_CLASS_CATALOG,
  TILE_UNITS,
  type CharacterView,
} from '@web-legend/contracts';
import { useCallback, useRef, useState } from 'react';

import { issueGameTicket } from '../api/client';
import { mapNameFor } from '../game/mapCatalog';
import type { ConnectionStatus } from '../net/worldClient';
import { useWorldSession } from '../session/useWorldSession';

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  connecting: '连接中',
  connected: '已连接',
  reconnecting: '重连中',
  disconnected: '已断开',
  failed: '连接失败',
};

const COLOR_HEX = ['#9fc4e0', '#e0b087', '#a8d6a1', '#cf9fe0', '#e0d18f', '#8fd0d0'];

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
  const [chatDraft, setChatDraft] = useState('');
  const requestTicket = useCallback(async () => {
    const response = await issueGameTicket(character.id);
    return response.ticket;
  }, [character.id]);
  const { state, rejoin, sendChat } = useWorldSession(containerRef, { character, requestTicket });

  const classDefinition = CHARACTER_CLASS_CATALOG[character.classId];
  const self = state.players.find((player) => player.playerId === state.selfId);
  const selfName = self?.displayName;
  const mapName = mapNameFor(state.mapId);

  const submitChat = useCallback(() => {
    const draft = chatDraft;
    if (draft.trim().length === 0) {
      return;
    }
    if (sendChat(draft)) {
      setChatDraft('');
    }
  }, [chatDraft, sendChat]);

  return (
    <div className="shell">
      <div className="canvas-layer" ref={containerRef} aria-hidden="true" />

      <header className="hud hud-top">
        <div className="brand">
          <p className="eyebrow">浏览器原生 · 实时多人</p>
          <h1>Web Legend</h1>
          <p className="phase">
            {character.name} · {classDefinition.name} Lv.{character.level}
            <span>阶段 3</span>
          </p>
          <p className="vitals" data-testid="vitals">
            HP {self?.hp ?? character.hp}/{self?.maxHp ?? character.maxHp}
            <span>
              法力 {self?.mp ?? character.mp}/{self?.maxMp ?? character.maxMp}
            </span>
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
            <span data-testid="map-name" data-map-id={state.mapId}>
              {mapName}
            </span>
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
          <h2>附近玩家</h2>
          <span>
            <span data-testid="player-count">{state.players.length}</span>
            {state.roomPlayerCount > state.players.length
              ? ` / ${String(state.roomPlayerCount)}`
              : ''}
          </span>
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
          {state.players.length === 0 ? <li className="empty">附近没有其他玩家</li> : null}
        </ul>
      </aside>

      <aside className="hud chat-panel" aria-label="同图聊天">
        <div className="panel-heading">
          <h2>地图频道</h2>
          <span>{mapName}</span>
        </div>
        <ul data-testid="chat-log">
          {state.messages.length === 0 ? (
            <li className="empty">同地图的玩家都能看到这里的消息</li>
          ) : null}
          {state.messages.map((message) => (
            <li
              key={message.messageId}
              data-testid="chat-message"
              data-player-id={message.playerId}
            >
              <span className="chat-author">{message.displayName}</span>
              <span className="chat-text">{message.message}</span>
            </li>
          ))}
        </ul>
        <form
          className="chat-form"
          onSubmit={(event) => {
            event.preventDefault();
            submitChat();
          }}
        >
          <input
            type="text"
            data-testid="chat-input"
            placeholder="说点什么…"
            maxLength={CHAT_MESSAGE_MAX_LENGTH}
            value={chatDraft}
            onChange={(event) => {
              setChatDraft(event.target.value);
            }}
          />
          <button type="submit" data-testid="chat-send">
            发送
          </button>
        </form>
      </aside>

      <footer className="hud hud-bottom">
        <p>点击地面移动 · 走到传送门切换地图 · 服务端 20Hz 权威模拟</p>
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
