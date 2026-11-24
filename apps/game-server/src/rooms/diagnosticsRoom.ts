import { CloseCode, Room, validate, type Client } from '@colyseus/core';
import { schema, t } from '@colyseus/schema';
import { z } from 'zod';

const DiagnosticsState = schema(
  {
    serverTime: t.number().default(0),
    bootedAt: t.number().default(0),
    protocolVersion: t.uint8().default(1),
  },
  'DiagnosticsState',
);

type DiagnosticsStateInstance = InstanceType<typeof DiagnosticsState>;

const pingSchema = z.object({
  sequence: z.number().int().nonnegative(),
  sentAt: z.number().nonnegative(),
});

/**
 * Development-only probe room. It verifies that a real Colyseus client can
 * join, exchange a validated message and reconnect. It carries no game rules
 * and is not registered when NODE_ENV=production.
 */
export class DiagnosticsRoom extends Room<{ state: DiagnosticsStateInstance }> {
  override maxClients = 8;

  override state = new DiagnosticsState();

  override messages = {
    'diagnostics.ping': validate(pingSchema, (client: Client, message) => {
      client.send('diagnostics.pong', {
        sequence: message.sequence,
        sentAt: message.sentAt,
        serverTime: Date.now(),
      });
    }),
  };

  override onCreate(): void {
    const now = Date.now();
    this.state.bootedAt = now;
    this.state.serverTime = now;
  }

  override onJoin(client: Client): void {
    client.send('diagnostics.welcome', {
      sessionId: client.sessionId,
      roomId: this.roomId,
    });
  }

  override async onLeave(client: Client, code?: number): Promise<void> {
    if (code === CloseCode.CONSENTED) {
      return;
    }

    try {
      await this.allowReconnection(client, 10);
    } catch {
      // Reconnection grace period elapsed; the seat is already released.
    }
  }
}
