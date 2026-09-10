import { afterEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  query: vi.fn().mockResolvedValue({ rows: [{ numbackends: 3, xact_commit: '20', xact_rollback: '1', deadlocks: '0', blks_hit: '8', blks_read: '2' }] }),
  end: vi.fn(), disconnect: vi.fn(),
  counts: vi.fn().mockResolvedValue({ active: 1, failed: 1 }),
  jobs: vi.fn().mockImplementation(async ([state]: string[]) => state === 'failed' ? [{ id: '1', name: 'email', attemptsMade: 2, timestamp: 123, failedReason: 'timeout', data: { secret: 'hidden' } }] : []),
}));
vi.mock('pg', () => ({ Pool: class { on() {} query = mocks.query; end = mocks.end; } }));
vi.mock('bullmq', () => ({ Queue: class { on() {} getJobCounts = mocks.counts; getJobs = mocks.jobs; isPaused = async () => false; disconnect = async () => mocks.disconnect(); } }));
import { DatabaseMonitor } from '../src/database-monitor.js';
import { QueueMonitor } from '../src/queue-monitor.js';
afterEach(() => vi.clearAllMocks());

it('reads postgres statistics, caches concurrent reads and handles failures', async () => {
  const options = { serviceId: 'test', database: { driver: 'postgres' as const, url: 'postgres://localhost' } };
  const monitor = new DatabaseMonitor(options);
  const [a, b] = await Promise.all([monitor.snapshot(), monitor.snapshot()]);
  expect(a).toBe(b);
  expect(a.metrics).toMatchObject({ connections: 3, commits: 20, cacheHitRate: 80 });
  expect(mocks.query).toHaveBeenCalledTimes(1);
  await monitor.onModuleDestroy();
  expect(mocks.end).toHaveBeenCalled();
  mocks.query.mockRejectedValueOnce(new Error('secret-url'));
  const failed = new DatabaseMonitor(options);
  expect(await failed.snapshot()).toMatchObject({ status: 'unavailable' });
  await failed.onModuleDestroy();
});

it('reads named queues and job failures without exposing payloads', async () => {
  const monitor = new QueueMonitor({ serviceId: 'test', queues: { driver: 'bullmq', url: 'redis://localhost', names: ['emails', 'emails'] } });
  const snapshot = await monitor.snapshot();
  expect(snapshot.queues).toHaveLength(1);
  expect(snapshot.queues[0]).toMatchObject({ name: 'emails', status: 'connected', counts: { active: 1 }, jobs: [{ id: '1', state: 'failed', failedReason: 'timeout' }] });
  expect(JSON.stringify(snapshot)).not.toContain('hidden');
  expect(mocks.disconnect).toHaveBeenCalledTimes(1);
  mocks.counts.mockRejectedValueOnce(new Error('credentials'));
  const failed = new QueueMonitor({ serviceId: 'test', queues: { driver: 'bullmq', url: 'redis://localhost', names: ['failed'] } });
  expect((await failed.snapshot()).queues[0]?.status).toBe('unavailable');
});
