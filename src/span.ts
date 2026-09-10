import { nanoid } from 'nanoid';
import { REDACTED, isRedactable, isSensitiveKey, redactValue, scrubHeaderBlock } from './redaction.js';
import type { Attributes, SerializedError, SpanRecord, SpanStatus, StackFrame } from './types.js';

export class TraceSpanDelegate {
  readonly traceId: string;
  readonly spanId = nanoid(16);
  readonly parentSpanId: string | undefined;
  readonly startedAt = Date.now();
  readonly startedAtIso = new Date().toISOString();
  private status: SpanStatus = 'ok';
  private error?: SerializedError;
  private ended = false;

  /** Set by the interceptor when the route is excluded through ignoredRoutes; the middleware then drops the span. */
  ignored = false;

  constructor(
    public name: string,
    readonly kind: string,
    traceId: string,
    parentSpanId: string | undefined,
    private readonly attributes: Attributes = {},
  ) {
    this.traceId = traceId;
    this.parentSpanId = parentSpanId;
  }

  setTag(key: string, value: Attributes[string]): this {
    this.attributes[key] = value;
    return this;
  }

  getTag(key: string): Attributes[string] {
    return this.attributes[key];
  }

  /** Server spans start with the raw path and are renamed once the matched route pattern is known. */
  rename(name: string): this {
    this.name = name;
    return this;
  }

  setAttributes(attributes: Attributes): this {
    Object.assign(this.attributes, attributes);
    return this;
  }

  recordException(error: unknown): this {
    this.status = 'error';
    this.error = serializeError(error);
    return this;
  }

  /** Marks the span as failed without an exception object (for example an HTTP 5xx response). */
  setError(message: string, name = 'Error'): this {
    this.status = 'error';
    this.error ??= { name, message };
    return this;
  }

  hasError(): boolean {
    return this.status === 'error';
  }

  isEnded(): boolean {
    return this.ended;
  }

  finish(): SpanRecord {
    if (this.ended) {
      throw new Error(`Span "${this.name}" has already ended`);
    }

    this.ended = true;
    const endedAt = Date.now();

    const record: SpanRecord = {
      traceId: this.traceId,
      spanId: this.spanId,
      name: this.name,
      kind: this.kind,
      status: this.status,
      startedAt: this.startedAtIso,
      endedAt: new Date(endedAt).toISOString(),
      durationMs: endedAt - this.startedAt,
      attributes: { ...this.attributes },
    };

    if (this.parentSpanId) {
      record.parentSpanId = this.parentSpanId;
    }

    if (this.error) {
      record.error = this.error;
    }

    return record;
  }
}

const MAX_CAUSE_DEPTH = 4;
const MAX_DETAIL_KEYS = 24;
const MAX_DETAIL_DEPTH = 3;
const MAX_STRING_LENGTH = 2_000;
const STANDARD_KEYS = new Set(['name', 'message', 'stack', 'cause', 'code', 'status', 'statusCode']);

export function serializeError(error: unknown, depth = 0): SerializedError {
  if (error instanceof Error || isErrorLike(error)) {
    const source = error as Error & Record<string, unknown>;
    const serialized: SerializedError = {
      name: typeof source.name === 'string' && source.name ? source.name : 'Error',
      message: typeof source.message === 'string' ? source.message : String(source.message ?? ''),
    };

    if (typeof source.stack === 'string' && source.stack) {
      serialized.stack = source.stack;
      const frames = parseStackFrames(source.stack);
      if (frames.length) serialized.frames = frames;
    }

    const code = source.code;
    if (typeof code === 'string' || typeof code === 'number') serialized.code = code;

    const status = httpStatusOf(source);
    if (status !== undefined) serialized.status = status;

    if (source.cause !== undefined && depth < MAX_CAUSE_DEPTH) {
      serialized.cause = serializeError(source.cause, depth + 1);
    }

    const details = extraProperties(source);
    if (details) serialized.details = details;

    return serialized;
  }

  return {
    name: 'Error',
    message: typeof error === 'string' ? error : safeStringify(error),
  };
}

/** Status of Nest HttpException instances (getStatus) or of errors exposing status/statusCode (http-errors, axios). */
export function httpStatusOf(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const candidate = error as { getStatus?: () => unknown; status?: unknown; statusCode?: unknown };
  const values = [typeof candidate.getStatus === 'function' ? candidate.getStatus.call(candidate) : undefined, candidate.status, candidate.statusCode];
  for (const value of values) {
    if (typeof value === 'number' && Number.isInteger(value) && value >= 100 && value <= 599) return value;
  }
  return undefined;
}

const FRAME_PATTERN = /^\s*at\s+(?:(async\s+)?(.*?)\s+\()?(?:(.+?):(\d+):(\d+)|([^()]+?))\)?\s*$/;

export function parseStackFrames(stack: string): StackFrame[] {
  const frames: StackFrame[] = [];
  for (const line of stack.split('\n')) {
    const match = FRAME_PATTERN.exec(line);
    if (!match) continue;
    const [, asyncPrefix, fn, fileWithPosition, lineNumber, columnNumber, bareLocation] = match;
    const file = fileWithPosition ?? bareLocation ?? '';
    const cleanFile = file.replace(/^file:\/\//, '');
    frames.push({
      function: `${asyncPrefix ? 'async ' : ''}${fn ?? ''}`.trim(),
      file: cleanFile,
      line: lineNumber ? Number(lineNumber) : null,
      column: columnNumber ? Number(columnNumber) : null,
      // Frames without a position ("<anonymous>", "native", "index 0" from Promise.all) never point at application code.
      inApp: lineNumber !== undefined && isApplicationFrame(cleanFile),
      raw: line.trim(),
    });
  }
  return frames;
}

function isApplicationFrame(file: string): boolean {
  if (!file) return false;
  if (file.startsWith('node:') || file.startsWith('internal/') || file === '<anonymous>' || file === 'native') return false;
  return !/[\\/]node_modules[\\/]/.test(file);
}

function isErrorLike(value: unknown): value is Error {
  return !!value && typeof value === 'object' && 'message' in value && ('stack' in value || 'name' in value);
}

function extraProperties(error: Record<string, unknown>): Record<string, unknown> | undefined {
  const details: Record<string, unknown> = {};
  let count = 0;
  for (const key of Object.keys(error)) {
    if (STANDARD_KEYS.has(key)) continue;
    if (count >= MAX_DETAIL_KEYS) break;
    // Error properties are recorded for debugging (AxiosError config/response, Prisma meta...) with credentials redacted.
    const value = sanitize(error[key], 0);
    if (value === undefined) continue;
    details[key] = isSensitiveKey(key) && isRedactable(value) ? REDACTED : value;
    count += 1;
  }
  return count ? details : undefined;
}

function sanitize(value: unknown, depth: number): unknown {
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'string') {
    const text = scrubHeaderBlock(value);
    return text.length > MAX_STRING_LENGTH ? `${text.slice(0, MAX_STRING_LENGTH)}…` : text;
  }
  if (typeof value === 'function' || typeof value === 'symbol' || value === undefined) return undefined;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) return depth < MAX_DETAIL_DEPTH ? serializeError(value, MAX_CAUSE_DEPTH) : `${value.name}: ${value.message}`;
  if (Buffer.isBuffer(value)) return `<Buffer ${value.length} bytes>`;
  if (depth >= MAX_DETAIL_DEPTH) return scrubHeaderBlock(safeStringify(redactValue(value))).slice(0, MAX_STRING_LENGTH);
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => sanitize(item, depth + 1) ?? null);
  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};
    let count = 0;
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (count >= MAX_DETAIL_KEYS) break;
      const sanitized = sanitize(item, depth + 1);
      if (sanitized === undefined) continue;
      result[key] = isSensitiveKey(key) && isRedactable(sanitized) ? REDACTED : sanitized;
      count += 1;
    }
    return result;
  }
  return String(value);
}

function safeStringify(value: unknown): string {
  try {
    const json = JSON.stringify(value);
    return json === undefined ? String(value) : json;
  } catch {
    return String(value);
  }
}
