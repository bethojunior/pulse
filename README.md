# @madgic/pulse

[![npm version](https://img.shields.io/npm/v/@madgic/pulse)](https://www.npmjs.com/package/@madgic/pulse)
[![CI](https://github.com/bethojunior/pulse/actions/workflows/ci.yml/badge.svg)](https://github.com/bethojunior/pulse/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A small NestJS observability package inspired by the ergonomics of NestJS Observe.

It gives Nest applications request traces, nested spans, handled error capture, request-scoped
attributes, custom metrics, a pluggable exporter and a built-in dashboard with Redis,
PostgreSQL, RabbitMQ and BullMQ panels.

## Requirements

- NestJS 10, 11 or 12 (`@nestjs/common` and `@nestjs/core` as peer dependencies).
- Node.js 20.19+ or 22.12+. The package is published as ES modules; applications compiled to
  CommonJS (the default Nest setup) load it through Node's `require(esm)` support.

## Install

```sh
npm i @madgic/pulse
```

Pulse only supports NestJS applications. The installation looks for `@nestjs/core` in the
application's `package.json` and scaffolds Pulse next to the other providers:

```
src/providers/pulse/
├── pulse.config.ts   # editable: dashboard users and path, Redis, RabbitMQ, PostgreSQL, BullMQ
└── pulse.module.ts   # PulseModule, ready to be imported by AppModule
```

`src/providers/` is created only when the application does not have it yet, existing files are
never overwritten and the source root is read from `nest-cli.json` (`sourceRoot`, default
`src`). In a project without NestJS nothing is created. If your package manager blocks
lifecycle scripts, run the same step from the application directory:

```sh
npx pulse init
```

## Quick Start

Import the generated module in `AppModule`:

```ts
import { Module } from '@nestjs/common';
import { PulseModule } from './providers/pulse/pulse.module';

@Module({
  imports: [PulseModule],
})
export class AppModule {}
```

Open `http://localhost:3000/pulse`. The dashboard uses Basic Auth with the users listed in
`pulse.config.ts`: user `admin` and a password generated during installation. `PULSE_USER` and
`PULSE_PASSWORD` in the environment override them without touching the code.

## Configuration

`pulse.config.ts` exports a factory, so variables loaded by `ConfigModule.forRoot()` or any
`.env` loader are already present when it runs. Edit it to choose who can open the dashboard,
its path (default `/pulse`) and which integrations are monitored:

```ts
import { definePulseConfig } from '@madgic/pulse';

export const pulseConfig = () =>
  definePulseConfig({
    serviceId: 'orders-api',
    environment: process.env.NODE_ENV === 'production' ? 'Production' : 'Development',
    dashboard: {
      enabled: true,
      path: '/pulse',
      users: [{ username: process.env.PULSE_USER ?? 'admin', password: process.env.PULSE_PASSWORD ?? 'generated', role: 'owner' }],
    },
    redis: { enabled: true, url: process.env.REDIS_URL ?? 'redis://localhost:6379' },
    rabbitmq: { enabled: true, url: process.env.RABBITMQ_URL ?? 'amqp://guest:guest@localhost:5672', queues: ['events'] },
    database: { enabled: true, driver: 'postgres', url: process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/app' },
    queues: { enabled: false, driver: 'bullmq', url: process.env.REDIS_URL ?? 'redis://localhost:6379', prefix: 'bull', names: [] },
  });
```

| Section | What Pulse reads | Notes |
| --- | --- | --- |
| `dashboard` | nothing external | `path` defaults to `/pulse`; `users` turns on Basic Auth. |
| `redis` | `PING` and `INFO` | `redis://user:password@host:6379/0`; `rediss://` enables TLS. |
| `rabbitmq` | Management API `/api/overview`, `/api/queues/<vhost>` and, when a queue is opened in the dashboard, `/api/queues/<vhost>/<name>` plus its `/bindings` | `amqp://user:password@host:5672/vhost`. The Management API is assumed at `http://host:15672` with the same credentials; set `managementUrl` otherwise. `queues` lists the names to show, an empty list shows the 20 deepest queues of the vhost. |
| `database` | `pg_stat_database` for the current database | PostgreSQL only. |
| `queues` | BullMQ counts and up to five retained jobs per state | Same prefix and Redis database as the application, up to 20 queue names. |

Integrations whose client packages appear in `package.json` during installation (for example
`ioredis`, `amqplib`, `@prisma/client`, `bullmq`) start enabled; the others start disabled.
`definePulseConfig()` validates the object and fails at startup with a clear message when an
enabled integration has no URL.

URL-encode special characters in credentials and keep production credentials in the
environment, not in the repository. Use accounts with read permissions only. These panels show
server statistics, not an audit log of every application operation; PostgreSQL statistics
accumulate until reset. Pulse does not start workers, consume or publish messages, retry jobs,
pause queues, or expose payloads. Bull and other brokers are not implemented in this version.

### JSON alternative

`loadPulseConfig()` reads `pulse.config.json` (see `pulse.config.example.json`) and resolves
`${ENV_NAME}` placeholders from `process.env`:

```ts
ObserveModule.forRootAsync({ useFactory: () => loadPulseConfig() })
```

## Application operations and jobs

To capture application accesses, timings and exceptions, inject `PulseConnections` and use its
clients or wrap your existing ORM/client calls:

```ts
import { Injectable } from '@nestjs/common';
import { PulseConnections } from '@madgic/pulse';

@Injectable()
export class OrdersService {
  constructor(private readonly pulse: PulseConnections) {}

  findOrder(id: number) {
    return this.pulse.query('SELECT id FROM orders WHERE id = $1', [id]);
  }

  cachedOrder(id: number) {
    return this.pulse.command('GET', `orders:${id}`);
  }
}
```

For existing clients, `pulse.database('orders.find', () => prisma.order.findMany())`
and `pulse.redis('GET', () => redis.get('key'))` preserve results and rethrow the
original error after recording it. Callbacks must return their asynchronous work.
SQL parameters, Redis arguments and results are not recorded. Do not put secrets
in operation names; exception messages/stacks may contain application data.

Inside a cron handler or worker processor, use
`pulse.job('daily-report', () => generateReport())`. The Jobs page shows these
local jobs while running, followed by their completed or failed spans. This is
explicit instrumentation: credentials alone cannot intercept ORM/client calls
or discover arbitrary scheduled functions.

## Dashboard

Everything lives in memory inside the application process (bounded by `retentionLimit` spans, 10 minutes of
2-second server samples and 6 hours of per-minute aggregates) and refreshes every 5 seconds. Selecting text inside
the page pauses the refresh so stack traces can be copied, and the "Ao vivo" button pauses it explicitly.

| Page | Content |
| --- | --- |
| Visão geral | Requests/min with trend, 5xx and 4xx rates, p50/p95/p99, in-flight requests, uptime, CPU/memory/heap/event-loop sparklines, 60-minute traffic chart, status-code distribution, spans per type, top routes and recent errors. |
| Erros | Error groups (Datadog-style issues): type, message, category (server 5xx / client 4xx / process / internal), HTTP status, occurrences, affected routes and users, first/last seen and a 30-minute trend. Selecting a group shows its recent occurrences and, for each one, the parsed stack trace (application frames highlighted, `node_modules` and Node internals collapsible), the raw stack, the `cause` chain, `code`/`status`, extra error properties (Nest `response` body, Prisma `meta`, ...), every span attribute of the request (method, route, URL, status, client IP, user agent, sizes, captured headers) and the waterfall of the whole trace. |
| Requests | Per-route table with requests, avg/min/max, p50/p95/p99, 2xx/4xx/5xx counts, error rate and last access, plus total bytes in/out and the status-code split. |
| Traces | Last 50 traces with a hierarchical waterfall (HTTP request → handler → database/Redis/job/manual spans) and the attributes and error of each span. |
| Métricas | Custom counters/gauges/histograms aggregated by name, spans per type, recent raw records and process events (uncaught exceptions, unhandled rejections, warnings). |
| Servidor | Host and process identity (OS, kernel, arch, CPU model, Node version, PID, user, cwd, argv, flags, timezone, versions of V8/libuv/OpenSSL/...), host CPU and per-core usage, load average, host memory, RSS, heap used/allocated/limit, V8 heap statistics and heap spaces, garbage-collector cycles and pauses by type, event-loop delay percentiles and utilization, active handles/requests by type, open file descriptors (Linux), `process.resourceUsage()` counters, disk usage, network throughput (Linux), cgroup CPU/memory limits inside containers, network interfaces, and a 10-minute / 6-hour history chart per metric. |
| Redis, Banco de dados, Queues, Jobs | Server statistics of the configured integrations and the operations recorded through `PulseConnections`. |

### How requests and errors are captured

Pulse registers a middleware (through the module's `configure`) that opens one `server` span per HTTP request before
guards, pipes and handlers run and closes it when the response finishes. Requests rejected by guards (401/403),
pipes (400) or that match no route (404) are therefore counted with their final status code, together with the client
IP (`x-forwarded-for` aware), user agent, host, request/response sizes and an incoming W3C `traceparent` when present.
The global interceptor adds a child `handler` span (`Controller.method`) and attaches thrown exceptions to both spans.
Message handlers of hybrid applications need the option described in the next section.

Each request span carries the data needed to reproduce a call: method, route, URL, query string (`http.query`), route
parameters (`http.params`), client IP (`http.client_ip`, honouring `X-Forwarded-For`), user agent, HTTP version, peer
port, request id, request and response sizes, status code, response content type and every request and response
header (`http.request.header.*`, `http.response.header.*`). Credentials are never stored: `authorization`, `cookie`,
`set-cookie`, API-key and CSRF headers are replaced by `[redacted]`, header values are cut at 512 characters and
query/params keys that look like secrets (password, token, api key, card number, CVV...) are redacted too.
`captureHeaders: false` disables header capture and a list of names records only those. Request bodies are off by
default; `captureBody: true` records the parsed body as `http.request.body` (JSON, same redaction, truncated at
`captureBodyMaxBytes`, default 8192). When a bearer JWT is present, its `sub` claim is shown as `enduser.id` without
verifying the token.

Error rate and service health count 5xx responses and unhandled exceptions; 4xx responses are reported separately as
client errors. Errors are grouped by exception type plus the first application stack frame (falling back to a
normalized message), so the same failure thrown for different ids stays in one group. `serializeError` keeps the
stack, parsed frames, `code`, HTTP status, the `cause` chain (4 levels) and the other own properties of the error,
truncated to keep payloads bounded. `process.on('warning')` and `uncaughtExceptionMonitor` (which also sees escalated
unhandled rejections) are recorded as `process` spans without changing the default behaviour of the process.

The JSON behind the page is served with the same authorization: `GET /pulse/api/snapshot`,
`GET /pulse/api/traces/:traceId`, `GET /pulse/api/errors/:id` and `GET /pulse/api/rabbitmq/queue?name=<queue>`.

## Hybrid applications (microservices)

Nest does not apply global interceptors to `connectMicroservice()` transports unless the hybrid app
inherits the HTTP configuration. To record RabbitMQ, Kafka or Redis message handlers as spans, pass
the option when connecting:

```ts
app.connectMicroservice<MicroserviceOptions>({ transport: Transport.RMQ, options }, { inheritAppConfig: true });
```

Without it, handler failures still reach the Nest logger but never appear in Pulse.

## Dashboard security

On the Queues page, clicking a RabbitMQ queue opens everything the Management API reports about
it: definition (type, durability, policy, node), arguments, message counts and bytes, rates,
consumers with their connections, bindings, and the complete JSON. Messages themselves are
never fetched, so nothing is consumed, requeued or exposed.


- Basic Auth with the configured users; a wrong or missing credential returns 401.
- The HTML response carries its own nonce-based `Content-Security-Policy`, so the dashboard
  keeps working behind `helmet` or another strict CSP middleware.
- Snapshots never include connection URLs, credentials or raw connection errors.
- Exception messages, stacks and extra properties, request URLs, client IPs, user agents and the process
  information on the Servidor page (paths, arguments, network addresses) are visible to anyone who can open the
  dashboard. Keep the credentials private and avoid putting secrets in error messages.

## Manual Instrumentation

```ts
import { Injectable } from '@nestjs/common';
import { TracerService } from '@madgic/pulse';

@Injectable()
export class BillingService {
  constructor(private readonly tracer: TracerService) {}

  charge(accountId: string) {
    return this.tracer.createSpan('billing.charge', async (span) => {
      span.setTag('accountId', accountId);
      this.tracer.counter('billing.charge.attempts').increment();
      return this.callGateway(accountId);
    });
  }
}
```

## Exports

- `definePulseConfig()`, `loadPulseConfig()`, `validatePulseOptions()`
- `PulseConnections`
- `RabbitMqMonitor`
- `createObserveModule()`
- `ObserveModule`
- `TracerService`
- `TraceSpanDelegate`
- `ConsoleTelemetryExporter`
- `HttpTelemetryExporter`
- `NoopTelemetryExporter`

## Notes

This project is not affiliated with NestJS Observe. It intentionally implements a compatible developer experience with original code.
