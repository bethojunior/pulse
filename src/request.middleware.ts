import { Inject, Injectable, type NestMiddleware } from '@nestjs/common';
import type { Attributes, PulseOptions } from './types.js';
import { TraceContextStore } from './context.js';
import { TraceSpanDelegate } from './span.js';
import { TelemetryStore } from './telemetry.store.js';
import { TracerService } from './tracer.service.js';
import { PULSE_OPTIONS } from './tokens.js';
import { REDACTED, isSensitiveHeader, redactValue } from './redaction.js';

export { redactValue } from './redaction.js';

/** Property under which the request span is attached to the framework request object. */
export const PULSE_REQUEST_SPAN = Symbol.for('pulse.requestSpan');

export interface RequestSpanCarrier {
  [PULSE_REQUEST_SPAN]?: TraceSpanDelegate;
  raw?: { [PULSE_REQUEST_SPAN]?: TraceSpanDelegate };
}

export function requestSpanOf(request: unknown): TraceSpanDelegate | undefined {
  const carrier = request as RequestSpanCarrier | undefined;
  return carrier?.[PULSE_REQUEST_SPAN] ?? carrier?.raw?.[PULSE_REQUEST_SPAN];
}

/**
 * Opens one server span per HTTP request before guards, pipes and handlers run, and closes it when the
 * response finishes. Unlike the interceptor, it also sees requests rejected by guards (401/403), pipes (400)
 * and unmatched routes (404), and records the final status code the exception filters wrote.
 */
@Injectable()
export class PulseRequestMiddleware implements NestMiddleware {
  constructor(
    private readonly tracer: TracerService,
    private readonly contextStore: TraceContextStore,
    private readonly telemetryStore: TelemetryStore,
    @Inject(PULSE_OPTIONS) private readonly options: PulseOptions,
  ) {}

  use(request: MiddlewareRequest, response: MiddlewareResponse, next: () => void): void {
    const url = request.originalUrl ?? request.url ?? '/';
    const path = url.split('?')[0] ?? '/';
    if (this.options.enabled === false || isDashboardPath(path, this.options) || isIgnoredPath(path, this.options.ignoredRoutes)) {
      return next();
    }

    const method = (request.method ?? 'GET').toUpperCase();
    const parent = parseTraceParent(header(request.headers, 'traceparent'));
    const span = new TraceSpanDelegate(`HTTP ${method} ${path}`, 'server', parent?.traceId ?? crypto.randomUUID(), parent?.spanId, {
      ...this.options.defaultAttributes,
      ...requestAttributes(request, method, url, path, this.options),
    });
    (request as RequestSpanCarrier)[PULSE_REQUEST_SPAN] = span;
    this.telemetryStore.requestStarted();

    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      response.removeListener?.('finish', finish);
      response.removeListener?.('close', finish);
      const statusCode = Number(response.statusCode ?? 0);
      const route = span.getTag('http.route') ?? request.route?.path ?? request.routeOptions?.url ?? request.routerPath;
      const routeLabel = typeof route === 'string' && route ? route : path;
      span.setTag('http.route', routeLabel);
      span.rename(`HTTP ${method} ${routeLabel}`);
      span.setTag('http.status_code', statusCode);
      const bytesOut = Number(response.getHeader?.('content-length') ?? 0) || 0;
      span.setTag('http.response.content_length', bytesOut);
      span.setAttributes(responseAttributes(response));
      if (this.options.captureBody) {
        const body = jsonAttribute(request.body, this.options.captureBodyMaxBytes ?? DEFAULT_BODY_BYTES);
        if (body !== undefined) span.setTag('http.request.body', body);
      }
      if (!response.writableFinished && response.writableEnded === false) span.setTag('http.aborted', true);
      if (statusCode >= 500 && !span.hasError()) span.setError(`HTTP ${statusCode} on ${method} ${routeLabel}`, 'HttpServerError');
      this.telemetryStore.requestFinished(statusCode, Number(span.getTag('http.request.content_length') ?? 0) || 0, bytesOut);
      if (!span.ignored) this.tracer.recordSpan(span);
    };
    response.on?.('finish', finish);
    response.on?.('close', finish);

    return this.contextStore.run({ traceId: span.traceId, spanId: span.spanId }, () => next());
  }
}

export function isDashboardPath(path: string, options: PulseOptions): boolean {
  const configured = options.dashboard?.path ?? '/pulse';
  const dashboard = configured.startsWith('/') ? configured : `/${configured}`;
  return path === dashboard || path.startsWith(`${dashboard}/`);
}

export function isIgnoredPath(path: string, ignoredRoutes: PulseOptions['ignoredRoutes'] = []): boolean {
  return ignoredRoutes.some((ignored) => {
    if (typeof ignored === 'string') return path === ignored || path.startsWith(`${ignored}/`);
    return ignored.test(path);
  });
}

function requestAttributes(request: MiddlewareRequest, method: string, url: string, path: string, options: PulseOptions): Attributes {
  const headers = request.headers ?? {};
  const forwarded = header(headers, 'x-forwarded-for');
  const attributes: Attributes = {
    'http.method': method,
    'http.url': url,
    'http.target': path,
    'http.host': header(headers, 'host'),
    'http.scheme': request.protocol ?? (request.socket?.encrypted ? 'https' : 'http'),
    'http.flavor': request.httpVersion,
    'http.client_ip': forwarded ? forwarded.split(',')[0]?.trim() : request.socket?.remoteAddress ?? request.ip,
    'net.peer.port': request.socket?.remotePort,
    'http.user_agent': header(headers, 'user-agent'),
    'http.request.content_length': Number(header(headers, 'content-length') ?? 0) || 0,
    'http.request_id': header(headers, 'x-request-id'),
    'http.query': queryAttribute(url),
    'enduser.id': enduserId(header(headers, 'authorization')),
  };
  for (const key of Object.keys(attributes)) if (attributes[key] === undefined) delete attributes[key];
  Object.assign(attributes, capturedHeaders(headers, options.captureHeaders));
  return attributes;
}

const DEFAULT_BODY_BYTES = 8_192;
const MAX_HEADER_VALUE = 512;
const MAX_JSON_VALUE = 2_048;

/**
 * Request headers as `http.request.header.<name>`. By default every header is recorded; credentials are
 * replaced by "[redacted]" and long values are cut at 512 characters. `false` records none, a
 * list records only those names. Shared with the interceptor, which sees the framework request.
 */
export function capturedHeaders(headers: Record<string, string | string[] | undefined> | undefined, capture: PulseOptions['captureHeaders']): Attributes {
  if (!headers || capture === false) return {};
  const names = Array.isArray(capture) ? capture.map((name) => name.toLowerCase()) : Object.keys(headers);
  return names.reduce<Attributes>((memo, name) => {
    const value = headers[name];
    if (value !== undefined) memo[`http.request.header.${name}`] = redactHeader(name, Array.isArray(value) ? value.join(', ') : String(value));
    return memo;
  }, {});
}

function responseAttributes(response: MiddlewareResponse): Attributes {
  const attributes: Attributes = {};
  const headers = response.getHeaders?.() ?? {};
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined || value === null) continue;
    attributes[`http.response.header.${name.toLowerCase()}`] = redactHeader(name.toLowerCase(), Array.isArray(value) ? value.join(', ') : String(value));
  }
  const contentType = headers['content-type'];
  if (contentType !== undefined && contentType !== null) attributes['http.response.content_type'] = truncate(String(contentType), MAX_HEADER_VALUE);
  return attributes;
}

export function redactHeader(name: string, value: string): string {
  return isSensitiveHeader(name) ? REDACTED : truncate(value, MAX_HEADER_VALUE);
}

/** Serializes a structured value (query, params, body) as a redacted JSON string capped at maxBytes. */
export function jsonAttribute(value: unknown, maxBytes: number): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'object' && !Buffer.isBuffer(value) && !Array.isArray(value) && Object.keys(value as object).length === 0) return undefined;
  let text: string | undefined;
  try {
    // Strict: user-supplied data may carry numeric CVV, OTP or card numbers under secret keys.
    text = typeof value === 'string' ? value : JSON.stringify(redactValue(value, 0, { strict: true }));
  } catch {
    text = String(value);
  }
  if (text === undefined || text === '') return undefined;
  if (Buffer.byteLength(text) <= maxBytes) return text;
  return `${Buffer.from(text).subarray(0, maxBytes).toString()}… [truncated, ${Buffer.byteLength(text)} bytes]`;
}

function queryAttribute(url: string): string | undefined {
  const index = url.indexOf('?');
  if (index < 0 || index === url.length - 1) return undefined;
  const query: Record<string, string | string[]> = {};
  for (const [key, value] of new URLSearchParams(url.slice(index + 1))) {
    const existing = query[key];
    query[key] = existing === undefined ? value : Array.isArray(existing) ? [...existing, value] : [existing, value];
  }
  return jsonAttribute(query, MAX_JSON_VALUE);
}

/**
 * `sub` claim of a bearer JWT, decoded WITHOUT verification and only to label the request in the dashboard.
 * The token itself is never stored (the Authorization header is redacted).
 */
export function enduserId(authorization: string | undefined): string | undefined {
  if (!authorization || !/^Bearer /i.test(authorization)) return undefined;
  const payload = authorization.slice(7).trim().split('.')[1];
  if (!payload) return undefined;
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { sub?: unknown };
    return typeof claims.sub === 'string' || typeof claims.sub === 'number' ? truncate(String(claims.sub), 128) : undefined;
  } catch {
    return undefined;
  }
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

/** W3C trace context (`traceparent: 00-<trace-id>-<parent-id>-<flags>`) so upstream traces stay connected. */
export function parseTraceParent(value: string | undefined): { traceId: string; spanId: string } | undefined {
  const match = value ? /^[0-9a-f]{2}-([0-9a-f]{32})-([0-9a-f]{16})-[0-9a-f]{2}$/i.exec(value.trim()) : null;
  if (!match || /^0+$/.test(match[1]!) || /^0+$/.test(match[2]!)) return undefined;
  return { traceId: match[1]!, spanId: match[2]! };
}

function header(headers: Record<string, string | string[] | undefined> | undefined, name: string): string | undefined {
  const value = headers?.[name];
  return Array.isArray(value) ? value[0] : value;
}

export interface MiddlewareRequest {
  method?: string;
  url?: string;
  originalUrl?: string;
  protocol?: string;
  ip?: string;
  headers?: Record<string, string | string[] | undefined>;
  httpVersion?: string;
  body?: unknown;
  socket?: { remoteAddress?: string; remotePort?: number; encrypted?: boolean };
  route?: { path?: string };
  routeOptions?: { url?: string };
  routerPath?: string;
}

export interface MiddlewareResponse {
  statusCode?: number;
  writableFinished?: boolean;
  writableEnded?: boolean;
  getHeader?(name: string): unknown;
  getHeaders?(): Record<string, unknown>;
  on?(event: string, listener: () => void): unknown;
  removeListener?(event: string, listener: () => void): unknown;
}
