import { describe, expect, it } from 'vitest';

import { RuntimeMetrics, runtimeMetricSamples } from './runtimeMetrics';

describe('RuntimeMetrics', () => {
  it('reports process, event loop and GC samples', async () => {
    const metrics = new RuntimeMetrics();
    metrics.start();

    const until = Date.now() + 40;
    while (Date.now() < until) {
      // Give the event-loop histogram and GC observer a window to record.
    }
    await new Promise((resolve) => setTimeout(resolve, 30));

    const snapshot = metrics.snapshot();
    metrics.stop();

    expect(snapshot.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(snapshot.rssBytes).toBeGreaterThan(0);
    expect(snapshot.heapUsedBytes).toBeGreaterThan(0);
    expect(snapshot.eventLoop.p99Ms).toBeGreaterThanOrEqual(0);
    expect(snapshot.gcPauseSeconds).toBeGreaterThanOrEqual(0);
    expect(snapshot.gcCount).toBeGreaterThanOrEqual(0);
    expect(snapshot.eventLoopUtilization).toBeGreaterThanOrEqual(0);
  });

  it('renders runtime samples as Prometheus metrics', () => {
    const metrics = new RuntimeMetrics();
    metrics.start();
    const samples = runtimeMetricSamples(metrics.snapshot());
    metrics.stop();

    const names = samples.map((metric) => metric.name);
    expect(names).toContain('process_resident_memory_bytes');
    expect(names).toContain('nodejs_event_loop_lag_seconds');
    expect(names).toContain('nodejs_gc_pause_seconds_total');
  });
});
