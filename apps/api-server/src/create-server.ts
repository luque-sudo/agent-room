import Fastify from 'fastify';
import cors from '@fastify/cors';
import type { IStorageAdapter, IPubSubAdapter } from '@agent-chat/database';
import type { TokenPayload } from '@agent-chat/types';
import { verifyToken } from './jwt.js';
import { authRoutes } from './routes/auth.js';
import { agentRoutes } from './routes/agents.js';
import { channelRoutes } from './routes/channels.js';
import { entityRoutes } from './routes/entities.js';

export interface ApiServerDeps {
  storage: IStorageAdapter;
  pubsub: IPubSubAdapter;
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (req: any, reply: any) => Promise<void>;
  }
}

export async function createApiServer(deps: ApiServerDeps) {
  const { storage } = deps;

  const app = Fastify({
    logger: process.env.LOG_LEVEL
      ? { level: process.env.LOG_LEVEL }
      : process.env.NODE_ENV !== 'production',
    ajv: {
      customOptions: {
        // Default @fastify/ajv-compiler strips additional props instead of rejecting.
        // Setting this to false makes additionalProperties:false actually return 400.
        removeAdditional: false,
      },
    },
  });

  await app.register(cors, {
    origin: process.env.CORS_ORIGIN ?? true,
    credentials: true,
  });

  app.decorate('authenticate', async (req: any, reply: any) => {
    const authHeader = req.headers.authorization as string | undefined;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;

    if (!token) {
      return reply.code(401).send({ error: 'Authorization header required' });
    }

    try {
      const payload = await verifyToken(token);
      const revoked = await storage.isSessionRevoked(payload.jti);
      if (revoked) {
        return reply.code(401).send({ error: 'Token has been revoked' });
      }
      req.tokenPayload = payload;
    } catch {
      return reply.code(401).send({ error: 'Invalid or expired token' });
    }
  });

  app.get('/health', async () => ({
    status: 'ok',
    service: 'api-server',
    ts: new Date().toISOString(),
  }));

  await app.register(authRoutes, { prefix: '/auth', storage });
  await app.register(agentRoutes as any, { prefix: '/agents', storage });
  await app.register(channelRoutes as any, { prefix: '/channels', storage });
  await app.register(entityRoutes as any, { prefix: '/entities', storage });

  return app;
}
