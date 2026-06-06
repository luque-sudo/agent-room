import { createHash } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createServer as createHttpServer } from 'node:http';
import { z } from 'zod';
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
