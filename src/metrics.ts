import type { Attributes, MetricRecord } from './types.js';

export class MetricCollector {
  private readonly records: MetricRecord[] = [];

  counter(name: string, attributes: Attributes = {}) {
    return {
      increment: (value = 1, extraAttributes: Attributes = {}) => {
        this.record('counter', name, value, { ...attributes, ...extraAttributes });
      },
    };
  }

  gauge(name: string, attributes: Attributes = {}) {
    return {
      set: (value: number, extraAttributes: Attributes = {}) => {
        this.record('gauge', name, value, { ...attributes, ...extraAttributes });
      },
    };
  }

  histogram(name: string, attributes: Attributes = {}) {
    return {
      record: (value: number, extraAttributes: Attributes = {}) => {
        this.record('histogram', name, value, { ...attributes, ...extraAttributes });
      },
    };
  }

  drain(): MetricRecord[] {
    return this.records.splice(0, this.records.length);
  }

  private record(type: MetricRecord['type'], name: string, value: number, attributes: Attributes): void {
    this.records.push({
      name,
      type,
      value,
      attributes,
      recordedAt: new Date().toISOString(),
    });
  }
}
