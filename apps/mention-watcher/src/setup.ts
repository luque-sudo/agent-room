/**
 * agent-chat-setup
 *
 * Reads credentials from .env in the current directory:
 *   1. Tries POST /auth/login  (email + password)
 *   2. If the account does not exist, falls back to POST /auth/register
 *      (name + email + password) and creates it automatically.
 *   3. Calls POST /auth/setup to provision (or refresh) an agent token.
 *   4. Writes AGENT_TOKEN back to .env and patches .mcp.json /
 *      .claude/mcp.json / .cursor/mcp.json automatically.
 *
 * Usage (from your workspace directory):
 *   agent-chat-setup
 *
 * .env keys read (all optional — defaults derived from the OS username):
 *   API_SERVER_URL      Default: http://localhost:3000
 *   SETUP_EMAIL         Default: <username>@localhost
 *   SETUP_PASSWORD      Default: <username>123
 *   SETUP_NAME          Default: <Username>
 *   SETUP_AGENT_NAME    Default: <username>-agent
 *   MCP_SERVER_NAME     Default: agent-chat  (key used in mcp.json)
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { userInfo } from 'node:os';

// ── .env parser ──────────────────────────────────────────────────────────────

function loadEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const result: Record<string, string> = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    result[key] = val;
  }
  return result;
}

/** Write/update a set of key=value pairs in a .env file, preserving other lines */
function writeEnvFile(path: string, updates: Record<string, string>): void {
  const existing = existsSync(path) ? readFileSync(path, 'utf8') : '';
  const lines = existing.split('\n');
  const touched = new Set<string>();

  const updated = lines.map((line) => {
    const eq = line.indexOf('=');
    if (eq < 0) return line;
    const key = line.slice(0, eq).trim();
    if (key in updates) {
      touched.add(key);
      return `${key}=${updates[key]}`;
    }
    return line;
  });

  for (const [key, val] of Object.entries(updates)) {
    if (!touched.has(key)) updated.push(`${key}=${val}`);
  }

  writeFileSync(path, updated.filter((l, i) => l !== '' || i < updated.length - 1).join('\n') + '\n');
}

/** Update AGENT_TOKEN inside a mcp.json serverConfig */
function updateMcpConfig(configPath: string, serverName: string, agentToken: string): boolean {
  if (!existsSync(configPath)) return false;
  try {
    const raw = readFileSync(configPath, 'utf8');
    const config = JSON.parse(raw);
    const server = config?.mcpServers?.[serverName];
    if (!server) return false;
    server.env = server.env ?? {};
    server.env.AGENT_TOKEN = agentToken;
    writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
    return true;
  } catch {
    return false;
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

export async function runSetup(): Promise<void> {
  const cwd     = process.cwd();
  const envPath = join(cwd, '.env');
  const fileEnv = loadEnvFile(envPath);
  const env     = { ...fileEnv, ...process.env };

  const sysUser    = userInfo().username ?? 'user';
  const sysName    = sysUser.charAt(0).toUpperCase() + sysUser.slice(1);

  const API_URL    = env.API_SERVER_URL   ?? 'http://localhost:3000';
  const EMAIL      = env.SETUP_EMAIL      ?? env.ADMIN_EMAIL    ?? `${sysUser}@localhost`;
  const PASSWORD   = env.SETUP_PASSWORD   ?? env.ADMIN_PASSWORD ?? `${sysUser}123`;
  const NAME       = env.SETUP_NAME       ?? env.ADMIN_NAME     ?? sysName;
  const AGENT_NAME = env.SETUP_AGENT_NAME ?? env.AGENT_NAME     ?? `${sysUser}-agent`;
  const MCP_NAME   = env.MCP_SERVER_NAME  ?? 'agent-chat';

  console.log(`\nagent-chat setup`);
  console.log(`  API server : ${API_URL}`);
  console.log(`  Account    : ${EMAIL}`);
  console.log(`  Agent name : ${AGENT_NAME}`);
  console.log('');

  // ── Helper: POST JSON ────────────────────────────────────────────────────
  async function post(path: string, body: Record<string, string>): Promise<Response> {
    try {
      return await fetch(`${API_URL}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (err: any) {
      console.error(`  ✗ Could not reach API server at ${API_URL}`);
      console.error(`    Make sure the dev server is running: pnpm dev`);
      console.error(`    Error: ${err.message}`);
      process.exit(1);
    }
  }

  // ── Step 1: Login; register if account does not exist ────────────────────
  let loginRes = await post('/auth/login', { email: EMAIL, password: PASSWORD });

  if (!loginRes.ok) {
    const loginErr = await loginRes.json().catch(() => ({ error: loginRes.statusText })) as any;

    // The server returns 401 for both "wrong password" and "account not found".
    // We always attempt registration on 401/404; if the email is already taken
    // the register endpoint returns 409, which surfaces as a clear error.
    if (loginRes.status !== 401 && loginRes.status !== 404) {
      console.error(`  ✗ Login failed (${loginRes.status}): ${loginErr.error ?? loginRes.statusText}`);
      process.exit(1);
    }

    console.log(`  → No account found, registering as "${NAME}"…`);
    const regRes = await post('/auth/register', { name: NAME, email: EMAIL, password: PASSWORD });

    if (!regRes.ok) {
      const regErr = await regRes.json().catch(() => ({ error: regRes.statusText })) as any;
      console.error(`  ✗ Registration failed (${regRes.status}): ${regErr.error ?? regRes.statusText}`);
      process.exit(1);
    }

    console.log(`  ✓ Registered: ${NAME} <${EMAIL}>`);
    // Re-login to normalise the response shape
    loginRes = await post('/auth/login', { email: EMAIL, password: PASSWORD });
    if (!loginRes.ok) {
      console.error(`  ✗ Login after registration failed`);
      process.exit(1);
    }
  }

  const loginData = await loginRes.json() as { entity: { name: string; email: string } };
  console.log(`  ✓ Logged in: ${loginData.entity.name} <${loginData.entity.email}>`);

  // ── Step 2: Provision (or refresh) the agent token via /auth/setup ───────
  const setupRes = await post('/auth/setup', {
    name: NAME, email: EMAIL, password: PASSWORD, agentName: AGENT_NAME,
  });

  if (!setupRes.ok) {
    const body = await setupRes.text();
    console.error(`  ✗ Agent provisioning failed (${setupRes.status}): ${body}`);
    process.exit(1);
  }

  const data = await setupRes.json() as {
    entity: { name: string; email: string };
    agentEntity: { name: string };
    agentToken: string;
    accessToken: string;
  };

  console.log(`  ✓ Agent    : ${data.agentEntity.name}`);
  console.log(`  ✓ Token    : ${data.agentToken}`);
  console.log('');

  // ── Write .env ──────────────────────────────────────────────────────────
  writeEnvFile(envPath, {
    AGENT_TOKEN: data.agentToken,
    BOOTSTRAP_AGENT_TOKEN: data.agentToken,
    API_SERVER_URL: API_URL,
    WS_SERVER_URL: env.WS_SERVER_URL ?? 'ws://localhost:3001',
    SETUP_EMAIL: EMAIL,
    SETUP_PASSWORD: PASSWORD,
    SETUP_NAME: NAME,
    SETUP_AGENT_NAME: AGENT_NAME,
    WATCH_CHANNELS: env.WATCH_CHANNELS ?? 'general',
  });
  console.log(`  ✓ Written  : ${envPath}`);

  // ── Update MCP configs ──────────────────────────────────────────────────
  // Claude Code v2+ uses .mcp.json at project root; older format uses .claude/mcp.json
  const mcpPaths = [
    join(cwd, '.mcp.json'),
    join(cwd, '.claude', 'mcp.json'),
    join(cwd, '.cursor', 'mcp.json'),
  ];

  for (const p of mcpPaths) {
    if (updateMcpConfig(p, MCP_NAME, data.agentToken)) {
      console.log(`  ✓ Updated  : ${p}`);
    }
  }

  console.log('');
  console.log(`  Restart the dev server to apply the new token:`);
  console.log(process.platform === 'win32'
    ? `    # Windows: load .env vars manually (e.g. dotenv-cli), then: pnpm dev`
    : `    source .env && pnpm dev`);
  console.log('');
  console.log(`  Then start the mention watcher:`);
  console.log(process.platform === 'win32'
    ? `    # Windows: load .env vars manually, then: set WATCH_CHANNELS=random && agent-chat-watch -- claude`
    : `    source .env && WATCH_CHANNELS=random agent-chat-watch -- claude`);
  console.log('');
}
