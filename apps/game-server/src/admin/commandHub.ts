import type { AdminCommandEnvelope, AdminRoom } from '@web-legend/contracts';
import type { Logger } from 'pino';

export type RoomAdminHandler = {
  roomId: string;
  snapshot: () => AdminRoom;
  /** Applies the command to matching sessions in this room; returns the count. */
  apply: (command: AdminCommandEnvelope) => number | Promise<number>;
};

const PROCESSED_LIMIT = 1_000;

/**
 * Fan-out point for administrator commands. Rooms register themselves; the
 * internal HTTP endpoint dispatches once per command id, and a duplicate
 * delivery is acknowledged without touching any session (ADR-022).
 */
export class AdminCommandHub {
  private readonly handlers = new Map<string, RoomAdminHandler>();
  private readonly processed = new Set<string>();
  private readonly processedOrder: string[] = [];

  constructor(private readonly logger: Logger) {}

  register(handler: RoomAdminHandler): void {
    this.handlers.set(handler.roomId, handler);
  }

  unregister(roomId: string): void {
    this.handlers.delete(roomId);
  }

  rooms(): AdminRoom[] {
    return [...this.handlers.values()]
      .map((handler) => handler.snapshot())
      .sort((left, right) => left.roomId.localeCompare(right.roomId));
  }

  processedCount(): number {
    return this.processed.size;
  }

  async dispatch(
    command: AdminCommandEnvelope,
  ): Promise<{ status: 'applied' | 'duplicate'; applied: number }> {
    if (this.processed.has(command.commandId)) {
      return { status: 'duplicate', applied: 0 };
    }

    let applied = 0;
    let failed = false;
    for (const handler of this.handlers.values()) {
      try {
        applied += await handler.apply(command);
      } catch (error) {
        failed = true;
        this.logger.error(
          { err: error, roomId: handler.roomId, commandId: command.commandId },
          'admin command failed in a room',
        );
      }
    }
    if (failed) {
      throw new Error(`admin command ${command.commandId} failed in at least one room`);
    }

    this.processed.add(command.commandId);
    this.processedOrder.push(command.commandId);
    if (this.processedOrder.length > PROCESSED_LIMIT) {
      const oldest = this.processedOrder.shift();
      if (oldest !== undefined) {
        this.processed.delete(oldest);
      }
    }
    return { status: 'applied', applied };
  }
}
