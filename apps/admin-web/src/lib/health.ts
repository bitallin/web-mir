import { readinessResponseSchema } from '@web-legend/contracts';
import { useCallback, useEffect, useState } from 'react';

export type ServiceState = 'checking' | 'online' | 'degraded' | 'offline';

export type ServiceHealth = {
  state: ServiceState;
  detail: string;
};

const INITIAL_HEALTH: ServiceHealth = {
  state: 'checking',
  detail: '正在连接 Control API',
};

const POLL_INTERVAL_MS = 15_000;

export function useControlApiHealth(): {
  health: ServiceHealth;
  refresh: () => void;
} {
  const [health, setHealth] = useState<ServiceHealth>(INITIAL_HEALTH);
  const [refreshToken, setRefreshToken] = useState(0);

  const refresh = useCallback(() => {
    setRefreshToken((token) => token + 1);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    const check = async (): Promise<void> => {
      try {
        const response = await fetch('/health/ready', {
          signal: controller.signal,
          headers: { accept: 'application/json' },
        });
        const body: unknown = await response.json();

        if (cancelled) {
          return;
        }

        const parsed = readinessResponseSchema.safeParse(body);
        if (!parsed.success) {
          setHealth({ state: 'offline', detail: '健康检查响应格式不正确' });
          return;
        }

        const failedChecks = parsed.data.checks.filter((check) => check.status === 'error');

        if (parsed.data.status === 'ok') {
          setHealth({ state: 'online', detail: `Control API v${parsed.data.version}` });
          return;
        }

        setHealth({
          state: 'degraded',
          detail:
            failedChecks.length > 0
              ? `异常检查项：${failedChecks.map((check) => check.name).join('、')}`
              : '服务降级',
        });
      } catch {
        if (cancelled || controller.signal.aborted) {
          return;
        }
        setHealth({ state: 'offline', detail: '无法连接 Control API' });
      }
    };

    void check();
    const interval = setInterval(() => {
      void check();
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      controller.abort();
      clearInterval(interval);
    };
  }, [refreshToken]);

  return { health, refresh };
}
