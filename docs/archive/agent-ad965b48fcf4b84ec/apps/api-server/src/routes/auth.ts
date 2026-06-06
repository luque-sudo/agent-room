import { createHash } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { EntityType, EntityRole } from '@agent-chat/types';
import type { IStorageAdapter } from '@agent-chat/database';
import {
  signAccessToken,
  signRefreshToken,
  verifyToken,
  defaultHumanScopes,
  defaultAgentScopes,
  adminScopes,
} from '../jwt.js';

/** Tracks whether the first admin has been created in this process lifetime */
let adminBootstrapped = false;

export async function authRoutes(
  app: FastifyInstance,
  opts: { storage: IStorageAdapter }
) {
  const { storage } = opts;

  app.post('/register', async (req, reply) => {
    const { name, email, password } = req.body as {
      name: string;
      email: string;
      password: string;
    };

    if (!name || !email || !password) {
      return reply.code(400).send({ error: 'name, email, and password are required' });
    }

    const existing = await storage.findEntityByEmail(email);
    if (existing) {
      return reply.code(409).send({ error: 'Email already registered' });
    }

    // First registered user becomes admin — check both the in-process flag
    // and whether any entity already exists (handles restarts with persistent storage)
    const isFirstUser = !adminBootstrapped && (await storage.findEntityByEmail(email)) === null;
    if (isFirstUser) adminBootstrapped = true;

    const entity = await storage.createEntity({
      type: 'HUMAN',
      name,
      email,
      metadata: isFirstUser ? { isAdmin: true } : undefined,
    });

    const hash = await bcrypt.hash(password, 10);
    await storage.saveCredential({
      entityId: entity.id,
      type: 'password',
      value: hash,
    });

    const scopes = isFirstUser ? adminScopes() : defaultHumanScopes();
    const accessToken = await signAccessToken({
      sub: entity.id,
      type: EntityType.HUMAN,
      name: entity.name,
      scopes,
    });
    const refreshToken = await signRefreshToken(entity.id);

    return reply.code(201).send({ entity, accessToken, refreshToken });
  });

  app.post('/login', async (req, reply) => {
    const { email, password } = req.body as { email: string; password: string };

    if (!email || !password) {
      return reply.code(400).send({ error: 'email and password are required' });
    }

    const entity = await storage.findEntityByEmail(email);
    if (!entity) {
      return reply.code(401).send({ error: 'Invalid credentials' });
    }

    const cred = await storage.findCredential(entity.id, 'password');
    if (!cred) {
      return reply.code(401).send({ error: 'Invalid credentials' });
    }

    const valid = await bcrypt.compare(password, cred.value);
    if (!valid) {
      return reply.code(401).send({ error: 'Invalid credentials' });
    }

    // Restore admin scopes if this entity was bootstrapped as admin
    const scopes = entity.metadata?.isAdmin ? adminScopes() : defaultHumanScopes();
    const accessToken = await signAccessToken({
      sub: entity.id,
      type: EntityType.HUMAN,
      name: entity.name,
      scopes,
    });
    const refreshToken = await signRefreshToken(entity.id);

    return reply.send({ entity, accessToken, refreshToken });
  });

  /**
   * One-shot setup: register (or login) a human account and provision a dev agent.
   * Idempotent — safe to call repeatedly. Returns the admin JWT and a fresh agent_token.
   */
  app.post('/setup', async (req, reply) => {
    const {
      name     = 'Admin',
      email    = 'admin@localhost',
      password = 'admin123',
      agentName = 'dev-agent',
    } = req.body as {
      name?: string; email?: string; password?: string; agentName?: string;
    };

    // ── 1. Find or create the human account ──────────────────────────────
    let entity = await storage.findEntityByEmail(email);
    if (!entity) {
      const isFirst = !adminBootstrapped;
      if (isFirst) adminBootstrapped = true;
      entity = await storage.createEntity({
        type: 'HUMAN', name, email,
        metadata: isFirst ? { isAdmin: true } : undefined,
      });
      const hash = await bcrypt.hash(password, 10);
      await storage.saveCredential({ entityId: entity.id, type: 'password', value: hash });
    } else {
      const cred = await storage.findCredential(entity.id, 'password');
      if (cred) {
        const ok = await bcrypt.compare(password, cred.value);
        if (!ok) return reply.code(401).send({ error: 'Wrong password for existing account' });
      }
    }

    const scopes = entity.metadata?.isAdmin ? adminScopes() : defaultHumanScopes();
    const accessToken = await signAccessToken({
      sub: entity.id, type: entity.type as any, name: entity.name, scopes,
    });

    // ── 2. Find or create the agent entity ───────────────────────────────
    let agentEntity = await storage.findEntityByName(agentName);
    if (!agentEntity) {
      agentEntity = await storage.createEntity({ type: 'AGENT', name: agentName });
    }

    // ── 3. Issue a new agent_token (replaces the old one via upsert) ─────
    const rawToken = randomUUID();
    const hashedToken = createHash('sha256').update(rawToken).digest('hex');
    await storage.saveCredential({ entityId: agentEntity.id, type: 'agent_token', value: hashedToken });

    return reply.send({
      entity, accessToken,
      agentEntity, agentToken: rawToken,
      note: 'Save agentToken in AGENT_TOKEN — it is not stored in plaintext.',
    });
  });

  // Exchange a raw agent_token for a short-lived JWT (used by mention-watcher and other daemons)
  app.post('/agent-token', async (req, reply) => {
    const { token } = req.body as { token?: string };
    if (!token) return reply.code(400).send({ error: 'token is required' });

    const hashedToken = createHash('sha256').update(token).digest('hex');
    const entity = await storage.verifyTokenCredential(hashedToken);
    if (!entity) return reply.code(401).send({ error: 'Invalid agent token' });

    const scopes = defaultAgentScopes();
    const accessToken = await signAccessToken({
      sub: entity.id,
      type: entity.type,
      name: entity.name,
      scopes,
    });
    return reply.send({ accessToken, entityId: entity.id, entityName: entity.name });
  });

  app.post('/refresh', async (req, reply) => {
    const { refreshToken } = req.body as { refreshToken: string };

    if (!refreshToken) {
      return reply.code(400).send({ error: 'refreshToken is required' });
    }

    try {
      const payload = await verifyToken(refreshToken);
      if ((payload as any).type !== 'refresh') {
        return reply.code(401).send({ error: 'Not a refresh token' });
      }

      const entity = await storage.findEntityById(payload.sub);
      if (!entity) {
        return reply.code(401).send({ error: 'Entity not found' });
      }

      const scopes =
        entity.type === EntityType.HUMAN
          ? (entity.metadata?.isAdmin ? adminScopes() : defaultHumanScopes())
          : defaultAgentScopes();

      const newAccessToken = await signAccessToken({
        sub: entity.id,
        type: entity.type,
        name: entity.name,
        scopes,
      });

      return reply.send({ accessToken: newAccessToken });
    } catch {
      return reply.code(401).send({ error: 'Invalid or expired refresh token' });
    }
  });
}
