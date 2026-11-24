import type { CommandRejectionCode } from '@web-legend/contracts';

const DEFAULT_WINDOW_SIZE = 240;

export type TickStats = {
  samples: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
};

export type RoomMetricsSnapshot = {
  roomId: string;
  players: number;
  acceptedCommands: number;
  rejectedCommands: number;
  rejectionsByCode: Record<string, number>;
  chatMessages: number;
  transfers: number;
  tick: TickStats;
};

function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) {
    return 0;
  }
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1));
  return sorted[index] ?? 0;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

export class RoomMetrics {
  private readonly tickDurations: number[] = [];
  private players = 0;
  private acceptedCommands = 0;
  private rejectedCommands = 0;
  private chatMessages = 0;
  private transfers = 0;
  private readonly rejectionsByCode = new Map<string, number>();

  constructor(
    private readonly roomId: string,
    private readonly windowSize = DEFAULT_WINDOW_SIZE,
  ) {}

  recordTick(durationMs: number): void {
    this.tickDurations.push(durationMs);
    if (this.tickDurations.length > this.windowSize) {
      this.tickDurations.shift();
    }
  }

  recordAcceptedCommand(): void {
    this.acceptedCommands += 1;
  }

  recordRejectedCommand(code: CommandRejectionCode): void {
    this.rejectedCommands += 1;
    this.rejectionsByCode.set(code, (this.rejectionsByCode.get(code) ?? 0) + 1);
  }

  recordChatMessage(): void {
    this.chatMessages += 1;
  }

  recordTransfer(): void {
    this.transfers += 1;
  }

  setPlayers(count: number): void {
    this.players = count;
  }

  tickStats(): TickStats {
    const sorted = [...this.tickDurations].sort((left, right) => left - right);
    return {
      samples: sorted.length,
      p50Ms: round(percentile(sorted, 0.5)),
      p95Ms: round(percentile(sorted, 0.95)),
      p99Ms: round(percentile(sorted, 0.99)),
      maxMs: round(sorted.at(-1) ?? 0),
    };
  }

  snapshot(): RoomMetricsSnapshot {
    return {
      roomId: this.roomId,
      players: this.players,
      acceptedCommands: this.acceptedCommands,
      rejectedCommands: this.rejectedCommands,
      rejectionsByCode: Object.fromEntries(this.rejectionsByCode),
      chatMessages: this.chatMessages,
      transfers: this.transfers,
      tick: this.tickStats(),
    };
  }
}

export type MetricsSnapshot = {
  service: 'game-server';
  rooms: RoomMetricsSnapshot[];
  totals: {
    activeRooms: number;
    roomsCreated: number;
    acceptedCommands: number;
    rejectedCommands: number;
    chatMessages: number;
    transfers: number;
  };
  timestamp: string;
};

export class MetricsRegistry {
  private readonly rooms = new Map<string, RoomMetrics>();
  private roomsCreated = 0;
  private acceptedCommands = 0;
  private rejectedCommands = 0;
  private chatMessages = 0;
  private transfers = 0;

  register(roomId: string): RoomMetrics {
    const metrics = new RoomMetrics(roomId);
    this.rooms.set(roomId, metrics);
    this.roomsCreated += 1;
    return metrics;
  }

  unregister(roomId: string): void {
    const metrics = this.rooms.get(roomId);
    if (metrics === undefined) {
      return;
    }
    const snapshot = metrics.snapshot();
    this.acceptedCommands += snapshot.acceptedCommands;
    this.rejectedCommands += snapshot.rejectedCommands;
    this.chatMessages += snapshot.chatMessages;
    this.transfers += snapshot.transfers;
    this.rooms.delete(roomId);
  }

  snapshot(): MetricsSnapshot {
    const rooms = [...this.rooms.values()]
      .map((room) => room.snapshot())
      .sort((left, right) => left.roomId.localeCompare(right.roomId));

    const activeAccepted = rooms.reduce((total, room) => total + room.acceptedCommands, 0);
    const activeRejected = rooms.reduce((total, room) => total + room.rejectedCommands, 0);
    const activeChat = rooms.reduce((total, room) => total + room.chatMessages, 0);
    const activeTransfers = rooms.reduce((total, room) => total + room.transfers, 0);

    return {
      service: 'game-server',
      rooms,
      totals: {
        activeRooms: rooms.length,
        roomsCreated: this.roomsCreated,
        acceptedCommands: this.acceptedCommands + activeAccepted,
        rejectedCommands: this.rejectedCommands + activeRejected,
        chatMessages: this.chatMessages + activeChat,
        transfers: this.transfers + activeTransfers,
      },
      timestamp: new Date().toISOString(),
    };
  }
}
