import { HttpException, NotFoundException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { httpStatusOf, parseStackFrames, serializeError } from '../src/span.js';

describe('serializeError', () => {
  it('captures stack frames, status, code, cause and extra properties', () => {
    const cause = Object.assign(new Error('connection refused'), { code: 'ECONNREFUSED', syscall: 'connect', address: '127.0.0.1', port: 5432 });
    const error = Object.assign(new Error('query failed', { cause }), { code: 'P2010', meta: { table: 'orders' }, secret: () => 'skipped' });

    const serialized = serializeError(error);

    expect(serialized).toMatchObject({ name: 'Error', message: 'query failed', code: 'P2010', details: { meta: { table: 'orders' } } });
    expect(serialized.details).not.toHaveProperty('secret');
    expect(serialized.cause).toMatchObject({ name: 'Error', message: 'connection refused', code: 'ECONNREFUSED', details: { syscall: 'connect', port: 5432 } });
    expect(serialized.frames?.[0]).toMatchObject({ file: expect.stringContaining('span.test.ts'), inApp: true });
    expect(serialized.frames?.[0]?.line).toBeGreaterThan(0);
    expect(serialized.stack).toBe(error.stack);
  });

  it('reads Nest HttpException status and response body', () => {
    const serialized = serializeError(new NotFoundException('Order 42 not found'));
    expect(serialized).toMatchObject({ name: 'NotFoundException', message: 'Order 42 not found', status: 404 });
    expect(serialized.details?.response).toMatchObject({ statusCode: 404, message: 'Order 42 not found' });
    expect(httpStatusOf(new HttpException('teapot', 418))).toBe(418);
    expect(httpStatusOf({ statusCode: 502 })).toBe(502);
    expect(httpStatusOf(new Error('plain'))).toBeUndefined();
  });

  it('redacts credentials in error properties by whole-word key match and keeps counters', () => {
    const error = Object.assign(new Error('request failed'), {
      config: { headers: { authorization: 'Bearer sk_test_123', accept: 'application/json' }, url: '/pay' },
      body: { accessToken: 'abc', api_key: 'k', cardNumber: '4111', otp: '123456', passenger: 'Ana', footprint: 'small' },
      usage: { total_tokens: 12, tokens: 3 },
      request: { _header: 'POST / HTTP/1.1\r\nauthorization: Bearer abc\r\nhost: x\r\n' },
    });

    const details = serializeError(error).details as Record<string, any>;

    expect(details.config.headers).toEqual({ authorization: '[redacted]', accept: 'application/json' });
    expect(details.body).toEqual({ accessToken: '[redacted]', api_key: '[redacted]', cardNumber: '[redacted]', otp: '[redacted]', passenger: 'Ana', footprint: 'small' });
    expect(details.usage).toEqual({ total_tokens: 12, tokens: 3 });
    expect(details.request._header).toBe('POST / HTTP/1.1\r\nauthorization: [redacted]\r\nhost: x\r\n');
  });

  it('serializes non-error values and truncates long strings', () => {
    expect(serializeError('boom')).toEqual({ name: 'Error', message: 'boom' });
    expect(serializeError({ reason: 'x' })).toEqual({ name: 'Error', message: '{"reason":"x"}' });
    const long = serializeError(Object.assign(new Error('big'), { payload: 'x'.repeat(5000) }));
    expect((long.details?.payload as string).length).toBeLessThanOrEqual(2001);
  });

  it('parses V8 stack frames including async, anonymous and node internals', () => {
    const frames = parseStackFrames([
      'TypeError: boom',
      '    at OrdersService.find (/app/src/orders/orders.service.ts:42:11)',
      '    at async OrdersController.findOne (/app/src/orders/orders.controller.ts:18:20)',
      '    at /app/node_modules/@nestjs/core/router/router-execution-context.js:46:28',
      '    at process.processTicksAndRejections (node:internal/process/task_queues:95:5)',
      '    at new Promise (<anonymous>)',
      '    at async Promise.all (index 0)',
    ].join('\n'));

    expect(frames).toHaveLength(6);
    expect(frames[5]).toMatchObject({ function: 'async Promise.all', file: 'index 0', line: null, inApp: false });
    expect(frames[0]).toMatchObject({ function: 'OrdersService.find', file: '/app/src/orders/orders.service.ts', line: 42, column: 11, inApp: true });
    expect(frames[1]).toMatchObject({ function: 'async OrdersController.findOne', line: 18, inApp: true });
    expect(frames[2]).toMatchObject({ function: '', file: '/app/node_modules/@nestjs/core/router/router-execution-context.js', inApp: false });
    expect(frames[3]).toMatchObject({ file: 'node:internal/process/task_queues', inApp: false });
    expect(frames[4]).toMatchObject({ function: 'new Promise', file: '<anonymous>', inApp: false });
  });
});
