import { describe, expect, it } from 'vitest';
import { TelemetryStore, errorFingerprint } from '../src/telemetry.store.js';
import { serializeError } from '../src/span.js';
import type { SpanRecord } from '../src/types.js';

function span(overrides: Partial<SpanRecord> & { attributes?: SpanRecord['attributes'] }): SpanRecord {
  const now = new Date().toISOString();
  return {
    traceId: 'trace-1',
    spanId: 'span-1',
    name: 'HTTP GET /orders/:id',
    kind: 'server',
    status: 'ok',
    startedAt: now,
    endedAt: now,
    durationMs: 120,
    attributes: { 'http.method': 'GET', 'http.route': '/orders/:id', 'http.status_code': 200 },
    ...overrides,
  };
}

describe('TelemetryStore', () => {
  it('builds dashboard route and overview data from spans', () => {
    const store = new TelemetryStore();
    store.append([span({})], []);

    const snapshot = store.snapshot({ serviceId: 'api', environment: 'Production' });

    expect(snapshot.service).toMatchObject({ id: 'api', environment: 'Production', status: 'healthy' });
    expect(snapshot.overview.requestsPerMinute).toBe(1);
    expect(snapshot.overview.statusClasses['2xx']).toBe(1);
    expect(snapshot.routes[0]).toMatchObject({ method: 'GET', route: '/orders/:id', requests: 1, p95: 120, statusClasses: { '2xx': 1 } });
    expect(snapshot.timeseries).toHaveLength(60);
    expect(snapshot.timeseries.at(-1)?.requests).toBe(1);
  });

  it('separates server errors (5xx) from client errors (4xx) in rates and error categories', () => {
    const store = new TelemetryStore();
    const notFound = serializeError(Object.assign(new Error('Order 42 not found'), { name: 'NotFoundException', status: 404 }));
    const crash = serializeError(new TypeError('Cannot read properties of undefined'));
    store.append(
      [
        span({ traceId: 't1', spanId: 's1' }),
        span({ traceId: 't2', spanId: 's2', status: 'error', error: notFound, attributes: { 'http.method': 'GET', 'http.route': '/orders/:id', 'http.status_code': 404 } }),
        span({ traceId: 't3', spanId: 's3', status: 'error', error: crash, attributes: { 'http.method': 'POST', 'http.route': '/orders', 'http.status_code': 500 } }),
        span({ traceId: 't3', spanId: 's4', kind: 'handler', parentSpanId: 's3', status: 'error', error: crash, attributes: { 'nest.class': 'OrdersController' } }),
      ],
      [],
    );

    const snapshot = store.snapshot({ serviceId: 'api' });

    expect(snapshot.overview.errorRate).toBeCloseTo(33.33, 1);
    expect(snapshot.overview.clientErrorRate).toBeCloseTo(33.33, 1);
    expect(snapshot.service.status).toBe('critical');
    expect(snapshot.errors).toHaveLength(2);
    const server = snapshot.errors.find((group) => group.name === 'TypeError');
    const client = snapshot.errors.find((group) => group.name === 'NotFoundException');
    // The handler and request spans of trace t3 share one exception: counted once, sampled from the request span.
    expect(server).toMatchObject({ category: 'server', occurrences: 1, traces: 1, status: 500 });
    expect(server?.latest.kind).toBe('server');
    expect(server?.routes).toEqual([{ route: 'POST /orders', count: 1 }]);
    expect(client).toMatchObject({ category: 'client', status: 404, occurrences: 1 });
    expect(snapshot.errorSummary).toMatchObject({ server: 1, client: 1, groups: 2 });
    expect(snapshot.traces.find((trace) => trace.traceId === 't3')).toMatchObject({ spanCount: 2, errorCount: 2, status: 'error', statusCode: 500 });
    expect(store.trace('t3').map((item) => item.spanId)).toEqual(['s3', 's4']);
    expect(store.errorGroup(server!.id)?.samples).toHaveLength(1);
    expect(store.errorGroup('missing')).toBeNull();
  });

  it('fingerprints errors by type and first application frame, ignoring changing ids in messages', () => {
    const stack = (message: string) =>
      `${message}\n    at OrdersService.find (/app/src/orders/orders.service.ts:42:11)\n    at process.processTicksAndRejections (node:internal/process/task_queues:95:5)`;
    const first = span({ status: 'error', error: serializeError(Object.assign(new Error('Order 1 missing'), { stack: stack('Error: Order 1 missing') })) });
    const second = span({ status: 'error', error: serializeError(Object.assign(new Error('Order 2 missing'), { stack: stack('Error: Order 2 missing') })) });
    const elsewhere = span({ status: 'error', error: serializeError(Object.assign(new Error('Order 3 missing'), { stack: 'Error: Order 3 missing\n    at Other.run (/app/src/other.ts:1:1)' })) });
    const noStack = span({ status: 'error', error: { name: 'Error', message: 'User 7 not found' } });
    const noStackAgain = span({ status: 'error', error: { name: 'Error', message: 'User 8 not found' } });

    expect(errorFingerprint(first)).toBe(errorFingerprint(second));
    expect(errorFingerprint(first)).not.toBe(errorFingerprint(elsewhere));
    expect(errorFingerprint(noStack)).toBe(errorFingerprint(noStackAgain));
  });

  it('tracks in-flight requests and totals independently of span retention', () => {
    const store = new TelemetryStore();
    store.requestStarted();
    store.requestStarted();
    store.requestFinished(200, 10, 200);
    store.requestFinished(503, 0, 20);
    store.requestStarted();
    const snapshot = store.snapshot({ serviceId: 'api' });
    expect(snapshot.http).toMatchObject({ inFlight: 1, total: 2, totalServerErrors: 1, bytesIn: 10, bytesOut: 220, statusClasses: { '2xx': 1, '5xx': 1 } });
  });

  it('summarizes custom metrics and span breakdown', () => {
    const store = new TelemetryStore();
    const now = new Date().toISOString();
    store.append(
      [span({ kind: 'internal', attributes: { 'pulse.category': 'database' }, durationMs: 30 }), span({ kind: 'internal', attributes: { 'pulse.category': 'database' }, durationMs: 10 })],
      [
        { name: 'jobs.completed', type: 'counter', value: 1, attributes: {}, recordedAt: now },
        { name: 'jobs.completed', type: 'counter', value: 2, attributes: {}, recordedAt: now },
        { name: 'queue.depth', type: 'gauge', value: 7, attributes: { queue: 'emails' }, recordedAt: now },
      ],
    );
    const snapshot = store.snapshot({ serviceId: 'api' });
    expect(snapshot.metrics).toEqual([
      expect.objectContaining({ name: 'jobs.completed', type: 'counter', count: 2, sum: 3, last: 2 }),
      expect.objectContaining({ name: 'queue.depth', type: 'gauge', count: 1, last: 7, attributes: { queue: 'emails' } }),
    ]);
    expect(snapshot.spanBreakdown[0]).toMatchObject({ key: 'database', count: 2, avg: 20, max: 30, totalMs: 40 });
  });
});
