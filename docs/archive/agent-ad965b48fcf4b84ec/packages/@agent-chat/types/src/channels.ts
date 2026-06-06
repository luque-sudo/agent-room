import type { EntityRole } from './entities.js';

export enum ChannelType {
  DM = 'DM',
  GROUP = 'GROUP',
  CHANNEL = 'CHANNEL',
}

export interface Channel {
  id: string;
  type: ChannelType;
  name?: string;
  description?: string;
  createdBy: string;
  isPublic: boolean;
  createdAt: string;
}

export interface ChannelMember {
  channelId: string;
  entityId: string;
  role: EntityRole;
  isSilent: boolean;
  joinedAt: string;
}
