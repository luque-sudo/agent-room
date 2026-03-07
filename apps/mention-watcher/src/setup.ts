/**
 * agent-chat-setup
 *
 * Reads credentials from .env in the current directory, calls the api-server
 * to register (or login) and provision a dev agent, then writes the agent token
 * back to .env and updates .mcp.json / .cursor/mcp.json automatically.
 *
 * Claude Code v2+ reads MCP config from .mcp.json at the project root.
 * Cursor reads from .cursor/mcp.json.
 *
 * Usage (from your workspace directory):
 *   agent-chat-setup
 *
 * .env keys read:
 *   API_SERVER_URL      Default: http://localhost:3000
 *   SETUP_EMAIL         Default: admin@localhost
 *   SETUP_PASSWORD      Default: admin123
 *   SETUP_NAME          Default: Admin
 *   SETUP_AGENT_NAME    Default: dev-agent
 *   MCP_SERVER_NAME     Default: agent-chat  (key used in mcp.json)
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';

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

  const API_URL    = env.API_SERVER_URL   ?? 'http://localhost:3000';
  const EMAIL      = env.SETUP_EMAIL      ?? env.ADMIN_EMAIL    ?? 'admin@localhost';
  const PASSWORD   = env.SETUP_PASSWORD   ?? env.ADMIN_PASSWORD ?? 'admin123';
  const NAME       = env.SETUP_NAME       ?? env.ADMIN_NAME     ?? 'Admin';
  const AGENT_NAME = env.SETUP_AGENT_NAME ?? env.AGENT_NAME     ?? 'dev-agent';
  const MCP_NAME   = env.MCP_SERVER_NAME  ?? 'agent-chat';

  console.log(`\nagent-chat setup`);
  console.log(`  API server : ${API_URL}`);
  console.log(`  Account    : ${EMAIL}`);
  console.log(`  Agent name : ${AGENT_NAME}`);
  console.log('');

  // ── Call /auth/setup ────────────────────────────────────────────────────
  let res: Response;
  try {
    res = await fetch(`${API_URL}/auth/setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: NAME, email: EMAIL, password: PASSWORD, agentName: AGENT_NAME }),
    });
  } catch (err: any) {
    console.error(`  ✗ Could not reach API server at ${API_URL}`);
    console.error(`    Make sure the dev server is running: pnpm dev`);
    console.error(`    Error: ${err.message}`);
    process.exit(1);
  }

  if (!res.ok) {
    const body = await res.text();
    console.error(`  ✗ Setup failed (${res.status}): ${body}`);
    process.exit(1);
  }

  const data = await res.json() as {
    entity: { name: string; email: string };
    agentEntity: { name: string };
    agentToken: string;
    accessToken: string;
  };

  console.log(`  ✓ Account  : ${data.entity.name} <${data.entity.email}>`);
  console.log(`  ✓ Agent    : ${data.agentEntity.name}`);
  console.log(`  ✓ Token    : ${data.agentToken}`);
  console.log('');

  // ── Write .env ──────────────────────────────────────────────────────────
  writeEnvFile(envPath, {
    AGENT_TOKEN: data.agentToken,
    BOOTSTRAP_AGENT_TOKEN: data.agentToken,
    API_SERVER_URL: API_URL,
    WS_SERVER_URL: env.WS_SERVER_URL ?? 'ws://localhost:3001',
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
  console.log(`    source .env && pnpm dev`);
  console.log('');
  console.log(`  Then start the mention watcher:`);
  console.log(`    source .env && WATCH_CHANNELS=random agent-chat-watch -- claude`);
  console.log('');
}
