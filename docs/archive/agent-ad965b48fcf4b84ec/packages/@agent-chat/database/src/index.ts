export * from './interfaces/index.js';
export * from './memory/index.js';

import { MemoryAdapter } from './memory/memory-adapter.js';
import { LocalPubSub } from './memory/local-pubsub.js';
import type { IStorageAdapter } from './interfaces/storage.js';
import type { IPubSubAdapter } from './interfaces/pubsub.js';

export type StorageMode = 'memory' | 'postgres';
export type PubSubMode = 'local' | 'redis';

export function createStorage(mode: StorageMode = 'memory'): IStorageAdapter {
  if (mode === 'memory') return new MemoryAdapter();
  throw new Error(
    `Storage mode "${mode}" is not available in this build. ` +
      'Install @agent-chat/database-postgres for PostgreSQL support.'
  );
}

export function createPubSub(mode: PubSubMode = 'local'): IPubSubAdapter {
  if (mode === 'local') return new LocalPubSub();
  throw new Error(
    `PubSub mode "${mode}" is not available in this build. ` +
      'Install @agent-chat/database-redis for Redis support.'
  );
}
