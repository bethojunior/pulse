import { Inject, Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { PULSE_OPTIONS } from './tokens.js';
import type { PulseOptions } from './types.js';

const states = ['waiting', 'active', 'completed', 'failed', 'delayed', 'waiting-children'] as const;
export interface QueueSnapshot {
  status: 'unconfigured' | 'configured';
  checkedAt: string;
  queues: Array<{ name: string; status: 'connected' | 'unavailable'; paused?: boolean; counts?: Record<string, number>; jobs?: Array<{
    id: string; name: string; state: string; attempts: number; timestamp: number; failedReason: string;
  }> }>;
}

@Injectable()
export class QueueMonitor {
  private cached?: QueueSnapshot;
  private pending: Promise<QueueSnapshot> | undefined;
  constructor(@Inject(PULSE_OPTIONS) private readonly options: PulseOptions) {}

  snapshot(): Promise<QueueSnapshot> {
    if (this.cached && Date.now() - Date.parse(this.cached.checkedAt) < 5000) return Promise.resolve(this.cached);
    return this.pending ??= this.collect().then((result) => { this.cached = result; return result; }).finally(() => { this.pending = undefined; });
  }

  private async collect(): Promise<QueueSnapshot> {
    const checkedAt = new Date().toISOString();
    const config = this.options.queues;
    if (!config?.url || config.enabled === false || this.options.enabled === false) return { status: 'unconfigured', checkedAt, queues: [] };
    const queues = await Promise.all([...new Set(config.names)].slice(0, 20).map(async (name) => {
      let queue: Queue | undefined;
      try {
        const url = new URL(config.url);
        queue = new Queue(name, {
          prefix: config.prefix ?? 'bull', skipMetasUpdate: true,
          connection: {
            host: url.hostname, port: Number(url.port || 6379), db: Number(url.pathname.slice(1) || 0),
            username: decodeURIComponent(url.username), password: decodeURIComponent(url.password),
            ...(url.protocol === 'rediss:' ? { tls: {} } : {}),
            connectTimeout: 1500, commandTimeout: 1500, maxRetriesPerRequest: 0, retryStrategy: () => null,
          },
        });
        queue.on('error', () => undefined);
        const counts = await queue.getJobCounts(...states);
        const jobs = [];
        // Bounded reads per state; no job payloads, results or queue mutations.
        for (const state of states) {
          for (const job of await queue.getJobs([state], 0, 4, false)) {
            jobs.push({ id: job.id ?? '', name: job.name, state, attempts: job.attemptsMade, timestamp: job.timestamp, failedReason: job.failedReason ?? '' });
          }
        }
        return { name, status: 'connected' as const, paused: await queue.isPaused(), counts, jobs };
      } catch { return { name, status: 'unavailable' as const }; }
      finally { await queue?.disconnect().catch(() => undefined); }
    }));
    return { status: 'configured', checkedAt, queues };
  }
}
