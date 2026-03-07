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
import * as pty from 'node-pty';
import { WebSocket } from 'ws';
import type { WireMessage } from '@agent-chat/types';

// ── Config ─────────────────────────────────────────────────────────────────

const AGENT_TOKEN    = process.env.AGENT_TOKEN ?? '';
const WS_URL         = process.env.WS_SERVER_URL ?? 'ws://localhost:3001';
const API_URL        = process.env.API_SERVER_URL ?? 'http://localhost:3000';
const IDLE_MS        = Number(process.env.INJECT_IDLE_MS ?? 800);
const MCP_NAME       = process.env.MCP_SERVER_NAME ?? 'agent-chat';
const WATCH_CHANNELS = (process.env.WATCH_CHANNELS ?? '').split(',').filter(Boolean);
const WORKSPACE_DIR  = process.env.WORKSPACE_DIR ?? detectWorkspaceDir();

/**
 * Walk up from cwd looking for a directory that contains .claude/mcp.json or
 * .cursor/mcp.json — the same markers Claude Code / Cursor use for project-level
 * MCP config.  Falls back to cwd if nothing is found (e.g. global invocation).
 */
function detectWorkspaceDir(): string {
  const markers = [
    '.mcp.json',                        // Claude Code project MCP config (v2+)
    path.join('.claude', 'mcp.json'),   // older Claude Code format
    path.join('.cursor', 'mcp.json'),   // Cursor
    '.claude',
    '.cursor',
    '.git',
  ];
  let dir = process.cwd();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    for (const marker of markers) {
      if (fs.existsSync(path.join(dir, marker))) return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break; // filesystem root
    dir = parent;
  }
  return process.cwd();
}

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

function scheduleInject(proc: pty.IPty) {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    idleTimer = null;
    drainQueue(proc);
  }, IDLE_MS);
}

function drainQueue(proc: pty.IPty) {
  if (queue.length === 0) return;
  const prompt = queue.shift()!;

  // Step 1: Ctrl+U — clear any half-typed content on the current line
  proc.write('\x15');

  // Step 2: write the prompt text (without any trailing newline)
  setTimeout(() => {
    proc.write(prompt);
  }, 80);

  // Step 3: send Enter as a completely separate write, after the text has been
  // buffered by the TUI. Both \r and \n are tried for maximum compatibility.
  setTimeout(() => {
    proc.write('\r');
    // Belt-and-suspenders: some TUIs (e.g. Ink) only react to \n
    setTimeout(() => proc.write('\n'), 20);
    if (queue.length > 0) scheduleInject(proc);
  }, 200);
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  if (!AGENT_TOKEN) {
    process.stderr.write('[mention-watcher] Error: AGENT_TOKEN is required\n');
    process.exit(1);
  }

  // 1. Authenticate
  const jwt = await resolveJwt();

  // 2. Spawn the target CLI in a PTY
  const cols = process.stdout.columns || 80;
  const rows = process.stdout.rows || 24;

  const wdSource = process.env.WORKSPACE_DIR ? 'env' : 'auto-detected';
  process.stderr.write(`[mention-watcher] Workspace: ${WORKSPACE_DIR} (${wdSource})\n`);
  process.stderr.write(`[mention-watcher] Spawning: ${COMMAND} ${CMD_ARGS.join(' ')}\n`);

  const proc = pty.spawn(COMMAND, CMD_ARGS, {
    name: 'xterm-256color',
    cols,
    rows,
    cwd: WORKSPACE_DIR,
    env: process.env as Record<string, string>,
  });

  // Forward PTY → real terminal
  proc.onData((data) => {
    process.stdout.write(data);
    lastOutputAt = Date.now();
  });

  // Forward real terminal stdin → PTY (raw mode for arrow keys, ctrl sequences, etc.)
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }
  process.stdin.resume();
  process.stdin.on('data', (data: Buffer) => {
    proc.write(data.toString('binary'));
  });

  // Sync terminal resize to PTY
  process.stdout.on('resize', () => {
    proc.resize(process.stdout.columns || 80, process.stdout.rows || 24);
  });

  // Clean up when the wrapped process exits
  proc.onExit(({ exitCode }: { exitCode: number }) => {
    process.exit(exitCode);
  });

  // 3. Start ws-server listener
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
