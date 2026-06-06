import { createStorage } from '@agent-chat/database';
import { createAgentGateway } from './create-server.js';

const storageMode = (process.env.STORAGE_MODE ?? 'memory') as 'memory' | 'postgres';
const storage = createStorage(storageMode);

const transport = (process.env.TRANSPORT ?? 'stdio') as 'stdio' | 'http';
const port = Number(process.env.PORT ?? 3002);

const result = await createAgentGateway(
  { storage },
  { transport, port, wsServerUrl: process.env.WS_SERVER_URL }
);

if (transport === 'http' && 'httpServer' in result && result.httpServer) {
  const host = process.env.HOST ?? '0.0.0.0';
  result.httpServer.listen(port, host, () => {
    console.error(`[agent-gateway] HTTP/MCP server listening on http://${host}:${port}`);
  });
} else {
  console.error('[agent-gateway] Running on stdio transport');
}
