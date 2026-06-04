export enum EntityType {
  HUMAN = 'HUMAN',
  AGENT = 'AGENT',
}

export enum EntityRole {
  OWNER = 'owner',
  ADMIN = 'admin',
  MEMBER = 'member',
  GUEST = 'guest',
  OBSERVER = 'observer',
}

export interface Entity {
  id: string;
  type: EntityType;
  name: string;
  email?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export type CredentialType = 'password' | 'agent_token' | 'oauth_github' | 'oauth_google';

export interface EntityCredential {
  id: string;
  entityId: string;
  type: CredentialType;
  value: string;
  createdAt: string;
}

export interface Session {
  id: string;
  entityId: string;
  jti: string;
  deviceId?: string;
  expiresAt: string;
  createdAt: string;
}

export interface AgentInstance {
  id: string;
  entityId: string;
  status: 'online' | 'idle' | 'busy' | 'offline';
  lastHeartbeat: string;
  metadata?: Record<string, unknown>;
}
