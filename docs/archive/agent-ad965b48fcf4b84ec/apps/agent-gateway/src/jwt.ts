import { SignJWT, jwtVerify } from 'jose';
import { randomUUID } from 'node:crypto';
import type { TokenPayload } from '@agent-chat/types';

function getSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET ?? 'dev-secret-change-in-production-min-32-chars!!';
  return new TextEncoder().encode(secret);
}

/** Issue an internal JWT for ws-server connection — no expiry by default */
export async function issueGatewayJwt(payload: Omit<TokenPayload, 'jti' | 'iat' | 'exp'>): Promise<string> {
  const expiry = process.env.JWT_GATEWAY_EXPIRY;
  const jwt = new SignJWT(payload as any)
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
