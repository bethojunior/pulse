#!/usr/bin/env node
// Scaffolds Pulse inside a NestJS application: <sourceRoot>/providers/pulse/{pulse.config.ts,pulse.module.ts}.
// Runs automatically after `npm install` (postinstall, --auto) and manually through `npx pulse init`.
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Dependencies that suggest which integrations to enable by default. Everything stays editable in pulse.config.ts.
const REDIS_PACKAGES = ['ioredis', 'redis', '@keyv/redis', 'cache-manager-ioredis', 'cache-manager-ioredis-yet', 'cache-manager-redis-store', 'cache-manager-redis-yet', '@nestjs-modules/ioredis', '@liaoliaots/nestjs-redis'];
const RABBITMQ_PACKAGES = ['amqplib', 'amqp-connection-manager', '@golevelup/nestjs-rabbitmq'];
const POSTGRES_PACKAGES = ['pg', 'postgres', '@prisma/client', 'prisma', 'typeorm', '@mikro-orm/postgresql', 'drizzle-orm', 'knex', 'sequelize', 'kysely'];
const BULLMQ_PACKAGES = ['bullmq', '@nestjs/bullmq'];

export function inspectProject(targetRoot) {
  const manifestPath = join(targetRoot, 'package.json');
  if (!existsSync(manifestPath)) return { nest: false, reason: `no package.json found in ${targetRoot}` };
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch {
    return { nest: false, reason: `${manifestPath} could not be parsed` };
  }
  // Applications declare Nest in dependencies; libraries (this package included) keep it in devDependencies or peerDependencies.
  const dependencies = { ...manifest.dependencies };
  if (!dependencies['@nestjs/core'] && !dependencies['@nestjs/common']) {
    return { nest: false, reason: `@nestjs/core is not in the dependencies of ${manifest.name || targetRoot}`, manifest };
  }
  return { nest: true, manifest, dependencies: { ...dependencies, ...manifest.devDependencies }, sourceRoot: readSourceRoot(targetRoot) };
}

function readSourceRoot(targetRoot) {
  try {
    const cli = JSON.parse(readFileSync(join(targetRoot, 'nest-cli.json'), 'utf8'));
    if (typeof cli.sourceRoot === 'string' && cli.sourceRoot.trim()) return cli.sourceRoot.trim().replace(/^\.\//, '');
  } catch {
    // Default Nest layout.
  }
  return 'src';
}

export function scaffoldPulse(targetRoot, { password = randomBytes(18).toString('base64url') } = {}) {
  const project = inspectProject(targetRoot);
  if (!project.nest) return { ...project, created: [], preserved: [] };

  // Creates providers/ only when the application does not have it yet; an existing providers/ just gains pulse/.
  const pulseDir = join(targetRoot, project.sourceRoot, 'providers', 'pulse');
  mkdirSync(pulseDir, { recursive: true });

  const files = { 'pulse.config.ts': renderConfig(project, password), 'pulse.module.ts': renderModule() };
  const created = [];
  const preserved = [];
  for (const [name, content] of Object.entries(files)) {
    const file = join(pulseDir, name);
    try {
      writeFileSync(file, content, { flag: 'wx' }); // never overwrite what the application already has
      created.push(file);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      preserved.push(file);
    }
  }
  return { ...project, pulseDir, created, preserved };
}

const has = (dependencies, names) => names.some((name) => name in dependencies);

function renderConfig(project, password) {
  const deps = project.dependencies;
  const serviceId = String(project.manifest.name || 'api').replace(/^@[^/]+\//, '').replace(/[^\w.-]/g, '-');
  return `import { definePulseConfig } from '@madgic/pulse';

/**
 * Pulse configuration.
 * Edit this file to choose who can open the dashboard and which integrations are monitored.
 * Environment variables take precedence over the inline values, so production credentials
 * can stay out of the repository.
 */
export const pulseConfig = () =>
  definePulseConfig({
    serviceId: '${serviceId}',
    environment: process.env.NODE_ENV === 'production' ? 'Production' : 'Development',

    // Dashboard: URL path and the Basic Auth users allowed to open it.
    dashboard: {
      enabled: true,
      path: '/pulse',
      users: [
        {
          username: process.env.PULSE_USER ?? 'admin',
          // Generated when Pulse was installed. Set PULSE_PASSWORD in the environment to override it.
          password: process.env.PULSE_PASSWORD ?? '${password}',
          name: 'Admin',
          role: 'owner',
        },
      ],
    },

    // Redis: PING/INFO metrics. Format: redis://user:password@host:6379/0 (rediss:// enables TLS).
    redis: {
      enabled: ${has(deps, REDIS_PACKAGES)},
      url: process.env.REDIS_URL ?? 'redis://localhost:6379',
    },

    // RabbitMQ: connections, channels, consumers and queue depths read from the Management API.
    // Format: amqp://user:password@host:5672/vhost. The Management API is assumed at http://host:15672
    // with the same credentials; set managementUrl when it lives somewhere else.
    rabbitmq: {
      enabled: ${has(deps, RABBITMQ_PACKAGES)},
      url: process.env.RABBITMQ_URL ?? 'amqp://guest:guest@localhost:5672',
      // managementUrl: process.env.RABBITMQ_MANAGEMENT_URL,
      // queues: ['events'], // empty shows the 20 deepest queues of the vhost
      queues: [],
    },

    // PostgreSQL: statistics from pg_stat_database for the configured database.
    database: {
      enabled: ${has(deps, POSTGRES_PACKAGES)},
      driver: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/postgres',
    },

    // BullMQ (Redis-backed) queues: list the queue names to display.
    queues: {
      enabled: ${has(deps, BULLMQ_PACKAGES)},
      driver: 'bullmq',
      url: process.env.REDIS_URL ?? 'redis://localhost:6379',
      prefix: 'bull',
      names: [],
    },

    // Request data shown in the dashboard: headers are recorded with credentials redacted (authorization,
    // cookie, api keys); bodies are opt-in because they may carry personal data.
    captureHeaders: true,
    captureBody: false,
    captureBodyMaxBytes: 8192,

    flushIntervalMs: 10_000,
    retentionLimit: 5_000,
  });
`;
}

function renderModule() {
  return `import { ObserveModule } from '@madgic/pulse';
import { Module } from '@nestjs/common';
import { pulseConfig } from './pulse.config';

/**
 * Registers Pulse: request traces, errors, metrics and the dashboard (default /pulse).
 * Add PulseModule to the imports of AppModule. ObserveModule is global, so TracerService
 * and PulseConnections can be injected anywhere in the application.
 */
@Module({
  imports: [
    ObserveModule.forRootAsync({
      // The factory runs after ConfigModule.forRoot() has loaded .env files, so process.env is complete.
      useFactory: pulseConfig,
    }),
  ],
})
export class PulseModule {}
`;
}

export function run(argv = process.argv, env = process.env) {
  const automatic = argv.includes('--auto');
  const targetRoot = automatic ? env.INIT_CWD : process.cwd();
  if (!targetRoot) return;
  // Global installs and the package's own development install have no application to scaffold.
  if (automatic && (env.npm_config_global === 'true' || realpathSync(targetRoot) === realpathSync(packageRoot))) return;

  if (realpathSync(targetRoot) === realpathSync(packageRoot)) throw new Error('Pulse: run pulse init inside the NestJS application, not inside @madgic/pulse itself');

  const result = scaffoldPulse(targetRoot);
  if (!result.nest) {
    const message = `Pulse: ${result.reason}. @madgic/pulse only supports NestJS applications; nothing was created.`;
    if (automatic) {
      console.log(message);
      return;
    }
    throw new Error(message);
  }

  const show = (file) => relative(targetRoot, file);
  for (const file of result.created) console.log(`Pulse: created ${show(file)}`);
  for (const file of result.preserved) console.log(`Pulse: preserved existing ${show(file)}`);
  if (result.created.length) {
    console.log(
      'Pulse: add PulseModule to the imports of AppModule:\n' +
        "  import { PulseModule } from './providers/pulse/pulse.module';\n" +
        `Pulse: dashboard at /pulse (user admin). Edit ${show(join(result.pulseDir, 'pulse.config.ts'))} to change credentials, Redis, RabbitMQ and database settings.`,
    );
  }
}

function isMainModule() {
  try {
    return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMainModule()) {
  try {
    run();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
