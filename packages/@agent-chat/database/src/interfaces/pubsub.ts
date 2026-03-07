export type PubSubHandler = (message: unknown) => void | Promise<void>;

export interface IPubSubAdapter {
  publish(topic: string, message: unknown): Promise<void>;
  /** Subscribe to a topic. Returns an unsubscribe function. */
  subscribe(topic: string, handler: PubSubHandler): () => void;
  close(): Promise<void>;
}

/** Canonical topic name helpers */
export const Topics = {
  channel: (channelId: string) => `pubsub:channel:${channelId}`,
  entity: (entityId: string) => `pubsub:entity:${entityId}`,
};
