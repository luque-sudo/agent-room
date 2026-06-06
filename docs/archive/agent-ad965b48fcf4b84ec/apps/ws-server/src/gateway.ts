import { randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'node:http';
import {
  EntityRole,
  MessageType,
  MessageVisibility,
  canSendMessages,
  isObserver,
} from '@agent-chat/types';
import type { WireMessage, MentionPayload } from '@agent-chat/types';
import type { IStorageAdapter, IPubSubAdapter } from '@agent-chat/database';
import { Topics } from '@agent-chat/database';
import { verifyToken } from './jwt.js';

interface ConnectionInfo {
  id: string;
  entityId: string;
  entityName: string;
  entityType: string;
  scopes: string[];
  ws: WebSocket;
  channels: Set<string>;
  streamSessions: Map<string, { chunkIndex: number }>;
}

function makeWire(
  type: WireMessage['type'] | string,
  from: string,
  payload: unknown,
  channel?: string
): WireMessage {
  return { id: randomUUID().slice(0, 8), type: type as WireMessage['type'], from, channel, payload, ts: new Date().toISOString() };
}

function send(ws: WebSocket, msg: WireMessage): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

export class WsGateway {
  private wss: WebSocketServer;
  private connections = new Map<string, ConnectionInfo>();
  private channelConns = new Map<string, Set<string>>();
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private unsubscribers: Array<() => void> = [];

  constructor(
    private storage: IStorageAdapter,
    private pubsub: IPubSubAdapter
  ) {
    this.wss = new WebSocketServer({ noServer: true });
    this.setupHeartbeat();
  }

  handleUpgrade(req: IncomingMessage, socket: any, head: Buffer): void {
    this.wss.handleUpgrade(req, socket, head, (ws) => {
      this.wss.emit('connection', ws, req);
    });
  }

  async onConnection(ws: WebSocket, req: IncomingMessage): Promise<void> {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    const token = url.searchParams.get('token');

    if (!token) {
      ws.close(4001, 'Missing token');
      return;
    }

    let payload;
    try {
      payload = await verifyToken(token);
    } catch {
      ws.close(4001, 'Invalid or expired token');
      return;
    }

    const revoked = await this.storage.isSessionRevoked(payload.jti);
    if (revoked) {
      ws.close(4001, 'Token revoked');
      return;
    }

    const connId = randomUUID();
    const conn: ConnectionInfo = {
      id: connId,
      entityId: payload.sub,
      entityName: payload.name,
      entityType: payload.type,
      scopes: payload.scopes,
      ws,
      channels: new Set(),
      streamSessions: new Map(),
    };
    this.connections.set(connId, conn);

    if (payload.type === 'AGENT') {
      await this.storage.upsertAgentInstance(payload.sub, connId, 'online');
    }

    // Subscribe to entity-level signals (interrupt, wake-up)
    const unsub = this.pubsub.subscribe(Topics.entity(payload.sub), (msg) => {
      send(ws, msg as WireMessage);
    });
    this.unsubscribers.push(unsub);

    send(ws, makeWire('response', 'system', {
      action: 'connect',
      success: true,
      connectionId: connId,
      entityId: payload.sub,
      entityName: payload.name,
    }));

    ws.on('message', (data) => {
      void this.handleMessage(conn, data.toString());
    });

    ws.on('close', () => {
      void this.onClose(conn);
    });

    ws.on('pong', () => {
      (ws as any)._isAlive = true;
    });

    (ws as any)._isAlive = true;
  }

  private async handleMessage(conn: ConnectionInfo, raw: string): Promise<void> {
    let msg: WireMessage;
    try {
      msg = JSON.parse(raw) as WireMessage;
    } catch {
      send(conn.ws, makeWire('error', 'system', { error: 'Invalid JSON' }));
      return;
    }

    switch (msg.type) {
      case 'ping':
        send(conn.ws, makeWire('pong', 'system', {}));
        break;

      case 'action':
        await this.handleAction(conn, msg);
        break;

      case 'chat':
        await this.handleChat(conn, msg);
        break;

      case 'stream_start':
        await this.handleStreamStart(conn, msg);
        break;

      case 'stream_chunk':
        await this.handleStreamChunk(conn, msg);
        break;

      case 'stream_end':
        await this.handleStreamEnd(conn, msg);
        break;

      case 'stream_abort':
        await this.handleStreamAbort(conn, msg);
        break;

      default:
        send(conn.ws, makeWire('error', 'system', { error: `Unknown message type: ${msg.type}` }));
    }
  }

  private async handleAction(conn: ConnectionInfo, msg: WireMessage): Promise<void> {
    const payload = msg.payload as any;
    const action = payload?.action as string;

    switch (action) {
      case 'join': {
        const channelId = payload.channelId as string;
        if (!channelId) {
          send(conn.ws, makeWire('response', 'system', { action, success: false, error: 'channelId required' }));
          return;
        }

        let channel = await this.storage.findChannelById(channelId);
        if (!channel) {
          channel = await this.storage.createChannel({
            id: channelId,
            type: 'CHANNEL',
            name: channelId,
            createdBy: conn.entityId,
            isPublic: true,
          });
        }

        let member = await this.storage.findMember(channelId, conn.entityId);
        if (!member) {
          const role = channel.createdBy === conn.entityId ? EntityRole.OWNER : EntityRole.MEMBER;
          await this.storage.addMember(channelId, conn.entityId, role);
          member = await this.storage.findMember(channelId, conn.entityId);
        }

        conn.channels.add(channelId);
        if (!this.channelConns.has(channelId)) this.channelConns.set(channelId, new Set());
        this.channelConns.get(channelId)!.add(conn.id);

        // Subscribe to channel pub/sub
        const unsub = this.pubsub.subscribe(Topics.channel(channelId), (wireMsg) => {
          if (conn.channels.has(channelId)) {
            send(conn.ws, wireMsg as WireMessage);
          }
        });
        this.unsubscribers.push(unsub);

        // Notify channel members of join
        const systemMsg = makeWire('signal', 'system', {
          event: 'join',
          entityId: conn.entityId,
          entityName: conn.entityName,
          channelId,
        }, channelId);
        await this.pubsub.publish(Topics.channel(channelId), systemMsg);

        send(conn.ws, makeWire('response', 'system', {
          action,
          success: true,
          channelId,
          channel,
          role: member?.role,
        }));
        break;
      }

      case 'leave': {
        const channelId = payload.channelId as string;
        if (!channelId) return;

        conn.channels.delete(channelId);
        this.channelConns.get(channelId)?.delete(conn.id);

        const systemMsg = makeWire('signal', 'system', {
          event: 'leave',
          entityId: conn.entityId,
          entityName: conn.entityName,
          channelId,
        }, channelId);
        await this.pubsub.publish(Topics.channel(channelId), systemMsg);

        send(conn.ws, makeWire('response', 'system', { action, success: true, channelId }));
        break;
      }

      case 'list_channels': {
        const channels = await this.storage.listChannels(conn.entityId);
        send(conn.ws, makeWire('response', 'system', { action, success: true, channels }));
        break;
      }

      case 'list_members': {
        const channelId = payload.channelId as string;
        const members = await this.storage.listMembers(channelId);
        const enriched = await Promise.all(
          members.map(async (m) => {
            const entity = await this.storage.findEntityById(m.entityId);
            return { ...m, entityName: entity?.name, entityType: entity?.type };
          })
        );
        send(conn.ws, makeWire('response', 'system', { action, success: true, members: enriched }));
        break;
      }

      default:
        send(conn.ws, makeWire('error', 'system', { error: `Unknown action: ${action}` }));
    }
  }

  private async handleChat(conn: ConnectionInfo, msg: WireMessage): Promise<void> {
    const channelId = msg.channel;
    if (!channelId) {
      send(conn.ws, makeWire('error', 'system', { error: 'channel required for chat' }));
      return;
    }

    const member = await this.storage.findMember(channelId, conn.entityId);
    if (!member) {
      send(conn.ws, makeWire('error', 'system', { error: 'Not a member of this channel' }));
      return;
    }

    if (!canSendMessages(member.role)) {
      send(conn.ws, makeWire('error', 'system', { error: 'Insufficient permissions to send messages' }));
      return;
    }

    const payload = msg.payload as any;
    const content = payload?.content as string ?? '';
    const mentions: string[] = payload?.mentions ?? [];
    const replyTo: string | undefined = payload?.replyTo;

    const savedMsg = await this.storage.saveMessage({
      channelId,
      senderId: conn.entityId,
      type: MessageType.CHAT,
      content,
      metadata: { mentions },
      replyTo,
      visibility: isObserver(member.role) ? MessageVisibility.PRIVATE : MessageVisibility.PUBLIC,
    });

    if (!isObserver(member.role)) {
      const wireMsg = makeWire('chat', conn.entityId, {
        messageId: savedMsg.id,
        content,
        mentions,
        replyTo,
        senderName: conn.entityName,
      }, channelId);
      await this.pubsub.publish(Topics.channel(channelId), wireMsg);
    }

    // Detect @mentions and wake up target agents
    await this.processMentions(content, savedMsg.id, channelId, conn);
  }

  private async processMentions(
    content: string,
    messageId: string,
    channelId: string,
    sender: ConnectionInfo
  ): Promise<void> {
    const mentionRegex = /@(\w[\w-]*)/g;
    let match;
    while ((match = mentionRegex.exec(content)) !== null) {
      const targetName = match[1];
      const target = await this.storage.findEntityByName(targetName);
      if (!target) continue;

      const mentionPayload: MentionPayload = {
        mentionedEntityId: target.id,
        mentionedEntityName: target.name,
        channelId,
        messageId,
        fromEntityId: sender.entityId,
        fromEntityName: sender.entityName,
        context: content,
      };

      const wakeSignal = makeWire('mention', 'system', {
        event: 'wake',
        ...mentionPayload,
      });
      await this.pubsub.publish(Topics.entity(target.id), wakeSignal);
    }
  }

  private async handleStreamStart(conn: ConnectionInfo, msg: WireMessage): Promise<void> {
    const channelId = msg.channel;
    const payload = msg.payload as any;
    const streamId = payload?.streamId ?? randomUUID().slice(0, 8);

    if (!channelId) return;

    conn.streamSessions.set(streamId, { chunkIndex: 0 });

    const wireMsg = makeWire('stream_start', conn.entityId, {
      streamId,
      senderName: conn.entityName,
    }, channelId);
    await this.pubsub.publish(Topics.channel(channelId), wireMsg);
    send(conn.ws, makeWire('response', 'system', { action: 'stream_start', success: true, streamId }));
  }

  private async handleStreamChunk(conn: ConnectionInfo, msg: WireMessage): Promise<void> {
    const channelId = msg.channel;
    const payload = msg.payload as any;
    const streamId = payload?.streamId as string;
    const content = payload?.content as string ?? '';

    if (!channelId || !streamId) return;

    const session = conn.streamSessions.get(streamId);
    if (!session) return;

    const chunkIndex = session.chunkIndex++;

    const wireMsg = makeWire('stream_chunk', conn.entityId, {
      streamId,
      chunkIndex,
      content,
      senderName: conn.entityName,
    }, channelId);
    await this.pubsub.publish(Topics.channel(channelId), wireMsg);
  }

  private async handleStreamEnd(conn: ConnectionInfo, msg: WireMessage): Promise<void> {
    const channelId = msg.channel;
    const payload = msg.payload as any;
    const streamId = payload?.streamId as string;
    const fullContent = payload?.fullContent as string ?? '';

    if (!channelId || !streamId) return;

    conn.streamSessions.delete(streamId);

    if (fullContent) {
      await this.storage.saveMessage({
        channelId,
        senderId: conn.entityId,
        type: MessageType.STREAM_END,
        content: fullContent,
        metadata: { streamId, isStreaming: false },
      });
    }

    const wireMsg = makeWire('stream_end', conn.entityId, {
      streamId,
      senderName: conn.entityName,
    }, channelId);
    await this.pubsub.publish(Topics.channel(channelId), wireMsg);
  }

  private async handleStreamAbort(conn: ConnectionInfo, msg: WireMessage): Promise<void> {
    const channelId = msg.channel;
    const payload = msg.payload as any;
    const streamId = payload?.streamId as string;

    if (!channelId || !streamId) return;

    conn.streamSessions.delete(streamId);

    const wireMsg = makeWire('stream_abort', conn.entityId, {
      streamId,
      senderName: conn.entityName,
      aborted: true,
    }, channelId);
    await this.pubsub.publish(Topics.channel(channelId), wireMsg);

    // Also send interrupt signal to the streamer's entity topic
    // so that their agent-gateway can abort the LLM call
    const interruptSignal = makeWire('signal', 'system', {
      event: 'interrupt',
      streamId,
      channelId,
    });
    await this.pubsub.publish(Topics.entity(conn.entityId), interruptSignal);
  }

  private async onClose(conn: ConnectionInfo): Promise<void> {
    this.connections.delete(conn.id);

    for (const channelId of conn.channels) {
      this.channelConns.get(channelId)?.delete(conn.id);
      const leaveMsg = makeWire('signal', 'system', {
        event: 'leave',
        entityId: conn.entityId,
        entityName: conn.entityName,
        channelId,
      }, channelId);
      await this.pubsub.publish(Topics.channel(channelId), leaveMsg);
    }

    if (conn.entityType === 'AGENT') {
      await this.storage.upsertAgentInstance(conn.entityId, conn.id, 'offline');
    }
  }

  private setupHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      for (const conn of this.connections.values()) {
        if ((conn.ws as any)._isAlive === false) {
          conn.ws.terminate();
          return;
        }
        (conn.ws as any)._isAlive = false;
        conn.ws.ping();
      }
    }, 30_000);
  }

  getStats() {
    return {
      connections: this.connections.size,
      channels: this.channelConns.size,
    };
  }

  async close(): Promise<void> {
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    for (const unsub of this.unsubscribers) unsub();
    await this.pubsub.close();
    this.wss.close();
  }
}
