import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    cli: 'src/cli.ts',
    watch: 'src/index.ts',
    setup: 'src/setup-runner.ts',
  },
  format: ['esm'],
  target: 'node18',
  bundle: true,
  // node-pty contains native bindings; ws is a runtime peer — keep both external
  external: ['node-pty', 'ws'],
  banner: { js: '#!/usr/bin/env node' },
  clean: true,
});
