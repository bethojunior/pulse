import { afterEach, describe, expect, it, vi } from 'vitest';
import { RabbitMqMonitor, parseRabbitMqOverview, rabbitMqManagementTarget, selectRabbitMqQueues } from '../src/rabbitmq-monitor.js';

const overview = {
  rabbitmq_version: '4.0.5',
  object_totals: { connections: 2, channels: 3, queues: 4, consumers: 1 },
  queue_totals: { messages: 10, messages_ready: 7, messages_unacknowledged: 3 },
  message_stats: { publish_details: { rate: 1.5 }, deliver_get_details: { rate: 0.5 } },
};
const queues = [
  { name: 'events', vhost: '/', state: 'running', messages: 10, messages_ready: 7, messages_unacknowledged: 3, consumers: 1 },
  { name: 'dead-letter', vhost: '/', state: 'running', messages: 0, messages_ready: 0, messages_unacknowledged: 0, consumers: 0 },
];

function mockFetch(handler: (url: string, init: RequestInit) => unknown) {
  const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    const body = handler(url, init);
    return { ok: true, status: 200, json: async () => body } as Response;
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe('RabbitMQ monitor', () => {
  it('derives the Management API from the AMQP URL and keeps credentials out of the URL', () => {
    const target = rabbitMqManagementTarget({ url: 'amqps://us%40er:p%3Ass@broker.internal:5671/orders' });
    expect(target.base).toBe('https://broker.internal:15672');
    expect(target.vhost).toBe('orders');
    expect(target.authorization).toBe('Basic ' + Buffer.from('us@er:p:ss').toString('base64'));

    const custom = rabbitMqManagementTarget({ url: 'amqp://localhost', managementUrl: 'http://admin:secret@mgmt.internal/rabbitmq/' });
    expect(custom.base).toBe('http://mgmt.internal/rabbitmq');
    expect(custom.vhost).toBe('/');
    expect(custom.authorization).toBe('Basic ' + Buffer.from('admin:secret').toString('base64'));
  });

  it('does not call the API without configuration', async () => {
    const fetchMock = mockFetch(() => overview);
    expect(await new RabbitMqMonitor({ serviceId: 'test' }).snapshot()).toMatchObject({ status: 'unconfigured' });
    expect(await new RabbitMqMonitor({ serviceId: 'test', rabbitmq: { enabled: false, url: 'amqp://localhost' } }).snapshot()).toMatchObject({ status: 'unconfigured' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reads overview and queue depths, shares concurrent reads and caches results', async () => {
    const fetchMock = mockFetch((url) => (url.endsWith('/api/overview') ? overview : queues));
    const monitor = new RabbitMqMonitor({ serviceId: 'test', rabbitmq: { url: 'amqp://guest:guest@localhost:5672' } });
    const [first, second] = await Promise.all([monitor.snapshot(), monitor.snapshot()]);
    expect(first).toBe(second);
    expect(first.status).toBe('connected');
    expect(first.metrics).toMatchObject({ version: '4.0.5', connections: 2, consumers: 1, messages: 10, unacknowledged: 3, publishRate: 1.5 });
    expect(first.queues?.map((queue) => queue.name)).toEqual(['events', 'dead-letter']);
    await monitor.snapshot();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://localhost:15672/api/overview');
    expect(fetchMock.mock.calls[1]?.[0]).toContain('/api/queues/%2F?columns=');
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).headers).toMatchObject({ authorization: 'Basic ' + Buffer.from('guest:guest').toString('base64') });
  });

  it('lists configured queues in order and flags missing ones', () => {
    const selected = selectRabbitMqQueues(queues, ['dead-letter', 'emails', 'dead-letter']);
    expect(selected.map((queue) => [queue.name, queue.state])).toEqual([
      ['dead-letter', 'running'],
      ['emails', 'missing'],
    ]);
    expect(selectRabbitMqQueues('not-a-list', undefined)).toEqual([]);
    expect(parseRabbitMqOverview({ object_totals: { connections: 'x' } })).toMatchObject({ version: '', connections: null, publishRate: null });
  });

  it('reports outages without exposing the broker address or credentials', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('connect ECONNREFUSED secret-host:15672'); }));
    const snapshot = await new RabbitMqMonitor({ serviceId: 'test', rabbitmq: { url: 'amqp://admin:topsecret@secret-host:5672' } }).snapshot();
    expect(snapshot.status).toBe('unavailable');
    expect(JSON.stringify(snapshot)).not.toMatch(/topsecret|secret-host/);

    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) })));
    expect((await new RabbitMqMonitor({ serviceId: 'test', rabbitmq: { url: 'amqp://localhost' } }).snapshot()).status).toBe('unavailable');
  });
  it('returns the full queue definition with bindings and encodes names and vhosts', async () => {
    const detail = { name: 'orders.created', vhost: 'shop', durable: true, type: 'quorum', arguments: { 'x-queue-type': 'quorum' }, consumer_details: [{ consumer_tag: 'ctag-1', prefetch_count: 10 }], message_stats: { ack: 5 } };
    const bindings = [{ source: '', destination: 'orders.created', routing_key: 'orders.created' }, { source: 'events', routing_key: 'orders.*' }];
    const fetchMock = mockFetch((url) => (url.endsWith('/bindings') ? bindings : detail));
    const monitor = new RabbitMqMonitor({ serviceId: 'test', rabbitmq: { url: 'amqp://guest:guest@localhost:5672/shop' } });
    const [first, second] = await Promise.all([monitor.queue('orders.created'), monitor.queue('orders.created')]);
    expect(first).toBe(second);
    expect(first).toMatchObject({ status: 'connected', name: 'orders.created', vhost: 'shop', queue: { type: 'quorum', consumer_details: [{ consumer_tag: 'ctag-1' }] } });
    expect(first.bindings).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map((call) => call[0]).sort()).toEqual([
      'http://localhost:15672/api/queues/shop/orders.created',
      'http://localhost:15672/api/queues/shop/orders.created/bindings',
    ]);
    await monitor.queue('a/b c', '/');
    expect(fetchMock.mock.calls[2]?.[0]).toBe('http://localhost:15672/api/queues/%2F/a%2Fb%20c');
  });

  it('distinguishes a missing queue from an unavailable broker and never calls the API when unconfigured', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, json: async () => ({ error: 'Object Not Found' }) })));
    expect(await new RabbitMqMonitor({ serviceId: 'test', rabbitmq: { url: 'amqp://localhost' } }).queue('ghost')).toMatchObject({ status: 'missing', name: 'ghost', vhost: '/' });
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED secret-host'); }));
    const failed = await new RabbitMqMonitor({ serviceId: 'test', rabbitmq: { url: 'amqp://admin:topsecret@secret-host:5672' } }).queue('events');
    expect(failed.status).toBe('unavailable');
    expect(JSON.stringify(failed)).not.toMatch(/topsecret|secret-host/);
    const fetchMock = mockFetch(() => ({}));
    expect((await new RabbitMqMonitor({ serviceId: 'test' }).queue('events')).status).toBe('unconfigured');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
