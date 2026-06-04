import { randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';
import type { WireMessage } from '@agent-chat/types';

type MessageHandler = (msg: WireMessage) => void;

export class WsBridge {
  private ws: WebSocket | null = null;
  private channelHandlers = new Map<string, Set<MessageHandler>>();
  private signalHandlers = new Set<MessageHandler>();
  private pendingActions = new Map<string, { resolve: (v: any) => void; reject: (e: any) => void }>();
  private connected = false;
  private reconnectAttempts = 0;
  private readonly maxReconnects = 10;

  constructor(
    private wsUrl: string,
    private token: string
  ) {}

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = `${this.wsUrl}?token=${encodeURIComponent(this.token)}`;
      this.ws = new WebSocket(url);

      this.ws.once('open', () => {
        this.connected = true;
        this.reconnectAttempts = 0;
        resolve();
      });

      this.ws.once('error', (err) => {
        if (!this.connected) reject(err);
      });

      this.ws.on('message', (data) => {
        this.handleIncoming(data.toString());
      });

      this.ws.on('close', () => {
        this.connected = false;
        this.scheduleReconnect();
      });
    });
  }

  private handleIncoming(raw: string): void {
    let msg: WireMessage;
    try {
      msg = JSON.parse(raw) as WireMessage;
    } catch {
      return;
    }

    // Route response to pending action resolver
    if (msg.type === 'response') {
      const payload = msg.payload as any;
      const action = payload?.action as string;
      if (action) {
        const pending = this.pendingActions.get(action);
        if (pending) {
          this.pendingActions.delete(action);
          if (payload.success) {
            pending.resolve(payload);
          } else {
            pending.reject(new Error(payload.error ?? 'Action failed'));
          }
          return;
        }
      }
    }

    // Route to channel handlers
    if (msg.channel) {
      const handlers = this.channelHandlers.get(msg.channel);
      if (handlers) {
        for (const h of handlers) h(msg);
      }
    }

    // Route to signal handlers (mention, interrupt, etc.)
    if (msg.type === 'mention' || msg.type === 'signal') {
      for (const h of this.signalHandlers) h(msg);
    }
  }

  private send(msg: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private async action<T>(action: string, payload: Record<string, unknown>): Promise<T> {
    return new Promise((resolve, reject) => {
      const id = randomUUID().slice(0, 8);
      const key = `${action}_${id}`;
      this.pendingActions.set(action, { resolve, reject });
      setTimeout(() => {
        if (this.pendingActions.has(action)) {
          this.pendingActions.delete(action);
          reject(new Error(`Action "${action}" timed out`));
        }
      }, 10_000);
      this.send({ id, type: 'action', from: 'gateway', payload: { action, ...payload }, ts: new Date().toISOString() });
    });
  }

  async joinChannel(channelId: string): Promise<void> {
    await this.action('join', { channelId });
  }

  async leaveChannel(channelId: string): Promise<void> {
    await this.action('leave', { channelId });
  }

  async listChannels(): Promise<any[]> {
    const res = await this.action<any>('list_channels', {});
    return res.channels ?? [];
  }

  async listMembers(channelId: string): Promise<any[]> {
    const res = await this.action<any>('list_members', { channelId });
    return res.members ?? [];
  }

  sendChat(channelId: string, content: string, mentions?: string[], replyTo?: string): void {
    const id = randomUUID().slice(0, 8);
    this.send({ id, type: 'chat', from: 'gateway', channel: channelId, payload: { content, mentions, replyTo }, ts: new Date().toISOString() });
  }

  async startStream(channelId: string, streamId: string): Promise<void> {
    const id = randomUUID().slice(0, 8);
    this.send({ id, type: 'stream_start', from: 'gateway', channel: channelId, payload: { streamId }, ts: new Date().toISOString() });
  }

  sendChunk(channelId: string, streamId: string, content: string): void {
    const id = randomUUID().slice(0, 8);
    this.send({ id, type: 'stream_chunk', from: 'gateway', channel: channelId, payload: { streamId, content }, ts: new Date().toISOString() });
  }

  endStream(channelId: string, streamId: string, fullContent?: string): void {
    const id = randomUUID().slice(0, 8);
    this.send({ id, type: 'stream_end', from: 'gateway', channel: channelId, payload: { streamId, fullContent }, ts: new Date().toISOString() });
  }

  abortStream(channelId: string, streamId: string): void {
    const id = randomUUID().slice(0, 8);
    this.send({ id, type: 'stream_abort', from: 'gateway', channel: channelId, payload: { streamId }, ts: new Date().toISOString() });
  }

  onChannelMessage(channelId: string, handler: MessageHandler): () => void {
    if (!this.channelHandlers.has(channelId)) this.channelHandlers.set(channelId, new Set());
    this.channelHandlers.get(channelId)!.add(handler);
    return () => this.channelHandlers.get(channelId)?.delete(handler);
  }

  onSignal(handler: MessageHandler): () => void {
    this.signalHandlers.add(handler);
    return () => this.signalHandlers.delete(handler);
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnects) return;
    const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 30_000);
    this.reconnectAttempts++;
    setTimeout(() => void this.connect().catch(() => {}), delay);
  }

  disconnect(): void {
    this.ws?.close();
    this.ws = null;
  }
}
