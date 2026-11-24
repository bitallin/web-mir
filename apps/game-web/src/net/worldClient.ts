import { Client, type Room } from '@colyseus/sdk';
import {
  CLIENT_MESSAGES,
  PROTOCOL_VERSION,
  SERVER_MESSAGES,
  WORLD_ROOM_NAME,
  commandAckSchema,
  commandRejectedSchema,
  type CommandAck,
  type CommandRejected,
  type TilePoint,
} from '@web-legend/contracts';
import { WorldState, type WorldStateInstance } from '@web-legend/contracts/world-state';

import { createUuid } from '../lib/uuid';
import {
  clearReconnectToken,
  readReconnectToken,
  storeReconnectToken,
  type DevIdentity,
  type RoomPreference,
} from '../lib/identity';

export type ConnectionStatus =
  'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'failed';

export type PlayerView = {
  playerId: string;
  displayName: string;
  x: number;
  y: number;
  facing: number;
  moving: boolean;
  connected: boolean;
  colorIndex: number;
};

export type WorldSnapshot = {
  mapId: string;
  tick: number;
  playerCount: number;
  players: PlayerView[];
};

export type WorldClientCallbacks = {
  onSnapshot: (snapshot: WorldSnapshot) => void;
  onStatus: (status: ConnectionStatus, detail: string) => void;
  onRoom: (roomId: string) => void;
  onAck: (ack: CommandAck) => void;
  onRejected: (rejected: CommandRejected) => void;
  onLatency: (latencyMs: number) => void;
};

export type WorldClientOptions = {
  url: string;
  identity: DevIdentity;
  roomPreference?: RoomPreference;
  callbacks: WorldClientCallbacks;
};

type WorldRoom = Room<unknown, WorldStateInstance>;

const PING_INTERVAL_MS = 3_000;

function joinErrorMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (code === 525) {
      return '无法进入世界：身份被拒绝，或该角色已在其他窗口';
    }
    if (code === 520 || code === 524) {
      return '无法进入世界：服务器尚未准备好';
    }
  }
  return '连接失败，请稍后重新加入';
}

/**
 * Colyseus client wrapper. It renders schema state for React and the Phaser
 * scene, and submits intent-only `move.to` commands. It never computes
 * authoritative results.
 */
export class WorldClient {
  private readonly options: WorldClientOptions;
  private room: WorldRoom | null = null;
  private sequence = 0;
  private stopped = false;
  private pingTimer: number | null = null;
  private readonly unsubscribers: (() => void)[] = [];

  constructor(options: WorldClientOptions) {
    this.options = options;
  }

  get identity(): DevIdentity {
    return this.options.identity;
  }

  async start(): Promise<void> {
    this.stopped = false;
    this.options.callbacks.onStatus('connecting', '正在连接世界');
    const client = new Client(this.options.url);

    const token = readReconnectToken();
    if (token !== null) {
      try {
        const room = (await client.reconnect(token, WorldState)) as WorldRoom;
        if (this.stopped) {
          await room.leave();
          return;
        }
        this.attach(room);
        return;
      } catch {
        clearReconnectToken();
      }
    }

    const joinOptions = {
      protocolVersion: PROTOCOL_VERSION,
      displayName: this.options.identity.displayName,
      playerKey: this.options.identity.playerKey,
    };
    const preference = this.options.roomPreference ?? { mode: 'joinOrCreate' };

    try {
      const joined =
        preference.mode === 'create'
          ? client.create(WORLD_ROOM_NAME, joinOptions, WorldState)
          : preference.mode === 'joinById'
            ? client.joinById(preference.roomId, joinOptions, WorldState)
            : client.joinOrCreate(WORLD_ROOM_NAME, joinOptions, WorldState);
      const room = (await joined) as WorldRoom;

      if (this.stopped) {
        await room.leave();
        return;
      }
      this.attach(room);
    } catch (error) {
      if (!this.stopped) {
        this.options.callbacks.onStatus('failed', joinErrorMessage(error));
      }
    }
  }

  sendMove(target: TilePoint): boolean {
    const room = this.room;
    if (room === null || this.stopped) {
      return false;
    }

    const commandId = createUuid();
    room.send(CLIENT_MESSAGES.moveTo, {
      protocolVersion: PROTOCOL_VERSION,
      commandId,
      clientSequence: this.sequence,
      targetTileX: target.x,
      targetTileY: target.y,
    });
    this.sequence += 1;
    return true;
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.clearPingTimer();

    for (const unsubscribe of this.unsubscribers.splice(0)) {
      unsubscribe();
    }

    const room = this.room;
    this.room = null;

    if (room !== null) {
      try {
        await room.leave();
      } catch {
        // The socket may already be closed.
      }
      clearReconnectToken();
    }
  }

  /** Development-only: drop the socket to exercise the real reconnect path. */
  dropConnection(): boolean {
    if (this.room === null) {
      return false;
    }
    this.room.connection.close();
    return true;
  }

  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  private attach(room: WorldRoom): void {
    this.room = room;
    this.sequence = 0;
    // The SDK otherwise refuses to reconnect during a room's first few seconds,
    // which would turn an early network blip into a permanent leave.
    room.reconnection.minUptime = 0;
    this.options.callbacks.onRoom(room.roomId);
    this.options.callbacks.onStatus('connected', `房间 ${room.roomId}`);
    storeReconnectToken(room.reconnectionToken);

    const handleStateChange = (state: WorldStateInstance): void => {
      this.emitSnapshot(state);
    };
    room.onStateChange(handleStateChange);
    this.unsubscribers.push(() => {
      room.onStateChange.remove(handleStateChange);
    });

    this.unsubscribers.push(
      room.onMessage(SERVER_MESSAGES.commandAck, (payload: unknown) => {
        const parsed = commandAckSchema.safeParse(payload);
        if (parsed.success) {
          this.options.callbacks.onAck(parsed.data);
        }
      }),
    );

    this.unsubscribers.push(
      room.onMessage(SERVER_MESSAGES.commandRejected, (payload: unknown) => {
        const parsed = commandRejectedSchema.safeParse(payload);
        if (parsed.success) {
          this.options.callbacks.onRejected(parsed.data);
        }
      }),
    );

    const handleDrop = (): void => {
      this.options.callbacks.onStatus('reconnecting', '网络中断，正在重连');
    };
    room.onDrop(handleDrop);
    this.unsubscribers.push(() => {
      room.onDrop.remove(handleDrop);
    });

    const handleReconnect = (): void => {
      storeReconnectToken(room.reconnectionToken);
      this.options.callbacks.onStatus('connected', `房间 ${room.roomId}`);
    };
    room.onReconnect(handleReconnect);
    this.unsubscribers.push(() => {
      room.onReconnect.remove(handleReconnect);
    });

    const handleLeave = (code: number): void => {
      this.clearPingTimer();
      clearReconnectToken();
      if (code === 4000) {
        this.options.callbacks.onStatus('disconnected', '已离开世界');
      } else {
        this.options.callbacks.onStatus('failed', '与服务器的连接已断开');
      }
    };
    room.onLeave(handleLeave);
    this.unsubscribers.push(() => {
      room.onLeave.remove(handleLeave);
    });

    this.clearPingTimer();
    this.pingTimer = window.setInterval(() => {
      try {
        room.ping((latencyMs) => {
          this.options.callbacks.onLatency(Math.round(latencyMs));
        });
      } catch {
        this.clearPingTimer();
      }
    }, PING_INTERVAL_MS);

    room.ping((latencyMs) => {
      this.options.callbacks.onLatency(Math.round(latencyMs));
    });
  }

  private emitSnapshot(state: WorldStateInstance): void {
    const players: PlayerView[] = [];
    state.players.forEach((player) => {
      players.push({
        playerId: player.playerId,
        displayName: player.displayName,
        x: player.x,
        y: player.y,
        facing: player.facing,
        moving: player.moving,
        connected: player.connected,
        colorIndex: player.colorIndex,
      });
    });

    this.options.callbacks.onSnapshot({
      mapId: state.mapId,
      tick: state.serverTick,
      playerCount: state.playerCount,
      players,
    });
  }

  private clearPingTimer(): void {
    if (this.pingTimer !== null) {
      window.clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }
}
