import { Inject, Injectable } from '@nestjs/common';
import { PULSE_OPTIONS } from './tokens.js';
import type { PulseOptions } from './types.js';

export interface RabbitMqQueueSnapshot {
  name: string;
  vhost: string;
  state: string;
  messages: number;
  ready: number;
  unacknowledged: number;
  consumers: number;
}

export interface RabbitMqSnapshot {
  status: 'unconfigured' | 'connected' | 'unavailable';
  checkedAt: string;
  metrics?: ReturnType<typeof parseRabbitMqOverview> & { latencyMs: number };
  queues?: RabbitMqQueueSnapshot[];
}

export interface RabbitMqQueueDetail {
  status: 'unconfigured' | 'connected' | 'missing' | 'unavailable';
  checkedAt: string;
  name: string;
  vhost: string;
  // Everything the Management API reports for the queue (definition, arguments, policy, counts, rates, memory, consumers).
  queue?: Record<string, unknown>;
  bindings?: Array<Record<string, unknown>>;
}

export interface RabbitMqManagementTarget {
  base: string;
  authorization: string;
  vhost: string;
}

// Reads the RabbitMQ Management HTTP API (default port 15672). Pulse never opens AMQP channels,
// consumes, publishes or acknowledges messages.
@Injectable()
export class RabbitMqMonitor {
  private cached?: RabbitMqSnapshot;
  private pending: Promise<RabbitMqSnapshot> | undefined;
  private readonly details = new Map<string, Promise<RabbitMqQueueDetail>>();
  constructor(@Inject(PULSE_OPTIONS) private readonly options: PulseOptions) {}

  snapshot(): Promise<RabbitMqSnapshot> {
    if (this.cached && Date.now() - Date.parse(this.cached.checkedAt) < 5000) return Promise.resolve(this.cached);
    return this.pending ??= this.collect().then((result) => { this.cached = result; return result; }).finally(() => { this.pending = undefined; });
  }

  /** Full details of one queue, for the dashboard drill-down. Cached for 3 seconds per queue. */
  queue(name: string, vhost?: string): Promise<RabbitMqQueueDetail> {
    const config = this.options.rabbitmq;
    const resolvedVhost = vhost || (config?.url ? rabbitMqManagementTarget(config).vhost : '/');
    const key = resolvedVhost + '\u0000' + name;
    const pending = this.details.get(key);
    if (pending) return pending;
    const request = this.collectQueue(name, resolvedVhost).finally(() => {
      setTimeout(() => { if (this.details.get(key) === request) this.details.delete(key); }, 3000).unref?.();
    });
    this.details.set(key, request);
    return request;
  }

  private async collectQueue(name: string, vhost: string): Promise<RabbitMqQueueDetail> {
    const checkedAt = new Date().toISOString();
    const config = this.options.rabbitmq;
    if (!config?.url || config.enabled === false || this.options.enabled === false) return { status: 'unconfigured', checkedAt, name, vhost };
    try {
      const target = rabbitMqManagementTarget(config);
      const path = '/api/queues/' + encodeURIComponent(vhost) + '/' + encodeURIComponent(name);
      const [queue, bindings] = await Promise.all([this.request(target, path), this.request(target, path + '/bindings')]);
      return {
        status: 'connected',
        checkedAt,
        name,
        vhost,
        queue: queue && typeof queue === 'object' && !Array.isArray(queue) ? (queue as Record<string, unknown>) : {},
        bindings: Array.isArray(bindings) ? bindings.filter((binding): binding is Record<string, unknown> => !!binding && typeof binding === 'object') : [],
      };
    } catch (error) {
      // 404 means the queue does not exist (any more); other failures are reported without broker details.
      return { status: (error as { status?: number }).status === 404 ? 'missing' : 'unavailable', checkedAt, name, vhost };
    }
  }

  private async collect(): Promise<RabbitMqSnapshot> {
    const checkedAt = new Date().toISOString();
    const config = this.options.rabbitmq;
    if (!config?.url || config.enabled === false || this.options.enabled === false) return { status: 'unconfigured', checkedAt };
    try {
      const target = rabbitMqManagementTarget(config);
      const start = performance.now();
      const overview = await this.request(target, '/api/overview');
      const latencyMs = performance.now() - start;
      const columns = 'name,vhost,state,messages,messages_ready,messages_unacknowledged,consumers';
      const queues = await this.request(target, `/api/queues/${encodeURIComponent(target.vhost)}?columns=${columns}`);
      return { status: 'connected', checkedAt, metrics: { ...parseRabbitMqOverview(overview), latencyMs }, queues: selectRabbitMqQueues(queues, config.queues) };
    } catch {
      // Never send connection URLs, credentials or raw errors to the browser.
      return { status: 'unavailable', checkedAt };
    }
  }

  private async request(target: RabbitMqManagementTarget, path: string): Promise<unknown> {
    const response = await fetch(target.base + path, {
      headers: { authorization: target.authorization, accept: 'application/json' },
      signal: AbortSignal.timeout(1500),
    });
    if (!response.ok) throw Object.assign(new Error(`HTTP ${response.status}`), { status: response.status });
    return response.json();
  }
}

// Derives the Management API address from the AMQP URL (same host, port 15672, same credentials)
// unless managementUrl is given. Credentials are moved to an Authorization header because fetch
// rejects URLs that embed them.
export function rabbitMqManagementTarget(config: { url: string; managementUrl?: string }): RabbitMqManagementTarget {
  const amqp = new URL(config.url);
  const management = new URL(config.managementUrl ?? `${amqp.protocol === 'amqps:' ? 'https' : 'http'}://${amqp.hostname}:15672`);
  const username = decodeURIComponent(management.username || amqp.username || 'guest');
  const password = decodeURIComponent(management.password || amqp.password || 'guest');
  management.username = '';
  management.password = '';
  return {
    base: management.origin + management.pathname.replace(/\/$/, ''),
    authorization: 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64'),
    vhost: decodeURIComponent(amqp.pathname.slice(1)) || '/',
  };
}

export function parseRabbitMqOverview(overview: unknown) {
  const data = (overview ?? {}) as Record<string, any>;
  const number = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);
  return {
    version: typeof data.rabbitmq_version === 'string' ? data.rabbitmq_version : '',
    connections: number(data.object_totals?.connections),
    channels: number(data.object_totals?.channels),
    queues: number(data.object_totals?.queues),
    consumers: number(data.object_totals?.consumers),
    messages: number(data.queue_totals?.messages),
    ready: number(data.queue_totals?.messages_ready),
    unacknowledged: number(data.queue_totals?.messages_unacknowledged),
    publishRate: number(data.message_stats?.publish_details?.rate),
    deliverRate: number(data.message_stats?.deliver_get_details?.rate),
  };
}

// Configured names are shown in order (missing queues are reported as such); otherwise the 20 deepest queues of the vhost.
export function selectRabbitMqQueues(payload: unknown, names: string[] | undefined): RabbitMqQueueSnapshot[] {
  const rows = Array.isArray(payload) ? payload : [];
  const queues = rows
    .filter((row): row is Record<string, any> => !!row && typeof row.name === 'string')
    .map((row) => ({
      name: row.name as string,
      vhost: typeof row.vhost === 'string' ? row.vhost : '/',
      state: typeof row.state === 'string' ? row.state : 'unknown',
      messages: Number(row.messages ?? 0),
      ready: Number(row.messages_ready ?? 0),
      unacknowledged: Number(row.messages_unacknowledged ?? 0),
      consumers: Number(row.consumers ?? 0),
    }));
  if (names?.length) {
    return [...new Set(names)].map(
      (name) => queues.find((queue) => queue.name === name) ?? { name, vhost: '/', state: 'missing', messages: 0, ready: 0, unacknowledged: 0, consumers: 0 },
    );
  }
  return queues.sort((a, b) => b.messages - a.messages).slice(0, 20);
}
