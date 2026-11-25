import {
  monitorEventLoopDelay,
  PerformanceObserver,
  performance,
  type EventLoopUtilization,
} from 'node:perf_hooks';

import type { PrometheusMetric } from './prometheus';

export type EventLoopSnapshot = {
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
};

export type RuntimeSnapshot = {
  uptimeSeconds: number;
  rssBytes: number;
  heapUsedBytes: number;
  heapTotalBytes: number;
  externalBytes: number;
  cpuUserSeconds: number;
  cpuSystemSeconds: number;
  eventLoop: EventLoopSnapshot;
  gcPauseSeconds: number;
  gcCount: number;
  eventLoopUtilization: number;
};

const NANOSECONDS_PER_MILLISECOND = 1_000_000;

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * Process-level metrics shared by both services. Event-loop delay and GC need
 * explicit observers; `stop()` must be called in tests so watchers do not leak
 * between test files.
 */
export class RuntimeMetrics {
  private readonly loop = monitorEventLoopDelay({ resolution: 20 });
  private gcObserver: PerformanceObserver | null = null;
  private gcPauseMs = 0;
  private gcCount = 0;
  private lastCpu = process.cpuUsage();
  private lastCpuAt = performance.now();
  private cpuUserSeconds = 0;
  private cpuSystemSeconds = 0;
  private started = false;

  start(): void {
    if (this.started) {
      return;
    }
    this.started = true;
    this.loop.enable();
    this.lastCpu = process.cpuUsage();
    this.lastCpuAt = performance.now();
    try {
      this.gcObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          this.gcPauseMs += entry.duration;
          this.gcCount += 1;
        }
      });
      this.gcObserver.observe({ entryTypes: ['gc'] });
    } catch {
      this.gcObserver = null;
    }
  }

  stop(): void {
    if (!this.started) {
      return;
    }
    this.started = false;
    this.loop.disable();
    this.gcObserver?.disconnect();
    this.gcObserver = null;
  }

  private sampleCpu(): void {
    const now = performance.now();
    const current = process.cpuUsage();
    const elapsedMs = now - this.lastCpuAt;
    if (elapsedMs <= 0) {
      return;
    }
    this.cpuUserSeconds += (current.user - this.lastCpu.user) / 1_000_000;
    this.cpuSystemSeconds += (current.system - this.lastCpu.system) / 1_000_000;
    this.lastCpu = current;
    this.lastCpuAt = now;
  }

  snapshot(): RuntimeSnapshot {
    this.sampleCpu();
    const memory = process.memoryUsage();
    const cpu = process.cpuUsage();
    const utilization: EventLoopUtilization = performance.eventLoopUtilization();
    return {
      uptimeSeconds: round(process.uptime()),
      rssBytes: memory.rss,
      heapUsedBytes: memory.heapUsed,
      heapTotalBytes: memory.heapTotal,
      externalBytes: memory.external,
      cpuUserSeconds: round(cpu.user / 1_000_000),
      cpuSystemSeconds: round(cpu.system / 1_000_000),
      eventLoop: {
        p50Ms: round(this.loop.percentile(50) / NANOSECONDS_PER_MILLISECOND),
        p95Ms: round(this.loop.percentile(95) / NANOSECONDS_PER_MILLISECOND),
        p99Ms: round(this.loop.percentile(99) / NANOSECONDS_PER_MILLISECOND),
        maxMs: round(this.loop.max / NANOSECONDS_PER_MILLISECOND),
      },
      gcPauseSeconds: round(this.gcPauseMs / 1000),
      gcCount: this.gcCount,
      eventLoopUtilization: round(utilization.utilization),
    };
  }
}

export function runtimeMetricSamples(snapshot: RuntimeSnapshot): PrometheusMetric[] {
  return [
    {
      name: 'process_uptime_seconds',
      help: 'Process uptime in seconds.',
      type: 'gauge',
      points: [{ value: snapshot.uptimeSeconds }],
    },
    {
      name: 'process_resident_memory_bytes',
      help: 'Resident set size in bytes.',
      type: 'gauge',
      points: [{ value: snapshot.rssBytes }],
    },
    {
      name: 'nodejs_heap_used_bytes',
      help: 'V8 heap used in bytes.',
      type: 'gauge',
      points: [{ value: snapshot.heapUsedBytes }],
    },
    {
      name: 'nodejs_heap_total_bytes',
      help: 'V8 heap total in bytes.',
      type: 'gauge',
      points: [{ value: snapshot.heapTotalBytes }],
    },
    {
      name: 'nodejs_external_memory_bytes',
      help: 'Memory allocated for C++ objects bound to JavaScript objects.',
      type: 'gauge',
      points: [{ value: snapshot.externalBytes }],
    },
    {
      name: 'process_cpu_seconds_total',
      help: 'Total user and system CPU time spent in seconds.',
      type: 'counter',
      points: [
        { labels: { kind: 'user' }, value: snapshot.cpuUserSeconds },
        { labels: { kind: 'system' }, value: snapshot.cpuSystemSeconds },
      ],
    },
    {
      name: 'nodejs_event_loop_lag_seconds',
      help: 'Event loop delay percentiles.',
      type: 'gauge',
      points: [
        { labels: { quantile: '0.5' }, value: snapshot.eventLoop.p50Ms / 1000 },
        { labels: { quantile: '0.95' }, value: snapshot.eventLoop.p95Ms / 1000 },
        { labels: { quantile: '0.99' }, value: snapshot.eventLoop.p99Ms / 1000 },
        { labels: { quantile: '1' }, value: snapshot.eventLoop.maxMs / 1000 },
      ],
    },
    {
      name: 'nodejs_event_loop_utilization',
      help: 'Event loop utilization between 0 and 1.',
      type: 'gauge',
      points: [{ value: snapshot.eventLoopUtilization }],
    },
    {
      name: 'nodejs_gc_pause_seconds_total',
      help: 'Total GC pause time in seconds.',
      type: 'counter',
      points: [{ value: snapshot.gcPauseSeconds }],
    },
    {
      name: 'nodejs_gc_runs_total',
      help: 'Total observed GC runs.',
      type: 'counter',
      points: [{ value: snapshot.gcCount }],
    },
  ];
}
