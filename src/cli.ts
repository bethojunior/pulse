#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const command = process.argv[2];

if (command !== 'init') {
  console.log('Usage: pulse init');
  process.exit(command ? 1 : 0);
}

// The init script prints its own messages; only its exit status is propagated.
const result = spawnSync(process.execPath, [fileURLToPath(new URL('../scripts/init-config.mjs', import.meta.url))], { stdio: 'inherit' });
process.exit(result.status ?? 1);
