#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { existsSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgRoot   = resolve(__dirname, '..');
const setupTs   = join(pkgRoot, 'src', 'setup-runner.ts');

function findTsx() {
  const candidates = [
    join(pkgRoot, 'node_modules', '.bin', 'tsx'),
    join(pkgRoot, '..', '..', 'node_modules', '.bin', 'tsx'),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return 'tsx';
}

const child = spawn(findTsx(), [setupTs, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: process.env,
  cwd: process.cwd(),
});

child.on('exit', (code) => process.exit(code ?? 0));
child.on('error', (err) => {
  process.stderr.write(`[agent-chat-setup] Failed to start: ${err.message}\n`);
  process.exit(1);
});
