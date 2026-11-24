import type { CharacterView, ChatMessage, TilePoint } from '@web-legend/contracts';
import type Phaser from 'phaser';
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

import { createWorldGame } from '../game/createWorldGame';
import { mapBundleFor } from '../game/mapCatalog';
import { WorldBridge } from '../game/worldBridge';
import { loadRoomPreference } from '../lib/identity';
import { WorldClient, type ConnectionStatus, type PlayerView } from '../net/worldClient';

export type SessionNotice = {
  kind: 'info' | 'warning' | 'error';
  message: string;
  at: number;
};

export type SessionState = {
  status: ConnectionStatus;
  detail: string;
  mapId: string;
  instanceId: string;
  players: PlayerView[];
  selfId: string;
  latencyMs: number | null;
  commandCount: number;
  serverTick: number;
  roomId: string | null;
  roomPlayerCount: number;
  messages: ChatMessage[];
  notice: SessionNotice | null;
};

export type WorldSessionOptions = {
  character: CharacterView;
  requestTicket: () => Promise<string>;
};

const MAX_CHAT_MESSAGES = 120;

function initialState(character: CharacterView): SessionState {
  return {
    status: 'connecting',
    detail: '正在准备世界',
    mapId: character.mapId,
    instanceId: '1',
    players: [],
    selfId: character.id,
    latencyMs: null,
    commandCount: 0,
    serverTick: 0,
    roomId: null,
    roomPlayerCount: 0,
    messages: [],
    notice: null,
  };
}

function resolveGameServerUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const sameOrigin = `${protocol}://${window.location.host}/ws`;
  if (import.meta.env.DEV) {
    return sameOrigin;
  }
  const override = import.meta.env.VITE_GAME_SERVER_URL;
  return typeof override === 'string' && override.length > 0 ? override : sameOrigin;
}

class WorldSession {
  private readonly bridge: WorldBridge;
  private readonly container: HTMLElement;
  private readonly options: WorldSessionOptions;
  private readonly updateState: (updater: (previous: SessionState) => SessionState) => void;
  private client: WorldClient | null = null;
  private game: Phaser.Game | null = null;
  private mapId: string;
  private commandCount = 0;
  private debugInstalled = false;

  constructor(
    container: HTMLElement,
    bridge: WorldBridge,
    options: WorldSessionOptions,
    updateState: (updater: (previous: SessionState) => SessionState) => void,
  ) {
    this.container = container;
    this.bridge = bridge;
    this.options = options;
    this.mapId = options.character.mapId;
    this.updateState = updateState;
    this.bridge.onMoveRequest = (tile) => {
      this.moveTo(tile);
    };
  }

  start(): void {
    this.game = createWorldGame(this.container, this.bridge, mapBundleFor(this.mapId));
    this.installDebugHooks();

    const characterId = this.options.character.id;
    this.client = new WorldClient({
      url: resolveGameServerUrl(),
      characterId,
      mapId: this.mapId,
      requestTicket: this.options.requestTicket,
      roomPreference: loadRoomPreference(),
      callbacks: {
        onSnapshot: (snapshot) => {
          this.bridge.pushSnapshot({ snapshot, selfId: characterId });
          if (import.meta.env.DEV) {
            const debug = window.__webLegendDebug;
            if (debug !== undefined) {
              debug.lastSnapshotAt = Date.now();
              // Record the first moving snapshot after the probe is reset, so
              // the E2E log shows the update that made the move visible.
              if (
                snapshot.players.some((player) => player.moving) &&
                (debug.lastMovingSnapshotAt === undefined || debug.lastMovingSnapshotAt === 0)
              ) {
                debug.lastMovingSnapshotAt = Date.now();
              }
            }
          }
          this.updateState((previous) => ({
            ...previous,
            mapId: snapshot.mapId,
            instanceId: snapshot.instanceId,
            players: snapshot.players,
            serverTick: snapshot.tick,
            roomPlayerCount: snapshot.playerCount,
            selfId: characterId,
          }));
        },
        onStatus: (status, detail) => {
          this.updateState((previous) => ({ ...previous, status, detail }));
        },
        onRoom: (roomId) => {
          this.updateState((previous) => ({ ...previous, roomId }));
        },
        onAck: (ack) => {
          this.bridge.pushAck(ack);
          if (import.meta.env.DEV) {
            const debug = window.__webLegendDebug;
            if (debug !== undefined) {
              debug.lastAckAt = Date.now();
            }
          }
        },
        onRejected: (rejected) => {
          this.updateState((previous) => ({
            ...previous,
            notice: { kind: 'warning', message: rejected.message, at: Date.now() },
          }));
        },
        onChat: (message) => {
          this.updateState((previous) => ({
            ...previous,
            messages: [...previous.messages, message].slice(-MAX_CHAT_MESSAGES),
          }));
        },
        onTransfer: (mapId) => {
          this.handleTransfer(mapId);
        },
        onLatency: (latencyMs) => {
          this.updateState((previous) => ({ ...previous, latencyMs }));
        },
      },
    });

    void this.client.start();
  }

  moveTo(tile: TilePoint): void {
    if (import.meta.env.DEV) {
      const debug = window.__webLegendDebug;
      if (debug !== undefined) {
        debug.lastMoveIntentAt = Date.now();
      }
    }
    if (this.client?.sendMove(tile) === true) {
      this.commandCount += 1;
      this.updateState((previous) => ({ ...previous, commandCount: this.commandCount }));
    }
  }

  sendChat(text: string): boolean {
    return this.client?.sendChat(text) ?? false;
  }

  rejoin(): void {
    if (this.client === null) {
      this.start();
      return;
    }
    this.updateState((previous) => ({
      ...previous,
      status: 'connecting',
      detail: '正在重新加入世界',
      notice: null,
    }));
    void this.client.restart();
  }

  async leave(): Promise<void> {
    const client = this.client;
    this.client = null;
    if (client !== null) {
      await client.stop();
    }
    this.updateState((previous) => ({
      ...previous,
      status: 'disconnected',
      detail: '已离开世界',
      players: [],
    }));
  }

  async dispose(): Promise<void> {
    this.removeDebugHooks();
    const client = this.client;
    this.client = null;
    if (client !== null) {
      await client.stop();
    }

    const game = this.game;
    this.game = null;
    game?.destroy(true);
  }

  private handleTransfer(mapId: string): void {
    this.updateState((previous) => ({
      ...previous,
      status: 'connecting',
      detail: '正在前往新的地图',
      mapId,
      players: [],
      messages: [],
      roomPlayerCount: 0,
    }));
    this.switchMap(mapId);
    if (this.client !== null) {
      void this.client.transferTo(mapId);
    }
  }

  private switchMap(mapId: string): void {
    this.mapId = mapId;
    const game = this.game;
    this.game = null;
    game?.destroy(true);
    this.bridge.reset();
    this.game = createWorldGame(this.container, this.bridge, mapBundleFor(mapId));
  }

  private installDebugHooks(): void {
    if (!import.meta.env.DEV) {
      return;
    }
    window.__webLegendDebug = {
      screenPointForTile: (tileX, tileY) => this.bridge.screenPointForTile({ x: tileX, y: tileY }),
      restartScene: () => this.bridge.restartScene(),
      sceneGeneration: () => this.bridge.sceneGeneration(),
      dropConnection: () => this.client?.dropConnection() ?? false,
      leaveWorld: () => this.leave(),
      currentMapId: () => this.client?.currentMapId ?? this.mapId,
      moveToTile: (tileX, tileY) => {
        this.moveTo({ x: tileX, y: tileY });
        return true;
      },
    };
    this.debugInstalled = true;
  }

  private removeDebugHooks(): void {
    if (this.debugInstalled) {
      delete window.__webLegendDebug;
      this.debugInstalled = false;
    }
  }
}

export type WorldSessionControls = {
  state: SessionState;
  rejoin: () => void;
  sendChat: (text: string) => boolean;
};

/**
 * Owns one Phaser game and one world connection for the selected character.
 * The ticket callback is kept in a ref so a re-render never restarts the world.
 */
export function useWorldSession(
  containerRef: RefObject<HTMLDivElement | null>,
  options: WorldSessionOptions,
): WorldSessionControls {
  const characterId = options.character.id;
  const [state, setState] = useState<SessionState>(() => initialState(options.character));
  const sessionRef = useRef<WorldSession | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) {
      return;
    }

    const bridge = new WorldBridge();
    const session = new WorldSession(container, bridge, optionsRef.current, (updater) => {
      setState(updater);
    });
    sessionRef.current = session;

    // Defer the start so React StrictMode's mount/unmount probe does not open
    // two connections or create two Phaser games.
    const timer = window.setTimeout(() => {
      session.start();
    }, 0);

    return () => {
      window.clearTimeout(timer);
      sessionRef.current = null;
      void session.dispose();
    };
  }, [containerRef, characterId]);

  const rejoin = useCallback(() => {
    sessionRef.current?.rejoin();
  }, []);

  const sendChat = useCallback((text: string) => sessionRef.current?.sendChat(text) ?? false, []);

  return { state, rejoin, sendChat };
}
