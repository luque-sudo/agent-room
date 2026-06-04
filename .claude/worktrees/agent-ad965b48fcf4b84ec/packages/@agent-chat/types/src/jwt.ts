import type { EntityType } from './entities.js';

export interface TokenPayload {
  sub: string;
  type: EntityType;
  name: string;
  scopes: string[];
  jti: string;
  iat?: number;
  exp?: number;
}

export type TokenScope = 'chat' | 'stream' | 'observe' | 'admin';
