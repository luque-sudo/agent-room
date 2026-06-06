import { randomUUID } from 'node:crypto';
import { WsAdapter } from './ws-adapter.js';
import type { WireMessage } from '@agent-chat/types';

export interface AgentChatClientOptions {
  /** agent-gateway WebSocket URL (default: ws://localhost:3002) */
  gatewayUrl?: string;
  /** Agent JWT or agent_token */
  token: string;
  /** Auto-join these channels on connect */
  channels?: string[];
}

type StreamPushFn = (chunk: string) => Promise<void>;
type StreamCallback = (push: StreamPushFn, signal: AbortSignal) => Promise<void>;

export class AgentChatClient {
  private adapter: WsAdapter;
  private connected = false;
  private joinedChannels = new Set<string>();
  private messageHandlers = new Map<string, Set<(msg: WireMessage) => void>>();
  private signalHandlers = new Set<(msg: WireMessage) => void>();
  private activeAbortControllers = new Map<string, AbortController>();

  constructor(private opts: AgentChatClientOptions) {
    const url = `${opts.gatewayUrl ?? 'ws://localhost:3002'}?token=${encodeURIComponent(opts.token)}`;
    this.adapter = new WsAdapter({ url });

    this.adapter.on('message', (msg: WireMessage) => {
      if (msg.type === 'signal') {
        const payload = msg.payload as any;
        if (payload?.event === 'interrupt' && payload?.streamId) {
          const ctrl = this.activeAbortControllers.get(payload.streamId);
          if (ctrl) {
            ctrl.abort();
            this.activeAbortControllers.delete(payload.streamId);
          }
        }
      }
    });

    this.adapter.on('signal', (msg: WireMessage) => {
      for (const h of this.signalHandlers) h(msg);
    });
  }

  async connect(): Promise<void> {
    await this.adapter.connect();
    this.connected = true;

    for (const channelId of this.opts.channels ?? []) {
      await this.joinChannel(channelId);
    }
  }

  async joinChannel(channelId: string): Promise<void> {
    this.sendAction('join', { channelId });
    this.joinedChannels.add(channelId);

    this.adapter.on(`channel:${channelId}`, (msg: WireMessage) => {
      const handlers = this.messageHandlers.get(channelId);
      if (handlers) {
        for (const h of handlers) h(msg);
      }
    });
  }

  async leaveChannel(channelId: string): Promise<void> {
    this.sendAction('leave', { channelId });
    this.joinedChannels.delete(channelId);
    this.adapter.removeAllListeners(`channel:${channelId}`);
  }

  sendMessage(channelId: string, content: string, options?: {
    mentions?: string[];
    replyTo?: string;
  }): void {
    const id = randomUUID().slice(0, 8);
    const msg = {
      id,
      type: 'chat',
      from: 'sdk',
      channel: channelId,
      payload: {
        content,
        mentions: options?.mentions,
        replyTo: options?.replyTo,
      },
      ts: new Date().toISOString(),
    } as WireMessage;
    this.adapter.send(msg);
  }

  /**
   * Stream content to a channel. The callback receives a push function and
   * an AbortSignal that fires when the stream is interrupted by the server.
   */
  async streamOutput(channelId: string, callback: StreamCallback): Promise<void> {
    const streamId = randomUUID().slice(0, 8);
    const controller = new AbortController();
    this.activeAbortControllers.set(streamId, controller);

    // Send stream_start
    this.adapter.send({
      id: randomUUID().slice(0, 8),
      type: 'stream_start' as WireMessage['type'],
      from: 'sdk',
      channel: channelId,
      payload: { streamId },
      ts: new Date().toISOString(),
    });

    const chunks: string[] = [];

    const push: StreamPushFn = async (chunk: string) => {
      if (controller.signal.aborted) throw new DOMException('Stream aborted', 'AbortError');
      chunks.push(chunk);
      this.adapter.send({
        id: randomUUID().slice(0, 8),
        type: 'stream_chunk' as WireMessage['type'],
        from: 'sdk',
        channel: channelId,
        payload: { streamId, content: chunk },
        ts: new Date().toISOString(),
      });
    };

    try {
      await callback(push, controller.signal);
      this.adapter.send({
        id: randomUUID().slice(0, 8),
        type: 'stream_end' as WireMessage['type'],
        from: 'sdk',
        channel: channelId,
        payload: { streamId, fullContent: chunks.join('') },
        ts: new Date().toISOString(),
      });
    } catch (err: any) {
      this.adapter.send({
        id: randomUUID().slice(0, 8),
        type: 'stream_abort' as WireMessage['type'],
        from: 'sdk',
        channel: channelId,
        payload: { streamId, reason: err?.message },
        ts: new Date().toISOString(),
      });
    } finally {
      this.activeAbortControllers.delete(streamId);
    }
  }

  onMessage(channelId: string, handler: (msg: WireMessage) => void): () => void {
    if (!this.messageHandlers.has(channelId)) {
      this.messageHandlers.set(channelId, new Set());
    }
    this.messageHandlers.get(channelId)!.add(handler);
    return () => this.messageHandlers.get(channelId)?.delete(handler);
  }

  onMention(handler: (msg: WireMessage) => void): () => void {
    this.signalHandlers.add(handler);
    return () => this.signalHandlers.delete(handler);
  }

  disconnect(): void {
    this.adapter.disconnect();
    this.connected = false;
  }

  private sendAction(action: string, payload: Record<string, unknown>): void {
    this.adapter.send({
      id: randomUUID().slice(0, 8),
      type: 'action' as WireMessage['type'],
      from: 'sdk',
      payload: { action, ...payload },
      ts: new Date().toISOString(),
    });
  }
}
