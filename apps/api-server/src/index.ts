import { createStorage, createPubSub } from '@agent-chat/database';
import { createApiServer } from './create-server.js';

const storageMode = (process.env.STORAGE_MODE ?? 'memory') as 'memory' | 'postgres';
const pubsubMode = (process.env.PUBSUB_MODE ?? 'local') as 'local' | 'redis';

const storage = createStorage(storageMode);
const pubsub = createPubSub(pubsubMode);

const server = await createApiServer({ storage, pubsub });

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '0.0.0.0';

await server.listen({ port, host });
console.log(`[api-server] Listening on http://${host}:${port}`);
