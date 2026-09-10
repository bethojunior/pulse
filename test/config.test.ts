import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { definePulseConfig, loadPulseConfig, validatePulseOptions } from '../src/config.js';

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })));

function jsonConfig(content: unknown): string {
  const cwd = mkdtempSync(join(tmpdir(), 'pulse-config-'));
  directories.push(cwd);
  const path = join(cwd, 'pulse.config.json');
  writeFileSync(path, JSON.stringify(content));
  return path;
}

describe('Pulse configuration', () => {
  it('returns validated options from definePulseConfig', () => {
    const options = definePulseConfig({ serviceId: 'api', rabbitmq: { url: 'amqp://localhost', queues: ['events'] }, dashboard: { path: '/pulse', users: [{ username: 'admin', password: 'secret' }] } });
    expect(options.serviceId).toBe('api');
    expect(() => definePulseConfig({ serviceId: ' ' })).toThrow('serviceId is required');
    expect(() => definePulseConfig({ serviceId: 'api', redis: { enabled: true, url: '' } })).toThrow('Pulse redis: connection URL is missing');
    expect(() => definePulseConfig({ serviceId: 'api', rabbitmq: { url: 'amqp://localhost', queues: ['ok', ''] } })).toThrow('rabbitmq.queues');
    expect(() => definePulseConfig({ serviceId: 'api', queues: { driver: 'bullmq', url: 'redis://localhost', names: ['a:b'] } })).toThrow('queues.names');
    expect(() => definePulseConfig({ serviceId: 'api', dashboard: { users: [{ username: 'admin', password: '' }] } })).toThrow('username and a password');
    expect(() => validatePulseOptions({ serviceId: 'api', database: { driver: 'mysql' as never, url: 'mysql://localhost' } })).toThrow('postgres');
  });

  it('loads JSON configuration and resolves environment placeholders', () => {
    process.env.PULSE_TEST_REDIS_URL = 'redis://localhost:6379/1';
    try {
      const config = loadPulseConfig(jsonConfig({ serviceId: 'json-api', redis: { enabled: true, url: '${PULSE_TEST_REDIS_URL}' }, rabbitmq: { enabled: false, url: '${PULSE_TEST_UNSET_URL}', queues: [] } }));
      expect(config.redis).toEqual({ enabled: true, url: 'redis://localhost:6379/1' });
      expect(config.rabbitmq?.url).toBe('');
    } finally {
      delete process.env.PULSE_TEST_REDIS_URL;
    }
    expect(() => loadPulseConfig(join(tmpdir(), 'pulse-missing', 'pulse.config.json'))).toThrow('Run "npx pulse init" first');
  });

  it('fails clearly for enabled integrations without credentials', () => {
    const path = jsonConfig({ serviceId: 'test', database: { enabled: true, driver: 'postgres', url: '${PULSE_MISSING_TEST_URL}' } });
    expect(() => loadPulseConfig(path)).toThrow('connection URL is missing');
  });
});
