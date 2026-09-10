import type { DynamicModule, ModuleMetadata, Provider, Type } from '@nestjs/common';

export type AttributeValue = string | number | boolean | null | undefined;
export type Attributes = Record<string, AttributeValue>;

export type SpanStatus = 'ok' | 'error';

export interface SpanRecord {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: string;
  status: SpanStatus;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  attributes: Attributes;
  error?: SerializedError;
}

export interface StackFrame {
  /** Function name as printed by V8, or an empty string for anonymous frames. */
  function: string;
  file: string;
  line: number | null;
  column: number | null;
  /** True when the frame belongs to the application (not node_modules or Node internals). */
  inApp: boolean;
  raw: string;
}

export interface SerializedError {
  name: string;
  message: string;
  stack?: string;
  /** Parsed stack frames, outermost call last, exactly like the raw stack order. */
  frames?: StackFrame[];
  /** `error.code` when the thrown value carries one (Node system errors, Prisma, pg, ioredis...). */
  code?: string | number;
  /** HTTP status when the exception is a Nest HttpException or exposes `status`/`statusCode`. */
  status?: number;
  /** `error.cause`, serialized recursively (bounded depth). */
  cause?: SerializedError;
  /** Other own enumerable properties of the error (HttpException response body, Prisma meta...). */
  details?: Record<string, unknown>;
}

export interface MetricRecord {
  name: string;
  type: 'counter' | 'gauge' | 'histogram';
  value: number;
  attributes: Attributes;
  recordedAt: string;
}

export interface TelemetryPayload {
  serviceId: string;
  serviceVersion?: string;
  environment?: string;
  spans: SpanRecord[];
  metrics: MetricRecord[];
}

export interface TelemetryExporter {
  export(payload: TelemetryPayload): Promise<void> | void;
  shutdown?(): Promise<void> | void;
}

export interface PulseExporterOptions {
  endpoint?: string;
  headers?: Record<string, string>;
  console?: boolean;
}

export interface PulseOptions {
  redis?: { enabled?: boolean; url: string };
  database?: { enabled?: boolean; driver: 'postgres'; url: string };
  queues?: { enabled?: boolean; driver: 'bullmq'; url: string; prefix?: string; names: string[] };
  rabbitmq?: { enabled?: boolean; url: string; managementUrl?: string; queues?: string[] };
  serviceId: string;
  serviceVersion?: string;
  environment?: string;
  enabled?: boolean;
  dashboard?: PulseDashboardOptions;
  /**
   * Request headers recorded on the request span as `http.request.header.<name>`.
   * Default `true`: every header, with credentials redacted (authorization, cookie, api keys...).
   * `false` records none; a list records only those names.
   */
  captureHeaders?: boolean | string[];
  /** Record the parsed request body as `http.request.body` (JSON, secret-looking keys redacted). Default `false`. */
  captureBody?: boolean;
  /** Maximum size of the recorded body, in bytes; longer bodies are truncated. Default 8192. */
  captureBodyMaxBytes?: number;
  ignoredRoutes?: Array<string | RegExp>;
  flushIntervalMs?: number;
  retentionLimit?: number;
  exporter?: TelemetryExporter | PulseExporterOptions;
  defaultAttributes?: Attributes;
}

export interface PulseDashboardUser {
  username: string;
  password: string;
  name?: string;
  role?: string;
}

export interface PulseDashboardOptions {
  enabled?: boolean;
  path?: string;
  users?: PulseDashboardUser[];
}

export interface PulseOptionsFactory {
  createPulseOptions(): Promise<PulseOptions> | PulseOptions;
}

export interface PulseModuleAsyncOptions extends Pick<ModuleMetadata, 'imports'> {
  inject?: any[];
  useFactory?: (...args: any[]) => Promise<PulseOptions> | PulseOptions;
  useClass?: Type<PulseOptionsFactory>;
  useExisting?: Type<PulseOptionsFactory>;
  extraProviders?: Provider[];
}

export interface CreatedObserveModule {
  ObserveModule: {
    forRoot(options: PulseOptions): DynamicModule;
    forRootAsync(options: PulseModuleAsyncOptions): DynamicModule;
  };
  ObserveInstrument: unknown;
}
