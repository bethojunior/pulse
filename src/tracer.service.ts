import { Inject, Injectable, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import type { Attributes, PulseOptions, TelemetryExporter } from './types.js';
import { TraceContextStore } from './context.js';
import { MetricCollector } from './metrics.js';
import { TraceSpanDelegate } from './span.js';
import { TelemetryStore } from './telemetry.store.js';
import { PULSE_EXPORTER, PULSE_METRICS, PULSE_OPTIONS } from './tokens.js';

@Injectable()
export class TracerService implements OnModuleInit, OnApplicationShutdown {
  private readonly spans: ReturnType<TraceSpanDelegate['finish']>[] = [];
  private flushTimer?: NodeJS.Timeout;
  private processListeners = false;

  constructor(
    private readonly contextStore: TraceContextStore,
    @Inject(PULSE_METRICS) private readonly metrics: MetricCollector,
    @Inject(PULSE_EXPORTER) private readonly exporter: TelemetryExporter,
    @Inject(PULSE_OPTIONS) private readonly options: PulseOptions,
    private readonly telemetryStore: TelemetryStore,
  ) {}

  onModuleInit(): void {
    if (this.options.enabled === false) {
      return;
    }

    const interval = this.options.flushIntervalMs ?? 10_000;
    if (interval > 0) {
      this.flushTimer = setInterval(() => {
        void this.flush().catch(() => undefined);
      }, interval);
      this.flushTimer.unref?.();
    }

    // `uncaughtExceptionMonitor` observes crashes (and unhandled rejections escalated by Node) without changing
    // the default behaviour of the process; `warning` covers deprecations, MaxListenersExceeded and similar.
    if (!this.processListeners) {
      process.on('uncaughtExceptionMonitor', this.onUncaughtException);
      process.on('warning', this.onWarning);
      this.processListeners = true;
    }
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
    }

    if (this.processListeners) {
      process.off('uncaughtExceptionMonitor', this.onUncaughtException);
      process.off('warning', this.onWarning);
      this.processListeners = false;
    }

    await this.flush();
    await this.exporter.shutdown?.();
  }

  createSpan<T>(name: string, callback: (span: TraceSpanDelegate) => T, attributes: Attributes = {}): T {
    if (this.options.enabled === false) {
      return callback(new TraceSpanDelegate(name, 'internal', 'disabled', undefined, attributes));
    }

    const parent = this.contextStore.get();
    const span = new TraceSpanDelegate(
      name,
      'internal',
      parent?.traceId ?? crypto.randomUUID(),
      parent?.spanId,
      {
        ...this.options.defaultAttributes,
        ...parent?.attributes,
        ...attributes,
      },
    );

    return this.contextStore.run({ traceId: span.traceId, spanId: span.spanId }, () => {
      try {
        const result = callback(span);

        if (isPromiseLike(result)) {
          return Promise.resolve(result)
            .catch((error: unknown) => {
              span.recordException(error);
              throw error;
            })
            .finally(() => this.recordSpan(span)) as T;
        }

        this.recordSpan(span);
        return result;
      } catch (error) {
        span.recordException(error);
        this.recordSpan(span);
        throw error;
      }
    });
  }

  startSpan(name: string, kind = 'internal', attributes: Attributes = {}): TraceSpanDelegate {
    const parent = this.contextStore.get();
    return new TraceSpanDelegate(name, kind, parent?.traceId ?? crypto.randomUUID(), parent?.spanId, {
      ...this.options.defaultAttributes,
      ...parent?.attributes,
      ...attributes,
    });
  }

  recordSpan(span: TraceSpanDelegate): void {
    if (this.options.enabled === false || span.isEnded()) {
      return;
    }

    this.spans.push(span.finish());
  }

  /** Records a process-level event (uncaught exception, unhandled rejection, warning) as an error span. */
  recordProcessEvent(kind: 'uncaughtException' | 'unhandledRejection' | 'warning', error: unknown): void {
    if (this.options.enabled === false) {
      return;
    }

    const span = new TraceSpanDelegate(kind, 'process', crypto.randomUUID(), undefined, {
      ...this.options.defaultAttributes,
      'event.kind': kind,
      pid: process.pid,
    });
    span.recordException(error);
    this.spans.push(span.finish());
    // The process may be about to exit: make the event visible in the dashboard without waiting for the next flush.
    void this.flush().catch(() => undefined);
  }

  setAttribute(key: string, value: Attributes[string]): void {
    this.contextStore.setAttribute(key, value);
  }

  counter(name: string, attributes?: Attributes) {
    return this.metrics.counter(name, attributes);
  }

  gauge(name: string, attributes?: Attributes) {
    return this.metrics.gauge(name, attributes);
  }

  histogram(name: string, attributes?: Attributes) {
    return this.metrics.histogram(name, attributes);
  }

  async flush(): Promise<void> {
    if (this.options.enabled === false) {
      return;
    }

    const spans = this.spans.splice(0, this.spans.length);
    const metrics = this.metrics.drain();
    this.telemetryStore.append(spans, metrics, this.options.retentionLimit);

    if (!spans.length && !metrics.length) {
      return;
    }

    const payload = {
      serviceId: this.options.serviceId,
      spans,
      metrics,
    };

    if (this.options.serviceVersion) {
      Object.assign(payload, { serviceVersion: this.options.serviceVersion });
    }

    if (this.options.environment) {
      Object.assign(payload, { environment: this.options.environment });
    }

    await this.exporter.export(payload);
  }

  private readonly onUncaughtException = (error: unknown, origin: string): void => {
    this.recordProcessEvent(origin === 'unhandledRejection' ? 'unhandledRejection' : 'uncaughtException', error);
  };

  private readonly onWarning = (warning: Error): void => {
    this.recordProcessEvent('warning', warning);
  };
}

function isPromiseLike<T>(value: T | PromiseLike<T>): value is PromiseLike<T> {
  return Boolean(value && typeof (value as PromiseLike<T>).then === 'function');
}
