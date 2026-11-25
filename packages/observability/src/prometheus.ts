/**
 * Minimal Prometheus text exposition (version 0.0.4). The project only needs a
 * few dozen series, so a tested renderer is cheaper than a metrics dependency.
 */

export type MetricLabels = Readonly<Record<string, string | number | boolean>>;

export type MetricPoint = {
  labels?: MetricLabels;
  value: number;
};

export type HistogramBucket = {
  /** Inclusive upper bound; the renderer appends `+Inf`. */
  le: number;
  /** Cumulative observation count, not per-bucket. */
  count: number;
};

export type HistogramPoint = {
  labels?: MetricLabels;
  buckets: readonly HistogramBucket[];
  sum: number;
  count: number;
};

export type PrometheusMetric =
  | { name: string; help: string; type: 'counter' | 'gauge'; points: readonly MetricPoint[] }
  | { name: string; help: string; type: 'histogram'; points: readonly HistogramPoint[] };

const METRIC_NAME = /^[a-zA-Z_:][a-zA-Z0-9_:]*$/u;
const LABEL_NAME = /^[a-zA-Z_][a-zA-Z0-9_]*$/u;

function formatLabelValue(value: string): string {
  return value.replace(/\\/gu, '\\\\').replace(/"/gu, '\\"').replace(/\n/gu, '\\n');
}

function renderLabels(labels: MetricLabels | undefined, extra?: [string, string]): string {
  const parts: string[] = [];
  if (labels !== undefined) {
    for (const [name, value] of Object.entries(labels)) {
      if (!LABEL_NAME.test(name)) {
        throw new Error(`invalid Prometheus label name "${name}"`);
      }
      parts.push(`${name}="${formatLabelValue(String(value))}"`);
    }
  }
  if (extra !== undefined) {
    parts.push(`${extra[0]}="${formatLabelValue(extra[1])}"`);
  }
  return parts.length === 0 ? '' : `{${parts.join(',')}}`;
}

function formatValue(value: number): string {
  if (!Number.isFinite(value)) {
    throw new Error(`metric values must be finite, received ${String(value)}`);
  }
  return String(value);
}

export function renderPrometheus(metrics: readonly PrometheusMetric[]): string {
  const lines: string[] = [];
  for (const metric of metrics) {
    if (!METRIC_NAME.test(metric.name)) {
      throw new Error(`invalid Prometheus metric name "${metric.name}"`);
    }
    lines.push(`# HELP ${metric.name} ${metric.help}`, `# TYPE ${metric.name} ${metric.type}`);
    if (metric.type === 'histogram') {
      for (const point of metric.points) {
        for (const bucket of point.buckets) {
          lines.push(
            `${metric.name}_bucket${renderLabels(point.labels, ['le', String(bucket.le)])} ${formatValue(bucket.count)}`,
          );
        }
        lines.push(
          `${metric.name}_bucket${renderLabels(point.labels, ['le', '+Inf'])} ${formatValue(point.count)}`,
          `${metric.name}_sum${renderLabels(point.labels)} ${formatValue(point.sum)}`,
          `${metric.name}_count${renderLabels(point.labels)} ${formatValue(point.count)}`,
        );
      }
    } else {
      for (const point of metric.points) {
        lines.push(`${metric.name}${renderLabels(point.labels)} ${formatValue(point.value)}`);
      }
    }
  }
  return `${lines.join('\n')}\n`;
}

export type HistogramSnapshot = {
  buckets: HistogramBucket[];
  sum: number;
  count: number;
};

/** Cumulative-bucket histogram used by HTTP and load metrics. */
export class Histogram {
  private readonly bounds: readonly number[];
  private readonly counts: number[];
  private sum = 0;
  private total = 0;

  constructor(buckets: readonly number[]) {
    this.bounds = [...buckets].sort((left, right) => left - right);
    this.counts = this.bounds.map(() => 0);
  }

  observe(value: number): void {
    if (!Number.isFinite(value) || value < 0) {
      return;
    }
    this.sum += value;
    this.total += 1;
    for (let index = 0; index < this.bounds.length; index += 1) {
      const bound = this.bounds[index];
      if (bound !== undefined && value <= bound) {
        this.counts[index] = (this.counts[index] ?? 0) + 1;
      }
    }
  }

  snapshot(): HistogramSnapshot {
    return {
      buckets: this.bounds.map((le, index) => ({ le, count: this.counts[index] ?? 0 })),
      sum: this.sum,
      count: this.total,
    };
  }
}
