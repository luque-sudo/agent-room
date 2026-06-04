import type { FastifyInstance } from 'fastify';
import { EntityRole } from '@agent-chat/types';
import type { IStorageAdapter } from '@agent-chat/database';

export async function channelRoutes(
  app: FastifyInstance,
  opts: { storage: IStorageAdapter }
) {
  const { storage } = opts;

  app.get('/', {
    preHandler: [app.authenticate],
    handler: async (req, reply) => {
      const caller = (req as any).tokenPayload;
      const channels = await storage.listChannels(caller.sub);
      return reply.send({ channels });
    },
  });

  app.post('/', {
    schema: {
      body: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['DM', 'GROUP', 'CHANNEL'] },
          name: { type: 'string' },
          description: { type: 'string' },
          isPublic: { type: 'boolean' },
          persistent: { type: 'boolean' },
        },
        required: ['type'],
        additionalProperties: false,
      },
    },
    preHandler: [app.authenticate],
    handler: async (req, reply) => {
      const caller = (req as any).tokenPayload;
      const { type, name, description, isPublic } = req.body as {
        type: 'DM' | 'GROUP' | 'CHANNEL';
        name?: string;
        description?: string;
        isPublic?: boolean;
      };

      if (!type || !['DM', 'GROUP', 'CHANNEL'].includes(type)) {
        return reply.code(400).send({ error: 'type must be DM, GROUP, or CHANNEL' });
      }

      const channel = await storage.createChannel({
        type,
        name,
        description,
        createdBy: caller.sub,
        isPublic: isPublic ?? false,
      });

      await storage.addMember(channel.id, caller.sub, EntityRole.OWNER);

      return reply.code(201).send({ channel });
    },
  });

  app.get('/:id', {
    preHandler: [app.authenticate],
    handler: async (req, reply) => {
      const caller = (req as any).tokenPayload;
      const { id } = req.params as { id: string };

      const channel = await storage.findChannelById(id);
      if (!channel) return reply.code(404).send({ error: 'Channel not found' });

      const member = await storage.findMember(id, caller.sub);
      if (!channel.isPublic && !member) {
        return reply.code(403).send({ error: 'Not a member of this channel' });
      }

      const rawMembers = await storage.listMembers(id);
      const members = await Promise.all(
        rawMembers.map(async (m) => {
          const entity = await storage.findEntityById(m.entityId);
          return { ...m, entityName: entity?.name ?? m.entityId };
        })
      );
      return reply.send({ channel, members });
    },
  });

  app.post('/:id/members', {
    schema: {
      body: {
        type: 'object',
        properties: {
          entityId: { type: 'string' },
          role: { type: 'string' },
          isSilent: { type: 'boolean' },
        },
        required: ['entityId'],
        additionalProperties: false,
      },
    },
    preHandler: [app.authenticate],
    handler: async (req, reply) => {
      const caller = (req as any).tokenPayload;
      const { id } = req.params as { id: string };
      const { entityId, role, isSilent } = req.body as {
        entityId: string;
        role?: EntityRole;
        isSilent?: boolean;
      };

      const channel = await storage.findChannelById(id);
      if (!channel) return reply.code(404).send({ error: 'Channel not found' });

      const isSelfJoin = entityId === caller.sub;
      if (!(isSelfJoin && channel.isPublic)) {
        const callerMember = await storage.findMember(id, caller.sub);
        if (!callerMember || ![EntityRole.OWNER, EntityRole.ADMIN].includes(callerMember.role)) {
          return reply.code(403).send({ error: 'Insufficient permissions' });
        }
      }

      const target = await storage.findEntityById(entityId);
      if (!target) return reply.code(404).send({ error: 'Entity not found' });

      const VALID_ROLES = Object.values(EntityRole);
      const lowered = role?.toLowerCase();
      const normalizedRole = (lowered && VALID_ROLES.includes(lowered as EntityRole))
        ? (lowered as EntityRole)
        : EntityRole.MEMBER;
      await storage.addMember(id, entityId, normalizedRole, isSilent ?? false);

      return reply.code(201).send({ message: 'Member added' });
    },
  });

  app.patch('/:id/members/:entityId', {
    preHandler: [app.authenticate],
    handler: async (req, reply) => {
      const caller = (req as any).tokenPayload;
      const { id, entityId } = req.params as { id: string; entityId: string };
      const { role } = req.body as { role: EntityRole };

      const callerMember = await storage.findMember(id, caller.sub);
      if (!callerMember || ![EntityRole.OWNER, EntityRole.ADMIN].includes(callerMember.role)) {
        return reply.code(403).send({ error: 'Insufficient permissions' });
      }

      const VALID_ROLES = Object.values(EntityRole);
      const lowered = role?.toLowerCase();
      if (!lowered || !VALID_ROLES.includes(lowered as EntityRole)) {
        return reply.code(400).send({ error: `Invalid role. Valid values: ${VALID_ROLES.join(', ')}` });
      }
      await storage.updateMemberRole(id, entityId, lowered as EntityRole);
      return reply.send({ message: 'Role updated' });
    },
  });

  app.get('/:id/messages', {
    preHandler: [app.authenticate],
    schema: {
      querystring: {
        type: 'object',
        properties: {
          cursor: { type: 'string' },
          limit: { type: 'integer', minimum: 1, maximum: 200 },
        },
        additionalProperties: false,
      },
    },
    handler: async (req, reply) => {
      const caller = (req as any).tokenPayload;
      const { id } = req.params as { id: string };
      const { cursor, limit } = req.query as { cursor?: string; limit?: number };

      const channel = await storage.findChannelById(id);
      if (!channel) return reply.code(404).send({ error: 'Channel not found' });

      const member = await storage.findMember(id, caller.sub);
      if (!channel.isPublic && !member) {
        return reply.code(403).send({ error: 'Not a member of this channel' });
      }

      const messages = await storage.listMessages(id, cursor, limit ?? 50);
      // nextCursor = oldest message in this page; pass it as ?cursor= to get the previous page
      const nextCursor = messages.length > 0 ? messages[0].id : null;
      return reply.send({ messages, count: messages.length, nextCursor });
    },
  });

  app.get('/:id/context', {
    preHandler: [app.authenticate],
    handler: async (req, reply) => {
      const caller = (req as any).tokenPayload;
      const { id } = req.params as { id: string };
      const { limit } = req.query as { limit?: string };

      const channel = await storage.findChannelById(id);
      if (!channel) return reply.code(404).send({ error: 'Channel not found' });

      const member = await storage.findMember(id, caller.sub);
      if (!channel.isPublic && !member) {
        return reply.code(403).send({ error: 'Not a member of this channel' });
      }

      const messages = await storage.listMessages(id, undefined, limit ? Number(limit) : 20);
      const members = await storage.listMembers(id);

      const memberNames: Record<string, string> = {};
      await Promise.all(
        members.map(async (m) => {
          const entity = await storage.findEntityById(m.entityId);
          if (entity) memberNames[entity.id] = entity.name;
        })
      );

      const contextLines = messages.map((msg) => {
        const senderName = memberNames[msg.senderId] ?? msg.senderId;
        return `[${msg.createdAt}] ${senderName}: ${msg.content}`;
      });

      return reply.send({
        channelId: id,
        channelName: channel.name ?? id,
        memberCount: members.length,
        context: contextLines.join('\n'),
        messages,
      });
    },
  });

  app.get('/:id/export', {
    preHandler: [app.authenticate],
    handler: async (req, reply) => {
      const caller = (req as any).tokenPayload;
      const { id } = req.params as { id: string };

      const channel = await storage.findChannelById(id);
      if (!channel) return reply.code(404).send({ error: 'Channel not found' });

      const member = await storage.findMember(id, caller.sub);
      if (!channel.isPublic && !member) {
        return reply.code(403).send({ error: 'Not a member of this channel' });
      }

      const messages = await storage.listMessages(id, undefined, 1000);
      const members = await storage.listMembers(id);

      const jsonl = messages.map((m) => JSON.stringify(m)).join('\n');

      return reply.send({
        channel,
        members,
        messageCount: messages.length,
        export: jsonl,
      });
    },
  });
}
