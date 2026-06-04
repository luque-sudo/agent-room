import { createHash } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { EntityType } from '@agent-chat/types';
import type { IStorageAdapter } from '@agent-chat/database';
import { signAgentToken, defaultAgentScopes } from '../jwt.js';

export async function agentRoutes(
  app: FastifyInstance,
  opts: { storage: IStorageAdapter }
) {
  const { storage } = opts;

  app.post('/', {
    preHandler: [app.authenticate],
    handler: async (req, reply) => {
      const caller = (req as any).tokenPayload;
      if (!caller.scopes.includes('admin')) {
        return reply.code(403).send({ error: 'admin scope required' });
      }

      const { name, metadata } = req.body as {
        name: string;
        metadata?: Record<string, unknown>;
      };

      if (!name) {
        return reply.code(400).send({ error: 'name is required' });
      }

      const existing = await storage.findEntityByName(name);
      if (existing && existing.type === EntityType.AGENT) {
        return reply.code(409).send({ error: 'Agent with this name already exists' });
      }

      const entity = await storage.createEntity({
        type: 'AGENT',
        name,
        metadata,
      });

      const rawToken = randomUUID();
      const hashedToken = createHash('sha256').update(rawToken).digest('hex');

      await storage.saveCredential({
        entityId: entity.id,
        type: 'agent_token',
        value: hashedToken,
      });

      const scopes = defaultAgentScopes();
      const jwtToken = await signAgentToken({
        sub: entity.id,
        type: EntityType.AGENT,
        name: entity.name,
        scopes,
      });

      return reply.code(201).send({
        entity,
        agent_token: rawToken,
        jwt_token: jwtToken,
        note: 'Save agent_token securely — it will not be shown again.',
      });
    },
  });

  app.get('/', {
    preHandler: [app.authenticate],
    handler: async (req, reply) => {
      const caller = (req as any).tokenPayload;
      if (!caller.scopes.includes('admin')) {
        return reply.code(403).send({ error: 'admin scope required' });
      }
      const all = await storage.listEntities();
      const agents = all
        .filter((e) => e.type === EntityType.AGENT)
        .map(({ email: _email, ...pub }) => pub);
      return reply.send({ agents });
    },
  });
}
