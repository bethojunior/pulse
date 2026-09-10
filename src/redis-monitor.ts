import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';
import { PULSE_OPTIONS } from './tokens.js';
import type { PulseOptions } from './types.js';

export interface RedisSnapshot {
  status: 'unconfigured' | 'connected' | 'unavailable';
  checkedAt: string;
  metrics?: ReturnType<typeof parseRedisInfo> & { latencyMs: number };
}

@Injectable()
export class RedisMonitor implements OnModuleDestroy {
  private client?: Redis;
  private cached?: RedisSnapshot;
  private pending: Promise<RedisSnapshot> | undefined;

  constructor(@Inject(PULSE_OPTIONS) private readonly options: PulseOptions) {}

  snapshot(): Promise<RedisSnapshot> {
    if (this.cached && Date.now() - Date.parse(this.cached.checkedAt) < 5000) return Promise.resolve(this.cached);
    if (this.pending) return this.pending;
    this.pending = this.collect().then((result) => {
      this.cached = result;
      return result;
    }).finally(() => { this.pending = undefined; });
    return this.pending;
  }

  onModuleDestroy(): void { this.client?.disconnect(); }

  private async collect(): Promise<RedisSnapshot> {
    const url = this.options.redis?.url;
    const checkedAt = new Date().toISOString();
    if (!url || this.options.enabled === false || this.options.redis?.enabled === false) return { status: 'unconfigured', checkedAt };
    try {
      if (!this.client || this.client.status === 'end') {
        this.client = new Redis(url, {
          lazyConnect: true,
          connectTimeout: 1500,
          commandTimeout: 1500,
          maxRetriesPerRequest: 0,
          retryStrategy: () => null,
          enableOfflineQueue: false,
        });
        this.client.on('error', () => undefined);
        await this.client.connect();
      }
      const start = performance.now();
      await this.client.ping();
      const latencyMs = performance.now() - start;
      const info = await this.client.info();
      return { status: 'connected', checkedAt, metrics: { ...parseRedisInfo(info), latencyMs } };
    } catch {
      this.client?.disconnect();
      // Never send connection URLs, credentials or raw connection errors to the browser.
      return { status: 'unavailable', checkedAt };
    }
  }
}

export function parseRedisInfo(info: string) {
  const fields = new Map<string, string>();
  for (const line of info.split(/\r?\n/)) {
    const separator = line.indexOf(':');
    if (separator > 0 && !line.startsWith('#')) fields.set(line.slice(0, separator), line.slice(separator + 1));
  }
  const number = (key: string): number | null => {
    const raw = fields.get(key);
    if (raw === undefined || raw === '') return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  };
  const hits = number('keyspace_hits');
  const misses = number('keyspace_misses');
  return {
    version: fields.get('redis_version') ?? '',
    role: fields.get('role') ?? '',
    usedMemory: number('used_memory'),
    maxMemory: number('maxmemory'),
    clients: number('connected_clients'),
    blockedClients: number('blocked_clients'),
    opsPerSecond: number('instantaneous_ops_per_sec'),
    hits,
    misses,
    hitRate: hits !== null && misses !== null && hits + misses > 0 ? hits / (hits + misses) * 100 : null,
    evictedKeys: number('evicted_keys'),
    expiredKeys: number('expired_keys'),
    databases: [...fields.entries()].filter(([key]) => /^db\d+$/.test(key)).map(([name, value]) => {
      const stats = new Map(value.split(',').map((pair) => pair.split('=') as [string, string]));
      return { name, keys: Number(stats.get('keys') ?? 0), expires: Number(stats.get('expires') ?? 0) };
    }),
  };
}
