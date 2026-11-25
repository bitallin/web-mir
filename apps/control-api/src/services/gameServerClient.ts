import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

import {
  adminCommandReceiptSchema,
  adminGameServerStatusSchema,
  type AdminCommandEnvelope,
  type AdminCommandReceipt,
  type AdminGameServerStatus,
} from '@web-legend/contracts';

/** Narrow port used by services; tests provide an in-memory implementation. */
export type GameServerGateway = {
  status: () => Promise<AdminGameServerStatus | null>;
  dispatch: (command: AdminCommandEnvelope) => Promise<AdminCommandReceipt>;
};

export class GameServerHttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'GameServerHttpError';
  }
}

const MAX_RESPONSE_BYTES = 1_000_000;

type JsonResponse = {
  statusCode: number;
  body: unknown;
};

/**
 * Internal client for the game server. Uses `node:http` instead of `fetch`
 * because the WHATWG fetch implementation refuses port 87 (the project's
 * game-server port in this container), see AGENTS §12.
 */
export class GameServerClient implements GameServerGateway {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly timeoutMs = 3_000,
  ) {}

  async status(): Promise<AdminGameServerStatus | null> {
    try {
      const response = await this.request('GET', '/internal/admin/status');
      const parsed = adminGameServerStatusSchema.safeParse(response.body);
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  async dispatch(command: AdminCommandEnvelope): Promise<AdminCommandReceipt> {
    const response = await this.request('POST', '/internal/admin/commands', command);
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new GameServerHttpError(
        response.statusCode,
        `game server rejected admin command (${String(response.statusCode)})`,
      );
    }
    const parsed = adminCommandReceiptSchema.safeParse(response.body);
    if (!parsed.success) {
      throw new GameServerHttpError(502, 'game server returned an invalid command receipt');
    }
    return parsed.data;
  }

  private request(method: 'GET' | 'POST', path: string, body?: unknown): Promise<JsonResponse> {
    const url = new URL(path, this.baseUrl);
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const transport = url.protocol === 'https:' ? httpsRequest : httpRequest;

    return new Promise<JsonResponse>((resolve, reject) => {
      const request = transport(
        url,
        {
          method,
          headers: {
            accept: 'application/json',
            'x-internal-admin-token': this.token,
            ...(payload === undefined
              ? {}
              : {
                  'content-type': 'application/json',
                  'content-length': String(Buffer.byteLength(payload)),
                }),
          },
          timeout: this.timeoutMs,
        },
        (response) => {
          const chunks: Buffer[] = [];
          let received = 0;
          response.on('data', (chunk: Buffer) => {
            received += chunk.length;
            if (received > MAX_RESPONSE_BYTES) {
              request.destroy(new Error('game server response too large'));
              return;
            }
            chunks.push(chunk);
          });
          response.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8');
            let parsed: unknown = null;
            if (text.length > 0) {
              try {
                parsed = JSON.parse(text);
              } catch {
                parsed = null;
              }
            }
            resolve({ statusCode: response.statusCode ?? 0, body: parsed });
          });
          response.on('error', reject);
        },
      );
      request.on('timeout', () => {
        request.destroy(new Error('game server request timed out'));
      });
      request.on('error', reject);
      if (payload !== undefined) {
        request.write(payload);
      }
      request.end();
    });
  }
}
