import type { PulseExporterOptions, TelemetryExporter, TelemetryPayload } from './types.js';

export class NoopTelemetryExporter implements TelemetryExporter {
  export(): void {}
}

export class ConsoleTelemetryExporter implements TelemetryExporter {
  export(payload: TelemetryPayload): void {
    console.info(JSON.stringify(payload));
  }
}

export class HttpTelemetryExporter implements TelemetryExporter {
  constructor(
    private readonly endpoint: string,
    private readonly headers: Record<string, string> = {},
  ) {}

  async export(payload: TelemetryPayload): Promise<void> {
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...this.headers,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`Pulse exporter failed with HTTP ${response.status}`);
    }
  }
}

export function createTelemetryExporter(options?: PulseExporterOptions | TelemetryExporter): TelemetryExporter {
  if (!options) {
    return new NoopTelemetryExporter();
  }

  if (isTelemetryExporter(options)) {
    return options;
  }

  if (options.endpoint) {
    return new HttpTelemetryExporter(options.endpoint, options.headers);
  }

  if (options.console) {
    return new ConsoleTelemetryExporter();
  }

  return new NoopTelemetryExporter();
}

function isTelemetryExporter(value: PulseExporterOptions | TelemetryExporter): value is TelemetryExporter {
  return 'export' in value && typeof value.export === 'function';
}
