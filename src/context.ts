import { AsyncLocalStorage } from 'node:async_hooks';
import { nanoid } from 'nanoid';
import type { Attributes } from './types.js';

export interface TraceContext {
  traceId: string;
  spanId?: string;
  attributes: Attributes;
}

export class TraceContextStore {
  private readonly storage = new AsyncLocalStorage<TraceContext>();

  run<T>(context: Partial<TraceContext>, callback: () => T): T {
    const parent = this.storage.getStore();
    const next: TraceContext = {
      traceId: context.traceId ?? parent?.traceId ?? nanoid(24),
      attributes: {
        ...parent?.attributes,
        ...context.attributes,
      },
    };

    const spanId = context.spanId ?? parent?.spanId;
    if (spanId) {
      next.spanId = spanId;
    }

    return this.storage.run(next, callback);
  }

  get(): TraceContext | undefined {
    return this.storage.getStore();
  }

  setAttribute(key: string, value: Attributes[string]): void {
    const context = this.storage.getStore();
    if (context) {
      context.attributes[key] = value;
    }
  }
}
