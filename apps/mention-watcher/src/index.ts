/**
 * mention-watcher: PTY wrapper for Claude Code (or any LLM CLI).
 *
 * Spawns the target command inside a pseudo-terminal, forwards all I/O so the
 * user interacts normally, and injects @mention prompts from the ws-server
 * whenever someone mentions the configured agent in a channel.
 *
 * Usage:
 *   AGENT_TOKEN=xxx pnpm watch [-- claude [extra-claude-flags]]
 *   AGENT_TOKEN=xxx pnpm watch [-- cursor agent]
 *
 * Environment variables:
 *   AGENT_TOKEN        Required. Agent JWT or raw agent_token.
 *   WS_SERVER_URL      Default: ws://localhost:3001
 *   API_SERVER_URL     Default: http://localhost:3000
 *   WATCH_CHANNELS     Comma-separated channels to join (optional, for context).
 *   INJECT_IDLE_MS     Milliseconds of output silence before injecting. Default 800.
 *   MCP_SERVER_NAME    Name of the MCP server in Claude config. Default: agent-chat.
 *   WORKSPACE_DIR      Working directory for the spawned CLI. Auto-detected by walking
 *                      up from cwd looking for .claude/mcp.json / .cursor/mcp.json /
 *                      .git. Override only if auto-detection picks the wrong directory.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { spawn } from 'node:child_process';
import * as pty from 'node-pty';
import { WebSocket } from 'ws';
import type { WireMessage } from '@agent-chat/types';

// ── .env loader ─────────────────────────────────────────────────────────────

function loadEnvFile(filePath: string): Record<string, string> {
  if (!fs.existsSync(filePath)) return {};
  const result: Record<string, string> = {};
  for (const line of fs.readFileSync(filePath, 'utf8').split('\n')) {
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

/**
 * Sync AGENT_TOKEN from .env into the Claude MCP config files for the given
 * workspace. Only writes when the stored token differs from the .env value.
 * Only the target server entry is touched — all other mcpServers are preserved.
 */
function syncMcpToken(
  workspaceDir: string,
  mcpServerName: string,
  preferredToken?: string,
): void {
  const envVars = loadEnvFile(path.join(workspaceDir, '.env'));
  const envToken =
    preferredToken ??
    process.env.AGENT_TOKEN ??
    envVars.AGENT_TOKEN ??
    envVars.BOOTSTRAP_AGENT_TOKEN;
  if (!envToken) return;

  // Sync across common project-level MCP config files.
  const mcpPaths = [
    path.join(workspaceDir, '.mcp.json'),
    path.join(workspaceDir, '.claude', 'mcp.json'),
    path.join(workspaceDir, '.cursor', 'mcp.json'),
  ];

  for (const configPath of mcpPaths) {
    if (!fs.existsSync(configPath)) continue;

    let config: Record<string, any>;
    try {
      config = JSON.parse(fs.readFileSync(configPath, 'utf8')) as Record<string, any>;
    } catch {
      process.stderr.write(`[mention-watcher] Could not parse ${configPath}, skipping\n`);
      continue;
    }

    const servers = config?.mcpServers;
    if (!servers || typeof servers !== 'object') {
      process.stderr.write(`[mention-watcher] No mcpServers in ${configPath}, skipping\n`);
      continue;
    }

    const explicit = servers[mcpServerName];
    const candidates = new Set<string>();
    if (explicit) candidates.add(mcpServerName);

    // Fallback: if server name differs, match common gateway command signatures.
    for (const [name, server] of Object.entries<any>(servers)) {
      const command = String(server?.command ?? '');
      const args = Array.isArray(server?.args) ? server.args.map((a: unknown) => String(a)).join(' ') : '';
      const signature = `${command} ${args}`;
      if (signature.includes('agent-gateway') || signature.includes('@agent-chat')) {
        candidates.add(name);
      }
    }

    if (candidates.size === 0) {
      process.stderr.write(
        `[mention-watcher] No matching MCP server in ${configPath} (expected "${mcpServerName}")\n`,
      );
      continue;
    }

    let changed = false;
    let updatedCount = 0;
    for (const name of candidates) {
      const server = servers[name] ?? {};
      server.env = server.env ?? {};
      const tokenBefore = server.env.AGENT_TOKEN;
      const bootstrapBefore = server.env.BOOTSTRAP_AGENT_TOKEN;
      if (tokenBefore !== envToken || bootstrapBefore !== envToken) {
        server.env.AGENT_TOKEN = envToken;
        server.env.BOOTSTRAP_AGENT_TOKEN = envToken;
        servers[name] = server;
        changed = true;
      }
      updatedCount += 1;
    }

    if (!changed) {
      process.stderr.write(`[mention-watcher] MCP token up-to-date: ${configPath}\n`);
      continue;
    }

    try {
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
      process.stderr.write(`[mention-watcher] MCP token synced (${updatedCount} server): ${configPath}\n`);
    } catch (err: any) {
      process.stderr.write(`[mention-watcher] Failed to write ${configPath}: ${err.message}\n`);
    }
  }
}

// ── Workspace detection ─────────────────────────────────────────────────────

/**
 * Walk up from cwd looking for a directory that contains .claude/mcp.json or
 * .cursor/mcp.json — the same markers Claude Code / Cursor use for project-level
 * MCP config.  Falls back to cwd if nothing is found (e.g. global invocation).
 */
function detectWorkspaceDir(): string {
  // Only match project-level MCP config files — NOT bare .claude/.cursor dirs,
  // which exist at ~ for global installs and would incorrectly point to home.
  const markers = [
    '.mcp.json',                        // Claude Code project MCP config (v2+)
    path.join('.claude', 'mcp.json'),   // older Claude Code format
    path.join('.cursor', 'mcp.json'),   // Cursor
    '.git',                             // git repo root
  ];
  const home = os.homedir();
  let dir = process.cwd();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    for (const marker of markers) {
      if (fs.existsSync(path.join(dir, marker))) return dir;
    }
    const parent = path.dirname(dir);
    // Never walk above the home directory to avoid matching ~/.git, etc.
    if (parent === dir || dir === home) break;
    dir = parent;
  }
  return process.cwd();
}

function buildPtyEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (typeof v !== 'string') continue;
    if (k.includes('\0') || v.includes('\0')) continue;
    // npm/pnpm inject many vars in `npm run`, which can make posix_spawnp fragile.
    if (/^(npm_|npm_config_|npm_package_|npm_lifecycle_|PNPM_|pnpm_)/.test(k)) continue;
    out[k] = v;
  }

  if (!out.PATH && typeof env.PATH === 'string') out.PATH = env.PATH;
  if (!out.HOME && typeof env.HOME === 'string') out.HOME = env.HOME;
  if (!out.SHELL && typeof env.SHELL === 'string') out.SHELL = env.SHELL;
  if (!out.TERM) out.TERM = 'xterm-256color';
  return out;
}

type TerminalProcess = {
  mode: 'pty' | 'script-pty' | 'plain';
  write: (data: string) => void;
  onData: (cb: (data: string) => void) => void;
  onExit: (cb: ({ exitCode }: { exitCode: number }) => void) => void;
  resize: (cols: number, rows: number) => void;
  kill?: (signal?: string) => void;
};

function spawnViaScriptPty(
  command: string,
  args: string[],
  cwd: string,
  env: Record<string, string>,
): TerminalProcess {
  // macOS `script` allocates a pseudo terminal for the child command.
  const child = spawn('script', ['-q', '/dev/null', command, ...args], {
    cwd,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  return {
    mode: 'script-pty',
    write(data: string) {
      if (!child.stdin.destroyed) child.stdin.write(data);
    },
    onData(cb: (data: string) => void) {
      child.stdout.on('data', (buf: Buffer) => cb(buf.toString()));
      child.stderr.on('data', (buf: Buffer) => cb(buf.toString()));
    },
    onExit(cb: ({ exitCode }: { exitCode: number }) => void) {
      child.on('exit', (code) => cb({ exitCode: code ?? 1 }));
      child.on('error', () => cb({ exitCode: 1 }));
    },
    // Resize is not supported through the `script` wrapper.
    resize() {},
    kill(signal?: string) {
      try {
        child.kill((signal as NodeJS.Signals | undefined) ?? 'SIGINT');
      } catch {
        // ignore
      }
    },
  };
}

function spawnWithoutPty(
  command: string,
  args: string[],
  cwd: string,
  env: Record<string, string>,
): TerminalProcess {
  const child = spawn(command, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
  return {
    mode: 'plain',
    write(data: string) {
      if (!child.stdin.destroyed) child.stdin.write(data);
    },
    onData(cb: (data: string) => void) {
      child.stdout.on('data', (buf: Buffer) => cb(buf.toString()));
      child.stderr.on('data', (buf: Buffer) => cb(buf.toString()));
    },
    onExit(cb: ({ exitCode }: { exitCode: number }) => void) {
      child.on('exit', (code) => cb({ exitCode: code ?? 1 }));
      child.on('error', () => cb({ exitCode: 1 }));
    },
    resize() {},
    kill(signal?: string) {
      try {
        child.kill((signal as NodeJS.Signals | undefined) ?? 'SIGINT');
      } catch {
        // ignore
      }
    },
  };
}


// Workspace = where the user ran the command from.
// detectWorkspaceDir() is kept for the WORKSPACE_DIR env-var override path only.
const _WORKSPACE = process.env.WORKSPACE_DIR ?? process.cwd();
{
  // Deduplicated list: cwd first (more specific), then workspace root
  const dirsToCheck = [...new Set([process.cwd(), _WORKSPACE])];
  for (const dir of dirsToCheck) {
    const envPath = path.join(dir, '.env');
    const fileEnv = loadEnvFile(envPath);
    if (Object.keys(fileEnv).length > 0) {
      process.stderr.write(`[mention-watcher] Loaded .env from ${envPath}\n`);
      for (const [k, v] of Object.entries(fileEnv)) {
        if (!(k in process.env)) process.env[k] = v;
      }
    }
  }
}

// ── Config ─────────────────────────────────────────────────────────────────

const AGENT_TOKEN    = process.env.AGENT_TOKEN ?? '';
const WS_URL         = process.env.WS_SERVER_URL ?? 'ws://localhost:3001';
const API_URL        = process.env.API_SERVER_URL ?? 'http://localhost:3000';
const IDLE_MS        = Number(process.env.INJECT_IDLE_MS ?? 800);
const MCP_NAME       = process.env.MCP_SERVER_NAME ?? 'agent-chat';
const WATCH_CHANNELS = (process.env.WATCH_CHANNELS ?? '').split(',').filter(Boolean);
const WORKSPACE_DIR  = _WORKSPACE;

// Command to wrap: everything after `--` in argv, or default to `claude`
const extraArgs = process.argv.slice(2);
const dashDash  = extraArgs.indexOf('--');
const cmdArgs   = dashDash >= 0 ? extraArgs.slice(dashDash + 1) : [];
const COMMAND   = cmdArgs[0] ?? 'claude';
const CMD_ARGS  = cmdArgs.slice(1);

// ── State ───────────────────────────────────────────────────────────────────

let lastOutputAt = Date.now();
let idleTimer: NodeJS.Timeout | null = null;
const queue: string[] = [];

// ── Auth ────────────────────────────────────────────────────────────────────

async function resolveJwt(): Promise<string> {
  // If it already looks like a JWT (base64url header), use it directly
  if (AGENT_TOKEN.startsWith('eyJ')) return AGENT_TOKEN;

  // Otherwise exchange via api-server /auth/agent-token
  const res = await fetch(`${API_URL}/auth/agent-token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: AGENT_TOKEN }),
  });
  if (!res.ok) {
    const err = (await res.json()) as any;
    throw new Error(`Token exchange failed: ${err.error ?? res.status}`);
  }
  const data = (await res.json()) as { accessToken: string; entityName: string };
  process.stderr.write(`[mention-watcher] Authenticated as ${data.entityName}\n`);
  return data.accessToken;
}

// ── WebSocket listener ───────────────────────────────────────────────────────

type MentionHandler  = (payload: any, channel: string) => void;
type PresenceHandler = (event: 'join' | 'leave', entityName: string, channel: string) => void;

async function startWsListener(
  jwt: string,
  onMention: MentionHandler,
  onPresence: PresenceHandler,
) {
  const connect = () => {
    const ws = new WebSocket(`${WS_URL}?token=${encodeURIComponent(jwt)}`);

    ws.on('open', () => {
      process.stderr.write(`[mention-watcher] Connected to ws-server\n`);
      for (const ch of WATCH_CHANNELS) {
        const msg: WireMessage = {
          id: Math.random().toString(36).slice(2, 10),
          type: 'action' as any,
          from: 'watcher',
          payload: { action: 'join', channelId: ch },
          ts: new Date().toISOString(),
        };
        ws.send(JSON.stringify(msg));
      }
    });

    ws.on('message', (raw) => {
      let msg: WireMessage;
      try { msg = JSON.parse(raw.toString()); } catch { return; }

      if (msg.type === 'mention') {
        onMention(msg.payload, msg.channel ?? '');
        return;
      }

      // Presence: join / leave signals from channels we're subscribed to
      if (msg.type === 'signal') {
        const p = msg.payload as any;
        if (p?.event === 'join' || p?.event === 'leave') {
          onPresence(p.event, p.entityName ?? p.entityId ?? '?', p.channelId ?? msg.channel ?? '?');
        }
      }
    });

    ws.on('close', () => {
      process.stderr.write('[mention-watcher] Disconnected — reconnecting in 5s…\n');
      setTimeout(connect, 5000);
    });

    ws.on('error', (err) => {
      process.stderr.write(`[mention-watcher] WS error: ${err.message}\n`);
    });
  };

  connect();
}

// ── PTY injection ────────────────────────────────────────────────────────────

function buildPrompt(payload: any, channel: string): string {
  const from    = payload?.fromEntityName ?? 'someone';
  const context = (payload?.context ?? '').replace(/\r?\n/g, ' ').trim();
  const ch      = channel || payload?.channelId || '?';

  // Single line — no embedded \n so readline submits as one message.
  // Tell Claude to use the MCP server to reply, but leave the choice of tools open.
  return `[agent-chat] @${from} mentioned you in #${ch}: ${context} (use ${MCP_NAME} MCP tools to reply in the channel)`;
}

function scheduleInject(proc: TerminalProcess) {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    idleTimer = null;
    drainQueue(proc);
  }, IDLE_MS);
}

function drainQueue(proc: TerminalProcess) {
  if (queue.length === 0) return;
  const prompt = queue.shift()!;

  // In fallback modes, avoid control-key injections that may break child TUI state
  // after user takeover. Use staged line submit for better compatibility.
  if (proc.mode !== 'pty') {
    setTimeout(() => {
      proc.write(prompt);
    }, 30);
    setTimeout(() => {
      // Some TUIs only react to CR, others to LF.
      proc.write('\r');
      setTimeout(() => proc.write('\n'), 20);
      process.stderr.write(`[mention-watcher] Injected mention prompt (${proc.mode})\n`);
      if (queue.length > 0) scheduleInject(proc);
    }, 120);
    return;
  }

  // PTY mode can safely use line-clear + staged Enter for better input hygiene.
  proc.write('\x15');
  setTimeout(() => {
    proc.write(prompt);
  }, 80);
  setTimeout(() => {
    proc.write('\r');
    setTimeout(() => proc.write('\n'), 20);
    process.stderr.write('[mention-watcher] Injected mention prompt (pty)\n');
    if (queue.length > 0) scheduleInject(proc);
  }, 200);
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  if (!AGENT_TOKEN) {
    const envPath = path.join(WORKSPACE_DIR, '.env');
    const envExists = fs.existsSync(envPath);
    process.stderr.write('[mention-watcher] Error: AGENT_TOKEN is required\n');
    process.stderr.write(`  Workspace : ${WORKSPACE_DIR}\n`);
    process.stderr.write(`  .env      : ${envPath} ${envExists ? '(exists, but AGENT_TOKEN not set)' : '(not found)'}\n`);
    process.stderr.write('\n');
    process.stderr.write('  Run setup first from your project directory:\n');
    process.stderr.write('    npx @agent-chat/mention-watcher setup\n');
    process.exit(1);
  }

  // 1. Authenticate
  const jwt = await resolveJwt();

  // 2. Sync a working auth token into project MCP configs.
  // Use exchanged JWT first because some MCP clients fail with raw agent tokens.
  syncMcpToken(WORKSPACE_DIR, MCP_NAME, jwt);

  // 3. Spawn the target CLI in a PTY
  const cols = process.stdout.columns || 80;
  const rows = process.stdout.rows || 24;

  const wdSource = process.env.WORKSPACE_DIR ? 'env' : 'auto-detected';
  process.stderr.write(`[mention-watcher] Workspace: ${WORKSPACE_DIR} (${wdSource})\n`);
  process.stderr.write(`[mention-watcher] Spawning: ${COMMAND} ${CMD_ARGS.join(' ')}\n`);

  const ptyEnv = buildPtyEnv(process.env);
  const spawnOptions = {
    name: 'xterm-256color',
    cols,
    rows,
    cwd: WORKSPACE_DIR,
    env: ptyEnv,
  };

  let proc: TerminalProcess;
  try {
    const p = pty.spawn(COMMAND, CMD_ARGS, spawnOptions);
    proc = { ...p, mode: 'pty' };
  } catch (err: any) {
    const msg = String(err?.message ?? err);
    if (!msg.includes('posix_spawnp failed')) {
      process.stderr.write(`[mention-watcher] Failed to spawn "${COMMAND}": ${msg}\n`);
      process.stderr.write(`  Run "which ${COMMAND}" in your terminal to confirm it is installed.\n`);
      process.exit(1);
    }

    // Fallback: spawn via the user's shell when direct posix_spawnp lookup fails.
    const userShell = process.env.SHELL || '/bin/zsh';
    const quotedArgs = [COMMAND, ...CMD_ARGS]
      .map((a) => `'${a.replace(/'/g, "'\\''")}'`)
      .join(' ');
    const shellCmd = `exec ${quotedArgs}`;
    process.stderr.write(
      `[mention-watcher] Direct spawn failed, retry via shell: ${userShell} -lc "${shellCmd}"\n`,
    );

    try {
      const p = pty.spawn(userShell, ['-lc', shellCmd], spawnOptions);
      proc = { ...p, mode: 'pty' };
    } catch (shellErr: any) {
      const shellMsg = String(shellErr?.message ?? shellErr);
      process.stderr.write(`[mention-watcher] Shell fallback failed: ${shellMsg}\n`);
      process.stderr.write('[mention-watcher] Falling back to script PTY mode\n');
      try {
        proc = spawnViaScriptPty(COMMAND, CMD_ARGS, WORKSPACE_DIR, ptyEnv);
      } catch (scriptErr: any) {
        const scriptMsg = String(scriptErr?.message ?? scriptErr);
        process.stderr.write(`[mention-watcher] Script PTY fallback failed: ${scriptMsg}\n`);
        process.stderr.write('[mention-watcher] Falling back to non-PTY mode\n');
        proc = spawnWithoutPty(COMMAND, CMD_ARGS, WORKSPACE_DIR, ptyEnv);
      }
    }
  }

  // Forward PTY → real terminal
  proc.onData((data) => {
    process.stdout.write(data);
    lastOutputAt = Date.now();
  });

  // Forward real terminal stdin → PTY/process (raw mode for arrow keys, ctrl sequences, etc.)
  let cleanedUp = false;
  const cleanupTerminal = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    if (process.stdin.isTTY) {
      try {
        process.stdin.setRawMode(false);
      } catch {
        // ignore
      }
    }
    process.stdin.pause();
  };

  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }
  process.stdin.resume();
  process.stdin.on('data', (data: Buffer) => {
    // In raw mode Ctrl+C is delivered as byte 0x03, not SIGINT.
    if (data.length === 1 && data[0] === 3) {
      proc.kill?.('SIGINT');
      cleanupTerminal();
      process.exit(130);
      return;
    }
    proc.write(data.toString('binary'));
  });

  // Sync terminal resize to PTY
  process.stdout.on('resize', () => {
    proc.resize(process.stdout.columns || 80, process.stdout.rows || 24);
  });

  // Clean up when the wrapped process exits
  proc.onExit(({ exitCode }: { exitCode: number }) => {
    cleanupTerminal();
    process.exit(exitCode);
  });

  // Fallback in case SIGINT is delivered to the parent process.
  process.on('SIGINT', () => {
    proc.kill?.('SIGINT');
    cleanupTerminal();
    process.exit(130);
  });

  // 4. Start ws-server listener
  await startWsListener(
    jwt,
    // ── mention handler ──────────────────────────────────────────────────────
    (payload, channel) => {
      const from = payload?.fromEntityName ?? 'someone';
      const ch   = channel || payload?.channelId || '?';
      process.stderr.write(`\r\n[mention-watcher] @mention from ${from} in #${ch}\r\n`);

      const prompt = buildPrompt(payload, channel);
      queue.push(prompt);

      const idleMs = Date.now() - lastOutputAt;
      if (idleMs >= IDLE_MS) {
        drainQueue(proc);
      } else {
        scheduleInject(proc);
      }
    },
    // ── presence handler ─────────────────────────────────────────────────────
    (event, entityName, channel) => {
      const arrow = event === 'join' ? '→' : '←';
      process.stderr.write(`\r\n[mention-watcher] ${arrow} ${entityName} ${event === 'join' ? 'joined' : 'left'} #${channel}\r\n`);
    },
  );

  process.stderr.write(`[mention-watcher] Ready. Watching for @mentions…\r\n`);
}

main().catch((err) => {
  process.stderr.write(`[mention-watcher] Fatal: ${err.message}\n`);
  process.exit(1);
});
