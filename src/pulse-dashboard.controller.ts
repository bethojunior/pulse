import { randomBytes } from 'node:crypto';
import { BadRequestException, Controller, Get, Inject, Param, Query, Req, Res, UnauthorizedException } from '@nestjs/common';
import { TelemetryStore } from './telemetry.store.js';
import { RedisMonitor } from './redis-monitor.js';
import { DatabaseMonitor } from './database-monitor.js';
import { QueueMonitor } from './queue-monitor.js';
import { RabbitMqMonitor } from './rabbitmq-monitor.js';
import { PulseConnections } from './pulse-connections.js';
import { PULSE_OPTIONS } from './tokens.js';
import type { PulseDashboardUser, PulseOptions } from './types.js';
import { renderPulseDashboard } from './pulse-dashboard.html.js';

@Controller()
export class PulseDashboardController {
  constructor(
    private readonly telemetryStore: TelemetryStore,
    @Inject(PULSE_OPTIONS) private readonly options: PulseOptions,
    private readonly redisMonitor: RedisMonitor,
    private readonly databaseMonitor: DatabaseMonitor,
    private readonly queueMonitor: QueueMonitor,
    private readonly connections: PulseConnections,
    private readonly rabbitMqMonitor: RabbitMqMonitor,
  ) {}

  @Get(['pulse/api/snapshot'])
  async snapshot(@Req() request: RequestLike, @Res({ passthrough: true }) response: ResponseLike) {
    if (!this.isDashboardRequest(request)) {
      response.status(404);
      return { error: 'Not found' };
    }

    this.authorize(request, response);
    const [redis, database, queues, rabbitmq] = await Promise.all([
      this.redisMonitor.snapshot(),
      this.databaseMonitor.snapshot(),
      this.queueMonitor.snapshot(),
      this.rabbitMqMonitor.snapshot(),
    ]);
    return { ...this.telemetryStore.snapshot(this.options), redis, database, queues, rabbitmq, activeJobs: this.connections.activeJobs() };
  }

  /** Every retained span of one trace, for the waterfall shown under an error or a request. */
  @Get(['pulse/api/traces/:traceId'])
  trace(@Param('traceId') traceId: string, @Req() request: RequestLike, @Res({ passthrough: true }) response: ResponseLike) {
    if (!this.isDashboardRequest(request)) {
      response.status(404);
      return { error: 'Not found' };
    }

    this.authorize(request, response);
    return { traceId, spans: this.telemetryStore.trace(traceId) };
  }

  /** One grouped error with its recent occurrences (full stack traces and request attributes). */
  @Get(['pulse/api/errors/:id'])
  error(@Param('id') id: string, @Req() request: RequestLike, @Res({ passthrough: true }) response: ResponseLike) {
    if (!this.isDashboardRequest(request)) {
      response.status(404);
      return { error: 'Not found' };
    }

    this.authorize(request, response);
    const group = this.telemetryStore.errorGroup(id);
    if (!group) {
      response.status(404);
      return { error: 'Unknown error group' };
    }
    return group;
  }

  /** Everything the RabbitMQ Management API reports for one queue, plus its bindings (dashboard drill-down). */
  @Get(['pulse/api/rabbitmq/queue'])
  async rabbitMqQueue(
    @Query('name') name: string | undefined,
    @Query('vhost') vhost: string | undefined,
    @Req() request: RequestLike,
    @Res({ passthrough: true }) response: ResponseLike,
  ) {
    if (!this.isDashboardRequest(request)) {
      response.status(404);
      return { error: 'Not found' };
    }

    this.authorize(request, response);
    if (typeof name !== 'string' || !name || name.length > 255) throw new BadRequestException('Query parameter "name" is required');
    if (vhost !== undefined && (typeof vhost !== 'string' || vhost.length > 255)) throw new BadRequestException('Invalid "vhost"');
    const detail = await this.rabbitMqMonitor.queue(name, vhost || undefined);
    if (detail.status === 'missing') response.status(404);
    return detail;
  }

  @Get(['pulse', 'pulse/*path'])
  dashboard(@Req() request: RequestLike, @Res({ passthrough: true }) response: ResponseLike): string {
    if (!this.isDashboardRequest(request)) {
      response.status(404);
      return 'Not found';
    }

    this.authorize(request, response);
    // Set only after authorization: a text/html content type on the 401 JSON body would make Nest log an ExpressAdapter warning.
    response.setHeader('content-type', 'text/html; charset=utf-8');
    // The dashboard is a self-contained page with one inline script. Host apps commonly run helmet, whose default
    // Content-Security-Policy (script-src 'self') would block that script, so the page ships its own policy with a nonce.
    const nonce = randomBytes(16).toString('base64');
    response.setHeader('content-security-policy', dashboardContentSecurityPolicy(nonce));
    return renderPulseDashboard({
      serviceId: this.options.serviceId,
      environment: this.options.environment ?? 'Production',
      basePath: this.dashboardPath(),
      nonce,
    });
  }

  private authorize(request: RequestLike, response: ResponseLike): void {
    const dashboard = this.options.dashboard;
    const users = dashboard?.users ?? [];

    if (dashboard?.enabled === false) {
      throw new UnauthorizedException('Pulse dashboard is disabled');
    }

    if (!users.length) {
      return;
    }

    const credentials = parseBasicAuth(request.headers?.authorization);
    const authorized = credentials && users.some((user) => matchesUser(user, credentials));

    if (!authorized) {
      response.setHeader('www-authenticate', 'Basic realm="Pulse"');
      throw new UnauthorizedException('Invalid Pulse dashboard credentials');
    }
  }

  private isDashboardRequest(request: RequestLike): boolean {
    const path = request.url?.split('?')[0] ?? '';
    return path === this.dashboardPath() || path.startsWith(`${this.dashboardPath()}/`);
  }

  private dashboardPath(): string {
    const configured = this.options.dashboard?.path ?? '/pulse';
    return configured.startsWith('/') ? configured : `/${configured}`;
  }
}

export function dashboardContentSecurityPolicy(nonce: string): string {
  return [
    'default-src \'self\'',
    `script-src 'nonce-${nonce}'`,
    'style-src \'self\' \'unsafe-inline\'',
    'img-src \'self\' data:',
    'font-src \'self\' data:',
    'connect-src \'self\'',
    'object-src \'none\'',
    'base-uri \'none\'',
    'form-action \'none\'',
    'frame-ancestors \'self\'',
  ].join('; ');
}

function parseBasicAuth(header: string | undefined): { username: string; password: string } | undefined {
  if (!header?.startsWith('Basic ')) {
    return undefined;
  }

  const decoded = Buffer.from(header.slice('Basic '.length), 'base64').toString('utf8');
  const separator = decoded.indexOf(':');

  if (separator === -1) {
    return undefined;
  }

  return {
    username: decoded.slice(0, separator),
    password: decoded.slice(separator + 1),
  };
}

function matchesUser(user: PulseDashboardUser, credentials: { username: string; password: string }): boolean {
  return user.username === credentials.username && user.password === credentials.password;
}

interface RequestLike {
  url?: string;
  headers?: {
    authorization?: string;
  };
}

interface ResponseLike {
  status(code: number): void;
  setHeader(name: string, value: string): void;
}
