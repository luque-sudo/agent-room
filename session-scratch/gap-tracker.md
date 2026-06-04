# Gap Tracker — AgentRoom Fork

---

## Section A: Confirmed Gaps (Source-Verified, Session 4)

These were predicted from bug history pattern analysis and confirmed by reading source.

---

### G1 — `/restrict` has no server-side implementation

**What it does now:** web sends `{ type:'chat', payload: { restricted: true } }` → server ignores `restricted` field, broadcasts normally. CLI sends action `permission.send_restricted` → server responds "Unknown action."  
**What it should do:** unknown — intended semantics (role-gated visibility? observer-only delivery?) never defined by original dev.  
**Status:** Deferred — requires design decision before implementation.  
**Files involved:** `apps/ws-server/src/gateway.ts` (`handleChat`), `apps/agent-room-cli/src/cli.ts`, `web/src/components/Chat.tsx`

---

### G2 — `/dm` is not true private messaging (misnamed feature)

**What it does now:** sends a regular chat message to the full channel with `isDm: true` in payload (ignored by server) and `mentions: [target]`. All members see it. Target gets a `type:'mention'` ping. Purple `[DM]` badge is cosmetic only.  
**What the original README said it should do:** README Part 1 line 398 states *"Direct messages: Point-to-point private messaging"* and the WS protocol section shows a dedicated action frame:

```json
{ "payload": { "action": "dm", "to": "Bob", "message": "Hi, private message" } }
```

This was a distinct WS action (not a chat message) intended to route only to the named entity — never implemented.  
**Verdict:** `/dm` is incorrectly named — the feature is "channel-scoped mention with DM styling", not private messaging. True DMs would require routing to an entity-scoped pubsub topic.  
**Status:** Documented. Implementing true DMs is out of scope for backend/CLI focus; would require server-side entity topic routing.  
**Files involved:** `apps/ws-server/src/gateway.ts` (no `dm` action handler), `apps/agent-room-cli/src/cli.ts`, `web/src/components/Chat.tsx`

---

### G3 — JWT expiry not detected during active web session

**What it does now:** token validated once on page mount via `GET /channels`. If JWT expires mid-session, REST calls silently fail with 401 but no logout or re-auth is triggered.  
**Status:** WEB UI concern — out of scope for current backend/CLI focus. Address during web UI customization.  
**Files involved:** `web/src/app/page.tsx` (session restore logic)

---

### P5F — SSRF in `connect_stream` — FIXED ✅

`connect_stream` accepted any URL scheme. Added `ws:`/`wss:` allowlist before `new WebSocket(url)`.  
**File:** `apps/agent-gateway/src/create-server.ts`

---

### P8F — Message pagination `limit` unbounded — FIXED ✅

`GET /channels/:id/messages?limit=N` had no cap. Added Fastify querystring schema: `integer`, `min:1`, `max:200`; unknown params → 400.  
**File:** `apps/api-server/src/routes/channels.ts`

---

## Section B: New Predicted Gaps (Unverified — for future sessions)

These derive from bug history patterns applied to areas not yet source-inspected. Listed for tracking only — not confirmed bugs.


| ID  | Predicted Gap                                                                                                                                                        | Pattern        | Severity | Status     |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | -------- | ---------- |
| NP1 | Other REST routes missing query/body schemas (same miss as R3, GAP-2) — e.g. `POST /channels/:id/members` role on PATCH, `GET /channels` filters                     | Pattern 7      | Low      | Unverified |
| NP2 | `stream_chunk` / `stream_end` sent to disconnected WS — same silent-drop as pre-B14 `startStream`                                                                    | Pattern 4      | Low      | Unverified |
| NP3 | `processMentions` regex `@(\w[\w-]*)` — hyphenated names work but names with dots or spaces (`@first.last`) silently skip mention routing                            | Pattern 2      | Low      | Unverified |
| NP4 | `listMessages` in MemoryAdapter — `cursor` lookup is a linear scan; no index. High message volume causes O(n) pagination                                             | Pattern 5/perf | Low      | Unverified |
| NP5 | `reconnectTokens` prune interval (`setInterval`) never cleared if `WsGateway` is torn down — interval leak on dev hot-reload                                         | Pattern 5      | Low      | Unverified |
| NP6 | `dev-state.json` written synchronously on every mutation (`persist()`) — concurrent rapid writes (e.g. bulk member adds) could corrupt the JSON file (no write lock) | Pattern 3      | Medium   | Unverified |


---

## Section C: Installation Instructions (INSTALL.md)

**File to create:** `agentroom/INSTALL.md`

Content plan:

```markdown
# Installation

## Prerequisites
- Node.js 20+
- pnpm (`npm install -g pnpm`)
- Windows Build Tools (only for mention-watcher / node-pty):
  `npm install -g windows-build-tools` or install MSVC via Visual Studio Installer

## First-Time Setup

# 1. Install dependencies
pnpm install

# 2. Copy environment file
cp .env.example .env
# (or on Windows: copy .env.example .env)
# Edit .env if you want a custom JWT_SECRET (change before any shared/production use)

# 3. Start backend (api :3000 · ws :3001 · gateway :3002)
pnpm dev

# 4. Register admin account + provision agent token
pnpm setup
# Writes AGENT_TOKEN to .env and patches .mcp.json / .claude/mcp.json

# 5. (Optional) Start web client
pnpm web:dev
# → http://localhost:4000  (login: admin@localhost / admin123)

## Enable Persistence (recommended)
# In .env, uncomment:
PERSIST_FILE=./dev-state.json
# Then restart: pnpm restart
# All users/channels/tokens survive restarts. Add dev-state.json to .gitignore (already done).

## Port Reference
| Port | Service |
|------|---------|
| 3000 | REST API (api-server) |
| 3001 | WebSocket + SSE (ws-server) |
| 3002 | MCP gateway (agent-gateway) |
| 4000 | Web client (Next.js) |
| 9000 | Simple service (upstream CLI compat) |

## CLI Usage
pnpm cli                          # simple service mode (username only, :9000)
pnpm cli -- --jwt [[ORCA_RAW_HTML_INLINE:%3Ctoken%3E]] --room general --daemon  # JWT mode, full-stack WS (:3001)

## Mention-Watcher (PTY bridge for Claude Code)
pnpm watch -- claude              # wraps Claude Code CLI; claude must be in PATH

## Useful Scripts
pnpm kill      # kill ports 3000 3001 3002
pnpm restart   # kill + dev
pnpm test:ws   # 3-way WS simulation (16 steps)
pnpm test:rest # REST endpoint sweep (13 steps)
pnpm test:mcp  # MCP tool surface (21 tools)

## Moving to a New Machine
1. Copy project folder (or git clone)
2. Copy .env (contains JWT_SECRET + AGENT_TOKEN)
3. Copy dev-state.json (contains users/channels — optional, skip for fresh state)
4. pnpm install && pnpm dev
NOTE: If you copy .env but NOT dev-state.json, AGENT_TOKEN will be invalid
(entity doesn't exist). Run pnpm setup again to re-provision.

## Across Orca Workspaces (same machine)
No extra config. Any Orca terminal panel on the same machine shares the running
pnpm dev process on the same localhost ports. Web UI at http://localhost:4000.
```

---

## Section D &amp; E: Moved to design doc

→ `archive/session-scratch/orca-agentroom-design.md`

Sections moved:

- Orca capability table, AgentRoom MCP capability table
- Decision matrix (what uses what)
- Combined pipeline (3-layer model + phases)
- Where true DM adds value over Orca
- Orca skill confirmed details (binary path, all commands, constraints)

---

## Section F: Bug Pattern Reference


| #   | Pattern                                | Representative bugs          |
| --- | -------------------------------------- | ---------------------------- |
| 1   | Documented but never implemented       | B1, B16, B32, B33, Items B–G |
| 2   | Protocol contract mismatches           | B3, B17, B27, R2             |
| 3   | Stale closure / race conditions        | B5, B7–B10, B12, B31         |
| 4   | Errors silently swallowed              | B6, B13–B15                  |
| 5   | Resource lifecycle leaks               | B8, B25, GAP-1               |
| 6   | Platform/environment assumptions       | B18–B20, B34                 |
| 7   | Missing input validation at boundaries | GAP-2, R1–R3, S3             |
| 8   | Security bolted on last                | S1–S3                        |


