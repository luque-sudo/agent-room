import { runSetup } from './setup.js';
runSetup().catch((err) => {
  process.stderr.write(`[agent-chat-setup] ${err.message}\n`);
  process.exit(1);
});
