import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { EntityType } from '@agent-chat/types';
import type { IStorageAdapter } from '@agent-chat/database';

const API_URL = () => process.env.API_SERVER_URL ?? 'http://localhost:3000';

export async function registerHuman(
  params: { name: string; email: string; password: string },
  storage: IStorageAdapter,
  callerScopes: string[]
) {
  const openRegistration = (process.env.OPEN_REGISTRATION ?? 'true') === 'true';

  if (!openRegistration && !callerScopes.includes('admin')) {
    throw new Error('admin scope required when OPEN_REGISTRATION=false');
  }

  const res = await fetch(`${API_URL()}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });

  if (!res.ok) {
    const err = (await res.json()) as any;
    throw new Error(err.error ?? 'Registration failed');
  }

  return res.json();
}

export async function createAgent(
  params: { name: string; metadata?: Record<string, unknown> },
  callerJwt: string,
  callerScopes: string[]
) {
  if (!callerScopes.includes('admin')) {
    throw new Error('admin scope required to create agent entities');
  }

  const res = await fetch(`${API_URL()}/agents`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${callerJwt}`,
    },
    body: JSON.stringify(params),
  });

  if (!res.ok) {
    const err = (await res.json()) as any;
    throw new Error(err.error ?? 'Agent creation failed');
  }

  return res.json();
}

export const RegisterHumanSchema = z.object({
  name: z.string().min(1).describe('Display name for the human account'),
  email: z.string().email().describe('Email address'),
  password: z.string().min(8).describe('Password (min 8 characters)'),
});

export const CreateAgentSchema = z.object({
  name: z.string().min(1).describe('Unique name for the agent entity'),
  metadata: z
    .record(z.unknown())
    .optional()
    .describe('Agent metadata: { model, provider, capabilities, ... }'),
});
