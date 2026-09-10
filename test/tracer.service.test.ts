import { describe, expect, it } from 'vitest';
import { TraceContextStore } from '../src/context.js';
import { MetricCollector } from '../src/metrics.js';
import { TelemetryStore } from '../src/telemetry.store.js';
import { TracerService } from '../src/tracer.service.js';
import type { TelemetryExporter, TelemetryPayload } from '../src/types.js';

class MemoryExporter implements TelemetryExporter {
  payloads: TelemetryPayload[] = [];

  export(payload: TelemetryPayload): void {
    this.payloads.push(payload);
  }
}

describe('TracerService', () => {
  it('exports successful spans and metrics', async () => {
    const exporter = new MemoryExporter();
    const tracer = new TracerService(
      new TraceContextStore(),
      new MetricCollector(),
      exporter,
      { serviceId: 'test-api', flushIntervalMs: 0, defaultAttributes: { env: 'test' } },
      new TelemetryStore(),
    );

    const result = tracer.createSpan('work', (span) => {
      span.setTag('job.id', '123');
      tracer.counter('jobs.completed').increment();
      return 42;
    });

    await tracer.flush();

    expect(result).toBe(42);
    expect(exporter.payloads).toHaveLength(1);
    expect(exporter.payloads[0]?.spans[0]).toMatchObject({
      name: 'work',
      status: 'ok',
      attributes: {
        env: 'test',
        'job.id': '123',
      },
    });
    expect(exporter.payloads[0]?.metrics[0]).toMatchObject({
      name: 'jobs.completed',
      type: 'counter',
      value: 1,
    });
  });

  it('records async span exceptions before rethrowing', async () => {
    const exporter = new MemoryExporter();
    const tracer = new TracerService(
      new TraceContextStore(),
      new MetricCollector(),
      exporter,
      { serviceId: 'test-api', flushIntervalMs: 0 },
      new TelemetryStore(),
    );

    await expect(
      tracer.createSpan('fails', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    await tracer.flush();

    expect(exporter.payloads[0]?.spans[0]).toMatchObject({
      name: 'fails',
      status: 'error',
      error: {
        message: 'boom',
      },
    });
  });
});
