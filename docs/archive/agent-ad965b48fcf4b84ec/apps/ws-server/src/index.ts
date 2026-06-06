import { createStorage, createPubSub } from '@agent-chat/database';
import { createWsServer } from './create-server.js';

const storageMode = (process.env.STORAGE_MODE ?? 'memory') as 'memory' | 'postgres';
const pubsubMode = (process.env.PUBSUB_MODE ?? 'local') as 'local' | 'redis';

const storage = createStorage(storageMode);
const pubsub = createPubSub(pubsubMode);

const { httpServer } = createWsServer({ storage, pubsub });

const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? '0.0.0.0';

httpServer.listen(port, host, () => {
  console.log(`[ws-server] Listening on ws://${host}:${port}`);
});

process.on('SIGTERM', () => {
  httpServer.close(() => process.exit(0));
});
