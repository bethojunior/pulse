import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { Pool } from 'pg';
import { PULSE_OPTIONS } from './tokens.js';
import type { PulseOptions } from './types.js';

export interface DatabaseSnapshot {
  status: 'unconfigured' | 'connected' | 'unavailable';
  checkedAt: string;
  metrics?: { latencyMs: number; connections: number; commits: number; rollbacks: number; deadlocks: number; cacheHitRate: number | null };
}

@Injectable()
export class DatabaseMonitor implements OnModuleDestroy {
  private pool?: Pool;
  private cached?: DatabaseSnapshot;
  private pending: Promise<DatabaseSnapshot> | undefined;
  constructor(@Inject(PULSE_OPTIONS) private readonly options: PulseOptions) {}

  snapshot(): Promise<DatabaseSnapshot> {
    if (this.cached && Date.now() - Date.parse(this.cached.checkedAt) < 5000) return Promise.resolve(this.cached);
    return this.pending ??= this.collect().then((result) => { this.cached = result; return result; }).finally(() => { this.pending = undefined; });
  }

  async onModuleDestroy(): Promise<void> { await this.pool?.end(); }

  private async collect(): Promise<DatabaseSnapshot> {
    const checkedAt = new Date().toISOString();
    const config = this.options.database;
    if (!config?.url || config.enabled === false || this.options.enabled === false) return { status: 'unconfigured', checkedAt };
    try {
      if (!this.pool) {
        this.pool = new Pool({ connectionString: config.url, max: 1, connectionTimeoutMillis: 1500, statement_timeout: 1500, query_timeout: 2000, application_name: 'pulse-monitor' });
        this.pool.on('error', () => undefined);
      }
      const start = performance.now();
      const result = await this.pool.query('SELECT numbackends, xact_commit, xact_rollback, deadlocks, blks_hit, blks_read FROM pg_stat_database WHERE datname = current_database()');
      const row = result.rows[0];
      if (!row) throw new Error('No database statistics');
      const blocks = Number(row.blks_hit) + Number(row.blks_read);
      return { status: 'connected', checkedAt, metrics: {
        latencyMs: performance.now() - start,
        connections: Number(row.numbackends), commits: Number(row.xact_commit), rollbacks: Number(row.xact_rollback), deadlocks: Number(row.deadlocks),
        cacheHitRate: blocks ? Number(row.blks_hit) / blocks * 100 : null,
      } };
    } catch { return { status: 'unavailable', checkedAt }; }
  }
}
