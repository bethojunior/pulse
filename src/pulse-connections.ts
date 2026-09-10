import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { Pool } from 'pg';
import { Redis } from 'ioredis';
import { PULSE_OPTIONS } from './tokens.js';
import { TracerService } from './tracer.service.js';
import type { PulseOptions } from './types.js';

@Injectable()
export class PulseConnections implements OnModuleDestroy {
  private pool?: Pool;
  private client?: Redis;
  private readonly runningJobs = new Map<string, { id: string; name: string; timestamp: number }>();
  constructor(@Inject(PULSE_OPTIONS) private readonly options: PulseOptions, private readonly tracer: TracerService) {}

  query(text: string, values?: unknown[]) {
    const config = this.options.database;
    if (!config?.url || config.enabled === false) throw new Error('Pulse database is not configured');
    return this.database('query', () => {
      if (!this.pool) {
        this.pool = new Pool({ connectionString: config.url, connectionTimeoutMillis: 2000 });
        this.pool.on('error', () => undefined);
      }
      return this.pool.query(text, values);
    });
  }

  command(command: string, ...args: string[]) {
    const config = this.options.redis;
    if (!config?.url || config.enabled === false) throw new Error('Pulse Redis is not configured');
    return this.redis(command.toUpperCase(), () => {
      if (!this.client || this.client.status === 'end') {
        this.client = new Redis(config.url, { connectTimeout: 2000, commandTimeout: 3000, maxRetriesPerRequest: 0, retryStrategy: () => null });
        this.client.on('error', () => undefined);
      }
      return this.client.call(command, ...args);
    });
  }

  // Wrap existing ORM/client calls without changing their return values or errors.
  database<T>(operation: string, callback: () => T): T {
    return this.tracer.createSpan('Database.' + operation, callback, { 'pulse.category': 'database' });
  }

  redis<T>(operation: string, callback: () => T): T {
    return this.tracer.createSpan('Redis.' + operation, callback, { 'pulse.category': 'redis' });
  }

  job<T>(name: string, callback: () => T): T {
    const id = crypto.randomUUID();
    this.runningJobs.set(id, { id, name, timestamp: Date.now() });
    try {
      const result = this.tracer.createSpan('Job.' + name, callback, { 'pulse.category': 'job' });
      if (result && typeof (result as unknown as PromiseLike<unknown>).then === 'function') {
        return Promise.resolve(result).finally(() => { this.runningJobs.delete(id); }) as T;
      }
      this.runningJobs.delete(id);
      return result;
    } catch (error) { this.runningJobs.delete(id); throw error; }
  }

  activeJobs() { return [...this.runningJobs.values()].slice(-100); }

  async onModuleDestroy(): Promise<void> {
    this.client?.disconnect();
    await this.pool?.end();
  }
}
