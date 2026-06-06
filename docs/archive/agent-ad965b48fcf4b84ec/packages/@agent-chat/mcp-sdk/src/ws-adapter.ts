import { EventEmitter } from 'node:events';
import { WebSocket } from 'ws';
import type { WireMessage } from '@agent-chat/types';

export interface WsAdapterOptions {
  /** WebSocket URL including ?token= query param */
  url: string;
  /** Maximum reconnection attempts (default: 10) */
  maxReconnects?: number;
  /** Heartbeat interval in ms (default: 30000) */
  heartbeatInterval?: number;
}

export class WsAdapter extends EventEmitter {
  private ws: WebSocket | null = null;
  private reconnectCount = 0;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private isAlive = false;
  readonly maxReconnects: number;
  readonly heartbeatInterval: number;

  constructor(private opts: WsAdapterOptions) {
    super();
    this.maxReconnects = opts.maxReconnects ?? 10;
    this.heartbeatInterval = opts.heartbeatInterval ?? 30_000;
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.opts.url);

      this.ws.once('open', () => {
        this.isAlive = true;
        this.reconnectCount = 0;
        this.startHeartbeat();
        this.emit('connected');
        resolve();
      });

      this.ws.once('error', (err) => {
        if (!this.isAlive) reject(err);
        else this.emit('error', err);
      });

      this.ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString()) as WireMessage;
          this.emit('message', msg);
          if (msg.channel) this.emit(`channel:${msg.channel}`, msg);
          if (msg.type === 'mention' || msg.type === 'signal') this.emit('signal', msg);
          if (msg.type === 'pong') this.isAlive = true;
        } catch {
          // ignore malformed frames
        }
      });

      this.ws.on('close', () => {
        this.stopHeartbeat();
        this.emit('disconnected');
        this.scheduleReconnect();
      });
    });
  }

  send(msg: WireMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  disconnect(): void {
    this.stopHeartbeat();
    this.ws?.close();
    this.ws = null;
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      if (!this.isAlive) {
        this.ws?.terminate();
        return;
      }
      this.isAlive = false;
      this.ws?.ping();
    }, this.heartbeatInterval);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectCount >= this.maxReconnects) {
      this.emit('maxReconnectsReached');
      return;
    }
    const delay = Math.min(1_000 * 2 ** this.reconnectCount, 30_000);
    this.reconnectCount++;
    setTimeout(() => void this.connect().catch((err) => this.emit('error', err)), delay);
  }
}
