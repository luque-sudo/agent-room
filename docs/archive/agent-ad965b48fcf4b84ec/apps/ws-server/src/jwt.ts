import { jwtVerify } from 'jose';
import type { TokenPayload } from '@agent-chat/types';

function getSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET ?? 'dev-secret-change-in-production-min-32-chars!!';
  return new TextEncoder().encode(secret);
}

export async function verifyToken(token: string): Promise<TokenPayload> {
  const { payload } = await jwtVerify(token, getSecret());
  return payload as unknown as TokenPayload;
}
