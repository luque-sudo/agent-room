import { randomUUID } from 'node:crypto';
import {
  EntityType,
  EntityRole,
  ChannelType,
  MessageType,
  MessageVisibility,
} from '@agent-chat/types';
import type {
  Entity,
  EntityCredential,
  Channel,
  ChannelMember,
  Message,
} from '@agent-chat/types';
import type {
  IStorageAdapter,
  CreateEntityInput,
  CreateCredentialInput,
  CreateChannelInput,
  SaveMessageInput,
  CreateSessionInput,
} from '../interfaces/storage.js';

export class MemoryAdapter implements IStorageAdapter {
  private entities = new Map<string, Entity>();
  private credentials = new Map<string, EntityCredential[]>();
  private tokenIndex = new Map<string, string>(); // hashedToken -> entityId
  private channels = new Map<string, Channel>();
  private members = new Map<string, Map<string, ChannelMember>>();
  private messages = new Map<string, Message[]>();
  private revokedJtis = new Set<string>();
  private agentInstances = new Map<
    string,
    Map<string, { status: string; lastHeartbeat: string }>
  >();

  async createEntity(data: CreateEntityInput): Promise<Entity> {
    const entity: Entity = {
      id: data.id ?? randomUUID(),
      type: data.type as EntityType,
      name: data.name,
      email: data.email,
      metadata: data.metadata,
      createdAt: new Date().toISOString(),
    };
    this.entities.set(entity.id, entity);
    return entity;
  }

  async findEntityById(id: string): Promise<Entity | null> {
    return this.entities.get(id) ?? null;
  }

  async findEntityByEmail(email: string): Promise<Entity | null> {
    for (const entity of this.entities.values()) {
      if (entity.email === email) return entity;
    }
    return null;
  }

  async findEntityByName(name: string): Promise<Entity | null> {
    for (const entity of this.entities.values()) {
      if (entity.name === name) return entity;
    }
    return null;
  }

  async saveCredential(data: CreateCredentialInput): Promise<void> {
    const cred: EntityCredential = {
      id: randomUUID(),
      entityId: data.entityId,
      type: data.type,
      value: data.value,
      createdAt: new Date().toISOString(),
    };
    const list = this.credentials.get(data.entityId) ?? [];
    const filtered = list.filter((c) => c.type !== data.type);
    filtered.push(cred);
    this.credentials.set(data.entityId, filtered);

    if (data.type === 'agent_token') {
      this.tokenIndex.set(data.value, data.entityId);
    }
  }

  async findCredential(entityId: string, type: string): Promise<EntityCredential | null> {
    const list = this.credentials.get(entityId) ?? [];
    return list.find((c) => c.type === type) ?? null;
  }

  async verifyTokenCredential(hashedToken: string): Promise<Entity | null> {
    const entityId = this.tokenIndex.get(hashedToken);
    if (!entityId) return null;
    return this.findEntityById(entityId);
  }

  async createChannel(data: CreateChannelInput): Promise<Channel> {
    const channel: Channel = {
      id: data.id ?? randomUUID(),
      type: data.type as ChannelType,
      name: data.name,
      description: data.description,
      createdBy: data.createdBy,
      isPublic: data.isPublic ?? false,
      createdAt: new Date().toISOString(),
    };
    this.channels.set(channel.id, channel);
    return channel;
  }

  async findChannelById(id: string): Promise<Channel | null> {
    return this.channels.get(id) ?? null;
  }

  async listChannels(entityId?: string): Promise<Channel[]> {
    const all = Array.from(this.channels.values());
    if (!entityId) return all.filter((c) => c.isPublic);

    const memberOf = new Set<string>();
    for (const [channelId, memberMap] of this.members.entries()) {
      if (memberMap.has(entityId)) memberOf.add(channelId);
    }
    return all.filter((c) => c.isPublic || memberOf.has(c.id));
  }

  async addMember(
    channelId: string,
    entityId: string,
    role: EntityRole,
    isSilent = false
  ): Promise<void> {
    if (!this.members.has(channelId)) this.members.set(channelId, new Map());
    const member: ChannelMember = {
      channelId,
      entityId,
      role,
      isSilent,
      joinedAt: new Date().toISOString(),
    };
    this.members.get(channelId)!.set(entityId, member);
  }

  async removeMember(channelId: string, entityId: string): Promise<void> {
    this.members.get(channelId)?.delete(entityId);
  }

  async findMember(channelId: string, entityId: string): Promise<ChannelMember | null> {
    return this.members.get(channelId)?.get(entityId) ?? null;
  }

  async listMembers(channelId: string): Promise<ChannelMember[]> {
    return Array.from(this.members.get(channelId)?.values() ?? []);
  }

  async updateMemberRole(
    channelId: string,
    entityId: string,
    role: EntityRole
  ): Promise<void> {
    const member = this.members.get(channelId)?.get(entityId);
    if (member) member.role = role;
  }

  async saveMessage(data: SaveMessageInput): Promise<Message> {
    const message: Message = {
      id: data.id ?? randomUUID(),
      channelId: data.channelId,
      senderId: data.senderId,
      type: (data.type as MessageType) ?? MessageType.CHAT,
      content: data.content,
      metadata: data.metadata as Message['metadata'],
      replyTo: data.replyTo,
      visibility: (data.visibility as MessageVisibility) ?? MessageVisibility.PUBLIC,
      createdAt: new Date().toISOString(),
    };
    if (!this.messages.has(data.channelId)) this.messages.set(data.channelId, []);
    this.messages.get(data.channelId)!.push(message);
    return message;
  }

  async findMessageById(id: string): Promise<Message | null> {
    for (const msgs of this.messages.values()) {
      const found = msgs.find((m) => m.id === id);
      if (found) return found;
    }
    return null;
  }

  async listMessages(channelId: string, cursor?: string, limit = 50): Promise<Message[]> {
    const msgs = this.messages.get(channelId) ?? [];
    if (!cursor) return msgs.slice(-limit);
    const idx = msgs.findIndex((m) => m.id === cursor);
    if (idx <= 0) return [];
    return msgs.slice(Math.max(0, idx - limit), idx);
  }

  async createSession(_data: CreateSessionInput): Promise<void> {
    // In memory mode, valid sessions are implied by a valid JWT signature.
    // We only track revocations explicitly.
  }

  async isSessionRevoked(jti: string): Promise<boolean> {
    return this.revokedJtis.has(jti);
  }

  async revokeSession(jti: string): Promise<void> {
    this.revokedJtis.add(jti);
  }

  async upsertAgentInstance(
    entityId: string,
    instanceId: string,
    status: string
  ): Promise<void> {
    if (!this.agentInstances.has(entityId)) {
      this.agentInstances.set(entityId, new Map());
    }
    this.agentInstances.get(entityId)!.set(instanceId, {
      status,
      lastHeartbeat: new Date().toISOString(),
    });
  }

  async heartbeat(instanceId: string): Promise<void> {
    for (const instances of this.agentInstances.values()) {
      if (instances.has(instanceId)) {
        instances.get(instanceId)!.lastHeartbeat = new Date().toISOString();
        return;
      }
    }
  }

  async getOnlineInstances(entityId: string): Promise<string[]> {
    const instances = this.agentInstances.get(entityId);
    if (!instances) return [];
    const now = Date.now();
    return Array.from(instances.entries())
      .filter(([, info]) => {
        const age = now - new Date(info.lastHeartbeat).getTime();
        return info.status !== 'offline' && age < 60_000;
      })
      .map(([id]) => id);
  }
}
