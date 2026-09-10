import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { inspectProject, scaffoldPulse } from '../scripts/init-config.mjs';

const roots: string[] = [];
function project(manifest: Record<string, unknown>, prepare: (root: string) => void = () => {}) {
  const root = mkdtempSync(join(tmpdir(), 'pulse-init-'));
  roots.push(root);
  writeFileSync(join(root, 'package.json'), JSON.stringify(manifest));
  prepare(root);
  return root;
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('pulse init scaffold', () => {
  it('refuses projects that are not NestJS applications and creates nothing', () => {
    const root = project({ name: 'express-app', dependencies: { express: '^4' } });
    const result = scaffoldPulse(root);
    expect(result.nest).toBe(false);
    expect(result.reason).toContain('@nestjs/core');
    expect(result.created).toEqual([]);
    expect(existsSync(join(root, 'src'))).toBe(false);
    expect(inspectProject(join(root, 'missing')).nest).toBe(false);

    const library = project({ name: 'nest-lib', devDependencies: { '@nestjs/core': '^11' }, peerDependencies: { '@nestjs/core': '>=10' } });
    expect(scaffoldPulse(library).nest).toBe(false);
    expect(existsSync(join(library, 'src'))).toBe(false);
  });

  it('creates src/providers/pulse with an editable config and a module in a Nest app', () => {
    const root = project({ name: '@acme/orders-api', dependencies: { '@nestjs/core': '^11', ioredis: '^5', '@prisma/client': '^6' } });
    const result = scaffoldPulse(root, { password: 'generated-secret' });
    expect(result.created.map((file) => file.slice(root.length))).toEqual(['/src/providers/pulse/pulse.config.ts', '/src/providers/pulse/pulse.module.ts']);
    const config = readFileSync(join(root, 'src/providers/pulse/pulse.config.ts'), 'utf8');
    expect(config).toContain("serviceId: 'orders-api'");
    expect(config).toContain("path: '/pulse'");
    expect(config).toContain("username: process.env.PULSE_USER ?? 'admin'");
    expect(config).toContain("password: process.env.PULSE_PASSWORD ?? 'generated-secret'");
    expect(config).toMatch(/redis: \{\n\s+enabled: true/);
    expect(config).toMatch(/rabbitmq: \{\n\s+enabled: false/);
    expect(config).toMatch(/database: \{\n\s+enabled: true/);
    expect(config).toMatch(/queues: \{\n\s+enabled: false/);
    const module = readFileSync(join(root, 'src/providers/pulse/pulse.module.ts'), 'utf8');
    expect(module).toContain('export class PulseModule');
    expect(module).toContain('useFactory: pulseConfig');
  });

  it('adds pulse/ to an existing providers directory and never overwrites files', () => {
    const root = project({ name: 'api', dependencies: { '@nestjs/core': '^11', amqplib: '^0.10' } }, (dir) => {
      mkdirSync(join(dir, 'src/providers/redis'), { recursive: true });
      writeFileSync(join(dir, 'src/providers/redis/redis.module.ts'), 'keep');
    });
    const first = scaffoldPulse(root);
    expect(first.created).toHaveLength(2);
    expect(readFileSync(join(root, 'src/providers/pulse/pulse.config.ts'), 'utf8')).toMatch(/rabbitmq: \{\n\s+enabled: true/);

    writeFileSync(join(root, 'src/providers/pulse/pulse.config.ts'), 'edited by the application');
    const second = scaffoldPulse(root);
    expect(second.created).toEqual([]);
    expect(second.preserved).toHaveLength(2);
    expect(readFileSync(join(root, 'src/providers/pulse/pulse.config.ts'), 'utf8')).toBe('edited by the application');
    expect(readFileSync(join(root, 'src/providers/redis/redis.module.ts'), 'utf8')).toBe('keep');
  });

  it('honours sourceRoot from nest-cli.json', () => {
    const root = project({ name: 'api', dependencies: { '@nestjs/common': '^11' } }, (dir) => {
      writeFileSync(join(dir, 'nest-cli.json'), JSON.stringify({ sourceRoot: 'apps/api/src' }));
    });
    expect(scaffoldPulse(root).created[0]).toBe(join(root, 'apps/api/src/providers/pulse/pulse.config.ts'));
  });
});
