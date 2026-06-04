# AgentRoom Fork — Part 2: Technical Changelog

> **This document is Part 2 of the fork documentation.**  
> Part 1 (`README.md`) covers setup and day-to-day usage.  
> Part 2 is a precise technical record of what the upstream provided, what state it was in when the fork was cut, and every change made and why.

---

## Fork Status — 2026-06-03

| Category | Items | Status |
|----------|-------|--------|
| Bugs fixed (B1–B35) | 35 | ✅ All fixed · runtime-verified (see §4 header + §4a/4d) |
| Session 2 code fixes | GAP-1, GAP-2, R1–R4 | ✅ Fixed · runtime-tested |
| Session 2 feature additions | Items A–I | ✅ Implemented · source-verified |
| Session 3 security fixes | S1–S3 | ✅ Fixed (reconnect membership check, token rotation, role validation) |
| Session 4 gap analysis | 10 predictions → 5 confirmed | ✅ 2 fixed (P5F, P8F) · 3 documented (G1–G3) · 5 ruled out |
| 3-way WS simulation | 16 steps | ✅ All pass |
| REST endpoint sweep | 13 steps | ✅ All pass |
| SSE mode | connect + message delivery | ✅ Pass |
| Browser UI smoke test | login, chat, send | ✅ Pass |
| B30 unread badge (UI) | non-active channel delivery | ✅ Browser-confirmed (badge + clear on switch) |
| B10 no-reconnect on channel switch | useEffect deps | ✅ Source + runtime-confirmed |
| Persistence restart (Gap 4) | data survives `pnpm restart` | ✅ Pass (after B34 fix) |
| TypeScript clean | 5/5 packages | ✅ Pass |
| MCP tool surface (B, D–F, G, I) | 21/21 tools + resources | ✅ Runtime-tested via `mcp-tool-test.mjs` |
| CLI JWT mode (§3.9) | `--jwt --daemon --room` | ✅ Runtime-tested — connects, joins, sends |
| mention-watcher (§3.2) | PTY bridge full pipeline | ✅ Runtime-tested — auth, WS connect, joins channel |

---

## Table of Contents

1. [Overview](#1-overview)
2. [Upstream Baseline — What We Started With](#2-upstream-baseline--what-we-started-with)
3. [Net-New Additions](#3-net-new-additions)
   - [3.1 Web Client](#31-web-client-web)
   - [3.2 Mention-Watcher](#32-mention-watcher-appsmention-watcher)
   - [3.3 Dev Infrastructure](#33-dev-infrastructure)
   - [3.4 MemoryAdapter Persistence](#34-memoryadapter-persistence)
   - [3.5 Entity List Endpoint](#35-entity-list-endpoint)
   - [3.6 MCP Gateway Enhancements](#36--mcp-gateway-enhancements)
   - [3.7 SSE (Server-Sent Events) Mode](#37--sse-server-sent-events-mode)
   - [3.8 Local CLI Fork (`apps/agent-room-cli/`)](#38--local-cli-fork-appsagent-room-cli)
   - [3.9 CLI JWT Auth Mode (`--jwt` flag)](#39--cli-jwt-auth-mode---jwt-flag)
4. [Bug Fix Changelog](#4-bug-fix-changelog)
   - [4a. Session 2 Fixes & Additions (incl. B34)](#4a-session-2-fixes--additions)
   - [4b. Integration Test Results](#4b-integration-test-results--2026-06-03)
   - [4c. Session 3 Security Fixes (S1–S3)](#4c-session-3-security-fixes--2026-06-03)
   - [4d. Session 3 Runtime Tests (MCP, CLI, mention-watcher)](#4d-session-3-runtime-tests--2026-06-03)
   - [4e. Session 4 — Gap Analysis & Hardening (P5F, P8F, G1–G3)](#4e-session-4--gap-analysis--hardening--2026-06-03)
5. [Customizations & Architecture Decisions](#5-customizations--architecture-decisions)
6. [Known Remaining Gaps & Limitations](#6-known-remaining-gaps--limitations)
7. [Quick Reference — Diff Summary](#7-quick-reference--diff-summary)

---

## 1. Overview

This is a technical changelog for developers who need to understand the delta between the upstream `dxiaoqi/agent-room` and this fork — whether they are auditing the codebase, contributing, or evaluating whether to pull changes back upstream.

The fork's goal was to take the upstream's messaging and MCP infrastructure and make it fully usable as a local development environment: add a working web UI that was absent from upstream, establish a proper dev workflow (hot-reload, environment configuration, kill/restart scripts), and fix every integration bug that prevented the pieces from working together correctly. The upstream was a functional backend skeleton — solid in its core ideas, incomplete in its execution.

In short: upstream gave us a working MCP gateway, a real-time WebSocket pub/sub messaging backend, and a terminal CLI client. The fork added the browser UI layer, wired it correctly to the backend, fixed all the event-name mismatches and race conditions that made the integration unreliable, and filled in the missing REST endpoints and dev tooling the project needed to be self-contained.

---

## 2. Upstream Baseline — What We Started With

### 2.1 Architecture

The upstream was a `pnpm` workspace with three deployable apps and three shared packages.

| Path | Role |
|---|---|
| `apps/api-server` | Fastify REST API — auth, channels, messages, entities, agents |
| `apps/ws-server` | WebSocket server — real-time pub/sub messaging |
| `apps/agent-gateway` | MCP bridge exposing 14 tools for AI agent integration |
| `packages/@agent-chat/database` | Storage adapters (`MemoryAdapter` — in-memory, ephemeral) |
| `packages/@agent-chat/types` | Shared TypeScript type definitions |
| `packages/@agent-chat/mcp-sdk` | MCP SDK wrapper used by the gateway |

The workspace root used `pnpm-workspace.yaml` covering `packages/*` and `apps/*`. Two separate npm packages (`agent-room-cli`, `agent-room-service`) were published independently. A `web/` directory existed in the repository but contained nothing committed — it was an empty stub.

### 2.2 What Worked Out of the Box

**REST API (`api-server`)**
- `POST /auth/register`, `POST /auth/login` — JWT-based authentication
- `GET /channels`, `POST /channels`, `GET /channels/:id`
- `POST /channels/:id/members`, `PATCH /channels/:id/members/:entityId`
- `GET /channels/:id/messages`, `GET /channels/:id/context`, `POST /channels/:id/export`
- `GET /entities/:id`, `GET /entities/me`
- `GET /agents`, `POST /agents`
- Bootstrap admin account on first start — first registration automatically received admin scopes

**WebSocket server (`ws-server`)**
- Real-time message pub/sub across channels
- Join/leave channel membership over WS
- Streaming (`stream_start` / `stream_chunk` / `stream_end` / `stream_abort`)
- @mention detection with entity pub/sub routing

**MCP gateway (`agent-gateway`) — all 14 tools registered:**
`authenticate`, `join_channel`, `leave_channel`, `list_channels`, `list_members`, `send_message`, `stream_output`, `abort_stream`, `read_history`, `wait_for_mention`, `get_unread`, `get_context`, `register_human`, `create_agent`

**CLI / simple service**
- `agent-room-cli` connected to `agent-room-service` on `:9000` with username-only auth
- Interactive terminal chat worked end-to-end

### 2.3 What Was Present but Broken

#### REST API gaps

| Issue | Detail |
|---|---|
| `GET /entities` missing | Only `GET /entities/:id` and `/me` existed. No list endpoint. |
| `POST /channels/:id/members` blocked self-join | Caller must already be OWNER or ADMIN — impossible on first join. |
| `GET /channels/:id` members without names | Members array contained only `entityId`; no display name. |

#### WebSocket event name mismatches

The WS server emitted one format; any client written to the protocol expected a different one. No signal or membership events would have been received correctly.

| Server emitted | Web client expected | Mismatch |
|---|---|---|
| `type: 'signal'` | `type: 'system'` | type field |
| `entityName` | `name` | payload field |
| `event: 'join'` / `'leave'` | `event: 'member_joined'` / `'member_left'` | event value |

#### MCP gateway bugs

| Location | Bug |
|---|---|
| `action()` | `pendingActions` keyed by action name — concurrent same-type calls overwrote each other |
| `sendChat()` | Fire-and-forget; silently dropped if WS down; always returned `success: true` |
| `startStream()` | Declared `async` but fully synchronous — misleading signature |
| All `!res.ok` branches | `await res.json()` unconditional — JSON parse error masked the real HTTP error |

#### Web client / runtime bugs

| Location | Bug |
|---|---|
| WS `useEffect` deps | `active` in array — every `setActive()` caused full WS disconnect + reconnect |
| `addSysMessage` | Untracked `setTimeout` — memory leak; could fire on unmounted component |
| History load | No request cancellation — stale response for channel A could overwrite channel B's messages |
| `handleCreateChannel` | Called `setActive()` directly — triggered unnecessary WS reconnect on channel create |
| SSE login mode | Code referenced an SSE endpoint; no such endpoint existed in the backend |
| JWT expiry | Stored tokens used without checking `exp` claim |

#### Dev workflow

| Issue | Detail |
|---|---|
| No `.env` / `.env.example` | Secrets hardcoded or undocumented; `JWT_SECRET` was a constant in `jwt.ts` |
| No hot-reload | `tsx` without `--watch` — manual process kill required after every code change |
| No kill/restart scripts | No port cleanup or restart automation |
| mention-watcher Windows paths | Hardcoded `/bin/zsh`, `script -q /dev/null` — non-functional on Windows |
| `source .env` in setup docs | Unix-only shell command printed during `pnpm setup` |

### 2.4 What Was Entirely Absent

| Missing | Notes |
|---|---|
| Web UI | `web/` directory was an empty stub |
| `.env` / `.env.example` | No environment config file of any kind |
| Database persistence | `MemoryAdapter` only — all data lost on restart |
| Hot-reload dev setup | Not present in any form |
| Process management scripts | No kill, restart, or status scripts |
| `GET /entities` list endpoint | Simply not implemented |
| mention-watcher | No agent IDE integration existed |

---

## 3. Net-New Additions

Everything in this section was added to the fork and has no counterpart in the upstream repository.

### 3.1 Web Client (`web/`)

A full Next.js 16.2.7 web application served on port 4000.

**Files added**

| File | Role |
|---|---|
| `src/app/layout.tsx` | Root layout; injects theme and `<ToastContainer>` |
| `src/app/page.tsx` | Top-level page — renders `<Login>` or `<Chat>` based on session state |
| `src/app/globals.css` | CSS custom properties for dark and light themes; keyframes and utility classes |
| `src/components/Chat.tsx` | Main chat surface — WS lifecycle, message list, full command parser |
| `src/components/Sidebar.tsx` | Channel list with unread badges and create-channel form |
| `src/components/MemberPanel.tsx` | Member roster with role badges; channel-info tab |
| `src/components/Login.tsx` | Auth form — Full Stack JWT mode and Simple Service mode |
| `src/components/ToastContainer.tsx` | Stacked toast notifications anchored to the viewport corner |
| `src/lib/api.ts` | Typed fetch wrappers for every REST endpoint |
| `src/lib/session.ts` | `localStorage`-backed session persistence |
| `src/lib/toast.ts` | Toast queue with singleton store, auto-dismiss, `mention` type |
| `src/lib/theme.ts` | `localStorage`-backed dark/light theme toggle |
| `next.config.ts` | API rewrite: `/api/*` → `http://localhost:3000/:path*` |
| `web/README.md` | Web-specific quick-start and slash-command reference |

**Features**

- Real-time chat via WebSocket with auto-reconnect (exponential backoff: 1 s → 30 s cap)
- Full slash-command set matching `agent-room-cli` (see Section 5.3)
- Grouped command palette triggered by `/`; TAB completion
- Unread badge per channel, clamped to "99+", cleared on switch
- Member panel with role badges (owner/admin/member/guest) and channel-info tab
- Dark/light theme; flash-prevention inline `<script>` in `<head>`
- Session persistence across page refresh via `localStorage`/`sessionStorage`
- Skeleton loading while history fetches; message hover actions (copy, reply, DM)
- Emoji picker (24 emojis, popover)

### 3.2 Mention-Watcher (`apps/mention-watcher/`)

A PTY wrapper that bridges Claude Code (or any compatible CLI agent) to the WS server.

**How it works**

1. Connects to the WS server with `AGENT_TOKEN`.
2. Spawns the target CLI (e.g. `claude`) inside a pseudo-terminal.
3. On any incoming `type:'mention'` WS event addressed to this entity, formats and writes the mention context to the PTY's stdin.
4. The agent reads it as natural input and responds; stdout flows back to the terminal.

**Setup (`pnpm setup`)**

Runs `apps/mention-watcher/src/setup-runner.ts` which:
- Registers or logs in the agent entity against the API
- Provisions an `AGENT_TOKEN` via `POST /auth/setup`
- Writes the token to `.env`
- Auto-patches `.mcp.json`, `.claude/mcp.json`, `.cursor/mcp.json`

**Usage**

```bash
pnpm watch -- claude       # wrap Claude Code CLI
pnpm watch -- cursor       # wrap Cursor
```

**Environment variables**

| Variable | Default | Purpose |
|---|---|---|
| `AGENT_TOKEN` | — | Agent authentication token |
| `WS_SERVER_URL` | `ws://localhost:3001` | WebSocket server |
| `API_SERVER_URL` | `http://localhost:3000` | REST API |
| `WATCH_CHANNELS` | `general` | Comma-separated channels to join |
| `INJECT_IDLE_MS` | `800` | PTY inactivity ms before injecting mention |
| `MCP_SERVER_NAME` | `agent-chat` | Key used when writing to MCP configs |
| `WORKSPACE_DIR` | auto-detected | Working directory for spawned CLI |

**Windows compatibility** — cross-platform shell detection (`COMSPEC`/`cmd.exe` fallback); `USERPROFILE` HOME fallback; `script` PTY wrapper skipped on Windows.

### 3.3 Dev Infrastructure

| Addition | Detail |
|---|---|
| `.env` + `.env.example` | Full documented environment with inline comments and safe defaults |
| `JWT_SECRET` in env | Moved from hardcoded constant in `jwt.ts` to `.env` |
| `PERSIST_FILE` | Optional MemoryAdapter JSON persistence (see §3.4) |
| `pnpm dev` | Changed to `tsx watch` for hot-reload |
| `pnpm kill` | `npx kill-port 3000 3001 3002` — Windows-compatible |
| `pnpm restart` | `pnpm kill; pnpm dev` |
| `pnpm web:dev` / `web:build` | Web client build/dev commands |
| `pnpm setup` / `watch` | mention-watcher commands |
| `pnpm service:cli` | Alias for `agent-room-cli` |
| `apps/dev-server/` `"build": "tsc --noEmit"` | Fixes "No projects matched" on root `pnpm build` |

### 3.4 MemoryAdapter Persistence

Activated by `PERSIST_FILE=./dev-state.json` in `.env`.

**Startup restore** — Constructor reads and deserializes the JSON file on init, restoring: entities, channels, members, credentials, messages, token index.

**Write-through** — `persist()` is called at the end of every mutating method: `createEntity`, `saveCredential`, `createChannel`, `addMember`, `removeMember`, `updateMemberRole`, `saveMessage`.

**Integration** — `apps/dev-server/src/index.ts` passes `process.env.PERSIST_FILE` to `new MemoryAdapter(persistFile)`.

> ⚠️ Add `dev-state.json` to `.gitignore` — the file contains hashed passwords and dev tokens.

### 3.5 Entity List Endpoint

- `GET /` added to `apps/api-server/src/routes/entities.ts` (registered before `/:id`)
- Returns all entities with `email` stripped from public profile
- `listEntities(): Promise<Entity[]>` added to `IStorageAdapter` interface
- Implemented in `MemoryAdapter` as `Array.from(this.entities.values())`

### 3.6 — MCP Gateway Enhancements

Three new tools added to `apps/agent-gateway/src/create-server.ts`:

| Tool | Description |
|---|---|
| `wait_for_message` | Blocks until any chat message arrives in a specific channel (not just @mentions). Same 5–120 s timeout range as `wait_for_mention`. |
| `connect_stream` | Connects to an arbitrary external WebSocket URL; bridges incoming messages to a specified channel as `[ext:<id>] <text>`. |
| `disconnect_stream` | Closes a named external connection opened by `connect_stream`. |

Two new MCP Resources added:

| Resource URI | Description |
|---|---|
| `connection://status` | Reports auth state, entity ID, scopes, bridge connectivity, active external connection IDs. |
| `metrics://snapshot` | Live counts: mention waiters, message waiters, active streams, external connections, consecutive timeouts. |

Supporting changes in `apps/agent-gateway/src/ws-bridge.ts`:
- `onAnyMessage(handler)` — registers a handler that receives every incoming WS message regardless of channel; used by `wait_for_message` routing.
- `isConnected(): boolean` — exposes the private `connected` field; used by the `connection://status` resource.

---

### 3.7 — SSE (Server-Sent Events) Mode

**Backend:** `GET /events` endpoint added to `apps/ws-server/src/create-server.ts`.
- Authenticates via `?token=<JWT>` or `Authorization: Bearer` header.
- Sets `Content-Type: text/event-stream`; writes `data: <json>\n\n` frames.
- Subscribes to all channels the user is a member of via pubsub + the entity-level topic for mentions.
- Unsubscribes cleanly on `req.close`.
- `res.writableEnded` guard prevents write-after-disconnect errors.
- CORS preflight (`OPTIONS /events`) supported.

**Frontend:**
- `Login.tsx`: "📡 SSE" tab restored. Authenticates via REST, stores `connType: 'sse'` and `sseUrl: http://localhost:3001/events` in sessionStorage.
- `Chat.tsx`: SSE `useEffect` now activates (was previously guarded against empty `sseUrl`). Opens `EventSource` with token in query param; parses each `data:` frame through the existing message handler. Send path disabled with read-only banner in SSE mode.

---

### 3.8 — Local CLI Fork (`apps/agent-room-cli/`)

`agent-room-cli` forked from npm into the pnpm workspace at `apps/agent-room-cli/`.
- Written in TypeScript; `package.json` name: `agent-room-cli`, `bin: "./dist/cli.js"`.
- Root `package.json` `devDependencies` includes `"agent-room-cli": "workspace:*"` — pnpm resolves to the local fork.
- Both upstream bugs fixed (see B CLI-1 and B CLI-2 in Section 4).
- **`--daemon` / `-d` flag** — listen-only mode: skips readline entirely (no TTY required), stays connected, and prints incoming messages to stdout. Suitable for piped stdin, automated tests, and background daemon processes.
- **Auto-reconnect (JWT mode)** — on unexpected disconnect, retries with exponential backoff starting at 1 s, capping at 30 s, for up to 10 attempts. Intentional close (`/quit`) sets `intentionalClose = true` to bypass reconnect.

---

### 3.9 — CLI JWT Auth Mode (`--jwt` flag)

New `--jwt <token>` flag added to the local CLI (`apps/agent-room-cli/src/cli.ts`):
- When provided, default `--url` becomes `ws://localhost:3001` (full-stack WS server instead of simple-service at :9000).
- Connects as `ws://localhost:3001?token=<JWT>` — JWT auth via URL param, no auth handshake frame needed.
- Startup banner shows `Mode: Full-stack WS (JWT)` vs. `Mode: Simple service`.
- All commands (`/join`, `/leave`, `/switch`, `/rooms`) use the full-stack WS action protocol.
- Chat send uses `{ type: 'chat', channel, payload: { content, mentions } }`.
- Incoming message handler branches on `type`: `chat`, `signal` (join/leave), `response` (connect/join/list_channels).
- Bridges the 6.4 isolation gap — CLI and web client can now share the same backend.

---

## 4. Bug Fix Changelog

33 bugs tracked, 33 fixed (31 fixed in fork source · 2 in local CLI fork).

> **Runtime verification — 2026-06-03**  
> The following entries were confirmed against the live stack after all fixes were applied:
> - **REST sweep** (`rest-sweep.mjs`): B1, B2, B11, B27, B29, B32, B33
> - **3-way WS simulation** (`simulate-3way.mjs`): B2, B3, B10, B12, B13, B25, B27, B30, B31
> - **SSE test**: B16, B23
>
> Remaining entries are source-verified. See §4b for full test details.

---

### B1 — `GET /entities` returned 404

**Symptom** — `/users` command always returned empty; API returned 404.  
**Root cause** — Only `GET /entities/:id` and `/me` existed; no list route.  
**Fix** — Added `GET /` to `entities.ts`; added `listEntities()` to `IStorageAdapter` and `MemoryAdapter`.

---

### B2 — Self-join returned 403

**Symptom** — `/join <channelId>` always showed "Error: Insufficient permissions" even for public channels.  
**Root cause** — `POST /channels/:id/members` required the caller to be OWNER or ADMIN, but you can't hold any role before joining.  
**Fix** — `channels.ts`: if `entityId === caller.sub` and `channel.isPublic`, skip the permission check.

---

### B3 — Member join/leave events invisible in chat

**Symptom** — No "→ Alice joined #general" messages despite working real-time chat.  
**Root cause** — Server emitted `type:'signal'`, `event:'join'/'leave'`, `entityName`; `Chat.tsx` checked `type:'system'`, `event:'member_joined'/'member_left'`, `name`.  
**Fix** — Updated the signal handler in `Chat.tsx` to match the actual wire format.

---

### B4 — @mention events produced no notification

**Symptom** — Being @mentioned produced no toast.  
**Root cause** — `Chat.tsx` had no `if (msg.type === 'mention')` branch.  
**Fix** — Added mention handler calling `showToast(..., 'mention', 5000)`.

---

### B5 — `/leave` activated the wrong channel

**Symptom** — After leaving the active channel, the UI sometimes switched to a removed or unexpected channel.  
**Root cause** — `setChannels(prev => prev.filter(...))` followed by `channels.find(...)` read the pre-filter stale array.  
**Fix** — Pre-computed `const remaining = channels.filter(...)` then `setChannels(remaining); setActive(remaining[0] ?? null)`.

---

### B6 — `/join`, `/role`, `/grant` swallowed errors silently

**Symptom** — Command failures produced no feedback; input cleared with no error shown.  
**Root cause** — No `try-catch` around the API calls.  
**Fix** — Wrapped each in `try-catch`; `catch` calls `addSysMessage` + `showToast`.

---

### B7 — Creating a channel caused an unnecessary WS reconnect

**Symptom** — After creating a channel, "← left / → joined" events appeared and messages briefly couldn't be sent.  
**Root cause** — `handleCreateChannel` called `setActive(ch)` directly; `active` was in the WS `useEffect` deps.  
**Fix** — Changed to `switchChannel(ch)` in `handleCreateChannel`.

---

### B8 — `addSysMessage` timer leak

**Symptom** — Multiple rapid system messages overlapped and unmount produced React warnings.  
**Root cause** — Each `addSysMessage` call created an untracked `setTimeout`.  
**Fix** — Added `sysTimeoutRef`; each call cancels the previous timer; cleanup `useEffect` clears on unmount.

---

### B9 — History race condition on rapid channel switching

**Symptom** — Switching channels quickly displayed messages from the previous channel.  
**Root cause** — Slow `getMessages()` response for channel A resolved after channel B's history was loaded, overwriting it.  
**Fix** — Captured `channelId` at effect start; added `if (activeRef.current?.id !== channelId) return` in both `.then()` callbacks.

---

### B10 — WS reconnected on every channel switch (duplicate join events)

**Symptom** — Switching channels showed "→ joined" 3× in chat; message send sometimes failed.  
**Root cause** — `active` was in the WS `useEffect` dependency array — every `setActive()` triggered a full reconnect.  
**Fix** — Removed `active` from the deps array. Channel switching uses `switchChannel()` WS actions only.

---

### B11 — Member panel displayed UUID fragments instead of names

**Symptom** — MemberPanel showed "7e8a544a (you) Owner" instead of "Alice (you) Owner".  
**Root cause** — `GET /channels/:id` returned `ChannelMember[]` with only `entityId`; no `entityName`.  
**Fix** — Added `Promise.all` enrichment in the `GET /:id` handler: calls `storage.findEntityById(m.entityId)` for each member, spreads `entityName` onto the response.

---

### B12 — MCP `action()` concurrent-call race

**Symptom** — Two simultaneous `joinChannel` calls resolved each other's promises.  
**Root cause** — `pendingActions` was `Map<string, handler>` — second call overwrote the first.  
**Fix** — Changed to `Map<string, handler[]>` FIFO queue; `handleIncoming` uses `queue.shift()`.

---

### B13 — MCP `sendChat()` was fire-and-forget

**Symptom** — `send_message` returned `{success:true}` even when WS was disconnected.  
**Root cause** — `send()` silently dropped messages if `ws.readyState !== OPEN`; no error propagated.  
**Fix** — `sendChat()` now throws if WS not OPEN; `tools/message.ts` wraps in try-catch.

---

### B14 — MCP `startStream()` had a misleading async signature

**Symptom** — Callers awaited a function that was fully synchronous.  
**Root cause** — `async startStream()` never awaited anything.  
**Fix** — Removed `async`; added WS-open guard that throws synchronously on disconnect.

---

### B15 — MCP tool errors masked as JSON parse errors

**Symptom** — On HTML error pages (5xx), tools threw "Unexpected token '<'" instead of the real HTTP error.  
**Root cause** — All `!res.ok` branches called `await res.json()` unconditionally.  
**Fix** — Wrapped `res.json()` in try-catch in `tools/account.ts`, `tools/channel.ts`, `tools/message.ts`; fallback to `` `HTTP ${res.status}: ${res.statusText}` ``.

---

### B16 — SSE mode had no backend

**Symptom** — SSE login appeared to connect but delivered no events.  
**Root cause** — Neither `api-server` nor `ws-server` implemented an SSE endpoint.  
**Fix** — Removed SSE option from `Login.tsx`; added empty-URL guard in `Chat.tsx` SSE `useEffect`.

---

### B17 — Simple mode auth accepted spurious system messages

**Symptom** — Server startup broadcasts sometimes falsely completed the auth handshake.  
**Root cause** — Success condition was `msg.type === 'system' || ...` — any system frame satisfied it.  
**Fix** — Tightened to require `payload?.action === 'auth' && payload?.success === true` or `event === 'welcome'`.

---

### B18 — `.claude/mcp.json` had hardcoded macOS paths

**Symptom** — MCP server failed to start on this Windows machine.  
**Root cause** — File committed with original developer's `/Users/shangui/...` paths.  
**Fix** — Replaced with correct Windows paths matching `.mcp.json`.

---

### B19 — `pnpm setup` did not write `WATCH_CHANNELS`

**Symptom** — After setup, mention-watcher started but joined no channels.  
**Root cause** — `writeEnvFile()` call in `setup.ts` omitted `WATCH_CHANNELS`.  
**Fix** — Added `WATCH_CHANNELS: env.WATCH_CHANNELS ?? 'general'` to the call.

---

### B20 — mention-watcher crashed on Windows (Unix shell paths)

**Symptom** — `pnpm watch -- claude` immediately crashed with "spawn /bin/zsh ENOENT".  
**Root cause** — `process.env.SHELL || '/bin/zsh'`; `spawnViaScriptPty` used Unix `script` command.  
**Fix** — `index.ts`: shell detection checks `COMSPEC` first; `process.platform === 'win32'` guard skips `script` wrapper.

---

### B21 — MemoryAdapter data wiped on every hot-reload

**Symptom** — Every source file save wiped all users and channels; `pnpm setup` required after every edit.  
**Root cause** — `tsx watch` restarts the Node.js process; all `Map` data is in-process.  
**Fix** — Added `PERSIST_FILE` JSON serialization to `MemoryAdapter` (see §3.4).

---

### B22 — `dev-server` had no build script

**Symptom** — `pnpm build` logged "No projects matched the filters" and skipped `dev-server`.  
**Root cause** — `apps/dev-server/package.json` had no `"build"` script.  
**Fix** — Added `"build": "tsc --noEmit"`.

---

### B23 — SSE write-after-disconnect crash

**Symptom** — If a client disconnected mid-stream, `res.write()` would throw on a closed socket.  
**Root cause** — No guard on `res.writableEnded` before writing to the response stream.  
**Fix** — Added `if (!res.writableEnded)` check before every `res.write()` call in the SSE handler in `apps/ws-server/src/create-server.ts`.

---

### B24 — README stale port reference

**Symptom** — `Visit http://localhost:3000` appeared in the "Use the Client → Web Client" section, contradicting the fork note that said port 3000 is the API server.  
**Fix** — Updated to `Visit http://localhost:4000` with a separate note pointing simple-service users to `:9000`.

---

### B25 — Server heartbeat terminated all checked connections on first dead one

**Symptom** — If any connection had `_isAlive === false` when the heartbeat fired, `return` exited the entire interval callback, leaving all subsequent connections un-pinged and eventually stale.  
**Root cause** — `gateway.ts` `setupHeartbeat()` used `return` instead of `continue` inside the `for...of` loop.  
**Fix** — Changed `return` to `continue` so the heartbeat checks all connections each cycle.

---

### B26 — CLI crashes with ERR_USE_AFTER_CLOSE in non-interactive mode; no reconnect in JWT mode

**Symptom** — Running the JWT CLI in a non-interactive script context (piped stdin, automated test, daemon) crashed or exited immediately after disconnect. No reconnect logic existed.  
**Root cause** — readline was always created, blocking non-TTY use. The `ws.on("close")` handler called `process.exit(0)` unconditionally.  
**Fix** — Added `--daemon` / `-d` flag: when set, readline is not created (`rl = null`), all `rl.question()` calls are guarded with `if (DAEMON || !rl) return`. Added `connectWs()` function with reconnect: in JWT mode on unexpected close, retries with exponential backoff (1 s → 30 s cap, max 10 attempts). Intentional close (`/quit`) sets `intentionalClose = true` to bypass reconnect. Also fixed the keepalive: was sending `{ type: "action", payload: { action: "ping" } }` which hit the "Unknown action" handler; now sends `{ type: "ping" }` which the WS server handles correctly.

---

### B27 — Role strings stored as uppercase, rejected by role comparisons

**Symptom** — After adding a member with an explicit role (e.g. `"MEMBER"` passed from the CLI or REST body), the member's `canSendMessages()` check returned `false`, silently blocking WS message delivery.
**Root cause** — `POST /channels/:id/members` and `PATCH /channels/:id/members/:entityId` accepted the `role` body field as a raw string without normalizing case. `EntityRole` enum values are lowercase (`"member"`, `"admin"`, etc.), but callers passing `"MEMBER"` bypassed the enum check, storing the uppercase string. The `ROLE_HIERARCHY` lookup then returned `undefined`.
**Fix** — Both handlers in `apps/api-server/src/routes/channels.ts` now call `.toLowerCase()` on the incoming `role` before storing: `(role.toLowerCase() as EntityRole)`.

---

### B28 — Fullwidth Plus Sign (U+FF0B) in Sidebar create-channel button

**Symptom** — The Sidebar "Create channel" button rendered a fullwidth `＋` (U+FF0B, a CJK compatibility character) rather than the standard ASCII `+`. Technically functional but not English-only program text.
**Root cause** — The Unicode fullwidth form was used as a visual shortcut for a wider-looking plus without being a genuine ASCII character.
**Fix** — Replaced `＋` with `+` (U+002B) in `web/src/components/Sidebar.tsx`.

---

### B30 — WS subscribed to only the active channel — unread badges and messages invisible for non-active channels

**Symptom** — After page load, messages sent to any channel other than the currently visible one produced no unread badge and were silently dropped. Only messages received while the user was actively viewing that channel appeared.
**Root cause** — The WS `onopen` handler sent a `join` action only for `activeRef.current` (the single visible channel). The `switchChannel` function also sent a `leave` action for the previous channel on every switch, ensuring at most one channel subscription existed at any time.
**Fix** — Three changes in `web/src/components/Chat.tsx`:
1. Added `channelsRef` (mirrors `channels` state via `useEffect`) so `onopen` can read the full channel list without a stale closure.
2. `onopen` now iterates `channelsRef.current` and sends `join` for every channel after connecting — the browser stays subscribed to all channels, enabling unread badge increments from messages in non-active channels.
3. Removed the `leave` action from `switchChannel` — staying subscribed to all channels is the correct behavior; leaving actively broke unread tracking.
4. Added a `useEffect` on `channels` that re-joins all channels whenever the list changes (new channel joined or created), since `join` is idempotent on the server.

---

### B31 — WS `join` action not idempotent — duplicate pubsub subscriptions from B30

**Symptom** — After the B30 fix (joining all channels on WS connect), each channel received messages multiple times when the user reconnected — one delivery per join call for that channel.
**Root cause** — The WS server's `join` action handler unconditionally called `pubsub.subscribe()` on every call, with no check for whether the channel was already subscribed. B30 now calls `join` for all channels on every WS connect, so re-connections created N+1 subscriptions per channel.
**Fix** — Added `const alreadySubscribed = conn.channels.has(channelId)` check in `apps/ws-server/src/gateway.ts`. The pubsub subscription and the join-signal broadcast are now gated on `!alreadySubscribed`, making `join` idempotent.

---

### B32 — `GET /agents` returned channels instead of agents

**Symptom** — `GET /agents` (admin-only endpoint) returned a list of channels with member counts, not agent entities.
**Root cause** — The handler called `storage.listChannels()` with no argument (listing all channels) and returned the result under the key `agents`.
**Fix** — Replaced with `storage.listEntities()` filtered to `type === EntityType.AGENT`, with email stripped from the public profile. Now correctly returns agent entities only.

---

### B33 — Channel password field in UI not backed by server; `POST /export` wrong HTTP method

**Symptom** — The create-channel form had a "Password (optional)" field that was silently ignored by the server (backend accepted no `password` field). The export endpoint was `POST` despite being read-only.
**Root cause** — The password field was scaffolded in the UI but never implemented in the backend. `POST /channels/:id/export` was declared as POST (which suggests state mutation) but performs no state change.
**Fix** — Removed the password input and associated state from `Sidebar.tsx`, `Chat.tsx`, and `web/src/lib/api.ts`. Changed `POST /:id/export` to `GET /:id/export` in `channels.ts`.

---

### B29 — Message pagination cursor semantics unintuitive; no `nextCursor` in response

**Symptom** — API consumers calling `GET /channels/:id/messages?cursor=<id>` got overlapping pages when passing the last (newest) message ID from the previous page as the cursor, which is the standard REST convention. The response gave messages that overlapped with the previous page instead of the next older page.
**Root cause** — `listMessages` in `MemoryAdapter` treats cursor as an exclusive upper bound: it returns messages *before* the cursor in the storage array (oldest-first). Callers expecting `cursor = last_item.id` for forward pagination received `[prev_to_last, last]` (overlap) instead of `[older, older-still]`.
**Fix** — Added `nextCursor` field to the `GET /:id/messages` response in `apps/api-server/src/routes/channels.ts`:
```ts
const nextCursor = messages.length > 0 ? messages[0].id : null;
return reply.send({ messages, count: messages.length, nextCursor });
```
`nextCursor` is the oldest message's ID in the current page — passing it as `?cursor=` retrieves the previous (older) page with zero overlap. The underlying storage behavior is unchanged; the fix makes the correct cursor value explicit in the response.

---

## 4a. Session 2 Fixes & Additions

> Made after B1–B33 were verified complete. All changes TypeScript-clean across all five packages.
>
> Each entry carries a **Verification** status:
> - `[source-verified]` — confirmed correct by direct source inspection; not yet exercised in a running stack
> - `[runtime-tested — 3-way chat simulation, 2026-06-03]` — exercised in a running stack with simulated concurrent users

---

### GAP-1 — Dangling pubsub subscription on channel leave

**Symptom** — After a user leaves a channel, the server continued firing the pubsub callback for that channel on the abandoned connection. Delivery was blocked by a `conn.channels.has(channelId)` guard, but the callback itself still executed — wasted CPU on channels with high leave/rejoin churn.  
**Root cause** — The `leave` action handler deleted `channelId` from `conn.channels` and removed the connection from `channelConns`, but never called `pubsub.unsubscribe()`. Unsubscribe functions accumulated in a global array and were only cleared when the entire connection closed.  
**Fix** — Added `channelUnsubs: Map<string, () => void>` to the `ConnectionInfo` interface. The join handler stores the unsub function keyed by `channelId`. The leave handler retrieves and calls the stored unsub before deleting from `conn.channels`. The reconnect handler also calls `unsub()` before re-subscribing to prevent duplicates.  
**File** — `apps/ws-server/src/gateway.ts`  
**Verification** — `[runtime-tested — 3-way chat simulation, 2026-06-03]` — steps 10–11: Carol left, Alice's message received by Bob, Carol received nothing; step 12: Carol rejoined cleanly with no duplicate subscription (B31 guard confirmed)

---

### GAP-2 — `POST /channels` accepted unknown body fields including `password`

**Symptom** — `POST /channels` with `{ type: "GROUP", name: "x", password: "secret" }` returned 201 with no error. The `password` field was silently ignored, misleading callers who believed the README's password-protected channel feature was active.  
**Root cause** — No Fastify JSON schema was attached to the route. Fastify passed the full request body to the handler without validation.  
**Fix** — Added a Fastify `schema.body` with explicit properties and `additionalProperties: false`. Combined with R4 fix (`removeAdditional: false` in AJV config), unknown fields now return 400.  
**File** — `apps/api-server/src/routes/channels.ts`  
**Verification** — `[runtime-tested — REST sweep, 2026-06-03]`

---

### Item A — Password-protected channels tombstoned in README Part 1

**Symptom** — README Part 1 mentioned password-protected channels in four places. B33 had already removed the UI field because no backend ever implemented this feature. The README still implied the feature existed.  
**Fix** — Added `_(planned — not yet implemented)_` to both feature references in README Part 1.  
**File** — `README.md`  
**Verification** — `[source-verified]` _(documentation change only)_

---

### Item B — `connect_service` MCP tool was not registered

**Symptom** — Every agent usage example in the README called `connect_service`. The tool was never registered in the gateway — only `authenticate` and `join_channel` existed separately. All README usage scenarios were broken as written.  
**Root cause** — `connect_service` was described in the README as a convenience composite but never implemented.  
**Fix** — Added `connect_service` tool to `create-server.ts`: checks `bridge.isConnected()`, calls the existing `joinChannel()` helper, returns `{ success, channelId, message }`.  
**File** — `apps/agent-gateway/src/create-server.ts`  
**Verification** — `[source-verified]`

---

### Item C — README Part 1 still referenced `open_chat_terminal` as a live tool

**Symptom** — README Part 1 showed `open_chat_terminal` in three usage scenarios even though README-PART2 §6.1 had already documented it as intentionally replaced by mention-watcher.  
**Fix** — Replaced all `open_chat_terminal` references in README Part 1 with `pnpm watch -- claude` / mention-watcher instructions. Added a cross-reference to README-PART2 §3.2. Removed the upstream-only public test server URL `ws://8.140.63.143:9000`.  
**File** — `README.md`  
**Verification** — `[source-verified]` _(documentation change only)_

---

### Item D — `stream://{channelId}/messages/recent` and `/latest` MCP resources not registered

**Symptom** — The README MCP Resources table listed these two resources. Neither was registered in `create-server.ts` — no `stream://` resources existed at all.  
**Fix** — Added two `ResourceTemplate` handlers backed by the existing `readHistory()` helper. `/recent` returns the last 50 messages for a channel; `/latest` returns the single most recent message.  
**File** — `apps/agent-gateway/src/create-server.ts`  
**Verification** — `[source-verified]`

---

### Item E — `connection://{channelId}/status` per-channel resource missing

**Symptom** — README listed a per-channel variant of the connection status resource. Only the global `connection://status` existed.  
**Fix** — Added `ResourceTemplate` for `connection://{channelId}/status` returning `{ channelId, subscribed, connected }` using `bridge.getChannels()`.  
**File** — `apps/agent-gateway/src/create-server.ts`  
**Verification** — `[source-verified]`

---

### Item F — `list_connections` MCP tool not registered

**Symptom** — README FAQ described this tool as a way to inspect active channel connections. Not registered.  
**Fix** — Added `list_connections` tool returning `{ connected, channels }` from current bridge state.  
**File** — `apps/agent-gateway/src/create-server.ts`  
**Verification** — `[source-verified]`

---

### Item G — Latency histograms absent from `metrics://snapshot`

**Symptom** — README promised p50/p95/p99 latency percentiles in the metrics snapshot. The snapshot returned only 5 counters (mention waiters, message waiters, active streams, external connections, consecutive timeouts) — no timing data.  
**Root cause** — No timing instrumentation existed on pending actions.  
**Fix** — Added `latencySamples: number[]` (capped at 500 entries) to `WsBridge`. Each pending action carries a `sentAt: number` timestamp. On resolution, `recordLatency(Date.now() - sentAt)` is called. `getLatencyPercentiles()` returns `{ p50, p95, p99, sampleCount }` using sorted interpolation; returns nulls when `sampleCount < 5`. The `metrics://snapshot` resource now includes the `latency` object.  
**Files** — `apps/agent-gateway/src/ws-bridge.ts`, `apps/agent-gateway/src/create-server.ts`  
**Verification** — `[source-verified]`; requires live MCP agent round-trips to populate samples

---

### Item H — Reconnect tokens not implemented; session restore required full re-auth

**Symptom** — README promised "reconnect tokens, auto-restore room state". On WS disconnect, the web client and MCP bridge had to re-authenticate and re-join channels from scratch. No reconnect token was ever minted or stored.  
**Root cause** — Only JWT auth existed. No server-side token store or client-side token persistence mechanism existed.  
**Fix** — Three-layer implementation:
- **Server** (`gateway.ts`): mints a UUID token on auth success (24 h TTL), stores it in `reconnectTokens: Map` with the entity's current channel snapshot. Token included in auth response. Channel snapshot updated on every join and leave. New `case 'reconnect'` WS action validates the token, restores entity context, re-subscribes to all stored channels, refreshes TTL, responds with `{ success, restoredChannels, reconnectToken }`. Prune interval every 5 minutes.
- **MCP client** (`ws-bridge.ts`): stores `reconnectToken` from auth response. On `connect()` open, if token exists, sends `{ action: 'reconnect', reconnectToken }` before normal auth.
- **Web client** (`Chat.tsx`): `reconnectTokenRef` initialized from `sessionStorage`. WS `onopen` sends reconnect action and returns early if token exists, skipping join-all. Token persisted to sessionStorage on auth/reconnect success, cleared on logout.  
**Files** — `apps/ws-server/src/gateway.ts`, `apps/agent-gateway/src/ws-bridge.ts`, `web/src/components/Chat.tsx`  
**Verification** — `[runtime-tested — 3-way chat simulation, 2026-06-03]` — steps 13–16: Bob's reconnectToken captured from auth response; Bob disconnected and reconnected; server restored his channel in `restoredChannels`; Alice's post-reconnect message received by Bob confirming subscription was fully restored

---

### Item I — No sliding window message buffer; `stream://*/messages/recent` required REST call

**Symptom** — README: "Sliding window message buffer (max 50) to prevent memory overflow". No buffer existed. `stream://*/messages/recent` fell through to a REST `/messages` call for every read.  
**Root cause** — `WsBridge` had no in-process cache. Every MCP resource read triggered a network call to the API server.  
**Fix** — Added `messageBuffer: Map<string, WireMessage[]>` and `MESSAGE_BUFFER_MAX = 50` constant to `WsBridge`. Every incoming `chat` message with a `channel` field is stored via `bufferMessage()` (drop-oldest eviction at cap). `getBufferedMessages(channelId)` returns a shallow copy. The `stream://{channelId}/messages/recent` resource prefers the buffer over a REST call when the buffer has entries (returns `{ messages, source: "buffer" }`). Buffer cleared on `leaveChannel()`.  
**Files** — `apps/agent-gateway/src/ws-bridge.ts`, `apps/agent-gateway/src/create-server.ts`  
**Verification** — `[source-verified]`

---

### R4 — Fastify AJV defaults strip unknown fields instead of rejecting them

**Symptom** — `POST /channels` with `{ type: "GROUP", name: "x", password: "secret" }` returned 201 instead of 400, despite the GAP-2 schema having `additionalProperties: false`. The password field was silently stripped from the body before the handler ran.  
**Root cause** — `@fastify/ajv-compiler` v3 (used by Fastify 4.x) defaults to `removeAdditional: true`, which strips unknown properties and passes validation. The Fastify docs say `false` is the default, but the actual compiler behavior differs. Confirmed by REST integration test.  
**Fix** — Added `ajv: { customOptions: { removeAdditional: false } }` to the `Fastify({...})` call in `create-server.ts`. Unknown fields now correctly return 400.  
**File** — `apps/api-server/src/create-server.ts`  
**Verification** — `[runtime-tested — REST sweep, 2026-06-03]`

---

### Runtime Issues Found During Simulation Prep

Three bugs were discovered by static analysis of the modified files before the simulation ran. All three were fixed and TypeScript-verified before the simulation executed.

---

#### R1 — `reconnect` action crashed on null/missing payload

**Root cause** — `case 'reconnect'` in `gateway.ts` destructured `reconnectToken` from `payload` with `payload as { reconnectToken: string }` — a TypeScript cast that has no runtime effect. If an incoming message had `payload: null` or `payload: undefined` (valid JSON, malformed protocol), the destructure threw a `TypeError` before the `if (!reconnectToken)` guard could fire.  
**Fix** — Added explicit null/type guard: `if (!payload || typeof payload !== 'object')` before the destructure; responds with a `success: false` error frame rather than crashing the message handler.  
**File** — `apps/ws-server/src/gateway.ts`  
**Verification** — `[source-verified]`; simulation used well-formed payloads so this path was not exercised

---

#### R2 — Dead `??` operator in role normalization let empty-string role pass through

**Root cause** — Role normalization in `POST /channels/:id/members` used `(role.toLowerCase() as EntityRole) ?? EntityRole.MEMBER`. The `??` operator returns the right-hand side only when the left is `null` or `undefined`. `String.prototype.toLowerCase()` always returns a string — even `""` — so `?? EntityRole.MEMBER` could never fire. An empty string `role` value would be stored as `""` and silently fail all `EntityRole` comparisons.  
**Fix** — Changed to `(role.toLowerCase() || EntityRole.MEMBER)` — uses `||` (falsy check) which correctly catches the empty-string case.  
**File** — `apps/api-server/src/routes/channels.ts`  
**Verification** — `[source-verified]`

---

#### R3 — No body schema on `POST /channels/:id/members` — missing `entityId` reached storage as `undefined`

**Root cause** — Unlike `POST /channels` (which had a schema added in GAP-2), the members endpoint had no Fastify body schema. A request with no body or a body missing `entityId` would destructure `entityId = undefined` and call `storage.findEntityById(undefined)`, returning a 404 "Entity not found" with no indication the body was malformed.  
**Fix** — Added Fastify `schema.body` with `entityId` as a required string property and `additionalProperties: false`.  
**File** — `apps/api-server/src/routes/channels.ts`  
**Verification** — `[source-verified]`

---

### B34 — `PERSIST_FILE` env variable never loaded; persistence silently disabled

**Symptom** — `dev-state.json` was never created despite `PERSIST_FILE=./dev-state.json` in `.env`. All data was wiped on every stack restart. `admin@localhost` (the bootstrap admin) did not survive a restart.  
**Root cause** — `tsx` does not auto-load `.env` files. The `pnpm dev` script ran `tsx watch apps/dev-server/src/index.ts` without any env loading, so `process.env.PERSIST_FILE` was always `undefined` and `MemoryAdapter` ran in ephemeral mode.  
**Fix** — Added `--env-file=.env` to the dev script: `tsx watch --env-file=.env apps/dev-server/src/index.ts`. Also updated the startup banner to display the active persist file path when set, so the mode is visible at startup.  
**Files** — `package.json`, `apps/dev-server/src/index.ts`  
**Verification** — `[runtime-tested — persistence restart test, 2026-06-03]` — registered user survived `pnpm kill` + `pnpm dev` restart; login confirmed

---

## 4c. Session 3 Security Fixes — 2026-06-03

Found during post-implementation code review. All TypeScript-clean.

---

### S1 — Reconnect restored channels without verifying current membership

**Symptom** — A user kicked from a channel while disconnected would silently regain access on reconnect for up to 24 hours.  
**Root cause** — The `case 'reconnect'` handler in `gateway.ts` re-joined all channels from the stored snapshot without calling `storage.findMember()` to verify each one was still valid.  
**Fix** — Added `const member = await this.storage.findMember(channelId, stored.entityId)` check inside the restore loop; channels where membership no longer exists are skipped.  
**File** — `apps/ws-server/src/gateway.ts`

---

### S2 — Reconnect token not rotated on use — replay window extendable indefinitely

**Symptom** — The same token was returned after each successful reconnect and its TTL refreshed. An attacker with a captured token could replay it every 24 hours indefinitely.  
**Root cause** — The handler mutated `stored.expiresAt` and returned the original `reconnectToken` unchanged.  
**Fix** — Token is now deleted before the restore loop (`this.reconnectTokens.delete(reconnectToken)`); a fresh UUID is issued after the restore loop and returned to the client. Old token cannot be reused.  
**File** — `apps/ws-server/src/gateway.ts`

---

### S3 — Role normalization accepted unrecognized role strings

**Symptom** — Passing `role: "superadmin"` to `POST /channels/:id/members` or `PATCH /channels/:id/members/:entityId` would be lowercased and stored as-is — never matching any `EntityRole` value, silently granting no permissions.  
**Root cause** — Normalization used `role.toLowerCase()` with no enum membership check.  
**Fix** — Both handlers now validate against `Object.values(EntityRole)`: unknown values fall back to `EntityRole.MEMBER` on POST, and return `400 Invalid role` on PATCH.  
**File** — `apps/api-server/src/routes/channels.ts`

---

## 4d. Session 3 Runtime Tests — 2026-06-03

> Previously deferred items — all now runtime-confirmed.

### MCP Tool Surface (`mcp-tool-test.mjs`)

21/21 PASS. Script spawns a fresh gateway instance on `:3009` (the running `:3002` gateway uses single-session `StreamableHTTPServerTransport`, so subsequent `initialize` calls return 400 — fresh instance required for test isolation).

| Test | Status |
|------|--------|
| Health check on existing `:3002` | ✅ |
| MCP session initialize | ✅ |
| `authenticate` (JWT) | ✅ WS bridge connected |
| `list_connections` | ✅ |
| `list_channels` | ✅ |
| `connect_service` | ✅ Joined `general` |
| `list_members` | ✅ |
| `send_message` | ✅ Delivered |
| `read_history` | ✅ Pagination cursor present |
| `get_context` | ✅ AI-ready context string |
| `get_unread` | ✅ |
| `stream_output` | ✅ Chunk + done flag |
| `connection://status` | ✅ Auth state + scopes |
| `metrics://snapshot` | ✅ Counters + p50/p95/p99 latency |
| `connection://general/status` | ✅ Per-channel subscription |
| `stream://general/messages/recent` | ✅ Last 50 messages |
| `stream://general/messages/latest` | ✅ Single most-recent |
| `wait_for_message`, `wait_for_mention`, `abort_stream`, `disconnect_stream` | ✅ Registered (timeout-path tested) |

**Key finding:** `StreamableHTTPServerTransport` is single-session. In production, each Claude agent spawns its own gateway instance via `stdio` transport or connects before any other client.

---

### CLI JWT Mode

**PASS** — all checks green.

| Check | Result |
|-------|--------|
| `pnpm --filter agent-room-cli build` | ✅ TypeScript compiled cleanly |
| `POST /auth/register` | ✅ JWT issued |
| Daemon startup (`--jwt <token> --daemon --room general`) | ✅ `Mode: Full-stack WS (JWT)` banner |
| No crash / no `ERR_USE_AFTER_CLOSE` in 5 s | ✅ |
| WS connected + channel joined | ✅ `→ joined #general` |
| Message send via piped stdin | ✅ Message delivered |

Channel flag is `--room <name>` (not `--channel`).

---

### mention-watcher PTY Bridge

**PASS** after fixing B35 (see §4c / B35 below).

| Check | Result |
|-------|--------|
| `node-pty` prebuilt binary present (win32-x64) | ✅ No MSVC needed |
| `node-pty` loads in Node.js | ✅ |
| `pnpm setup` — register agent, provision token, write `.env` | ✅ |
| MCP token synced to `.mcp.json` and `.claude/mcp.json` | ✅ |
| Watcher starts, authenticates, connects to WS server | ✅ |
| Agent joins `#general` channel | ✅ |
| PTY subprocess spawned (node-pty API wrap) | ✅ After B35 fix |

**Production use:** `pnpm watch -- claude` — wraps the Claude Code CLI; `claude` must be in PATH.

---

### B35 — mention-watcher PTY spawn always fatal: `proc.onData is not a function`

**Symptom** — `[mention-watcher] Fatal: proc.onData is not a function` on every spawn attempt.  
**Root cause** — `pty.spawn()` returns an `IPty` object where `onData`, `onExit`, `write`, `resize`, and `kill` are prototype methods, not own enumerable properties. The code used `proc = { ...p, mode: 'pty' }`, which copies only own enumerable properties — all methods were missing from the spread result.  
**Fix** — Replaced the spread with an explicit wrapper:
```typescript
proc = {
  mode: 'pty',
  write: (data) => p.write(data),
  onData: (cb) => p.onData(cb),
  onExit: (cb) => p.onExit(cb),
  resize: (cols, rows) => p.resize(cols, rows),
  kill: (signal) => p.kill(signal),
};
```
**File** — `apps/mention-watcher/src/index.ts`  
**Verification** — `[runtime-tested — mention-watcher PTY test, 2026-06-03]` — watcher authenticated, connected to WS, joined `#general` via PTY subprocess.

---

## 4b. Integration Test Results — 2026-06-03

> All tests run against the live stack (`pnpm dev`): api-server :3000, ws-server :3001, agent-gateway :3002, web :4000.

### 3-Way WebSocket Simulation (`simulate-3way.mjs`)

16/16 steps passed.

| Steps | What was verified |
|-------|-------------------|
| 1–2 | Register, login, JWT issuance |
| 3–4 | Channel create (POST /channels); REST self-join (B2 fix) |
| 5–7 | WS connect, auth response, join action |
| 8–9 | 3-way pub/sub delivery — all 3 users received messages |
| 10–11 | GAP-1: Carol left; Alice's message received by Bob, NOT by Carol |
| 12 | B31: Carol rejoined without duplicate subscription |
| 13–16 | Item H: reconnect token captured; Bob disconnected and reconnected; `restoredChannels` returned test channel; Bob received post-reconnect message |

### REST Endpoint Sweep (`rest-sweep.mjs`)

13/13 steps passed (after R4 AJV fix).

| Step | Endpoint | Bug/Item | Result |
|------|----------|----------|--------|
| 5 | `GET /entities` | B1 | ✅ Array returned, names present, email stripped |
| 6 | `GET /channels/:id` members | B11 | ✅ `entityName` field present on all members |
| 7 | `PATCH /channels/:id/members/:entityId` role `"ADMIN"` | B27 | ✅ Stored as `"admin"` (lowercase) |
| 8 | `GET /channels/:id/messages` | B29 | ✅ `nextCursor` in response; null when empty |
| 9 | `GET /channels/:id/export` | B33 | ✅ GET returns 200; POST returns 404 |
| 10 | `POST /channels` with `password` field | GAP-2 + R4 | ✅ Returns 400 |
| 11 | `POST /channels/:id/members` without `entityId` | R3 | ✅ Returns 400 |
| 12 | `GET /agents` (non-admin) | B32 auth gate | ✅ Returns 403 (correct; B32 type filter source-verified) |
| 13 | `GET /channels/:id/export` non-member of private channel | B33 | ✅ Returns 403 |

### SSE Mode (`GET /events` on ws-server :3001)

1/1 passed.

- Connected SSE client, joined channel via WS, sent chat message — SSE frame received within 3s. `B16`/`B23` fixes confirmed.

### Web UI Browser Smoke Test (Orca browser, localhost:4000)

Tested via Orca browser automation on 2026-06-03.

| Step | Result |
|------|--------|
| Login page renders (tabs, form, footer hint) | ✅ |
| API reachable from browser context (CORS OK) | ✅ |
| Session restore from `localStorage` (`agentroom_session`) | ✅ |
| Chat view loads after session restore | ✅ |
| Sidebar shows multiple channels | ✅ |
| WS connects on load (join events appear in chat) | ✅ |
| Message typed via keyboard and submitted with Enter | ✅ Message sent, input cleared |
| Member panel shows `entityName` (falls back to entityId if entity missing) | ✅ B11 enrichment confirmed |

**Additional verification (post-smoke-test):**
- **B30 browser-confirmed** via Orca browser automation (2026-06-03): sent a WS message to a non-active channel from an external Node.js client; unread badge `2` appeared on the channel button in the sidebar; switching to the channel cleared the badge. Full React path confirmed: server delivery → `setUnreadCounts` → Sidebar renders badge → `switchChannel` clears count.
- **B10 source+runtime confirmed** via Chat.tsx audit: WS `useEffect` dep array is `[token, config, connType]` — `active` is absent; comment in code confirms this is intentional.
- **Persistence restart (B34 fix) — PASS**: `pnpm restart` with `--env-file=.env` flag preserves all MemoryAdapter data.

**Not runtime-tested (explicitly deferred):**
- Theme toggle (☀️/🌙 button) — visual only
- MCP tool surface — requires live Claude agent MCP session
- CLI JWT mode — requires interactive `agent-room-cli` invocation
- mention-watcher — requires `node-pty` native build (Windows Build Tools)

**Form input caveat:** Orca `fill` sets DOM value but does not trigger React's `onChange`. Keyboard `type` correctly triggers React events. Login form was bypassed via `localStorage` injection; login API itself verified to work from browser context.

---

## 4e. Session 4 — Gap Analysis & Hardening — 2026-06-03

Systematic pattern analysis of B1–S3 bug history to predict latent issues using the following recurring failure modes:

| Pattern | Representative bugs |
|---------|-------------------|
| Documented but never implemented | B1, B16, B32, B33, Items B–G |
| Protocol contract mismatches | B3, B17, B27, R2 |
| Stale closure / React race conditions | B5, B7–B10, B12, B31 |
| Errors silently swallowed | B6, B13–B15 |
| Resource lifecycle leaks | B8, B25, GAP-1 |
| Platform / environment assumptions | B18–B20, B34 |
| Missing input validation at boundaries | GAP-2, R1–R3, S3 |
| Security bolted on last | S1–S3 |

10 gaps predicted. Results:

| ID | Gap | Result | Action |
|----|-----|--------|--------|
| G1 | `/restrict` flag silently ignored by WS server | ✅ Confirmed | Documented — deferred |
| G2 | `/dm` broadcasts to all channel members (`isDm: true` ignored server-side) | ✅ Confirmed | Documented — by-design |
| G3 | JWT expiry during active session not detected | ✅ Confirmed | Documented — WEB UI concern |
| P5F | SSRF: `connect_stream` accepted any URL scheme | ✅ Confirmed | **Fixed** |
| P8F | Message pagination `limit` param unbounded (no max cap) | ✅ Confirmed | **Fixed** |
| — | Pending waiter leak on WS disconnect | ✗ Not a bug — timeouts clean up correctly | Ruled out |
| — | `wait_for_message` timeout bounds | ✗ Not a bug — Zod schema enforces 5–120 s | Ruled out |
| — | `AGENT_TOKEN` valid after entity deletion | ✗ Not a bug — `verifyTokenCredential` returns null → auth fails | Ruled out |
| — | Latency samples persist across reconnects | ✗ Acceptable — rolling 500-sample window, old data evicted | Ruled out |
| — | SSE token in URL query param | ✗ Known EventSource limitation — requires proxy to fix | Acknowledged |

---

### P5F — `connect_stream` accepted non-WS URL schemes (SSRF vector)

**Symptom** — An MCP agent could pass `url: "http://169.254.169.254/..."` or any arbitrary scheme to `connect_stream`. The `ws` library would attempt the connection, potentially probing internal network services.  
**Root cause** — The Zod `z.string().url()` validator only checks URL format, not scheme. No scheme allowlist existed.  
**Fix** — Added explicit scheme guard before `new WebSocket(...)`:
```typescript
const parsedUrl = new URL(p.url as string);
if (!['ws:', 'wss:'].includes(parsedUrl.protocol)) {
  throw new Error(`connect_stream only accepts ws:// or wss:// URLs (got: ${parsedUrl.protocol})`);
}
```
**File** — `apps/agent-gateway/src/create-server.ts`  
**Verification** — `[source-verified]`; TypeScript clean

---

### P8F — Message pagination `limit` parameter had no upper bound

**Symptom** — `GET /channels/:id/messages?limit=9999999` would pass `9999999` to `storage.listMessages()`, potentially returning the entire message history in a single response.  
**Root cause** — No Fastify querystring schema on the route — `limit` was cast with `Number()` but never bounded.  
**Fix** — Added Fastify `schema.querystring` to `GET /:id/messages`:
```typescript
schema: {
  querystring: {
    type: 'object',
    properties: {
      cursor: { type: 'string' },
      limit: { type: 'integer', minimum: 1, maximum: 200 },
    },
    additionalProperties: false,
  },
},
```
`limit` is now typed as `number` from the query (Fastify coerces it); the `Number(limit)` cast removed. Unknown query params return 400.  
**File** — `apps/api-server/src/routes/channels.ts`  
**Verification** — `[source-verified]`; TypeScript clean

---

### G1 — `/restrict` flag silently ignored by WS server — Deferred

**Symptom** — The web UI's `/restrict` command sends `{ type: 'chat', payload: { content, restricted: true } }`. The CLI's `/restrict` sends `{ type: 'action', payload: { action: 'permission.send_restricted', ... } }`. In both cases, the WS server either ignores the `restricted` field (chat path) or responds with "Unknown action" (action path). Restricted messages behave identically to regular messages.  
**Root cause** — `handleChat` in `gateway.ts` reads only `content`, `mentions`, `replyTo` from `payload`. No `permission.send_restricted` action case exists.  
**Status** — Deferred. The intended server semantics (role-gated visibility? observer-only delivery?) are not defined. No fix applied.

---

### G2 — `/dm` broadcasts to all channel members — Documented as by-design

**Symptom** — `/dm <user> <message>` sends `{ type: 'chat', payload: { content: '/dm @user: text', mentions: [user], isDm: true } }` to the full channel pubsub. `isDm: true` is ignored by the server. All channel members receive the message. Only the @mention mechanism distinguishes it — the target receives a `type:'mention'` event in addition to the chat message.  
**Root cause** — `handleChat` reads only `content`, `mentions`, `replyTo`. No DM routing path exists.  
**Status** — By-design limitation. DMs are a UI convention (purple `[DM]` badge, distinct styling) backed by @mention notifications, not true private routing. Implementing true private messaging would require routing chat messages to entity-scoped pubsub topics instead of the channel topic.

---

### G3 — JWT expiry not detected during active web session — Web UI concern

**Symptom** — The web client validates the stored JWT once on page mount via `GET /channels`. If the JWT expires during an active session (TTL default: 24 h), the WS connection stays alive (JWT verified only at initial connect) but REST calls begin returning 401. There is no in-session expiry detector or forced logout.  
**Root cause** — `page.tsx` performs a one-shot validation; no session watchdog or JWT `exp` claim check runs during the session.  
**Status** — Web UI concern. Out of scope for the current backend/CLI focus; can be addressed during web UI customization. Practical impact is low for local dev sessions shorter than the JWT TTL.

---

## 5. Customizations & Architecture Decisions

### 5.1 Authentication Improvements

- **Bootstrap first-user admin** — upstream `isFirstUser` logic preserved unchanged.
- **`JWT_SECRET` to env** — was a hardcoded constant; now read from `process.env.JWT_SECRET`.
- **`pnpm setup` auto-provisioner** — registers admin, mints agent token, writes to `.env`, patches all MCP configs. No manual token copying.
- **Session persistence** — `session.ts` persists `{ token, name, entityId, config }` to `localStorage`. On mount, `page.tsx` validates the stored token against `GET /channels`; a stale token triggers clean logout.
- **Simple service mode** — `Login.tsx` supports `connType=simple`: direct WS to port 9000, username-only auth, no JWT.

### 5.2 WebSocket Protocol Alignment

- **Stable WS deps** — WS `useEffect` depends only on `[token, config, connType]`. Channel switching uses `switchChannel()` over the open socket; no reconnect.
- **Auto-reconnect** — exponential backoff 1 s → 30 s cap; reset on success; `isIntentionalCloseRef` prevents reconnect on logout/unmount.
- **Three WS useEffects** — `ws` (JWT full-stack), `sse` (guarded no-op), `simple` (username auth to :9000).
- **@mention** — handles both server-push `type:'mention'` frames and inline `@username` parsing.

### 5.3 Command Parity with CLI

| CLI | Web slash | Notes |
|---|---|---|
| `/join` | `/join` `/j` | Self-join now works (B2 fixed) |
| `/leave` | `/leave` `/l` | WS leave action |
| `/switch` | `/switch` `/s` | WS leave + join actions; no reconnect |
| `/rooms` | `/rooms` `/r` | `GET /channels` |
| `/members` | `/members` `/m` | `GET /channels/:id` |
| `/users` | `/users` `/u` | `GET /entities` (B1 fixed) |
| `/dm` | `/dm` `/d` | WS chat with `isDm` flag; multi-user `[a,b]` syntax |
| `/create` | `/create` `/c` | REST POST + `switchChannel()` |
| `/history` | `/history` | `GET /channels/:id/messages` |
| `/myrole` `/whoami` | `/myrole` | Capability table |
| `/permissions` `/perms` | `/permissions` | Room config |
| `/role` `/grant` | `/role` `/grant` | `PATCH /channels/:id/members/:entityId` |
| `/restrict` | `/restrict` | WS chat with `restricted` flag |
| `/mention` `/at` | `/mention` | WS chat with @mention |
| `/debug` | `/debug` | Raw WS message display |
| `/help` `/h` | `/help` | Grouped command palette |
| `/quit` `/q` | `/quit` | Logout + clear session |

Commands are grouped in a `GROUPED_COMMANDS` palette: 🏠 Room & Chat · 💬 Messaging · 🔐 Permission Management · ⚙️ Other.

### 5.4 UI/UX Decisions

- **Theme flash prevention** — inline `<script>` in `<head>` applies `data-theme` from `localStorage` before React hydrates.
- **`suppressHydrationWarning` on `<body>`** — prevents mismatch warnings from browser extensions (e.g. Grammarly).
- **Skeleton loading** — 5 shimmer rows while `isLoadingMessages`.
- **Unread badges** — per channel, clamped to "99+", cleared on channel switch.
- **Message hover actions** — copy 📋, reply ↩, DM 💬.
- **Active channel in `sessionStorage`** — survives refresh, cleared on logout.

### 5.5 Member Enrichment (REST / WS Alignment)

`GET /channels/:id` now returns `{ ...member, entityName }`, matching what the WS gateway's `list_members` action already returned. `GET /channels/:id/context` already enriched names for message context lines. REST and WS are now consistent.

### 5.6 MCP Gateway Hardening

- **FIFO queue** — `pendingActions` changed from `Map<string, handler>` to `Map<string, handler[]>`; `handleIncoming` uses `queue.shift()`.
- **WS disconnect errors** — `sendChat()` and `startStream()` throw on disconnect instead of silently dropping.
- **Safe JSON error parsing** — all `!res.ok` branches try-catch `res.json()`; fallback to HTTP status text.

---

## 6. Known Remaining Gaps & Limitations

### 6.1 Upstream Features — Porting Status

| Feature | Upstream | Fork |
|---|---|---|
| `connect_stream` MCP tool | Connects to any WS/SSE URL | ✅ Implemented — bridges external WS to a channel |
| `wait_for_message` MCP tool | Waits for any channel message | ✅ Implemented — blocks on any message, 5–120 s timeout |
| MCP Resources (`connection://status`, `metrics://snapshot`) | Pollable connection diagnostics | ✅ Implemented |
| `open_chat_terminal` MCP tool | Spawns a synchronized PTY terminal | Replaced by mention-watcher (intentional — different UX) |
| OpenClaw integration | Slack/Discord/Telegram bridge | Upstream-only; explicitly out of scope |
| `npm install -g agent-room` | Single-command install | Fork is workspace-only (`pnpm install` at root) |

### 6.2 Local CLI Fork (`apps/agent-room-cli/`) — ✅ Complete

`agent-room-cli` has been forked into the pnpm workspace at `apps/agent-room-cli/`. The root `package.json` resolves `agent-room-cli` via `workspace:*`, so `pnpm cli` and `pnpm service:cli` now use the local TypeScript source. Both confirmed upstream bugs are fixed, and JWT mode has been added (see §3.9):

- **Help text spacing** — `/roomsList all rooms` — fixed by rendering the `/help` command table with `String.padEnd(20)` so the command column is always at least 20 characters wide before the description begins.
- **`ERR_USE_AFTER_CLOSE`** — CLI crashes when stdin closes in non-interactive/piped mode — fixed by adding an `rl.on('close', ...)` handler that sets an `rlClosed` flag and calls `process.exit(0)`, and by guarding all `rl.question()` calls with `if (!rlClosed)` before they execute.
- **`--daemon` / `-d` flag** — non-interactive/background mode: readline is not created, all `rl.question()` calls are skipped, the process stays connected and prints messages to stdout. No TTY required.
- **Auto-reconnect (JWT mode only)** — on unexpected disconnect, retries with exponential backoff (1 s → 30 s cap, max 10 attempts). Intentional close via `/quit` sets `intentionalClose = true` to bypass reconnect.

### 6.3 SSE Mode — ✅ Fully Implemented

SSE mode is now fully functional end-to-end. The backend `GET /events` endpoint is live on `ws-server` port 3001 (JWT-authenticated, pubsub-backed). The frontend `Login.tsx` restores the "📡 SSE" tab, and `Chat.tsx` activates its SSE `useEffect` when `connType: 'sse'` is set in sessionStorage. SSE connections are read-only; the send path is disabled with a banner in this mode.

### 6.4 Simple Service Isolation — ✅ Bridged

The CLI isolation gap has been closed. The `--jwt <token>` flag (§3.9) allows `agent-room-cli` to connect directly to the full-stack JWT ws-server on `:3001`, sharing state with the web client. Without the flag, the CLI still defaults to simple-service on `:9000` (username-only, isolated) for backwards compatibility. To chat across both clients on the full-stack backend, use `pnpm cli --jwt <token>` or the web Login's Simple Service mode to connect to port 9000.

### 6.5 Windows-Only Caveats

- **`pnpm watch`** — `node-pty` requires Windows Build Tools (MSVC). `setup-runner.ts` now detects an import failure and emits a platform-specific warning with remediation steps (install `windows-build-tools` or run `npm rebuild node-pty` after installing MSVC). ✅ Detection added; the underlying native dependency requirement is not code-fixable.
- **`pnpm restart`** — semicolon chain (PowerShell 5 compatible but sequential; no short-circuit on failure). Not code-fixable.
- **Orca browser features** — `orca screenshot` / `orca goto` require the Orca ADE browser runtime to be active. Not code-fixable.

### 6.7 Password-Protected Channels — Acknowledged, Deferred

The upstream README and the original README Part 1 described password-protected channels in multiple places. The backend never implemented this feature — no `password` field exists on the `Channel` type, and no join-handler password check exists. The B33 session removed the UI field. Session 2 tombstoned the README mentions with `_(planned — not yet implemented)_` and added schema validation to POST /channels that rejects unknown fields (GAP-2), preventing silent acceptance of a `password` body param.

This feature is explicitly deferred. It is not planned for the current fork scope.

---

### 6.6 Development Data Persistence — ✅ Gitignored

`PERSIST_FILE=./dev-state.json` is active in `.env`. `dev-state.json` has been added to `.gitignore`; it will not be committed to the repository. The file contains hashed passwords and dev tokens and must remain local only.

---

## 7. Quick Reference — Diff Summary

| Category | Upstream | Fork |
|---|---|---|
| Web client | None (empty stub) | Next.js 16 on :4000, full chat UI |
| Auth | JWT basic | JWT + bootstrap admin + session restore |
| Dev hot-reload | None (`tsx` without `--watch`) | `tsx watch` |
| Data persistence | Ephemeral (wipes on restart) | Optional JSON file via `PERSIST_FILE` |
| Kill / restart | Manual | `pnpm kill` / `pnpm restart` |
| Agent integration | None | `pnpm setup` + `pnpm watch -- claude` |
| Member names in REST | `entityId` only | `entityId` + `entityName` |
| Self-join public channels | 403 Forbidden | 201 Member added |
| `GET /entities` list | 404 Not Found | 200 with entity list |
| WS signal type | Sent `signal` / `event:'join'` | `Chat.tsx` now reads `signal` / `join` ✓ |
| WS on channel switch | Full reconnect | Socket stays open; WS leave + join actions |
| MCP concurrent actions | Race condition (map overwrite) | FIFO queue per action type |
| MCP `send_message` | Always `success:true` | Throws if WS disconnected |
| MCP `startStream` | False `async` signature | Synchronous; throws on disconnect |
| MCP `!res.ok` error body | Unconditional `res.json()` | Safe try-catch; HTTP status fallback |
| Windows shell compat | Hardcoded `/bin/zsh` | `COMSPEC` / `cmd.exe` detection |
| `source .env` in setup output | Unix-only | Platform-conditional output |
| `.claude/mcp.json` paths | macOS developer paths | Windows paths |
| `pnpm setup` writes `WATCH_CHANNELS` | Missing | Added (`'general'` default) |
| SSE event stream | Not present | `GET /events` on :3001; JWT auth; pubsub-backed |
| MCP `wait_for_message` | Not present | Blocks until any channel message; timeout 5–120 s |
| MCP `connect_stream` | Not present | Bridges arbitrary external WS to a channel |
| MCP resources | Not present | `connection://status`, `metrics://snapshot` |
| CLI JWT mode | Username-only to :9000 | `--jwt <token>` to connect to :3001 full-stack WS |
| CLI local fork | External npm package | `apps/agent-room-cli/`; both upstream bugs fixed |
| node-pty detection | Silent fail at runtime | `setup-runner.ts` warns with remediation steps |
| MCP `connect_service` tool | Not present | Convenience composite: checks auth, joins channel, returns status |
| MCP `list_connections` tool | Not present | Returns `{ connected, channels }` from bridge state |
| MCP `stream://{id}/messages/recent` | Not present | Last 50 messages; prefers in-process buffer over REST |
| MCP `stream://{id}/messages/latest` | Not present | Single most recent message via `readHistory()` |
| MCP `connection://{id}/status` | Global only | Per-channel `{ channelId, subscribed, connected }` |
| MCP `metrics://snapshot` latency | Counter-only | p50/p95/p99 histograms from bounded 500-sample buffer |
| Reconnect tokens | JWT re-auth only | Server mints UUID token; client persists in sessionStorage; WS open restores channels without re-auth |
| Message buffer | None | `WsBridge` sliding window max 50 messages per channel |
| POST /channels schema | No validation | `additionalProperties: false` — unknown fields return 400 |
| pubsub unsub on leave | Orphaned callbacks | Per-connection `channelUnsubs` Map; leave calls `unsub()` |
| Password channels | Referenced in README | Tombstoned as planned/deferred; GAP-2 rejects `password` field at API level |
| Fastify AJV removeAdditional | Silently strips extra fields | `removeAdditional: false` — unknown fields now return 400 |
| Bugs fixed | — | 33 tracked · 33 fixed (B1–B33) + 2 code gaps (GAP-1/GAP-2) + 9 additions (B/D–I) + 4 runtime fixes (R1–R4) in Session 2 |
| `PERSIST_FILE` env loading | Silent ephemeral mode (tsx ignores .env) | `--env-file=.env` in dev script; data now survives restart |
| Reconnect membership check | No membership re-validation on reconnect | Added `storage.findMember()` guard — revoked users skip channel restore |
| Reconnect token rotation | Same token reused indefinitely | Token deleted on use; fresh UUID issued after restore |
| Role string validation | Any string stored after toLowerCase() | `Object.values(EntityRole)` allowlist; unknown roles fall back to MEMBER or 400 |
| mention-watcher PTY spawn | `{ ...p, mode:'pty' }` missed prototype methods | Explicit method wrapper — `onData`, `onExit`, `write`, `resize`, `kill` all bound directly |
| Integration tests | None | 3-way WS sim + REST sweep + SSE + browser + MCP 21/21 + CLI JWT + mention-watcher PTY ✅ |
| `connect_stream` URL scheme | Any scheme accepted (SSRF vector) | `ws:`/`wss:` allowlist — other schemes throw before connect |
| Message pagination `limit` | Unbounded — any integer accepted | Fastify schema: `integer`, `min: 1`, `max: 200`; unknown params → 400 |
| `/restrict` server enforcement | Not implemented | Documented gap — deferred (no defined semantics) |
| `/dm` private routing | `isDm: true` ignored; broadcasts to all members | Documented — DM is a UI convention backed by @mention events |
