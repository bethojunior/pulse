import { afterEach, describe, expect, it, vi } from 'vitest';

const client = vi.hoisted(() => ({
  status: 'ready',
  on: vi.fn(),
  connect: vi.fn().mockResolvedValue(undefined),
  disconnect: vi.fn(),
  ping: vi.fn().mockResolvedValue('PONG'),
  info: vi.fn().mockResolvedValue('redis_version:7.4.0\r\nused_memory:1024\r\nkeyspace_hits:8\r\nkeyspace_misses:2\r\n'),
}));
vi.mock('ioredis', () => ({ Redis: class { constructor() { return client; } } }));
import { parseRedisInfo, RedisMonitor } from '../src/redis-monitor.js';

afterEach(() => vi.clearAllMocks());

describe('Redis monitor', () => {
  it('parses INFO without inventing missing metrics or a hit rate with no traffic', () => {
    const parsed = parseRedisInfo('# Keyspace\r\nkeyspace_hits:0\r\nkeyspace_misses:0\r\ndb0:keys=12,expires=3,avg_ttl=50\r\n');
    expect(parsed.hitRate).toBeNull();
    expect(parsed.usedMemory).toBeNull();
    expect(parsed.databases).toEqual([{ name: 'db0', keys: 12, expires: 3 }]);
  });

  it('does not connect without configuration', async () => {
    expect(await new RedisMonitor({ serviceId: 'test' }).snapshot()).toMatchObject({ status: 'unconfigured' });
    expect(client.connect).not.toHaveBeenCalled();
  });

  it('shares concurrent reads, caches results and closes its own client', async () => {
    const monitor = new RedisMonitor({ serviceId: 'test', redis: { url: 'redis://localhost' } });
    const [first, second] = await Promise.all([monitor.snapshot(), monitor.snapshot()]);
    expect(first).toBe(second);
    expect(first).toMatchObject({ status: 'connected', metrics: { hitRate: 80, usedMemory: 1024 } });
    await monitor.snapshot();
    expect(client.info).toHaveBeenCalledTimes(1);
    monitor.onModuleDestroy();
    expect(client.disconnect).toHaveBeenCalled();
  });

  it('reports outages without exposing connection credentials', async () => {
    client.connect.mockRejectedValueOnce(new Error('redis://secret:password@private-host'));
    const monitor = new RedisMonitor({ serviceId: 'test', redis: { url: 'redis://secret:password@private-host' } });
    const snapshot = await monitor.snapshot();
    expect(snapshot.status).toBe('unavailable');
    expect(JSON.stringify(snapshot)).not.toContain('password');
    expect(snapshot.metrics).toBeUndefined();
    monitor.onModuleDestroy();
  });
});
