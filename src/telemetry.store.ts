import { Injectable, type OnModuleInit, type OnModuleDestroy } from '@nestjs/common';
import { ServerMetrics, aggregatePoints, toServerPoint, type ServerInfo, type ServerPoint, type ServerSample } from './server-metrics.js';
import type { MetricRecord, PulseOptions, SpanRecord } from './types.js';

export type ErrorCategory = 'server' | 'client' | 'process' | 'internal';

export interface ErrorGroup {
  id: string;
  name: string;
  message: string;
  category: ErrorCategory;
  kind: string;
  status: number | null;
  code: string | number | null;
  location: string | null;
  occurrences: number;
  traces: number;
  users: number;
  firstSeen: string;
  lastSeen: string;
  routes: Array<{ route: string; count: number }>;
  trend: number[];
  latest: SpanRecord;
}

export interface ErrorGroupDetail extends ErrorGroup {
  samples: SpanRecord[];
}

export interface TraceSummary {
  traceId: string;
  name: string;
  kind: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  spanCount: number;
  errorCount: number;
  status: 'ok' | 'error';
  method: string | null;
  route: string | null;
  statusCode: number | null;
}

export interface RouteStats {
  method: string;
  route: string;
  requests: number;
  avg: number;
  min: number;
  max: number;
  p50: number;
  p95: number;
  p99: number;
  errors: number;
  clientErrors: number;
  errorRate: number;
  lastSeen: string;
  statusClasses: Record<string, number>;
}

export interface MetricSummary {
  name: string;
  type: MetricRecord['type'];
  count: number;
  last: number;
  sum: number;
  min: number;
  max: number;
  avg: number;
  lastAt: string;
  attributes: MetricRecord['attributes'];
}

export interface PulseSnapshot {
  generatedAt: string;
  service: {
    id: string;
    version?: string;
    environment?: string;
    status: 'healthy' | 'degraded' | 'critical';
    startedAt: string;
  };
  server: ServerSample | null;
  serverInfo: ServerInfo | null;
  serverHistory: ServerPoint[];
  serverHistoryLong: ServerPoint[];
  http: {
    inFlight: number;
    total: number;
    totalServerErrors: number;
    totalClientErrors: number;
    bytesIn: number;
    bytesOut: number;
    statusClasses: Record<string, number>;
  };
  overview: {
    requestsPerMinute: number;
    requestsPerSecond: number;
    errorRate: number;
    clientErrorRate: number;
    avgLatency: number;
    p50Latency: number;
    p95Latency: number;
    p99Latency: number;
    maxLatency: number;
    activePods: number;
    cpu: number;
    memory: number;
    inFlight: number;
    statusClasses: Record<string, number>;
    statusCodes: Record<string, number>;
    trend: { requests: number | null; errorRate: number | null; p95: number | null };
    retainedSpans: number;
    retainedSince: string | null;
  };
  timeseries: Array<{ time: string; requests: number; errors: number; clientErrors: number; latency: number; p95: number }>;
  routes: RouteStats[];
  errors: ErrorGroup[];
  errorSummary: { total: number; server: number; client: number; process: number; internal: number; groups: number; lastHour: number };
  traces: TraceSummary[];
  spans: SpanRecord[];
  spanBreakdown: Array<{ key: string; count: number; errors: number; avg: number; p95: number; max: number; totalMs: number }>;
  metrics: MetricSummary[];
  recentMetrics: MetricRecord[];
  processEvents: SpanRecord[];
}

const SHORT_HISTORY_POINTS = 300; // 2s samples, 10 minutes
const LONG_HISTORY_POINTS = 360; // 1 minute aggregates, 6 hours

@Injectable()
export class TelemetryStore implements OnModuleInit, OnModuleDestroy {
  private readonly serverMetrics = new ServerMetrics();
  private readonly serverHistory: ServerPoint[] = [];
  private readonly serverHistoryLong: ServerPoint[] = [];
  private minuteBuffer: ServerPoint[] = [];
  private minuteKey = '';
  private latestSample: ServerSample | null = null;
  private serverInfo: ServerInfo | null = null;
  private serverTimer?: NodeJS.Timeout;
  private readonly startedAt = new Date().toISOString();
  private spans: SpanRecord[] = [];
  private metrics: MetricRecord[] = [];
  private inFlight = 0;
  private readonly http = { total: 0, totalServerErrors: 0, totalClientErrors: 0, bytesIn: 0, bytesOut: 0, statusClasses: {} as Record<string, number> };

  onModuleInit(): void {
    this.serverMetrics.start();
    this.serverInfo = this.serverMetrics.describe();
    this.sampleServer();
    this.serverTimer = setInterval(() => this.sampleServer(), 2000);
    this.serverTimer.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.serverTimer);
    this.serverMetrics.stop();
  }

  requestStarted(): void {
    this.inFlight += 1;
  }

  requestFinished(statusCode: number, bytesIn = 0, bytesOut = 0): void {
    this.inFlight = Math.max(0, this.inFlight - 1);
    this.http.total += 1;
    this.http.bytesIn += bytesIn;
    this.http.bytesOut += bytesOut;
    const statusClass = `${Math.floor(statusCode / 100)}xx`;
    this.http.statusClasses[statusClass] = (this.http.statusClasses[statusClass] ?? 0) + 1;
    if (statusCode >= 500) this.http.totalServerErrors += 1;
    else if (statusCode >= 400) this.http.totalClientErrors += 1;
  }

  private sampleServer(): void {
    this.latestSample = this.serverMetrics.sample();
    const point = toServerPoint(this.latestSample);
    this.serverHistory.push(point);
    if (this.serverHistory.length > SHORT_HISTORY_POINTS) this.serverHistory.shift();

    const minute = point.time.slice(0, 16);
    if (minute !== this.minuteKey) {
      const aggregated = aggregatePoints(this.minuteBuffer);
      if (aggregated) {
        aggregated.time = `${this.minuteKey}:00.000Z`;
        this.serverHistoryLong.push(aggregated);
        if (this.serverHistoryLong.length > LONG_HISTORY_POINTS) this.serverHistoryLong.shift();
      }
      this.minuteBuffer = [];
      this.minuteKey = minute;
    }
    this.minuteBuffer.push(point);
  }

  append(spans: SpanRecord[], metrics: MetricRecord[], limit = 5_000): void {
    this.spans.push(...spans);
    this.metrics.push(...metrics);

    if (this.spans.length > limit) {
      this.spans = this.spans.slice(this.spans.length - limit);
    }

    if (this.metrics.length > limit) {
      this.metrics = this.metrics.slice(this.metrics.length - limit);
    }
  }

  trace(traceId: string): SpanRecord[] {
    return this.spans.filter((span) => span.traceId === traceId).sort(byStart);
  }

  errorGroup(id: string, sampleLimit = 25): ErrorGroupDetail | null {
    const group = groupErrors(this.spans.filter((span) => span.error)).find((item) => item.id === id);
    if (!group) return null;
    const samples = this.spans
      .filter((span) => span.error && errorFingerprint(span) === id)
      .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
    return { ...group, samples: preferredSamples(samples).slice(0, sampleLimit) };
  }

  snapshot(options: PulseOptions): PulseSnapshot {
    const now = Date.now();
    const requestSpans = this.spans.filter((span) => span.kind === 'server');
    const lastMinute = requestSpans.filter((span) => now - Date.parse(span.endedAt) <= 60_000);
    const previousMinute = requestSpans.filter((span) => {
      const age = now - Date.parse(span.endedAt);
      return age > 60_000 && age <= 120_000;
    });
    const latencies = requestSpans.map((span) => span.durationMs).sort((a, b) => a - b);
    const serverErrors = requestSpans.filter(isServerError).length;
    const clientErrors = requestSpans.filter(isClientError).length;
    const errorRate = requestSpans.length ? (serverErrors / requestSpans.length) * 100 : 0;
    const errorSpans = this.spans.filter((span) => span.error);
    const errors = groupErrors(errorSpans);
    const latest = this.latestSample;
    const statusCodes: Record<string, number> = {};
    const statusClasses: Record<string, number> = { '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0 };
    for (const span of requestSpans) {
      const status = statusCodeOf(span);
      if (status === null) continue;
      statusCodes[String(status)] = (statusCodes[String(status)] ?? 0) + 1;
      const statusClass = `${Math.floor(status / 100)}xx`;
      statusClasses[statusClass] = (statusClasses[statusClass] ?? 0) + 1;
    }

    return {
      generatedAt: new Date(now).toISOString(),
      service: serviceInfo(options, errorRate, this.startedAt),
      server: latest,
      serverInfo: this.serverInfo,
      serverHistory: [...this.serverHistory],
      serverHistoryLong: [...this.serverHistoryLong],
      http: { inFlight: this.inFlight, ...this.http, statusClasses: { ...this.http.statusClasses } },
      overview: {
        requestsPerMinute: lastMinute.length,
        requestsPerSecond: lastMinute.length / 60,
        errorRate,
        clientErrorRate: requestSpans.length ? (clientErrors / requestSpans.length) * 100 : 0,
        avgLatency: average(latencies),
        p50Latency: percentile(latencies, 50),
        p95Latency: percentile(latencies, 95),
        p99Latency: percentile(latencies, 99),
        maxLatency: latencies.at(-1) ?? 0,
        activePods: uniquePodCount(this.spans),
        cpu: latest?.host.cpu.percent ?? 0,
        memory: latest?.host.memory.percent ?? 0,
        inFlight: this.inFlight,
        statusClasses,
        statusCodes,
        trend: {
          requests: percentChange(previousMinute.length, lastMinute.length),
          errorRate: percentChange(rate(previousMinute, isServerError), rate(lastMinute, isServerError)),
          p95: percentChange(percentile(previousMinute.map((span) => span.durationMs).sort((a, b) => a - b), 95), percentile(lastMinute.map((span) => span.durationMs).sort((a, b) => a - b), 95)),
        },
        retainedSpans: this.spans.length,
        retainedSince: this.spans[0]?.startedAt ?? null,
      },
      timeseries: timeseries(requestSpans, now),
      routes: routes(requestSpans),
      errors,
      errorSummary: {
        total: errors.reduce((sum, group) => sum + group.occurrences, 0),
        server: errors.filter((group) => group.category === 'server').reduce((sum, group) => sum + group.occurrences, 0),
        client: errors.filter((group) => group.category === 'client').reduce((sum, group) => sum + group.occurrences, 0),
        process: errors.filter((group) => group.category === 'process').reduce((sum, group) => sum + group.occurrences, 0),
        internal: errors.filter((group) => group.category === 'internal').reduce((sum, group) => sum + group.occurrences, 0),
        groups: errors.length,
        lastHour: new Set(errorSpans.filter((span) => now - Date.parse(span.startedAt) <= 3_600_000).map((span) => `${span.traceId}:${errorFingerprint(span)}`)).size,
      },
      traces: traces(this.spans),
      spans: [...this.spans].slice(-200).reverse(),
      spanBreakdown: spanBreakdown(this.spans),
      metrics: metricSummaries(this.metrics),
      recentMetrics: [...this.metrics].slice(-100).reverse(),
      processEvents: this.spans.filter((span) => span.kind === 'process').slice(-50).reverse(),
    };
  }
}

export function statusCodeOf(span: SpanRecord): number | null {
  const attribute = Number(span.attributes['http.status_code']);
  if (Number.isInteger(attribute) && attribute >= 100) return attribute;
  return span.error?.status ?? null;
}

export function isServerError(span: SpanRecord): boolean {
  const status = statusCodeOf(span);
  return status !== null ? status >= 500 : span.status === 'error';
}

export function isClientError(span: SpanRecord): boolean {
  const status = statusCodeOf(span);
  return status !== null && status >= 400 && status < 500;
}

/**
 * Request spans are classified by the HTTP status they produced (4xx client, otherwise server); errors that stayed
 * inside database/Redis/job/manual spans are internal even when an upstream call answered with a 4xx.
 */
export function errorCategory(span: SpanRecord, status: number | null = statusCodeOf(span)): ErrorCategory {
  if (span.kind === 'process') return 'process';
  if (span.kind === 'server' || span.kind === 'handler') return status !== null && status >= 400 && status < 500 ? 'client' : 'server';
  return 'internal';
}

/** Groups occurrences the way error trackers do: error type plus the first application frame, falling back to a normalized message. */
export function errorFingerprint(span: SpanRecord): string {
  const error = span.error;
  if (!error) return '';
  const frame = error.frames?.find((item) => item.inApp) ?? error.frames?.[0];
  const location = frame ? `${frame.file}:${frame.line ?? 0}` : normalizeMessage(error.message);
  return hash(`${span.kind === 'process' ? 'process|' : ''}${error.name}|${location}`);
}

function normalizeMessage(message: string): string {
  return message
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<uuid>')
    .replace(/\b[0-9a-f]{16,}\b/gi, '<hex>')
    .replace(/\d+/g, '#')
    .slice(0, 200);
}

function hash(value: string): string {
  let hashValue = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hashValue = ((hashValue << 5) + hashValue + value.charCodeAt(index)) | 0;
  }
  return (hashValue >>> 0).toString(36);
}

const KIND_PRIORITY: Record<string, number> = { server: 0, handler: 1, process: 2 };

/** One span per trace, preferring the HTTP request span (it carries route, status and client attributes). */
function preferredSamples(spans: SpanRecord[]): SpanRecord[] {
  const byTrace = new Map<string, SpanRecord>();
  for (const span of spans) {
    const current = byTrace.get(span.traceId);
    if (!current || (KIND_PRIORITY[span.kind] ?? 9) < (KIND_PRIORITY[current.kind] ?? 9)) byTrace.set(span.traceId, span);
  }
  return [...byTrace.values()];
}

export function groupErrors(spans: SpanRecord[]): ErrorGroup[] {
  const groups = new Map<string, SpanRecord[]>();
  for (const span of spans) {
    const id = errorFingerprint(span);
    groups.set(id, [...(groups.get(id) ?? []), span]);
  }
  const now = Date.now();
  return [...groups.entries()]
    .map(([id, items]) => {
      const sorted = [...items].sort(byStart);
      const samples = preferredSamples([...sorted].reverse());
      const latest = samples[0] ?? sorted.at(-1) ?? items[0]!;
      const routeCounts = new Map<string, number>();
      const statusCounts = new Map<number, number>();
      const trend = new Array<number>(30).fill(0);
      for (const sample of samples) {
        const route = sample.attributes['http.route'];
        if (route) {
          const key = `${String(sample.attributes['http.method'] ?? 'GET')} ${String(route)}`;
          routeCounts.set(key, (routeCounts.get(key) ?? 0) + 1);
        }
        const status = statusCodeOf(sample);
        if (status !== null) statusCounts.set(status, (statusCounts.get(status) ?? 0) + 1);
        const minutesAgo = Math.floor((now - Date.parse(sample.startedAt)) / 60_000);
        if (minutesAgo >= 0 && minutesAgo < 30) trend[29 - minutesAgo] = (trend[29 - minutesAgo] ?? 0) + 1;
      }
      const status = [...statusCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
      const frame = latest.error?.frames?.find((item) => item.inApp) ?? latest.error?.frames?.[0];
      return {
        id,
        name: latest.error?.name ?? 'Error',
        message: latest.error?.message ?? '',
        category: errorCategory(latest, status),
        kind: latest.kind,
        status,
        code: latest.error?.code ?? null,
        location: frame ? `${frame.file}${frame.line !== null ? `:${frame.line}` : ''}` : null,
        occurrences: samples.length,
        traces: new Set(items.map((item) => item.traceId)).size,
        users: new Set(items.map((item) => item.attributes['user.id']).filter(Boolean)).size,
        firstSeen: sorted[0]?.startedAt ?? new Date().toISOString(),
        lastSeen: sorted.at(-1)?.startedAt ?? new Date().toISOString(),
        routes: [...routeCounts.entries()].map(([route, count]) => ({ route, count })).sort((a, b) => b.count - a.count).slice(0, 5),
        trend,
        latest,
      };
    })
    .sort((a, b) => Date.parse(b.lastSeen) - Date.parse(a.lastSeen))
    .slice(0, 100);
}

function serviceInfo(options: PulseOptions, errorRate: number, startedAt: string): PulseSnapshot['service'] {
  const status = errorRate >= 5 ? 'critical' : errorRate >= 1 ? 'degraded' : 'healthy';
  const service: PulseSnapshot['service'] = { id: options.serviceId, status, startedAt };
  if (options.serviceVersion) service.version = options.serviceVersion;
  if (options.environment) service.environment = options.environment;
  return service;
}

function routes(spans: SpanRecord[]): RouteStats[] {
  const groups = new Map<string, SpanRecord[]>();

  for (const span of spans) {
    const method = String(span.attributes['http.method'] ?? 'GET');
    const route = String(span.attributes['http.route'] ?? span.name.replace(/^HTTP [A-Z]+ /, ''));
    const key = `${method} ${route}`;
    groups.set(key, [...(groups.get(key) ?? []), span]);
  }

  return [...groups.values()]
    .map((items) => {
      const first = items[0];
      const values = items.map((item) => item.durationMs).sort((a, b) => a - b);
      const errors = items.filter(isServerError).length;
      const statusClasses: Record<string, number> = {};
      for (const item of items) {
        const status = statusCodeOf(item);
        if (status === null) continue;
        const statusClass = `${Math.floor(status / 100)}xx`;
        statusClasses[statusClass] = (statusClasses[statusClass] ?? 0) + 1;
      }
      return {
        method: String(first?.attributes['http.method'] ?? 'GET'),
        route: String(first?.attributes['http.route'] ?? first?.name ?? 'unknown'),
        requests: items.length,
        avg: average(values),
        min: values[0] ?? 0,
        max: values.at(-1) ?? 0,
        p50: percentile(values, 50),
        p95: percentile(values, 95),
        p99: percentile(values, 99),
        errors,
        clientErrors: items.filter(isClientError).length,
        errorRate: items.length ? (errors / items.length) * 100 : 0,
        lastSeen: items.reduce((latest, item) => (item.endedAt > latest ? item.endedAt : latest), items[0]?.endedAt ?? ''),
        statusClasses,
      };
    })
    .sort((a, b) => b.requests - a.requests)
    .slice(0, 100);
}

function traces(spans: SpanRecord[]): TraceSummary[] {
  const groups = new Map<string, SpanRecord[]>();
  for (const span of spans) groups.set(span.traceId, [...(groups.get(span.traceId) ?? []), span]);
  return [...groups.entries()]
    .map(([traceId, items]) => {
      const sorted = [...items].sort(byStart);
      const root = sorted.find((span) => !span.parentSpanId) ?? sorted.find((span) => span.kind === 'server') ?? sorted[0]!;
      const startedAt = sorted[0]?.startedAt ?? root.startedAt;
      const endedAt = sorted.reduce((latest, span) => (span.endedAt > latest ? span.endedAt : latest), root.endedAt);
      const errorCount = items.filter((span) => span.status === 'error').length;
      return {
        traceId,
        name: root.name,
        kind: root.kind,
        startedAt,
        endedAt,
        durationMs: Math.max(root.durationMs, Date.parse(endedAt) - Date.parse(startedAt)),
        spanCount: items.length,
        errorCount,
        status: errorCount ? ('error' as const) : ('ok' as const),
        method: root.attributes['http.method'] !== undefined ? String(root.attributes['http.method']) : null,
        route: root.attributes['http.route'] !== undefined ? String(root.attributes['http.route']) : null,
        statusCode: statusCodeOf(root),
      };
    })
    .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
    .slice(0, 50);
}

function spanBreakdown(spans: SpanRecord[]): PulseSnapshot['spanBreakdown'] {
  const groups = new Map<string, SpanRecord[]>();
  for (const span of spans) {
    const key = String(span.attributes['pulse.category'] ?? span.kind);
    groups.set(key, [...(groups.get(key) ?? []), span]);
  }
  return [...groups.entries()]
    .map(([key, items]) => {
      const values = items.map((item) => item.durationMs).sort((a, b) => a - b);
      return {
        key,
        count: items.length,
        errors: items.filter((item) => item.status === 'error').length,
        avg: average(values),
        p95: percentile(values, 95),
        max: values.at(-1) ?? 0,
        totalMs: values.reduce((sum, value) => sum + value, 0),
      };
    })
    .sort((a, b) => b.count - a.count);
}

function metricSummaries(metrics: MetricRecord[]): MetricSummary[] {
  const groups = new Map<string, MetricRecord[]>();
  for (const metric of metrics) {
    const key = `${metric.type}:${metric.name}`;
    groups.set(key, [...(groups.get(key) ?? []), metric]);
  }
  return [...groups.values()]
    .map((items) => {
      const last = items.at(-1)!;
      const values = items.map((item) => item.value);
      const sum = values.reduce((total, value) => total + value, 0);
      return {
        name: last.name,
        type: last.type,
        count: items.length,
        last: last.value,
        sum,
        min: Math.min(...values),
        max: Math.max(...values),
        avg: values.length ? sum / values.length : 0,
        lastAt: last.recordedAt,
        attributes: last.attributes,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function timeseries(spans: SpanRecord[], now: number): PulseSnapshot['timeseries'] {
  const buckets = new Map<string, SpanRecord[]>();

  for (let index = 59; index >= 0; index -= 1) {
    const bucket = new Date(now - index * 60_000);
    bucket.setSeconds(0, 0);
    buckets.set(bucket.toISOString(), []);
  }

  for (const span of spans) {
    const bucket = new Date(span.endedAt);
    bucket.setSeconds(0, 0);
    const key = bucket.toISOString();
    if (buckets.has(key)) {
      buckets.get(key)?.push(span);
    }
  }

  return [...buckets.entries()].map(([time, items]) => {
    const values = items.map((item) => item.durationMs).sort((a, b) => a - b);
    return {
      time,
      requests: items.length,
      errors: items.filter(isServerError).length,
      clientErrors: items.filter(isClientError).length,
      latency: average(values),
      p95: percentile(values, 95),
    };
  });
}

function rate(spans: SpanRecord[], predicate: (span: SpanRecord) => boolean): number {
  return spans.length ? (spans.filter(predicate).length / spans.length) * 100 : 0;
}

function percentChange(previous: number, current: number): number | null {
  if (!previous) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

function percentile(values: number[], percentileValue: number): number {
  if (!values.length) {
    return 0;
  }

  const index = Math.ceil((percentileValue / 100) * values.length) - 1;
  return Math.round(values[Math.max(0, index)] ?? 0);
}

function average(values: number[]): number {
  if (!values.length) {
    return 0;
  }

  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function byStart(a: SpanRecord, b: SpanRecord): number {
  return Date.parse(a.startedAt) - Date.parse(b.startedAt) || a.durationMs - b.durationMs;
}

function uniquePodCount(spans: SpanRecord[]): number {
  const pods = new Set(spans.map((span) => span.attributes.pod).filter(Boolean));
  return pods.size || Number(process.env.PULSE_ACTIVE_PODS ?? 1);
}
