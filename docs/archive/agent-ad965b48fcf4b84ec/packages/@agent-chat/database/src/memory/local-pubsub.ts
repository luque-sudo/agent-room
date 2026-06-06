import { EventEmitter } from 'node:events';
import type { IPubSubAdapter, PubSubHandler } from '../interfaces/pubsub.js';

export class LocalPubSub implements IPubSubAdapter {
  private emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(0);
  }

  async publish(topic: string, message: unknown): Promise<void> {
    this.emitter.emit(topic, message);
  }

  subscribe(topic: string, handler: PubSubHandler): () => void {
    const listener = (msg: unknown) => {
      void handler(msg);
    };
    this.emitter.on(topic, listener);
    return () => this.emitter.off(topic, listener);
  }

  async close(): Promise<void> {
    this.emitter.removeAllListeners();
  }
}
