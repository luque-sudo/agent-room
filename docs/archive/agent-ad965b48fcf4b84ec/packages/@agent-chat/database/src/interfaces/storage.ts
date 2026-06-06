import type {
  Entity,
  EntityCredential,
  Channel,
  ChannelMember,
  Message,
  EntityRole,
} from '@agent-chat/types';

export interface CreateEntityInput {
  id?: string;
  type: 'HUMAN' | 'AGENT';
  name: string;
  email?: string;
  metadata?: Record<string, unknown>;
}

export interface CreateCredentialInput {
  entityId: string;
  type: 'password' | 'agent_token' | 'oauth_github' | 'oauth_google';
  value: string;
}

export interface CreateChannelInput {
  id?: string;
  type: 'DM' | 'GROUP' | 'CHANNEL';
  name?: string;
  description?: string;
  createdBy: string;
  isPublic?: boolean;
}

export interface SaveMessageInput {
  id?: string;
  channelId: string;
  senderId: string;
  type: string;
  content: string;
  metadata?: Record<string, unknown>;
  replyTo?: string;
  visibility?: string;
}

export interface CreateSessionInput {
  id?: string;
  entityId: string;
  jti: string;
  deviceId?: string;
  expiresAt: string;
}

export interface IStorageAdapter {
  // Entity
  createEntity(data: CreateEntityInput): Promise<Entity>;
  findEntityById(id: string): Promise<Entity | null>;
  findEntityByEmail(email: string): Promise<Entity | null>;
  findEntityByName(name: string): Promise<Entity | null>;

  // Credentials
  saveCredential(data: CreateCredentialInput): Promise<void>;
  findCredential(entityId: string, type: string): Promise<EntityCredential | null>;
  /** Looks up an agent entity by its raw (unhashed) agent_token value */
  verifyTokenCredential(hashedToken: string): Promise<Entity | null>;

  // Channel
  createChannel(data: CreateChannelInput): Promise<Channel>;
  findChannelById(id: string): Promise<Channel | null>;
  listChannels(entityId?: string): Promise<Channel[]>;

  // Channel Members
  addMember(
    channelId: string,
    entityId: string,
    role: EntityRole,
    isSilent?: boolean
  ): Promise<void>;
  removeMember(channelId: string, entityId: string): Promise<void>;
  findMember(channelId: string, entityId: string): Promise<ChannelMember | null>;
  listMembers(channelId: string): Promise<ChannelMember[]>;
  updateMemberRole(channelId: string, entityId: string, role: EntityRole): Promise<void>;

  // Messages
  saveMessage(data: SaveMessageInput): Promise<Message>;
  findMessageById(id: string): Promise<Message | null>;
  listMessages(channelId: string, cursor?: string, limit?: number): Promise<Message[]>;

  // Sessions (JWT revocation support)
  createSession(data: CreateSessionInput): Promise<void>;
  isSessionRevoked(jti: string): Promise<boolean>;
  revokeSession(jti: string): Promise<void>;

  // Agent Instances (presence)
  upsertAgentInstance(entityId: string, instanceId: string, status: string): Promise<void>;
  heartbeat(instanceId: string): Promise<void>;
  getOnlineInstances(entityId: string): Promise<string[]>;
}
