import { createServer as createHttpServer } from 'node:http';
import type { IStorageAdapter, IPubSubAdapter } from '@agent-chat/database';
import { Topics } from '@agent-chat/database';
import { WsGateway } from './gateway.js';
import { verifyToken } from './jwt.js';

export interface WsServerDeps {
  storage: IStorageAdapter;
  pubsub: IPubSubAdapter;
}

const SSE_CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

export function createWsServer(deps: WsServerDeps) {
  const gateway = new WsGateway(deps.storage, deps.pubsub);

  const httpServer = createHttpServer(async (req, res) => {
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

    if (req.method === 'OPTIONS' && req.url?.startsWith('/events')) {
      res.writeHead(204, SSE_CORS_HEADERS);
      res.end();
      return;
    }

    if (req.url?.startsWith('/events')) {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const token =
        url.searchParams.get('token') ??
        req.headers.authorization?.replace('Bearer ', '');

      if (!token) {
        res.writeHead(401, SSE_CORS_HEADERS);
        res.end('Unauthorized');
        return;
      }

      let payload;
      try {
        payload = await verifyToken(token);
      } catch {
        res.writeHead(401, SSE_CORS_HEADERS);
        res.end('Invalid token');
        return;
      }

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        ...SSE_CORS_HEADERS,
      });
      res.flushHeaders();

      const write = (msg: unknown) => {
        if (!res.writableEnded) {
          res.write(`data: ${JSON.stringify(msg)}\n\n`);
        }
      };

      write({
        type: 'response',
        payload: {
          action: 'connect',
          success: true,
          entityId: payload.sub,
          entityName: payload.name,
        },
      });

      const channels = await deps.storage.listChannels(payload.sub);
      const unsubs: Array<() => void> = [];

      for (const ch of channels) {
        unsubs.push(deps.pubsub.subscribe(Topics.channel(ch.id), write));
      }
      unsubs.push(deps.pubsub.subscribe(Topics.entity(payload.sub), write));

      req.on('close', () => {
        for (const u of unsubs) u();
      });
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
