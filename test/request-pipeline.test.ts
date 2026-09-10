import { EventEmitter } from 'node:events';
import { NotFoundException } from '@nestjs/common';
import { lastValueFrom, of, throwError } from 'rxjs';
import { describe, expect, it } from 'vitest';
import { TraceContextStore } from '../src/context.js';
import { MetricCollector } from '../src/metrics.js';
import { PulseRequestInterceptor } from '../src/request.interceptor.js';
import { PulseRequestMiddleware, parseTraceParent, requestSpanOf } from '../src/request.middleware.js';
import { TelemetryStore } from '../src/telemetry.store.js';
import { TracerService } from '../src/tracer.service.js';
import type { PulseOptions } from '../src/types.js';

function setup(options: PulseOptions = { serviceId: 'api', flushIntervalMs: 0 }) {
  const store = new TelemetryStore();
  const contextStore = new TraceContextStore();
  const tracer = new TracerService(contextStore, new MetricCollector(), { export() {} }, options, store);
  const middleware = new PulseRequestMiddleware(tracer, contextStore, store, options);
  const interceptor = new PulseRequestInterceptor(tracer, contextStore, options);
  return { store, tracer, middleware, interceptor, contextStore };
}

function fakeResponse(statusCode: number, contentLength = 0) {
  const response = new EventEmitter() as EventEmitter & { statusCode: number; writableFinished: boolean; writableEnded: boolean; getHeader(name: string): unknown };
  response.statusCode = statusCode;
  response.writableFinished = false;
  response.writableEnded = false;
  response.getHeader = (name: string) => (name === 'content-length' ? contentLength : undefined);
  return response;
}

function executionContext(request: unknown, response: unknown, className = 'OrdersController', handlerName = 'findOne') {
  return {
    getType: () => 'http',
    getClass: () => ({ name: className }),
    getHandler: () => ({ name: handlerName }),
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }),
  } as never;
}

describe('request pipeline', () => {
  it('records requests rejected before the handler (guards, pipes, 404) with their final status', async () => {
    const { store, tracer, middleware } = setup();
    const request = { method: 'GET', url: '/blog?x=1', headers: { host: 'api.local', 'user-agent': 'vitest', 'x-forwarded-for': '10.0.0.9, 10.0.0.1' }, socket: { remoteAddress: '127.0.0.1' } };
    const response = fakeResponse(401);
    let nextCalled = false;

    middleware.use(request, response, () => { nextCalled = true; });
    expect(nextCalled).toBe(true);
    expect(store.snapshot({ serviceId: 'api' }).http.inFlight).toBe(1);
    response.statusCode = 401;
    response.writableFinished = true;
    response.emit('finish');
    response.emit('close');
    await tracer.flush();

    const snapshot = store.snapshot({ serviceId: 'api' });
    expect(snapshot.http).toMatchObject({ inFlight: 1 - 1, total: 1, totalClientErrors: 1 });
    expect(snapshot.spans).toHaveLength(1);
    expect(snapshot.spans[0]).toMatchObject({
      kind: 'server',
      status: 'ok',
      name: 'HTTP GET /blog',
      attributes: { 'http.method': 'GET', 'http.route': '/blog', 'http.status_code': 401, 'http.client_ip': '10.0.0.9', 'http.user_agent': 'vitest', 'http.host': 'api.local' },
    });
    expect(snapshot.overview.clientErrorRate).toBe(100);
    expect(snapshot.overview.errorRate).toBe(0);
  });

  it('links the handler span to the request span and shares the exception with both', async () => {
    const { store, tracer, middleware, interceptor } = setup();
    const request: Record<string, unknown> = { method: 'GET', url: '/orders/42', headers: {}, route: { path: '/orders/:id' } };
    const response = fakeResponse(404);
    middleware.use(request, response, () => undefined);
    const root = requestSpanOf(request)!;
    expect(root).toBeDefined();

    const failing = { handle: () => throwError(() => new NotFoundException('Order 42 not found')) };
    await expect(lastValueFrom(interceptor.intercept(executionContext(request, response), failing))).rejects.toBeInstanceOf(NotFoundException);
    response.emit('finish');
    await tracer.flush();

    const spans = store.trace(root.traceId);
    expect(spans.map((span) => span.kind).sort()).toEqual(['handler', 'server']);
    const server = spans.find((span) => span.kind === 'server')!;
    const handler = spans.find((span) => span.kind === 'handler')!;
    expect(server).toMatchObject({ name: 'HTTP GET /orders/:id', status: 'error', attributes: { 'http.route': '/orders/:id', 'http.status_code': 404 } });
    expect(server.error).toMatchObject({ name: 'NotFoundException', status: 404 });
    expect(handler).toMatchObject({ name: 'OrdersController.findOne', parentSpanId: server.spanId, status: 'error', attributes: { 'nest.class': 'OrdersController', 'http.route': '/orders/:id' } });
    const snapshot = store.snapshot({ serviceId: 'api' });
    expect(snapshot.errors).toHaveLength(1);
    expect(snapshot.errors[0]).toMatchObject({ category: 'client', occurrences: 1, status: 404, latest: { kind: 'server' } });
  });

  it('marks unexplained 5xx responses as errors and ignores configured routes', async () => {
    const options: PulseOptions = { serviceId: 'api', flushIntervalMs: 0, ignoredRoutes: ['/health'] };
    const { store, tracer, middleware, interceptor } = setup(options);

    const failing = { method: 'POST', url: '/orders', headers: { 'content-length': '12' } };
    const failingResponse = fakeResponse(500, 30);
    middleware.use(failing, failingResponse, () => undefined);
    failingResponse.emit('finish');

    const health = { method: 'GET', url: '/health', headers: {} };
    let healthNext = false;
    middleware.use(health, fakeResponse(200), () => { healthNext = true; });
    expect(healthNext).toBe(true);
    expect(requestSpanOf(health)).toBeUndefined();

    const dashboard = { method: 'GET', url: '/pulse/api/snapshot', headers: {} };
    middleware.use(dashboard, fakeResponse(200), () => undefined);
    expect(requestSpanOf(dashboard)).toBeUndefined();

    // A route ignored by pattern only becomes known inside the interceptor; the request span is then dropped.
    const status = { method: 'GET', url: '/status/1', headers: {}, route: { path: '/health/:probe' } };
    const statusResponse = fakeResponse(200);
    middleware.use(status, statusResponse, () => undefined);
    await lastValueFrom(interceptor.intercept(executionContext(status, statusResponse, 'HealthController', 'probe'), { handle: () => of('ok') }));
    statusResponse.emit('finish');
    await tracer.flush();

    const snapshot = store.snapshot({ serviceId: 'api' });
    expect(snapshot.spans).toHaveLength(1);
    expect(snapshot.spans[0]).toMatchObject({ status: 'error', attributes: { 'http.status_code': 500, 'http.request.content_length': 12, 'http.response.content_length': 30 } });
    expect(snapshot.spans[0]?.error).toMatchObject({ name: 'HttpServerError', message: 'HTTP 500 on POST /orders' });
    expect(snapshot.http).toMatchObject({ total: 2, bytesIn: 12, bytesOut: 30 });
  });

  it('keeps creating the server span itself when no middleware span exists (non-HTTP or Fastify without middie)', async () => {
    const { store, tracer, interceptor } = setup();
    const request = { method: 'GET', url: '/legacy', headers: {}, route: { path: '/legacy' } };
    const response = { statusCode: 200 };
    await lastValueFrom(interceptor.intercept(executionContext(request, response), { handle: () => of('ok') }));
    await tracer.flush();
    expect(store.snapshot({ serviceId: 'api' }).spans[0]).toMatchObject({ kind: 'server', name: 'HTTP GET /legacy', attributes: { 'http.status_code': 200 } });
  });

  it('continues upstream W3C trace context', () => {
    expect(parseTraceParent('00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01')).toEqual({ traceId: '0af7651916cd43dd8448eb211c80319c', spanId: 'b7ad6b7169203331' });
    expect(parseTraceParent('00-00000000000000000000000000000000-b7ad6b7169203331-01')).toBeUndefined();
    expect(parseTraceParent('garbage')).toBeUndefined();
    const { middleware } = setup();
    const request = { method: 'GET', url: '/x', headers: { traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01' } };
    middleware.use(request, fakeResponse(200), () => undefined);
    expect(requestSpanOf(request)).toMatchObject({ traceId: '0af7651916cd43dd8448eb211c80319c', parentSpanId: 'b7ad6b7169203331' });
  });

  it('records process events as error spans', async () => {
    const { store, tracer } = setup();
    tracer.recordProcessEvent('warning', Object.assign(new Error('Possible EventEmitter memory leak'), { name: 'MaxListenersExceededWarning' }));
    await tracer.flush();
    const snapshot = store.snapshot({ serviceId: 'api' });
    expect(snapshot.processEvents[0]).toMatchObject({ kind: 'process', status: 'error', attributes: { 'event.kind': 'warning' } });
    expect(snapshot.errors[0]).toMatchObject({ category: 'process', name: 'MaxListenersExceededWarning' });
  });
});
