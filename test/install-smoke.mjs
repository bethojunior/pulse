// End-to-end check of the packed installation: `npm pack` + `npm install <tarball>` in throwaway projects.
// Run manually with `node test/install-smoke.mjs` (needs network access for @nestjs/core).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const cwd = mkdtempSync(join(tmpdir(), 'pulse-install-'));
try {
  const packed = JSON.parse(execFileSync('npm', ['pack', '--json', '--pack-destination', cwd], { cwd: resolve('.'), encoding: 'utf8' }));
  const tarball = join(cwd, packed[0].filename);
  const install = (dir) => execFileSync('npm', ['install', tarball, '--foreground-scripts', '--no-audit', '--no-fund'], { cwd: dir, stdio: 'pipe', timeout: 240000 });

  // NestJS application with an existing providers/ directory: only providers/pulse is added.
  const nest = join(cwd, 'nest-app');
  mkdirSync(join(nest, 'src/providers/redis'), { recursive: true });
  writeFileSync(join(nest, 'package.json'), JSON.stringify({ name: 'nest-app', version: '1.0.0', private: true, dependencies: { '@nestjs/core': '^11.0.0', ioredis: '^5.0.0' } }));
  install(nest);
  const configPath = join(nest, 'src/providers/pulse/pulse.config.ts');
  const config = readFileSync(configPath, 'utf8');
  assert.match(config, /path: '\/pulse'/);
  assert.match(config, /PULSE_PASSWORD \?\? '[A-Za-z0-9_-]{20,}'/);
  assert.match(config, /redis: \{\n\s+enabled: true/);
  assert.ok(existsSync(join(nest, 'src/providers/pulse/pulse.module.ts')));
  assert.ok(existsSync(join(nest, 'src/providers/redis')));
  writeFileSync(configPath, '// edited');
  execFileSync('npm', ['rebuild', '@madgic/pulse'], { cwd: nest, stdio: 'pipe', timeout: 60000 });
  assert.equal(readFileSync(configPath, 'utf8'), '// edited');

  // Project without NestJS: the installation succeeds and nothing is scaffolded.
  const plain = join(cwd, 'plain-app');
  mkdirSync(plain, { recursive: true });
  writeFileSync(join(plain, 'package.json'), JSON.stringify({ name: 'plain-app', version: '1.0.0', private: true }));
  const output = execFileSync('npm', ['install', tarball, '--foreground-scripts', '--no-audit', '--no-fund'], { cwd: plain, encoding: 'utf8', timeout: 240000 });
  assert.match(output, /only supports NestJS applications/);
  assert.equal(existsSync(join(plain, 'src')), false);

  console.log('Packed npm installation: Nest app scaffolded and preserved on reinstall; non-Nest project left untouched');
} finally {
  rmSync(cwd, { recursive: true, force: true });
}
