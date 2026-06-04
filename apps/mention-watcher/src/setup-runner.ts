import { runSetup } from './setup.js';

async function checkNodePty(): Promise<void> {
  try {
    await import('node-pty');
  } catch {
    process.stderr.write(
      '\n[agent-chat-setup] WARNING: node-pty is not available.\n' +
      '  pnpm watch will fail at runtime without it.\n' +
      '  Windows fix: install Windows Build Tools, then rebuild:\n' +
      '    npm install -g windows-build-tools\n' +
      '    npm rebuild node-pty\n' +
      '  Linux/macOS fix: install build-essential / Xcode CLI tools, then:\n' +
      '    npm rebuild node-pty\n\n'
    );
  }
}

checkNodePty()
  .then(() => runSetup())
  .catch((err) => {
    process.stderr.write(`[agent-chat-setup] ${err.message}\n`);
    process.exit(1);
  });
