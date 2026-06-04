/**
 * All-in-one local dev server.
 *
 * Starts api-server, ws-server, and agent-gateway in a single Node.js process
 * sharing the SAME MemoryAdapter and LocalPubSub instances — so all services
 * see the same state without needing PostgreSQL or Redis.
 *
 * Ports:
 *   API:     http://localhost:3000
 *   WS:      ws://localhost:3001
 *   Gateway: http://localhost:3002  (MCP HTTP transport)
 *            stdio via: AGENT_TOKEN=xxx tsx apps/agent-gateway/src/index.ts
 */

import { createHash } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { MemoryAdapter, LocalPubSub } from '@agent-chat/database';
import { createApiServer } from '../../api-server/src/create-server.js';
import { createWsServer } from '../../ws-server/src/create-server.js';
import { createAgentGateway } from '../../agent-gateway/src/create-server.js';

const persistFile = process.env.PERSIST_FILE;
const storage = new MemoryAdapter(persistFile);
const pubsub = new LocalPubSub();

const API_PORT = Number(process.env.API_PORT ?? 3000);
const WS_PORT = Number(process.env.WS_PORT ?? 3001);
const GW_PORT = Number(process.env.GW_PORT ?? 3002);
const HOST = process.env.HOST ?? '0.0.0.0';

// ── Bootstrap dev fixtures ───────────────────────────────────────────────
// If BOOTSTRAP_AGENT_TOKEN is set, always recreate a stable admin account
// and a dev agent with that exact token. The MCP config never needs updating.
{
  const token     = process.env.BOOTSTRAP_AGENT_TOKEN;
  const adminEmail = process.env.BOOTSTRAP_ADMIN_EMAIL    ?? 'admin@localhost';
  const adminPw    = process.env.BOOTSTRAP_ADMIN_PASSWORD ?? 'admin123';
  const adminName  = process.env.BOOTSTRAP_ADMIN_NAME     ?? 'Admin';
  const agentName  = process.env.BOOTSTRAP_AGENT_NAME     ?? 'dev-agent';

  if (token) {
    // Admin account
    const existing = await storage.findEntityByEmail(adminEmail);
    if (!existing) {
      const admin = await storage.createEntity({
        type: 'HUMAN', name: adminName, email: adminEmail,
        metadata: { isAdmin: true },
      });
      const hash = await bcrypt.hash(adminPw, 10);
      await storage.saveCredential({ entityId: admin.id, type: 'password', value: hash });
    }

    // Dev agent with deterministic token
    const existingAgent = await storage.findEntityByName(agentName);
    if (!existingAgent) {
      const agent = await storage.createEntity({ type: 'AGENT', name: agentName });
      const hashed = createHash('sha256').update(token).digest('hex');
      await storage.saveCredential({ entityId: agent.id, type: 'agent_token', value: hashed });
    }

    console.log(`[dev-server] Bootstrap: admin="${adminEmail}" / agent="${agentName}" (token stable)`);
  }
}

// ── Start API server ────────────────────────────────────────────────────
const apiServer = await createApiServer({ storage, pubsub });
await apiServer.listen({ port: API_PORT, host: HOST });

// ── Start WS server ─────────────────────────────────────────────────────
const { httpServer: wsHttp } = createWsServer({ storage, pubsub });
wsHttp.listen(WS_PORT, HOST);

// ── Start Agent Gateway (HTTP/MCP transport) ─────────────────────────────
const gwResult = await createAgentGateway(
  { storage },
  {
    transport: 'http',
    port: GW_PORT,
    wsServerUrl: `ws://${HOST === '0.0.0.0' ? '127.0.0.1' : HOST}:${WS_PORT}`,
  }
);
if ('httpServer' in gwResult && gwResult.httpServer) {
  gwResult.httpServer.listen(GW_PORT, HOST);
}

// ── Banner ───────────────────────────────────────────────────────────────
const bootstrapToken = process.env.BOOTSTRAP_AGENT_TOKEN;
const localHost = 'localhost';
console.log(`
┌─────────────────────────────────────────────────────┐
│            agent-chat  •  local dev mode             │
├─────────────────────────────────────────────────────┤
│  API server   →  http://${localHost}:${API_PORT}               │
│  WS gateway   →  ws://${localHost}:${WS_PORT}                │
│  MCP gateway  →  http://${localHost}:${GW_PORT}  (HTTP/MCP)   │
│                                                     │
${persistFile ? `│  Storage: MemoryAdapter  (persist → ${persistFile.slice(0,13).padEnd(13)}) │` : `│  Storage: in-memory (MemoryAdapter — ephemeral)      │`}
│  PubSub:  in-process (LocalPubSub)                  │
│                                                     │
${bootstrapToken
  ? `│  Bootstrap agent token (stable across restarts):   │\n│  ${bootstrapToken.slice(0, 49).padEnd(49)} │`
  : `│  Tip: set BOOTSTRAP_AGENT_TOKEN=<uuid> to keep     │\n│  your MCP token stable across restarts.            │`}
└─────────────────────────────────────────────────────┘
`);

process.on('SIGINT', () => {
  console.log('\n[dev-server] Shutting down...');
  void apiServer.close();
  wsHttp.close();
  process.exit(0);
});
