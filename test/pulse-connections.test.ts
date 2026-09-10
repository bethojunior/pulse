import { expect, it } from 'vitest';
import { PulseConnections } from '../src/pulse-connections.js';
import { TracerService } from '../src/tracer.service.js';
import { TelemetryStore } from '../src/telemetry.store.js';
import { TraceContextStore } from '../src/context.js';
import { MetricCollector } from '../src/metrics.js';

it('records successful accesses, preserves errors and tracks jobs while running', async () => {
  const store = new TelemetryStore();
  const options = { serviceId: 'test' };
  const tracer = new TracerService(new TraceContextStore(), new MetricCollector(), { export() {} }, options, store);
  const connections = new PulseConnections(options, tracer);
  expect(connections.database('find', () => 42)).toBe(42);
  const failure = new Error('cache failed');
  await expect(connections.redis('GET', async () => { throw failure; })).rejects.toBe(failure);
  let finish!: () => void;
  const pending = connections.job('report', () => new Promise<void>((resolve) => { finish = resolve; }));
  expect(connections.activeJobs()).toHaveLength(1);
  finish();
  await pending;
  expect(connections.activeJobs()).toHaveLength(0);
  await tracer.flush();
  const spans = store.snapshot(options).spans;
  expect(spans.find((span) => span.attributes['pulse.category'] === 'redis')).toMatchObject({ status: 'error', error: { message: 'cache failed' } });
  expect(spans.find((span) => span.attributes['pulse.category'] === 'database')).toMatchObject({ status: 'ok' });
  expect(spans.find((span) => span.attributes['pulse.category'] === 'job')).toMatchObject({ status: 'ok' });
});
