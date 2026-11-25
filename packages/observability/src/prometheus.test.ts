import { describe, expect, it } from 'vitest';

import { Histogram, renderPrometheus } from './prometheus';

describe('renderPrometheus', () => {
  it('renders counters and gauges with escaped labels', () => {
    const text = renderPrometheus([
      {
        name: 'web_legend_requests_total',
        help: 'Requests handled.',
        type: 'counter',
        points: [{ labels: { route: '/a"b\\c', method: 'GET' }, value: 3 }],
      },
      {
        name: 'web_legend_players',
        help: 'Connected players.',
        type: 'gauge',
        points: [{ value: 12 }],
      },
    ]);

    expect(text).toContain('# HELP web_legend_requests_total Requests handled.');
    expect(text).toContain('# TYPE web_legend_requests_total counter');
    expect(text).toContain('web_legend_requests_total{route="/a\\"b\\\\c",method="GET"} 3');
    expect(text).toContain('web_legend_players 12');
  });

  it('renders cumulative histogram buckets including +Inf', () => {
    const histogram = new Histogram([0.1, 0.01, 0.05]);
    histogram.observe(0.004);
    histogram.observe(0.03);
    histogram.observe(0.2);

    const text = renderPrometheus([
      {
        name: 'web_legend_request_duration_seconds',
        help: 'Request latency.',
        type: 'histogram',
        points: [{ labels: { route: '/health' }, ...histogram.snapshot() }],
      },
    ]);

    expect(text).toContain(
      'web_legend_request_duration_seconds_bucket{route="/health",le="0.01"} 1',
    );
    expect(text).toContain(
      'web_legend_request_duration_seconds_bucket{route="/health",le="0.05"} 2',
    );
    expect(text).toContain(
      'web_legend_request_duration_seconds_bucket{route="/health",le="0.1"} 2',
    );
    expect(text).toContain(
      'web_legend_request_duration_seconds_bucket{route="/health",le="+Inf"} 3',
    );
    expect(text).toContain('web_legend_request_duration_seconds_sum{route="/health"} 0.234');
    expect(text).toContain('web_legend_request_duration_seconds_count{route="/health"} 3');
  });

  it('rejects invalid metric names and non-finite values', () => {
    expect(() =>
      renderPrometheus([{ name: 'bad name', help: 'x', type: 'gauge', points: [{ value: 1 }] }]),
    ).toThrow(/metric name/u);

    expect(() =>
      renderPrometheus([
        { name: 'bad_value', help: 'x', type: 'gauge', points: [{ value: Number.NaN }] },
      ]),
    ).toThrow(/finite/u);
  });

  it('keeps an empty metric as a header-only series', () => {
    const text = renderPrometheus([
      { name: 'web_legend_empty', help: 'Nothing yet.', type: 'counter', points: [] },
    ]);

    expect(text).toBe('# HELP web_legend_empty Nothing yet.\n# TYPE web_legend_empty counter\n');
  });
});
