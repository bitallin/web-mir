import type { ReadinessCheck } from '@web-legend/contracts';
import type { Database } from '@web-legend/persistence';
import { sql } from 'drizzle-orm';

export type ReadinessProbe = () => Promise<ReadinessCheck[]>;

const DATABASE_PROBE_TIMEOUT_MS = 2_000;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('timeout'));
    }, timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error('unknown failure'));
      },
    );
  });
}

export function createDatabaseProbe(db: Database): ReadinessProbe {
  return async () => {
    try {
      await withTimeout(db.execute(sql`select 1`), DATABASE_PROBE_TIMEOUT_MS);
      return [{ name: 'database', status: 'ok' }];
    } catch {
      // Do not expose connection strings or driver errors on a public endpoint.
      return [{ name: 'database', status: 'error', detail: 'database unreachable' }];
    }
  };
}
