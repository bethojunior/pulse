import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { PulseOptions } from './types.js';

export function definePulseConfig(options: PulseOptions): PulseOptions {
  return validatePulseOptions(options);
}

export function loadPulseConfig(path = 'pulse.config.json'): PulseOptions {
  const configPath = resolve(process.cwd(), path);

  if (!existsSync(configPath)) {
    throw new Error(`Pulse config not found at ${configPath}. Run "npx pulse init" first.`);
  }

  const config = JSON.parse(readFileSync(configPath, 'utf8'), (_key, value: unknown) =>
    typeof value === 'string' ? value.replace(/\$\{([A-Z_][A-Z0-9_]*)\}/g, (_match, name: string) => process.env[name] ?? '') : value,
  ) as PulseOptions;
  return validatePulseOptions(config);
}

export function validatePulseOptions(config: PulseOptions): PulseOptions {
  if (!config || typeof config.serviceId !== 'string' || !config.serviceId.trim()) throw new Error('Pulse serviceId is required');
  const connections = { redis: config.redis, database: config.database, queues: config.queues, rabbitmq: config.rabbitmq };
  for (const [name, connection] of Object.entries(connections)) {
    if (connection?.enabled === true && !connection.url) throw new Error(`Pulse ${name}: connection URL is missing`);
  }
  if (config.database && config.database.driver !== 'postgres') throw new Error('Pulse supports the postgres database driver');
  if (config.queues && config.queues.driver !== 'bullmq') throw new Error('Pulse supports the bullmq queue driver');
  if (config.queues && !isNameList(config.queues.names, 20, (name) => !name.includes(':'))) {
    throw new Error('Pulse queues.names must contain up to 20 BullMQ queue names');
  }
  if (config.rabbitmq?.queues !== undefined && !isNameList(config.rabbitmq.queues, 50)) {
    throw new Error('Pulse rabbitmq.queues must contain up to 50 queue names');
  }
  if (config.dashboard?.users?.some((user) => !user.username || !user.password)) {
    throw new Error('Pulse dashboard.users entries need a username and a password');
  }
  return config;
}

function isNameList(value: unknown, limit: number, accept: (name: string) => boolean = () => true): value is string[] {
  return Array.isArray(value) && value.length <= limit && value.every((name) => typeof name === 'string' && name.length > 0 && accept(name));
}
