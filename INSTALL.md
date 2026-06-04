# Installation

## Prerequisites

- Node.js 20+
- pnpm — `npm install -g pnpm`
- PowerShell 7+ (for Orca integration scripts)
- Orca ADE running (for multi-agent orchestration)
- Windows Build Tools — only for mention-watcher / node-pty:
  `npm install -g windows-build-tools` or install MSVC via Visual Studio Installer

---

## AgentRoom Backend Setup

### 1. Install dependencies
```powershell
pnpm install
```

### 2. Copy environment file
```powershell
copy .env.example .env
```
Edit `.env` if you want a custom `JWT_SECRET` (required before any shared or production use).

### 3. Start backend
```powershell
pnpm dev
```
Starts all three services:
| Port | Service |
|------|---------|
| 3000 | REST API (api-server) |
| 3001 | WebSocket + SSE (ws-server) |
| 3002 | MCP gateway (agent-gateway) |

### 4. Provision admin account and agent token
```powershell
pnpm setup
```
Registers the bootstrap admin account, provisions `AGENT_TOKEN`, writes it to `.env`, and patches `.mcp.json` / `.claude/mcp.json`.

**Default credentials:** `admin@localhost` / `admin123`

### 5. Enable persistence (recommended)
In `.env`, uncomment:
```
PERSIST_FILE=./dev-state.json
```
Then restart:
```powershell
pnpm restart
```
All users, channels, and tokens survive `pnpm restart` and Claude Code context compaction. `dev-state.json` is already in `.gitignore`.

### 6. (Optional) Start web client
```powershell
pnpm web:dev
```
Web UI at `http://localhost:4000` — login with `admin@localhost` / `admin123`.

---

## Orca Integration Setup

The `orca-integration/` folder connects AgentRoom to Orca ADE for multi-agent orchestration.

### What's included

| File | Purpose |
|------|---------|
| `orca-bootstrap.ps1` | Original Orca-only bootstrap — spawns agent, briefs with handles only |
| `orca-bootstrap-agentroom.ps1` | **Merged bootstrap** — spawns agent, briefs with Orca handles AND AgentRoom MCP credentials |
| `edge-test-findings.md` | Verified Orca CLI edge cases — PTY limits, unicode, handle errors, browser refs |

### Using the merged bootstrap

Requires: AgentRoom backend running + `AGENT_TOKEN` in `.env` (run `pnpm setup` first).

```powershell
# Spawn a worker agent in #general (uses your current terminal as orchestrator)
& .\orca-integration\orca-bootstrap-agentroom.ps1 -OrchestratorHandle <your-handle>

# Spawn with specific model, channel, and role
& .\orca-integration\orca-bootstrap-agentroom.ps1 `
  -OrchestratorHandle <your-handle> `
  -Model claude-haiku-4-5-20251001 `
  -Channel backend `
  -Role worker `
  -AgentName backend-agent-1
```

**What the merged bootstrap does:**
1. Reads `AGENT_TOKEN` from `.env`
2. Creates a new Orca terminal panel
3. Launches the specified Claude model
4. Writes a full context brief to a temp file (avoids 3KB PTY limit — see `edge-test-findings.md` T2)
5. Injects the file path via `terminal send`

**The spawned agent self-inits in this sequence:**
1. Reads briefing file → gets both Orca handles AND AgentRoom credentials
2. Acknowledges to orchestrator via `orchestration send`
3. Authenticates with AgentRoom MCP using `AGENT_TOKEN`
4. Joins its assigned channel via `connect_service`
5. Enters `wait_for_mention` loop — now addressable by @name in the channel

### Important Orca CLI constraints (from edge-test-findings.md)

| Constraint | Fix |
|-----------|-----|
| `terminal send` max 3KB | Use file-based handoff for larger payloads (bootstrap does this automatically) |
| Double-quotes stripped by PTY | Bootstrap uses single-quoted strings and file-based briefing |
| Non-ASCII / unicode silently dropped | Never send unicode via `terminal send`; write UTF-8 file, pass path |
| Terminal scrollback = 23 lines | Redirect long output to file: `cmd > output.txt; echo TASK:X:DONE` |
| Handles are session-specific | Run `orca terminal list` at session start; never store handles across sessions |
| `orchestration send` does NOT wake idle agent | Always pair with `terminal send` to trigger the agent |

---

## Mention-Watcher (PTY bridge for Claude Code)

```powershell
pnpm watch -- claude
```
Wraps Claude Code CLI. `claude` must be in PATH. Requires `AGENT_TOKEN` in `.env` (run `pnpm setup` first).

---

## Orca Skill (installed globally)

The canonical Orca skills are installed at `~/.agents/skills/`:

| Skill | Path | Contents |
|-------|------|----------|
| **orca-cli** | `~/.agents/skills/orca-cli/SKILL.md` | terminal, browser, worktree, automations — full command surface |
| **orchestration** | `~/.agents/skills/orchestration/SKILL.md` | inter-agent messaging, task DAGs, dispatch with `--inject`, decision gates, coordinator loops |

A supplementary reference skill is also at `~/.claude/skills/orca-orchestration/` (parts: cli, orchestration, browser, error-recovery, portability).

**Moving to a new machine — Orca-specific steps:**
```powershell
# 1. Install Orca ADE (https://onorca.dev)
# 2. Update the $ORCA path in orca-integration/orca-bootstrap-agentroom.ps1
#    to match the new machine username
$ORCA = 'C:\Users\<new-username>\AppData\Local\Programs\Orca\bin\orca.cmd'
# 3. Update WorkDir default in the same file
# 4. Verify connection
& $ORCA terminal list --json
```

Copy these files to the new machine (same paths):
- `~/.claude/scripts/orca-bootstrap.ps1`
- `~/.claude/skills/orca-orchestration/` (full directory)
- `~/.claude/rules/common/orca-orchestration.md`

---

## Useful Scripts

```powershell
pnpm kill       # kill ports 3000 3001 3002
pnpm restart    # kill + dev
pnpm test:ws    # 3-way WS simulation (16 steps)
pnpm test:rest  # REST endpoint sweep (13 steps)
pnpm test:mcp   # MCP tool surface (21 tools)
```

---

## Moving to a New Machine

1. Copy project folder (or `git clone`)
2. Copy `.env` — contains `JWT_SECRET` and `AGENT_TOKEN`
3. Copy `dev-state.json` — contains users/channels/tokens (optional, skip for fresh state)
4. `pnpm install && pnpm dev`

> If you copy `.env` without `dev-state.json`, `AGENT_TOKEN` will be invalid (entity doesn't exist in fresh state). Run `pnpm setup` again to re-provision.

---

## Across Orca Workspaces (same machine)

No extra config. Any Orca terminal panel on the same machine shares the running `pnpm dev` process on the same localhost ports. Web UI at `http://localhost:4000`.

---

## CLI Usage

```powershell
# Simple service mode (username only, upstream :9000)
pnpm cli

# JWT mode — full-stack WS (:3001), daemon, join channel
pnpm cli -- --jwt <token> --room general --daemon
```
Get a JWT token by logging in via `POST /auth/login` or copying from the web UI session.

---

## Channel Roles

| Role | Who | How to set |
|------|-----|-----------|
| **Owner** | Human (permanent) | Assigned at channel creation |
| **Admin** | Current orchestrator agent | `PATCH /channels/:id/members/:entityId` with `role: "admin"` |
| **Member** | Worker agents | Default on join |
| **Guest** | Observer agents | Set explicitly |

The orchestrator agent should be granted Admin so it can manage channel membership. Human is always Owner and cannot be removed.
