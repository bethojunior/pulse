import { describe, expect, it, vi } from 'vitest';
import { ServerMetrics, aggregatePoints, toServerPoint } from '../src/server-metrics.js';
import { TelemetryStore } from '../src/telemetry.store.js';

describe('server metrics', () => {
  it('reads process, heap, event loop and host samples with finite values', () => {
    const collector = new ServerMetrics();
    collector.start();
    try {
      const sample = collector.sample();
      expect(sample.process.pid).toBe(process.pid);
      expect(sample.process.memory.rss).toBeGreaterThan(0);
      expect(sample.process.memory.heapUsed).toBeLessThanOrEqual(sample.process.memory.heapTotal);
      expect(sample.process.memory.heapLimit).toBeGreaterThan(sample.process.memory.heapTotal);
      expect(sample.process.heapSpaces.map((space) => space.name)).toContain('old_space');
      expect(sample.host.memory.used).toBeLessThanOrEqual(sample.host.memory.total);
      expect(sample.host.cpu.perCore).toHaveLength(sample.host.cpu.perCore.length);
      expect(sample.host.cpu.load).toHaveLength(3);
      expect(sample.host.disk === null || sample.host.disk.total > 0).toBe(true);
      const numbers = [
        sample.host.cpu.percent,
        sample.process.cpu.percent,
        sample.process.cpu.user,
        sample.process.cpu.system,
        sample.process.eventLoop.p95,
        sample.process.eventLoop.utilization,
        sample.process.gc.total.pauseMs,
        sample.process.usage.maxRss,
        ...sample.host.cpu.perCore,
      ];
      for (const value of numbers) {
        expect(Number.isFinite(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(0);
      }
      expect(sample.process.eventLoop.utilization).toBeLessThanOrEqual(100);
    } finally {
      collector.stop();
    }
  });

  it('describes the machine and the process once', () => {
    const info = new ServerMetrics().describe();
    expect(info.node).toBe(process.version);
    expect(info.pid).toBe(process.pid);
    expect(info.cores).toBeGreaterThan(0);
    expect(info.versions.v8).toBeTruthy();
    expect(info.argv.length).toBeGreaterThan(0);
    expect(Date.parse(info.bootedAt)).toBeLessThanOrEqual(Date.now());
  });

  it('flattens samples into chart points and aggregates them per minute', () => {
    const collector = new ServerMetrics();
    const point = toServerPoint(collector.sample());
    expect(point.rss).toBeGreaterThan(0);
    const aggregated = aggregatePoints([
      { ...point, hostCpu: 10, gcCount: 1, gcPauseMs: 2 },
      { ...point, hostCpu: 30, gcCount: 2, gcPauseMs: 4 },
    ]);
    expect(aggregated?.hostCpu).toBe(20);
    expect(aggregated?.gcCount).toBe(3);
    expect(aggregated?.gcPauseMs).toBe(6);
    expect(aggregatePoints([])).toBeNull();
  });

  it('bounds history and stops sampling on shutdown', () => {
    vi.useFakeTimers();
    const store = new TelemetryStore();
    try {
      store.onModuleInit();
      vi.advanceTimersByTime(602_000);
      const snapshot = store.snapshot({ serviceId: 'test' });
      expect(snapshot.serverHistory).toHaveLength(300);
      expect(snapshot.serverHistoryLong.length).toBeGreaterThanOrEqual(9);
      expect(snapshot.serverInfo?.pid).toBe(process.pid);
      store.onModuleDestroy();
      const after = store.snapshot({ serviceId: 'test' });
      vi.advanceTimersByTime(4000);
      expect(store.snapshot({ serviceId: 'test' }).server).toEqual(after.server);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      store.onModuleDestroy();
      vi.useRealTimers();
    }
  });
});
