import { DynamicModule, Global, MiddlewareConsumer, Module, NestModule, Provider } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { createTelemetryExporter } from './exporters.js';
import { TraceContextStore } from './context.js';
import { MetricCollector } from './metrics.js';
import { PulseDashboardController } from './pulse-dashboard.controller.js';
import { PulseRequestInterceptor } from './request.interceptor.js';
import { PulseRequestMiddleware } from './request.middleware.js';
import { TelemetryStore } from './telemetry.store.js';
import { RedisMonitor } from './redis-monitor.js';
import { DatabaseMonitor } from './database-monitor.js';
import { QueueMonitor } from './queue-monitor.js';
import { RabbitMqMonitor } from './rabbitmq-monitor.js';
import { PulseConnections } from './pulse-connections.js';
import { TracerService } from './tracer.service.js';
import { PULSE_EXPORTER, PULSE_METRICS, PULSE_OPTIONS } from './tokens.js';
import type { CreatedObserveModule, PulseModuleAsyncOptions, PulseOptions, PulseOptionsFactory } from './types.js';

@Global()
@Module({})
export class ObserveModule implements NestModule {
  static forRoot(options: PulseOptions): DynamicModule {
    return {
      module: ObserveModule,
      controllers: [PulseDashboardController],
      providers: [...coreProviders(), { provide: PULSE_OPTIONS, useValue: options }, exporterProvider()],
      exports: [TracerService, PulseConnections, PULSE_OPTIONS, PULSE_EXPORTER, PULSE_METRICS],
    };
  }

  static forRootAsync(options: PulseModuleAsyncOptions): DynamicModule {
    const moduleDefinition: DynamicModule = {
      module: ObserveModule,
      controllers: [PulseDashboardController],
      providers: [
        ...coreProviders(),
        ...createAsyncOptionsProviders(options),
        exporterProvider(),
        ...(options.extraProviders ?? []),
      ],
      exports: [TracerService, PulseConnections, PULSE_OPTIONS, PULSE_EXPORTER, PULSE_METRICS],
    };

    if (options.imports) {
      moduleDefinition.imports = options.imports;
    }

    return moduleDefinition;
  }

  // The request middleware runs before guards and pipes, so requests they reject are still measured.
  // "*" is the wildcard Nest accepts on both Express 4 (Nest 10) and Express 5 / path-to-regexp v8 (Nest 11).
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(PulseRequestMiddleware).forRoutes('*');
  }
}

export function createObserveModule(): CreatedObserveModule {
  return {
    ObserveModule,
    ObserveInstrument: {
      module: ObserveModule,
    },
  };
}

function coreProviders(): Provider[] {
  return [
    TraceContextStore,
    TelemetryStore,
    RedisMonitor,
    DatabaseMonitor,
    QueueMonitor,
    RabbitMqMonitor,
    PulseConnections,
    TracerService,
    PulseRequestMiddleware,
    { provide: PULSE_METRICS, useClass: MetricCollector },
    { provide: APP_INTERCEPTOR, useClass: PulseRequestInterceptor },
  ];
}

function exporterProvider(): Provider {
  return {
    provide: PULSE_EXPORTER,
    inject: [PULSE_OPTIONS],
    useFactory: (options: PulseOptions) => createTelemetryExporter(options.exporter),
  };
}

function createAsyncOptionsProviders(options: PulseModuleAsyncOptions): Provider[] {
  if (options.useFactory) {
    return [
      {
        provide: PULSE_OPTIONS,
        inject: options.inject ?? [],
        useFactory: options.useFactory,
      },
    ];
  }

  const optionsProvider = options.useExisting ?? options.useClass;
  if (!optionsProvider) {
    throw new Error('PulseModuleAsyncOptions requires useFactory, useClass, or useExisting');
  }

  const inject = [optionsProvider];
  const providers: Provider[] = [
    {
      provide: PULSE_OPTIONS,
      inject,
      useFactory: (factory: PulseOptionsFactory) => factory.createPulseOptions(),
    },
  ];

  if (options.useClass) {
    providers.push({
      provide: options.useClass,
      useClass: options.useClass,
    });
  }

  return providers;
}
