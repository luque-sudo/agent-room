import type { FastifyInstance } from 'fastify';
import type { IStorageAdapter } from '@agent-chat/database';

export async function entityRoutes(
  app: FastifyInstance,
  opts: { storage: IStorageAdapter }
) {
  const { storage } = opts;

  app.get('/:id', {
    preHandler: [app.authenticate],
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const entity = await storage.findEntityById(id);
      if (!entity) return reply.code(404).send({ error: 'Entity not found' });

      const { email: _email, ...publicProfile } = entity as any;
      return reply.send({ entity: publicProfile });
    },
  });

  app.get('/me', {
    preHandler: [app.authenticate],
    handler: async (req, reply) => {
      const caller = (req as any).tokenPayload;
      const entity = await storage.findEntityById(caller.sub);
      if (!entity) return reply.code(404).send({ error: 'Entity not found' });
      return reply.send({ entity });
    },
  });
}
