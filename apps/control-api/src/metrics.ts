import { sql } from 'drizzle-orm';
import { Histogram, type PrometheusMetric } from '@web-legend/observability';
import { outboxStatusCounts, type Database } from '@web-legend/persistence';
import type { Logger } from 'pino';

const DURATION_BUCKETS_SECONDS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

type RequestSeries = {
  count: number;
  histogram: Histogram;
};

export type HttpMetricSeries = {
  method: string;
  route: string;
  status: string;
  count: number;
  histogram: Histogram;
};

/** Fastify request counters; route templates keep label cardinality bounded. */
export class HttpMetrics {
  private readonly series = new Map<string, RequestSeries>();
  private inFlight = 0;

  startRequest(): void {
    this.inFlight += 1;
  }

  endRequest(method: string, route: string, status: number, durationSeconds: number): void {
    this.inFlight = Math.max(0, this.inFlight - 1);
    const key = `${method}\u0000${route}\u0000${String(status)}`;
    const existing = this.series.get(key);
    if (existing !== undefined) {
      existing.count += 1;
      existing.histogram.observe(durationSeconds);
      return;
    }
    const histogram = new Histogram(DURATION_BUCKETS_SECONDS);
    histogram.observe(durationSeconds);
    this.series.set(key, { count: 1, histogram });
  }

  snapshot(): HttpMetricSeries[] {
    return [...this.series.entries()]
      .map(([key, value]) => {
        const [method = '', route = '', status = ''] = key.split('\u0000');
        return { method, route, status, count: value.count, histogram: value.histogram };
      })
      .sort((left, right) => {
        const leftKey = `${left.route}:${left.method}:${left.status}`;
        const rightKey = `${right.route}:${right.method}:${right.status}`;
        return leftKey.localeCompare(rightKey);
      });
  }

  inFlightCount(): number {
    return this.inFlight;
  }
}

export type OutboxMetricSnapshot = {
  pending: number;
  dispatched: number;
  applied: number;
  failed: number;
  oldestPendingAgeSeconds: number | null;
  dbProbeSeconds: number | null;
  dbProbeOk: boolean;
  refreshedAt: string | null;
};

/**
 * Refreshes PostgreSQL-derived operational gauges on a timer so a Prometheus
 * scrape never turns into an unbounded database query path.
 */
export class OperationalMetrics {
  private timer: NodeJS.Timeout | null = null;
  private current: OutboxMetricSnapshot = {
    pending: 0,
    dispatched: 0,
    applied: 0,
    failed: 0,
    oldestPendingAgeSeconds: null,
    dbProbeSeconds: null,
    dbProbeOk: true,
    refreshedAt: null,
  };

  constructor(
    private readonly database: Database,
    private readonly logger: Logger,
    private readonly intervalMs = 5_000,
    private readonly now: () => number = Date.now,
  ) {}

  start(): void {
    if (this.timer !== null) {
      return;
    }
    this.timer = setInterval(() => {
      void this.refresh();
    }, this.intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async refresh(): Promise<void> {
    const startedAt = this.now();
    try {
      await this.database.execute(sql`select 1`);
      const probeSeconds = Math.max(0, this.now() - startedAt) / 1000;
      const counts = await outboxStatusCounts(this.database);
      const now = new Date(this.now());
      this.current = {
        pending: counts.pending,
        dispatched: counts.dispatched,
        applied: counts.applied,
        failed: counts.failed,
        oldestPendingAgeSeconds:
          counts.oldestPendingAt === null
            ? null
            : Math.max(0, now.getTime() - counts.oldestPendingAt.getTime()) / 1000,
        dbProbeSeconds: Math.round(probeSeconds * 1000) / 1000,
        dbProbeOk: true,
        refreshedAt: now.toISOString(),
      };
    } catch (error) {
      this.current = {
        ...this.current,
        dbProbeOk: false,
        refreshedAt: new Date(this.now()).toISOString(),
      };
      this.logger.warn({ err: error }, 'operational metrics refresh failed');
    }
  }

  snapshot(): OutboxMetricSnapshot {
    return this.current;
  }
}

export function operationalMetricSamples(snapshot: OutboxMetricSnapshot): PrometheusMetric[] {
  const metrics: PrometheusMetric[] = [
    {
      name: 'web_legend_outbox_commands',
      help: 'Admin commands by outbox status.',
      type: 'gauge',
      points: [
        { labels: { status: 'pending' }, value: snapshot.pending },
        { labels: { status: 'dispatched' }, value: snapshot.dispatched },
        { labels: { status: 'applied' }, value: snapshot.applied },
        { labels: { status: 'failed' }, value: snapshot.failed },
      ],
    },
    {
      name: 'web_legend_db_probe_up',
      help: 'Whether the last database probe succeeded.',
      type: 'gauge',
      points: [{ value: snapshot.dbProbeOk ? 1 : 0 }],
    },
  ];
  if (snapshot.oldestPendingAgeSeconds !== null) {
    metrics.push({
      name: 'web_legend_outbox_oldest_pending_age_seconds',
      help: 'Age of the oldest pending admin command.',
      type: 'gauge',
      points: [{ value: snapshot.oldestPendingAgeSeconds }],
    });
  }
  if (snapshot.dbProbeSeconds !== null) {
    metrics.push({
      name: 'web_legend_db_probe_duration_seconds',
      help: 'Duration of the last database probe.',
      type: 'gauge',
      points: [{ value: snapshot.dbProbeSeconds }],
    });
  }
  return metrics;
}

export function httpMetricSamples(
  series: readonly HttpMetricSeries[],
  inFlight: number,
): PrometheusMetric[] {
  return [
    {
      name: 'web_legend_http_requests_total',
      help: 'HTTP requests handled by method, route and status.',
      type: 'counter',
      points: series.map((entry) => ({
        labels: { method: entry.method, route: entry.route, status: entry.status },
        value: entry.count,
      })),
    },
    {
      name: 'web_legend_http_request_duration_seconds',
      help: 'HTTP request latency by method, route and status.',
      type: 'histogram',
      points: series.map((entry) => ({
        labels: { method: entry.method, route: entry.route, status: entry.status },
        ...entry.histogram.snapshot(),
      })),
    },
    {
      name: 'web_legend_http_requests_in_flight',
      help: 'HTTP requests currently being handled.',
      type: 'gauge',
      points: [{ value: inFlight }],
    },
  ];
}
