import { createServer as createHttpServer } from 'node:http';
import type { IStorageAdapter, IPubSubAdapter } from '@agent-chat/database';
import { WsGateway } from './gateway.js';

export interface WsServerDeps {
  storage: IStorageAdapter;
  pubsub: IPubSubAdapter;
}

export function createWsServer(deps: WsServerDeps) {
  const gateway = new WsGateway(deps.storage, deps.pubsub);

  const httpServer = createHttpServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        service: 'ws-server',
        ...gateway.getStats(),
        ts: new Date().toISOString(),
      }));
      return;
    }
    res.writeHead(404);
    res.end();
  });

  httpServer.on('upgrade', (req, socket, head) => {
    gateway.handleUpgrade(req, socket as any, head);
  });

  gateway['wss'].on('connection', (ws, req) => {
    void gateway.onConnection(ws, req);
  });

  return { httpServer, gateway };
}
