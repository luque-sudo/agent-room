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

      const members = await storage.listMembers(id);
      return reply.send({ channel, members });
    },
  });

  app.post('/:id/members', {
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

      const callerMember = await storage.findMember(id, caller.sub);
      if (!callerMember || ![EntityRole.OWNER, EntityRole.ADMIN].includes(callerMember.role)) {
        return reply.code(403).send({ error: 'Insufficient permissions' });
      }

      const target = await storage.findEntityById(entityId);
      if (!target) return reply.code(404).send({ error: 'Entity not found' });

      await storage.addMember(id, entityId, role ?? EntityRole.MEMBER, isSilent ?? false);

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

      await storage.updateMemberRole(id, entityId, role);
      return reply.send({ message: 'Role updated' });
    },
  });

  app.get('/:id/messages', {
    preHandler: [app.authenticate],
    handler: async (req, reply) => {
      const caller = (req as any).tokenPayload;
      const { id } = req.params as { id: string };
      const { cursor, limit } = req.query as { cursor?: string; limit?: string };

      const channel = await storage.findChannelById(id);
      if (!channel) return reply.code(404).send({ error: 'Channel not found' });

      const member = await storage.findMember(id, caller.sub);
      if (!channel.isPublic && !member) {
        return reply.code(403).send({ error: 'Not a member of this channel' });
      }

      const messages = await storage.listMessages(id, cursor, limit ? Number(limit) : 50);
      return reply.send({ messages, count: messages.length });
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

  app.post('/:id/export', {
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
