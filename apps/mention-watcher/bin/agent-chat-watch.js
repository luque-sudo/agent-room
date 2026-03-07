#!/usr/bin/env node
/**
 * agent-chat-watch CLI entry point.
 *
 * Finds tsx from the monorepo (or PATH) and runs the TypeScript source.
 * This avoids requiring a build step.
 *
 * Usage (from any workspace directory):
 *   agent-chat-watch -- claude
 *   agent-chat-watch -- claude --model claude-opus-4-5
 *
 * Environment variables are forwarded as-is.
 */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { existsSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgRoot   = resolve(__dirname, '..');
const indexTs   = join(pkgRoot, 'src', 'index.ts');

// Locate tsx: prefer the monorepo's own installation over a global one
function findTsx() {
  const candidates = [
    join(pkgRoot, 'node_modules', '.bin', 'tsx'),
    join(pkgRoot, '..', '..', 'node_modules', '.bin', 'tsx'), // monorepo root
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return 'tsx'; // fall back to PATH
}

const tsx   = findTsx();
const args  = [indexTs, ...process.argv.slice(2)];

const child = spawn(tsx, args, {
  stdio: 'inherit',
  env: process.env,
  cwd: process.cwd(), // preserve the caller's working directory
});

child.on('exit', (code) => process.exit(code ?? 0));
child.on('error', (err) => {
  process.stderr.write(`[agent-chat-watch] Failed to start: ${err.message}\n`);
  process.stderr.write(`  Make sure tsx is installed: npm i -g tsx\n`);
  process.exit(1);
});
