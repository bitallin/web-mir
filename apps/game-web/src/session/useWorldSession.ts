import type { TilePoint } from '@web-legend/contracts';
import type Phaser from 'phaser';
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

import { createWorldGame } from '../game/createWorldGame';
import { WorldBridge } from '../game/worldBridge';
import { loadDevIdentity, loadRoomPreference, type DevIdentity } from '../lib/identity';
import { WorldClient, type ConnectionStatus, type PlayerView } from '../net/worldClient';

export type SessionNotice = {
  kind: 'info' | 'warning' | 'error';
  message: string;
  at: number;
};

export type SessionState = {
  status: ConnectionStatus;
  detail: string;
  players: PlayerView[];
  selfId: string | null;
  latencyMs: number | null;
  commandCount: number;
  serverTick: number;
  roomId: string | null;
  notice: SessionNotice | null;
  identity: DevIdentity | null;
};

const INITIAL_STATE: SessionState = {
  status: 'connecting',
  detail: '正在准备世界',
  players: [],
  selfId: null,
  latencyMs: null,
  commandCount: 0,
  serverTick: 0,
  roomId: null,
  notice: null,
  identity: null,
};

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
  private readonly updateState: (updater: (previous: SessionState) => SessionState) => void;
  private readonly identity: DevIdentity;
  private client: WorldClient | null = null;
  private game: Phaser.Game | null = null;
  private commandCount = 0;
  private debugInstalled = false;

  constructor(
    container: HTMLElement,
    bridge: WorldBridge,
    identity: DevIdentity,
    updateState: (updater: (previous: SessionState) => SessionState) => void,
  ) {
    this.container = container;
    this.bridge = bridge;
    this.identity = identity;
    this.updateState = updateState;
    this.bridge.onMoveRequest = (tile) => {
      this.moveTo(tile);
    };
  }

  start(): void {
    this.game = createWorldGame(this.container, this.bridge);
    this.installDebugHooks();

    this.client = new WorldClient({
      url: resolveGameServerUrl(),
      identity: this.identity,
      roomPreference: loadRoomPreference(),
      callbacks: {
        onSnapshot: (snapshot) => {
          this.bridge.pushSnapshot({ snapshot, selfId: this.identity.playerKey });
          this.updateState((previous) => ({
            ...previous,
            players: snapshot.players,
            serverTick: snapshot.tick,
            selfId: this.identity.playerKey,
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
        },
        onRejected: (rejected) => {
          this.updateState((previous) => ({
            ...previous,
            notice: { kind: 'warning', message: rejected.message, at: Date.now() },
          }));
        },
        onLatency: (latencyMs) => {
          this.updateState((previous) => ({ ...previous, latencyMs }));
        },
      },
    });

    void this.client.start();
  }

  moveTo(tile: TilePoint): void {
    if (this.client?.sendMove(tile) === true) {
      this.commandCount += 1;
      this.updateState((previous) => ({ ...previous, commandCount: this.commandCount }));
    }
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
      selfId: null,
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
};

export function useWorldSession(
  containerRef: RefObject<HTMLDivElement | null>,
): WorldSessionControls {
  const [state, setState] = useState<SessionState>(() => ({
    ...INITIAL_STATE,
    identity: loadDevIdentity(),
  }));
  const sessionRef = useRef<WorldSession | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) {
      return;
    }

    const bridge = new WorldBridge();
    const identity = loadDevIdentity();
    const session = new WorldSession(container, bridge, identity, (updater) => {
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
  }, [containerRef]);

  const rejoin = useCallback(() => {
    sessionRef.current?.rejoin();
  }, []);

  return { state, rejoin };
}
