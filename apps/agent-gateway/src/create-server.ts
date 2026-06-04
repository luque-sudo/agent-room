import { createHash, randomUUID } from 'node:crypto';
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createServer as createHttpServer } from 'node:http';
import { z } from 'zod';
import { WebSocket } from 'ws';
import { EntityType } from '@agent-chat/types';
import type { IStorageAdapter } from '@agent-chat/database';
import { WsBridge } from './ws-bridge.js';
import { issueGatewayJwt, verifyToken } from './jwt.js';
import { registerHuman, createAgent, RegisterHumanSchema, CreateAgentSchema } from './tools/account.js';
import { joinChannel, leaveChannel, listChannels, listMembers, getContext, JoinChannelSchema, LeaveChannelSchema, ListMembersSchema, GetContextSchema } from './tools/channel.js';
import { sendMessage, streamOutput, abortStream, readHistory, SendMessageSchema, StreamOutputSchema, AbortStreamSchema, ReadHistorySchema, GetUnreadSchema, WaitForMentionSchema } from './tools/message.js';

export interface AgentGatewayDeps {
  storage: IStorageAdapter;
}

export interface AgentGatewayOptions {
  transport: 'stdio' | 'http';
  port?: number;
  wsServerUrl?: string;
}

export async function createAgentGateway(
  deps: AgentGatewayDeps,
  options: AgentGatewayOptions
) {
  const { storage } = deps;
  const wsUrl = options.wsServerUrl ?? process.env.WS_SERVER_URL ?? 'ws://localhost:3001';
  const activeStreams = new Map<string, AbortController>();

  type MentionWaiter = { resolve: (v: any) => void; channelId?: string };
  const mentionWaiters: MentionWaiter[] = [];
  type MessageWaiter = { resolve: (v: any) => void; channelId: string };
  const messageWaiters: MessageWaiter[] = [];
  const externalConnections = new Map<string, WebSocket>();
  let consecutiveTimeouts = 0;
  const CONTEXT_RESET_THRESHOLD = Number(process.env.MENTION_RESET_THRESHOLD ?? 10);

  function attachSignalHandler(b: WsBridge): void {
    b.onSignal((msg) => {
      const payload = msg.payload as any;

      if (payload?.event === 'interrupt' && payload.streamId) {
        const controller = activeStreams.get(payload.streamId);
        if (controller) {
          controller.abort();
          activeStreams.delete(payload.streamId);
        }
      }

      if (msg.type === 'mention') {
        const idx = mentionWaiters.findIndex(w => !w.channelId || w.channelId === msg.channel);
        if (idx >= 0) {
          const [waiter] = mentionWaiters.splice(idx, 1);
          consecutiveTimeouts = 0;
          waiter.resolve({ mention: true, channelId: msg.channel, ...payload });
        }
      }
    });

    b.onAnyMessage((msg) => {
      if (msg.type === 'chat') {
        const idx = messageWaiters.findIndex(w => w.channelId === msg.channel);
        if (idx >= 0) {
          const [waiter] = messageWaiters.splice(idx, 1);
          waiter.resolve({ received: true, channelId: msg.channel, ...(msg.payload as any) });
        }
      }
    });
  }

  // Per-connection state (for HTTP transport, one per session)
  let bridge: WsBridge | null = null;
  let callerJwt = '';
  let callerScopes: string[] = [];
  let callerEntityId = '';

  async function authenticateToken(rawToken: string): Promise<{
    entityId: string;
    entityName: string;
    entityType: EntityType;
    jwt: string;
    scopes: string[];
  }> {
    // Try JWT first
    try {
      const payload = await verifyToken(rawToken);
      return {
        entityId: payload.sub,
        entityName: payload.name,
        entityType: payload.type,
        jwt: rawToken,
        scopes: payload.scopes,
      };
    } catch {
      // Fall through to agent_token lookup
    }

    // Try agent_token (SHA-256 hash lookup)
    const hashedToken = createHash('sha256').update(rawToken).digest('hex');
    const entity = await storage.verifyTokenCredential(hashedToken);
    if (!entity) throw new Error('Invalid token: not a valid JWT or agent_token');

    const scopes = ['chat', 'stream', 'observe'];
    const jwt = await issueGatewayJwt({
      sub: entity.id,
      type: entity.type,
      name: entity.name,
      scopes,
    });

    return { entityId: entity.id, entityName: entity.name, entityType: entity.type, jwt, scopes };
  }

  const server = new McpServer({
    name: 'agent-chat-gateway',
    version: '0.1.0',
  });

  // ── Account Management ──────────────────────────────────────────────

  server.registerTool('register_human', {
    description: 'Create a new human account. Returns entityId and access token.',
    inputSchema: RegisterHumanSchema,
  }, async (params) => {
    const result = await registerHuman(params as any, storage, callerScopes);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  });

  server.registerTool('create_agent', {
    description: 'Create a new agent entity and issue an agent_token. Requires admin scope.',
    inputSchema: CreateAgentSchema,
  }, async (params) => {
    const result = await createAgent(params as any, callerJwt, callerScopes);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  });

  // ── Channel Management ───────────────────────────────────────────────

  server.registerTool('join_channel', {
    description: 'Join a channel. The channel will be auto-created if it does not exist.',
    inputSchema: JoinChannelSchema,
  }, async (params) => {
    if (!bridge) throw new Error('Not connected. Provide AGENT_TOKEN first.');
    const result = await joinChannel((params as any).channelId, bridge);
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  });

  server.registerTool('leave_channel', {
    description: 'Leave a channel.',
    inputSchema: LeaveChannelSchema,
  }, async (params) => {
    if (!bridge) throw new Error('Not connected.');
    const result = await leaveChannel((params as any).channelId, bridge);
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  });

  server.registerTool('list_channels', {
    description: 'List all accessible channels.',
    inputSchema: z.object({}),
  }, async () => {
    if (!bridge) throw new Error('Not connected.');
    const result = await listChannels(bridge);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  });

  server.registerTool('list_members', {
    description: 'List members of a channel with their roles and online status.',
    inputSchema: ListMembersSchema,
  }, async (params) => {
    if (!bridge) throw new Error('Not connected.');
    const result = await listMembers((params as any).channelId, bridge);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  });

  server.registerTool('get_context', {
    description: 'Fetch recent channel messages formatted as an AI-ready context string.',
    inputSchema: GetContextSchema,
  }, async (params) => {
    if (!callerJwt) throw new Error('Not authenticated.');
    const p = params as any;
    const result = await getContext(p.channelId, p.limit ?? 20, callerJwt);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  });

  // ── Messaging ────────────────────────────────────────────────────────

  server.registerTool('send_message', {
    description: 'Send a message to a channel. Use @name syntax in content to mention entities.',
    inputSchema: SendMessageSchema,
  }, async (params) => {
    if (!bridge) throw new Error('Not connected.');
    const result = await sendMessage(params as any, bridge);
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  });

  server.registerTool('stream_output', {
    description: [
      'Stream content to a channel token-by-token.',
      'Call repeatedly with the same streamId to send chunks.',
      'Set done=true on the final call to close the stream.',
      'First call auto-generates a streamId if omitted.',
    ].join(' '),
    inputSchema: StreamOutputSchema,
  }, async (params) => {
    if (!bridge) throw new Error('Not connected.');
    const result = await streamOutput(params as any, bridge, activeStreams);
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  });

  server.registerTool('abort_stream', {
    description: 'Abort an active streaming session.',
    inputSchema: AbortStreamSchema,
  }, async (params) => {
    if (!bridge) throw new Error('Not connected.');
    const result = await abortStream(params as any, bridge, activeStreams);
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  });

  server.registerTool('read_history', {
    description: 'Read recent message history from a channel.',
    inputSchema: ReadHistorySchema,
  }, async (params) => {
    if (!callerJwt) throw new Error('Not authenticated.');
    const p = params as any;
    const result = await readHistory(p.channelId, p.limit ?? 20, p.cursor, callerJwt);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  });

  server.registerTool('wait_for_mention', {
    description: [
      'Block until this agent is @mentioned in a channel, or until the timeout expires.',
      '',
      'CRITICAL BEHAVIOR RULES — follow exactly:',
      '1. result.timeout === true AND result.suggest_context_reset is absent:',
      '   Call wait_for_mention again IMMEDIATELY. Do NOT emit any text, reasoning, or commentary between calls.',
      '2. result.suggest_context_reset === true:',
      '   Write exactly 1-2 sentences summarising work done so far, then immediately call wait_for_mention again.',
      '   This checkpoint prevents context-window overflow.',
      '3. result.mention === true:',
      '   Process the mention. Reply using send_message or stream_output.',
      '   After replying, call wait_for_mention again to keep listening.',
      '',
      'Do NOT exit the loop unless the user explicitly asks you to stop.',
    ].join('\n'),
    inputSchema: WaitForMentionSchema,
  }, async (params) => {
    if (!bridge) throw new Error('Not connected. Call authenticate first.');
    const p = params as any;

    const result = await new Promise<any>((resolve) => {
      const waiterResolve = (v: any) => { clearTimeout(timer); resolve(v); };
      const timer = setTimeout(() => {
        const idx = mentionWaiters.findIndex(w => w.resolve === waiterResolve);
        if (idx >= 0) mentionWaiters.splice(idx, 1);
        consecutiveTimeouts++;
        const suggest = consecutiveTimeouts >= CONTEXT_RESET_THRESHOLD;
        if (suggest) consecutiveTimeouts = 0;
        resolve({ timeout: true, ...(suggest ? { suggest_context_reset: true } : {}) });
      }, (p.timeout ?? 55) * 1000);

      mentionWaiters.push({ resolve: waiterResolve, channelId: p.channelId });
    });

    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  });

  server.registerTool('wait_for_message', {
    description: 'Block until any message is received in a specific channel, or until timeout.',
    inputSchema: z.object({
      channelId: z.string().describe('Channel ID to wait for a message in'),
      timeout: z.number().int().min(5).max(120).default(55).describe('Seconds to wait'),
    }),
  }, async (params) => {
    if (!bridge) throw new Error('Not connected.');
    const p = params as any;
    const result = await new Promise<any>((resolve) => {
      const timer = setTimeout(() => {
        const idx = messageWaiters.findIndex(w => w.channelId === p.channelId);
        if (idx >= 0) messageWaiters.splice(idx, 1);
        resolve({ timeout: true, channelId: p.channelId });
      }, (p.timeout ?? 55) * 1000);
      messageWaiters.push({
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        channelId: p.channelId,
      });
    });
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  });

  server.registerTool('get_unread', {
    description: 'Get messages since a specific timestamp (ISO-8601).',
    inputSchema: GetUnreadSchema,
  }, async (params) => {
    if (!callerJwt) throw new Error('Not authenticated.');
    const p = params as any;
    const since = p.since ?? new Date(Date.now() - 5 * 60_000).toISOString();
    const result = await readHistory(p.channelId, 50, undefined, callerJwt) as any;
    const messages = ((result as any).messages ?? []).filter(
      (m: any) => m.createdAt >= since
    );
    return { content: [{ type: 'text', text: JSON.stringify({ messages, since }) }] };
  });

  // ── Streaming / External Connections ─────────────────────────────────

  server.registerTool('connect_stream', {
    description: 'Connect to an external WebSocket URL and bridge incoming messages to a channel.',
    inputSchema: z.object({
      url: z.string().url().describe('External WebSocket URL to connect to'),
      channelId: z.string().describe('Channel to forward messages to'),
      connectionId: z.string().optional().describe('ID for this connection (auto-generated if omitted)'),
      headers: z.record(z.string()).optional().describe('Optional HTTP headers for the WS handshake'),
    }),
  }, async (params) => {
    if (!bridge) throw new Error('Not connected.');
    const p = params as any;
    const connId = (p.connectionId as string | undefined) ?? randomUUID().slice(0, 8);

    const parsedUrl = new URL(p.url as string);
    if (!['ws:', 'wss:'].includes(parsedUrl.protocol)) {
      throw new Error(`connect_stream only accepts ws:// or wss:// URLs (got: ${parsedUrl.protocol})`);
    }

    const extWs = new WebSocket(p.url as string, { headers: (p.headers ?? {}) as Record<string, string> });
    externalConnections.set(connId, extWs);

    await new Promise<void>((resolve, reject) => {
      extWs.once('open', resolve);
      extWs.once('error', (err) => {
        externalConnections.delete(connId);
        reject(err);
      });
    });

    extWs.on('message', (data) => {
      const text = (data as Buffer).toString();
      bridge!.sendChat(p.channelId as string, `[ext:${connId}] ${text}`);
    });

    extWs.on('close', () => {
      externalConnections.delete(connId);
      bridge!.sendChat(p.channelId as string, `[ext:${connId}] Connection closed`);
    });

    return { content: [{ type: 'text', text: JSON.stringify({ success: true, connectionId: connId, url: p.url, channelId: p.channelId }, null, 2) }] };
  });

  server.registerTool('disconnect_stream', {
    description: 'Disconnect a previously established external WebSocket connection.',
    inputSchema: z.object({
      connectionId: z.string().describe('Connection ID returned by connect_stream'),
    }),
  }, async (params) => {
    const p = params as any;
    const ws = externalConnections.get(p.connectionId as string);
    if (!ws) throw new Error(`No connection with ID: ${p.connectionId}`);
    ws.close();
    externalConnections.delete(p.connectionId as string);
    return { content: [{ type: 'text', text: JSON.stringify({ success: true, connectionId: p.connectionId }, null, 2) }] };
  });

  // ── Convenience: connect + join in one step ───────────────────────────

  server.registerTool('connect_service', {
    description: 'Connect to the AgentRoom service and join a channel. Convenience wrapper: verifies auth, joins the specified channel, and returns channel info. Use this before send_message or wait_for_message.',
    inputSchema: z.object({
      channelId: z.string().describe('The channel ID or name to join'),
    }),
  }, async (params) => {
    if (!bridge || !bridge.isConnected()) {
      throw new Error('Not connected. Call authenticate first to establish a connection.');
    }
    const { channelId } = params as { channelId: string };
    const result = await joinChannel(channelId, bridge);
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          channelId: result.channelId,
          message: `Connected to channel ${result.channelId}`,
        }, null, 2),
      }],
    };
  });

  // ── Item F: list_connections tool ────────────────────────────────────

  server.registerTool('list_connections', {
    description: 'List all active channel connections for this gateway session. Returns channel IDs the gateway has joined, auth state, and WS connection status.',
    inputSchema: z.object({}),
  }, async () => {
    if (!bridge) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ connected: false, note: 'Not authenticated. Call authenticate first.' }, null, 2),
        }],
      };
    }
    const channels = await bridge.listChannels().catch(() => []);
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          connected: bridge.isConnected(),
          channels,
        }, null, 2),
      }],
    };
  });

  // ── Auth tool (bootstrap) ─────────────────────────────────────────────

  server.registerTool('authenticate', {
    description: 'Authenticate with an agent_token or JWT to connect to the ws-server. Call this before using channel/messaging tools.',
    inputSchema: z.object({
      token: z.string().describe('agent_token or JWT access token'),
    }),
  }, async (params) => {
    const { entityId, entityName, entityType, jwt, scopes } = await authenticateToken((params as any).token);

    callerJwt = jwt;
    callerScopes = scopes;
    callerEntityId = entityId;

    bridge = new WsBridge(wsUrl, jwt);
    await bridge.connect();
    attachSignalHandler(bridge);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          entityId,
          entityName,
          entityType,
          scopes,
          wsServerUrl: wsUrl,
        }, null, 2),
      }],
    };
  });

  // ── MCP Resources ─────────────────────────────────────────────────────

  server.registerResource('connection-status', 'connection://status', {
    description: 'Current gateway connection state: authenticated entity, WS URL, scopes, external connections',
    mimeType: 'application/json',
  }, async () => {
    return {
      contents: [{
        uri: 'connection://status',
        mimeType: 'application/json',
        text: JSON.stringify({
          authenticated: !!callerJwt,
          entityId: callerEntityId || null,
          wsServerUrl: wsUrl,
          scopes: callerScopes,
          bridgeConnected: bridge?.isConnected() ?? false,
          externalConnections: Array.from(externalConnections.keys()),
        }, null, 2),
      }],
    };
  });

  server.registerResource('metrics-snapshot', 'metrics://snapshot', {
    description: 'Gateway metrics: message waiters, mention waiters, active streams, external connections',
    mimeType: 'application/json',
  }, async () => {
    return {
      contents: [{
        uri: 'metrics://snapshot',
        mimeType: 'application/json',
        text: JSON.stringify({
          mentionWaiters: mentionWaiters.length,
          messageWaiters: messageWaiters.length,
          activeStreams: activeStreams.size,
          externalConnections: externalConnections.size,
          consecutiveTimeouts,
          latency: bridge ? bridge.getLatencyPercentiles() : { p50: null, p95: null, p99: null, sampleCount: 0 },
        }, null, 2),
      }],
    };
  });

  // ── Item E: per-channel connection status resource ────────────────────

  server.registerResource(
    'channel-connection-status',
    new ResourceTemplate('connection://{channelId}/status', { list: undefined }),
    {
      description: 'Connection status for a specific channel. Returns whether the gateway is subscribed to this channel.',
      mimeType: 'application/json',
    },
    async (uri, variables) => {
      const channelId = variables['channelId'] as string;
      let subscribed = false;
      if (bridge) {
        try {
          const channels = await bridge.listChannels();
          subscribed = (channels as any[]).some(
            (ch) => (typeof ch === 'string' ? ch : ch?.id ?? ch?.channelId) === channelId
          );
        } catch {
          // listChannels failed; fall through with subscribed = false
        }
      }
      return {
        contents: [{
          uri: uri.toString(),
          mimeType: 'application/json',
          text: JSON.stringify({
            channelId,
            subscribed,
            connected: bridge?.isConnected() ?? false,
          }, null, 2),
        }],
      };
    }
  );

  // ── Item D: stream per-channel recent / latest message resources ──────

  server.registerResource(
    'channel-messages-recent',
    new ResourceTemplate('stream://{channelId}/messages/recent', { list: undefined }),
    {
      description: 'Last 50 messages in a channel. Read this resource to review recent chat history without calling read_history tool.',
      mimeType: 'application/json',
    },
    async (uri, variables) => {
      const channelId = variables['channelId'] as string;
      if (!callerJwt) {
        return {
          contents: [{
            uri: uri.toString(),
            mimeType: 'application/json',
            text: JSON.stringify({
              channelId,
              note: 'Not authenticated. Call authenticate first, then use the read_history tool to retrieve messages.',
            }, null, 2),
          }],
        };
      }
      const buffered = bridge ? bridge.getBufferedMessages(channelId) : [];
      if (buffered.length > 0) {
        return {
          contents: [{
            uri: uri.toString(),
            mimeType: 'application/json',
            text: JSON.stringify({ messages: buffered, source: 'buffer' }, null, 2),
          }],
        };
      }
      const result = await readHistory(channelId, 50, undefined, callerJwt);
      return {
        contents: [{
          uri: uri.toString(),
          mimeType: 'application/json',
          text: JSON.stringify(result, null, 2),
        }],
      };
    }
  );

  server.registerResource(
    'channel-messages-latest',
    new ResourceTemplate('stream://{channelId}/messages/latest', { list: undefined }),
    {
      description: 'The single most recent message in a channel.',
      mimeType: 'application/json',
    },
    async (uri, variables) => {
      const channelId = variables['channelId'] as string;
      if (!callerJwt) {
        return {
          contents: [{
            uri: uri.toString(),
            mimeType: 'application/json',
            text: JSON.stringify({
              channelId,
              note: 'Not authenticated. Call authenticate first, then use the read_history tool to retrieve messages.',
            }, null, 2),
          }],
        };
      }
      const result = await readHistory(channelId, 1, undefined, callerJwt) as { messages?: any[] };
      const latest = result?.messages?.[0] ?? null;
      return {
        contents: [{
          uri: uri.toString(),
          mimeType: 'application/json',
          text: JSON.stringify({ channelId, message: latest }, null, 2),
        }],
      };
    }
  );

  if (options.transport === 'stdio') {
    // For stdio, read AGENT_TOKEN from env and auto-authenticate
    const envToken = process.env.AGENT_TOKEN;
    if (envToken) {
      try {
        const { entityId, entityName, entityType, jwt, scopes } = await authenticateToken(envToken);
        callerJwt = jwt;
        callerScopes = scopes;
        callerEntityId = entityId;
        bridge = new WsBridge(wsUrl, jwt);
        await bridge.connect();
        attachSignalHandler(bridge);
        process.stderr.write(`[agent-gateway] Authenticated as ${entityName} (${entityType})\n`);
      } catch (err: any) {
        process.stderr.write(`[agent-gateway] Warning: AGENT_TOKEN auth failed: ${err.message}\n`);
      }
    }

    const transport = new StdioServerTransport();
    await server.connect(transport);
    return { server, transport };
  } else {
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => crypto.randomUUID() });
    const httpServer = createHttpServer((req, res) => {
      if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', service: 'agent-gateway' }));
        return;
      }
      void transport.handleRequest(req, res);
    });
    await server.connect(transport);
    return { server, transport, httpServer };
  }
}
