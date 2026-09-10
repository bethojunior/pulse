import { CallHandler, ExecutionContext, Inject, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, catchError, finalize, tap, throwError } from 'rxjs';
import type { Attributes, PulseOptions } from './types.js';
import { TraceContextStore } from './context.js';
import { capturedHeaders, isDashboardPath, isIgnoredPath, jsonAttribute, requestSpanOf } from './request.middleware.js';
import { TraceSpanDelegate, httpStatusOf } from './span.js';
import { TracerService } from './tracer.service.js';
import { PULSE_OPTIONS } from './tokens.js';

@Injectable()
export class PulseRequestInterceptor implements NestInterceptor {
  constructor(
    private readonly tracer: TracerService,
    private readonly contextStore: TraceContextStore,
    @Inject(PULSE_OPTIONS) private readonly options: PulseOptions,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const attributes = getContextAttributes(context, this.options);
    const root = attributes.request ? requestSpanOf(attributes.request) : undefined;

    if (
      this.options.enabled === false ||
      isIgnoredPath(attributes.route, this.options.ignoredRoutes) ||
      (attributes.url !== undefined && isDashboardPath(attributes.url.split('?')[0] ?? '', this.options))
    ) {
      if (root) root.ignored = true;
      return next.handle();
    }

    if (root) {
      return this.handlerSpan(root, attributes, next);
    }

    const parent = this.contextStore.get();
    const span = new TraceSpanDelegate(
      attributes.name,
      attributes.kind,
      parent?.traceId ?? crypto.randomUUID(),
      parent?.spanId,
      {
        ...this.options.defaultAttributes,
        ...attributes.values,
      },
    );

    return this.contextStore.run({ traceId: span.traceId, spanId: span.spanId }, () =>
      next.handle().pipe(
        tap(() => {
          if (attributes.responseStatus) {
            span.setTag('http.status_code', attributes.responseStatus());
          }
        }),
        catchError((error: unknown) => {
          span.recordException(error);
          span.setTag('http.status_code', httpStatusOf(error) ?? 500);
          return throwError(() => error);
        }),
        finalize(() => {
          this.tracer.recordSpan(span);
        }),
      ),
    );
  }

  /** The middleware already opened the request span; this adds the controller handler as a child span. */
  private handlerSpan(root: TraceSpanDelegate, attributes: ContextAttributes, next: CallHandler): Observable<unknown> {
    root.setTag('http.route', attributes.route);
    root.rename(`HTTP ${String(attributes.values['http.method'] ?? 'GET')} ${attributes.route}`);
    root.setAttributes(attributes.headers);
    if (attributes.params !== undefined) root.setTag('http.params', attributes.params);
    const span = new TraceSpanDelegate(attributes.handler, 'handler', root.traceId, root.spanId, {
      ...this.options.defaultAttributes,
      'nest.class': attributes.className,
      'nest.handler': attributes.handlerName,
      'http.method': attributes.values['http.method'],
      'http.route': attributes.route,
    });

    return this.contextStore.run({ traceId: root.traceId, spanId: span.spanId }, () =>
      next.handle().pipe(
        catchError((error: unknown) => {
          span.recordException(error);
          root.recordException(error);
          return throwError(() => error);
        }),
        finalize(() => {
          this.tracer.recordSpan(span);
        }),
      ),
    );
  }
}

interface ContextAttributes {
  name: string;
  kind: string;
  route: string;
  url: string | undefined;
  request: unknown;
  handler: string;
  className: string;
  handlerName: string;
  responseStatus?: () => number | undefined;
  values: Attributes;
  headers: Attributes;
  /** Route parameters as a redacted JSON string, when the request has any. */
  params?: string;
}

function getContextAttributes(context: ExecutionContext, options: PulseOptions): ContextAttributes {
  const type = context.getType<string>();
  const className = context.getClass().name;
  const handlerName = context.getHandler().name || 'anonymous';
  const handler = `${className}.${handlerName}`;

  if (type === 'http') {
    const http = context.switchToHttp();
    const request = http.getRequest<RequestLike>();
    const response = http.getResponse<ResponseLike>();
    const method = (request.method ?? 'GET').toUpperCase();
    const route = request.route?.path ?? request.routeOptions?.url ?? request.routerPath ?? request.url?.split('?')[0] ?? 'unknown';
    const headers = capturedHeaders(request.headers, options.captureHeaders);
    const params = jsonAttribute(request.params, 2_048);

    return {
      name: `HTTP ${method} ${route}`,
      kind: 'server',
      route,
      url: request.originalUrl ?? request.url,
      request,
      handler,
      className,
      handlerName,
      responseStatus: () => response.statusCode,
      values: {
        'http.method': method,
        'http.route': route,
        'http.url': request.originalUrl ?? request.url,
        'nest.class': className,
        'nest.handler': handlerName,
        ...(params !== undefined ? { 'http.params': params } : {}),
        ...headers,
      },
      headers,
      ...(params !== undefined ? { params } : {}),
    };
  }

  return {
    name: `${type.toUpperCase()} ${handler}`,
    kind: type,
    route: handler,
    url: undefined,
    request: undefined,
    handler,
    className,
    handlerName,
    values: {
      'nest.context_type': type,
      'nest.class': className,
      'nest.handler': handlerName,
    },
    headers: {},
  };
}

interface RequestLike {
  method?: string;
  url?: string;
  originalUrl?: string;
  route?: { path?: string };
  routeOptions?: { url?: string };
  routerPath?: string;
  params?: Record<string, unknown>;
  headers?: Record<string, string | string[] | undefined>;
}

interface ResponseLike {
  statusCode?: number;
}
