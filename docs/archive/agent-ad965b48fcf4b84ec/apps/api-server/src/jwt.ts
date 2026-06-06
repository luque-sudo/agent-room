import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import { randomUUID } from 'node:crypto';
import { EntityType } from '@agent-chat/types';
import type { TokenPayload } from '@agent-chat/types';

function getSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET ?? 'dev-secret-change-in-production-min-32-chars!!';
  return new TextEncoder().encode(secret);
}

export async function signAccessToken(
  payload: Omit<TokenPayload, 'jti' | 'iat' | 'exp'>
): Promise<string> {
  const expiry = process.env.JWT_ACCESS_EXPIRY; // omit = no expiry
  const jwt = new SignJWT(payload as unknown as JWTPayload)
    .setProtectedHeader({ alg: 'HS256' })
    .setJti(randomUUID())
    .setIssuedAt();
  if (expiry) jwt.setExpirationTime(expiry);
  return jwt.sign(getSecret());
}

export async function signRefreshToken(entityId: string): Promise<string> {
  return new SignJWT({ sub: entityId, type: 'refresh' } as JWTPayload)
    .setProtectedHeader({ alg: 'HS256' })
    .setJti(randomUUID())
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(getSecret());
}

export async function signAgentToken(
  payload: Omit<TokenPayload, 'jti' | 'iat' | 'exp'>
): Promise<string> {
  // Agent tokens never expire by default (long-lived service credentials)
  const expiry = process.env.JWT_AGENT_EXPIRY;
  const jwt = new SignJWT(payload as unknown as JWTPayload)
    .setProtectedHeader({ alg: 'HS256' })
    .setJti(randomUUID())
    .setIssuedAt();
  if (expiry) jwt.setExpirationTime(expiry);
  return jwt.sign(getSecret());
}

export async function verifyToken(token: string): Promise<TokenPayload> {
  const { payload } = await jwtVerify(token, getSecret());
  return payload as unknown as TokenPayload;
}

export function defaultHumanScopes(): string[] {
  return ['chat', 'stream'];
}

export function defaultAgentScopes(): string[] {
  return ['chat', 'stream', 'observe'];
}

export function adminScopes(): string[] {
  return ['chat', 'stream', 'observe', 'admin'];
}
