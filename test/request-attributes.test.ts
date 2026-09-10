import { EventEmitter } from 'node:events';
import { lastValueFrom, of } from 'rxjs';
import { describe, expect, it } from 'vitest';
import { TraceContextStore } from '../src/context.js';
import { MetricCollector } from '../src/metrics.js';
import { PulseRequestInterceptor } from '../src/request.interceptor.js';
import { PulseRequestMiddleware, capturedHeaders, enduserId, jsonAttribute, redactValue, requestSpanOf } from '../src/request.middleware.js';
import { serializeError } from '../src/span.js';
import { TelemetryStore } from '../src/telemetry.store.js';
import { TracerService } from '../src/tracer.service.js';
import type { PulseOptions, SpanRecord } from '../src/types.js';

function setup(options: PulseOptions = { serviceId: 'api', flushIntervalMs: 0 }) {
  const store = new TelemetryStore();
  const contextStore = new TraceContextStore();
  const tracer = new TracerService(contextStore, new MetricCollector(), { export() {} }, options, store);
  return { store, tracer, middleware: new PulseRequestMiddleware(tracer, contextStore, store, options), interceptor: new PulseRequestInterceptor(tracer, contextStore, options) };
}

function fakeResponse(statusCode: number, headers: Record<string, unknown> = {}) {
  const response = new EventEmitter() as EventEmitter & { statusCode: number; writableFinished: boolean; writableEnded: boolean; getHeader(name: string): unknown; getHeaders(): Record<string, unknown> };
  response.statusCode = statusCode;
  response.writableFinished = true;
  response.writableEnded = true;
  response.getHeader = (name: string) => headers[name];
  response.getHeaders = () => headers;
  return response;
}

const token = 'Bearer eyJhbGciOiJIUzI1NiJ9.' + Buffer.from(JSON.stringify({ sub: 'usr_42', email: 'a@b.c' })).toString('base64url') + '.sig';

async function record(options: PulseOptions, request: Record<string, unknown>, response = fakeResponse(200, { 'content-type': 'application/json; charset=utf-8', 'content-length': 12, 'set-cookie': ['sid=secret'] })): Promise<SpanRecord> {
  const { store, tracer, middleware } = setup(options);
  middleware.use(request, response, () => undefined);
  response.emit('finish');
  await tracer.flush();
  const span = store.snapshot(options).spans[0];
  if (!span) throw new Error('no span recorded');
  return span;
}

describe('request data captured on the server span', () => {
  const headers = {
    host: 'shop.example.com',
    'user-agent': 'vitest',
    authorization: token,
    cookie: 'sid=abc',
    'x-request-id': 'req-1',
    'x-forwarded-for': '203.0.113.7, 10.0.0.1',
    'x-long': 'a'.repeat(700),
    accept: 'application/json',
  };

  it('records every header by default with credentials redacted and long values capped', async () => {
    const span = await record({ serviceId: 'api' }, { method: 'GET', url: '/orders?status=paid&status=open&token=abc&page=2', httpVersion: '1.1', headers, socket: { remoteAddress: '127.0.0.1', remotePort: 51234 } });
    expect(span.attributes).toMatchObject({
      'http.client_ip': '203.0.113.7',
      'http.flavor': '1.1',
      'net.peer.port': 51234,
      'http.request.header.host': 'shop.example.com',
      'http.request.header.accept': 'application/json',
      'http.request.header.authorization': '[redacted]',
      'http.request.header.cookie': '[redacted]',
      'enduser.id': 'usr_42',
      'http.response.content_type': 'application/json; charset=utf-8',
      'http.response.header.content-type': 'application/json; charset=utf-8',
      'http.response.header.set-cookie': '[redacted]',
    });
    expect(String(span.attributes['http.request.header.x-long'])).toHaveLength(513);
    expect(JSON.parse(String(span.attributes['http.query']))).toEqual({ status: ['paid', 'open'], token: '[redacted]', page: '2' });
    expect(span.attributes['http.request.body']).toBeUndefined();
    expect(JSON.stringify(span)).not.toContain('eyJhbGciOiJIUzI1NiJ9');
  });

  it('honours captureHeaders false and allow-lists', () => {
    expect(capturedHeaders(headers, false)).toEqual({});
    expect(Object.keys(capturedHeaders(headers, ['Host', 'authorization']))).toEqual(['http.request.header.host', 'http.request.header.authorization']);
    expect(capturedHeaders(headers, ['authorization'])['http.request.header.authorization']).toBe('[redacted]');
    expect(Object.keys(capturedHeaders(headers, undefined))).toHaveLength(Object.keys(headers).length);
  });

  it('records the body only when enabled, redacting secrets and truncating large payloads', async () => {
    const body = { email: 'ana@example.com', password: 'hunter2', card: { cardNumber: '4111111111111111', cvv: '123', holder: 'Ana' }, items: [{ sku: 'SKU-1', quantity: 2 }], apiKey: 'k' };
    const span = await record({ serviceId: 'api', captureBody: true }, { method: 'POST', url: '/orders', headers: {}, body });
    expect(JSON.parse(String(span.attributes['http.request.body']))).toEqual({
      email: 'ana@example.com',
      password: '[redacted]',
      card: { cardNumber: '[redacted]', cvv: '[redacted]', holder: 'Ana' },
      items: [{ sku: 'SKU-1', quantity: 2 }],
      apiKey: '[redacted]',
    });

    const large = await record({ serviceId: 'api', captureBody: true, captureBodyMaxBytes: 64 }, { method: 'POST', url: '/orders', headers: {}, body: { note: 'x'.repeat(500) } });
    expect(String(large.attributes['http.request.body'])).toMatch(/^\{"note":"x+… \[truncated, 5\d\d bytes\]$/);

    const empty = await record({ serviceId: 'api', captureBody: true }, { method: 'GET', url: '/orders', headers: {}, body: {} });
    expect(empty.attributes['http.request.body']).toBeUndefined();

    const text = await record({ serviceId: 'api', captureBody: true }, { method: 'POST', url: '/webhook', headers: {}, body: 'raw text payload' });
    expect(text.attributes['http.request.body']).toBe('raw text payload');
  });

  it('adds route params from the interceptor onto the request span', async () => {
    const { store, tracer, middleware, interceptor } = setup();
    const request: Record<string, unknown> = { method: 'GET', url: '/orders/42/items/7', headers: {}, route: { path: '/orders/:id/items/:itemId' }, params: { id: '42', itemId: '7', token: 't' } };
    const response = fakeResponse(200);
    middleware.use(request, response, () => undefined);
    const context = { getType: () => 'http', getClass: () => ({ name: 'OrdersController' }), getHandler: () => ({ name: 'item' }), switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }) } as never;
    await lastValueFrom(interceptor.intercept(context, { handle: () => of({ ok: true }) }));
    response.emit('finish');
    await tracer.flush();
    const root = store.snapshot({ serviceId: 'api' }).spans.find((span) => span.kind === 'server');
    expect(requestSpanOf(request)).toBeDefined();
    expect(JSON.parse(String(root?.attributes['http.params']))).toEqual({ id: '42', itemId: '7', token: '[redacted]' });
  });

  it('exposes safe helpers', () => {
    expect(redactValue({ user: { passwordHash: 'x', name: 'n' }, list: [{ accessToken: 't' }] })).toEqual({ user: { passwordHash: '[redacted]', name: 'n' }, list: [{ accessToken: '[redacted]' }] });
    expect(jsonAttribute(undefined, 10)).toBeUndefined();
    expect(jsonAttribute(Buffer.from('abc'), 100)).toBe('"<Buffer 3 bytes>"');
    expect(enduserId('Bearer not-a-jwt')).toBeUndefined();
    expect(enduserId('Basic abc')).toBeUndefined();
    expect(enduserId(token)).toBe('usr_42');
  });

  it('redacts credentials inside serialized error details (AxiosError config, raw request headers)', () => {
    const error = Object.assign(new Error('Request failed with status code 402'), {
      name: 'AxiosError',
      code: 'ERR_BAD_REQUEST',
      config: { url: 'https://api.stripe.com/v1/charges', headers: { Authorization: 'Bearer sk_live_topsecret', 'Content-Type': 'application/json' }, data: '{"card_token":"tok_secret","amount":10}' },
      request: { _header: 'POST /v1/charges HTTP/1.1\r\nAccept: application/json\r\nauthorization: Bearer sk_live_topsecret\r\ncookie: sid=abc\r\n', method: 'POST' },
      response: { status: 402, data: { error: { code: 'card_declined' } }, config: { headers: { authorization: 'Bearer sk_live_topsecret' }, nested: { deeper: { deepest: { apiKey: 'sk_live_topsecret', ok: 1 } } } } },
    });
    const serialized = serializeError(error);
    const text = JSON.stringify(serialized);
    expect(text).not.toContain('sk_live_topsecret');
    expect(text).not.toContain('sid=abc');
    expect(serialized.details).toMatchObject({ config: { url: 'https://api.stripe.com/v1/charges', headers: { Authorization: '[redacted]', 'Content-Type': 'application/json' } }, response: { status: 402, data: { error: { code: 'card_declined' } } } });
    expect(String((serialized.details as { request: { _header: string } }).request._header)).toContain('authorization: [redacted]');
    expect(String((serialized.details as { request: { _header: string } }).request._header)).toContain('Accept: application/json');
  });

  it('redacts numeric secrets in user-supplied data while error details keep counters', async () => {
    const span = await record({ serviceId: 'api', captureBody: true }, { method: 'POST', url: '/payments?otp=482913&page=2', headers: {}, body: { cvv: 123, otp: 482913, cardNumber: 4111111111111111, pin: 1234, quantity: 2, amount: 49.9, gift: true } });
    expect(JSON.parse(String(span.attributes['http.request.body']))).toEqual({ cvv: '[redacted]', otp: '[redacted]', cardNumber: '[redacted]', pin: '[redacted]', quantity: 2, amount: 49.9, gift: true });
    expect(JSON.parse(String(span.attributes['http.query']))).toEqual({ otp: '[redacted]', page: '2' });
    expect(redactValue({ usage: { total_tokens: 12 }, cvv: 123 })).toEqual({ usage: { total_tokens: 12 }, cvv: 123 });
    expect(redactValue({ usage: { total_tokens: 12 }, cvv: 123 }, 0, { strict: true })).toEqual({ usage: { total_tokens: '[redacted]' }, cvv: '[redacted]' });
  });
});
