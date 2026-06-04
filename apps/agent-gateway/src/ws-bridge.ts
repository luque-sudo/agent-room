import { randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';
import type { WireMessage } from '@agent-chat/types';

type MessageHandler = (msg: WireMessage) => void;

export class WsBridge {
  private ws: WebSocket | null = null;
  private channelHandlers = new Map<string, Set<MessageHandler>>();
  private signalHandlers = new Set<MessageHandler>();
  private anyMessageHandlers = new Set<MessageHandler>();
  private pendingActions = new Map<string, Array<{ resolve: (v: any) => void; reject: (e: any) => void; sentAt: number }>>();
  private latencySamples: number[] = [];
  private connected = false;
  private reconnectAttempts = 0;
  private readonly maxReconnects = 10;
  private messageBuffer: Map<string, WireMessage[]> = new Map();
  private readonly MESSAGE_BUFFER_MAX = 50;
  private reconnectToken: string | null = null;

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
        if (this.reconnectToken) {
          this.ws!.send(JSON.stringify({ type: 'action', payload: { action: 'reconnect', reconnectToken: this.reconnectToken } }));
        }
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

      // Handle auth success — extract and store reconnect token
      if (action === 'auth' && payload?.success === true) {
        this.reconnectToken = payload.reconnectToken ?? null;
      }

      // Handle reconnect response
      if (action === 'reconnect') {
        if (payload?.success === true) {
          this.reconnectToken = payload.reconnectToken ?? this.reconnectToken;
        } else {
          console.warn('[WsBridge] Reconnect token rejected by server — clearing stored token');
          this.reconnectToken = null;
        }
      }

      if (action) {
        const queue = this.pendingActions.get(action);
        if (queue && queue.length > 0) {
          const pending = queue.shift()!;
          if (queue.length === 0) this.pendingActions.delete(action);
          this.recordLatency(Date.now() - pending.sentAt);
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

    // Buffer incoming chat messages per channel (sliding window, max 50)
    if (msg.type === 'chat' && msg.channel) {
      this.bufferMessage(msg.channel, msg);
    }

    // Broadcast to any-message listeners
    for (const h of this.anyMessageHandlers) h(msg);

    // Route to signal handlers (mention, interrupt, etc.)
    if (msg.type === 'mention' || msg.type === 'signal') {
      for (const h of this.signalHandlers) h(msg);
    }
  }

  private bufferMessage(channelId: string, msg: WireMessage): void {
    if (!this.messageBuffer.has(channelId)) {
      this.messageBuffer.set(channelId, []);
    }
    const buf = this.messageBuffer.get(channelId)!;
    buf.push(msg);
    if (buf.length > this.MESSAGE_BUFFER_MAX) {
      buf.shift(); // drop oldest
    }
  }

  getBufferedMessages(channelId: string): WireMessage[] {
    return [...(this.messageBuffer.get(channelId) ?? [])];
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
      const sentAt = Date.now();
      if (!this.pendingActions.has(action)) this.pendingActions.set(action, []);
      this.pendingActions.get(action)!.push({ resolve, reject, sentAt });
      setTimeout(() => {
        const queue = this.pendingActions.get(action);
        if (queue) {
          const idx = queue.findIndex(p => p.resolve === resolve);
          if (idx >= 0) {
            queue.splice(idx, 1);
            if (queue.length === 0) this.pendingActions.delete(action);
            reject(new Error(`Action "${action}" timed out`));
          }
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
    this.messageBuffer.delete(channelId);
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
    if (this.ws?.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket not connected — message not sent');
    }
    const id = randomUUID().slice(0, 8);
    this.send({ id, type: 'chat', from: 'gateway', channel: channelId, payload: { content, mentions, replyTo }, ts: new Date().toISOString() });
  }

  startStream(channelId: string, streamId: string): void {
    if (this.ws?.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket not connected — cannot start stream');
    }
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

  onAnyMessage(handler: MessageHandler): () => void {
    this.anyMessageHandlers.add(handler);
    return () => this.anyMessageHandlers.delete(handler);
  }

  isConnected(): boolean {
    return this.connected;
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnects) return;
    const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 30_000);
    this.reconnectAttempts++;
    setTimeout(() => void this.connect().catch(() => {}), delay);
  }

  recordLatency(ms: number): void {
    if (this.latencySamples.length >= 500) {
      this.latencySamples.shift();
    }
    this.latencySamples.push(ms);
  }

  getLatencyPercentiles(): { p50: number | null; p95: number | null; p99: number | null; sampleCount: number } {
    const count = this.latencySamples.length;
    if (count < 5) {
      return { p50: null, p95: null, p99: null, sampleCount: count };
    }
    const sorted = [...this.latencySamples].sort((a, b) => a - b);
    const p50 = Math.round(sorted[Math.floor(sorted.length * 0.50)] * 10) / 10;
    const p95 = Math.round(sorted[Math.floor(sorted.length * 0.95)] * 10) / 10;
    const p99 = Math.round(sorted[Math.floor(sorted.length * 0.99)] * 10) / 10;
    return { p50, p95, p99, sampleCount: count };
  }

  disconnect(): void {
    this.ws?.close();
    this.ws = null;
  }
}
