# Orca + AgentRoom — Combined Design

> Session scratch — 2026-06-03

---

## 1. Why Both Systems Exist Together

Orca orchestration and AgentRoom solve different problems and are complementary, not overlapping.

**Orca Orchestration Skill** owns the runtime layer. Full capability set:
- **Messaging** — `orchestration send/check/reply/inbox`: structured unicode-safe mailbox between terminals (~7KB body, does not wake)
- **Task DAGs** — `task-create / dispatch / task-update`: define tasks with specs, dispatch to specific terminals, track status (pending → dispatched → completed → failed → blocked)
- **Dispatch with preamble injection** — `terminal send` injects prompt text directly into PTY; combined with `orchestration send` for large context preambles before a task starts
- **Decision gates** — `gate-create / gate-resolve`: block pipeline at a decision point until a human or agent resolves with a resolution string
- **Coordinator loops** — `orchestration run / run-stop / reset`: start a persistent coordinator process that watches the task DAG and drives dispatch automatically
- **Terminal I/O** — `terminal send/read/wait`: raw PTY control, cursor-based delta reads, tui-idle detection
- **Browser automation** — `goto / snapshot / fill / click`: drives the Orca browser tab (not computer use)
- **Process spawning** — `orca-bootstrap.ps1`: spawns new Claude / 3rd-party CLI agents in fresh terminal panels

Orca is synchronous and process-scoped. It requires knowing a terminal handle (session-specific, re-discovered each session).

**AgentRoom** owns the communication layer: persistent structured messages, event-driven wakeups (`wait_for_mention`, `wait_for_message`), entity-addressed routing (by name, not handle), cross-session history, and human coordination. It is asynchronous and entity-scoped.

Neither replaces the other. An agent uses Orca to do work and AgentRoom to coordinate.

---

## 1B. Role Model — Human Always Owner

AgentRoom channel roles map to a fixed hierarchy. This is not about which agent has the Orca orchestrator skill in memory — any agent can run that skill. The roles here are the **agreed-upon channel permissions** at the AgentRoom level.

| AgentRoom Role | Who | Meaning |
|---------------|-----|---------|
| **Owner** | Human (always) | Creates channels, cannot be removed, full permissions. The human is the permanent authority. |
| **Admin** | Current orchestrator agent | The agent currently running the agreed orchestration plan. Admin can add/remove members, set roles. Reassignable as orchestration shifts. |
| **Member** | Worker agents | Can send messages, join/leave. Standard participant. |
| **Guest** | Read-only agents / observers | Can read channel history, cannot send. |

**Why this matters:**
- `POST /channels/:id/members` with `role: "admin"` sets the orchestrator agent
- If sub-orchestration occurs, the sub-orchestrator gets admin in the sub-channel; the parent orchestrator keeps admin in the parent channel
- Human always holds owner regardless of which agent is running the pipeline
- Orca orchestrator skill ≠ AgentRoom admin role — the skill is a capability in an agent's memory; the role is a permission level in the channel

---

## 2. The Three-Layer Model

| Layer | Medium | Readable by | Cost | Persistence |
|-------|--------|-------------|------|-------------|
| **Filesystem** | Markdown / code files in project folder | Any agent (direct read) | 0 — passive | Permanent |
| **Orca terminal** | Raw terminal I/O | Any agent via `terminal read` | 0 — passive | Session only |
| **AgentRoom channel** | Structured chat messages | All channel members | Tokens to produce | Survives restart + compaction |

### Hard rules

- **Never post to channel what is already visible in the terminal.** Terminal output is observable by any agent. Channel messages are intentional signals — a post means "I am communicating this deliberately."
- **Never dump file content into a channel message.** Post the path and section. Other agents read the file directly.
- **Channel history is the post-compaction index.** When context is compacted, `get_context` / `read_history` retrieves the pointer trail. The filesystem holds the content.

---

## 3. Core Principle: Use Case Ownership

Neither system is a superset of the other. Each owns a distinct problem space. The design fails when tasks are assigned to the wrong system.

**Orca owns:** process control, pushing to idle agents, passive terminal observation.  
**AgentRoom owns:** event-driven wakeup, broadcast, cross-session persistence, human coordination.  
**Neither owns:** status monitoring (both require explicit calls — see §3C).  
**Merged:** when you need push AND persistence, or wake AND broadcast.

---

### 3A. Orca-Only — when to use Orca and nothing else

Use Orca alone when persistence, broadcasting, or event-blocking are not needed.

| Task | Command | Why AgentRoom is wrong here |
|------|---------|----------------------------|
| Spawn agent process | `orca-bootstrap.ps1` | AgentRoom has no process management |
| Wake an idle agent | `terminal send --enter` | Only Orca can push to an idle process. AgentRoom `wait_for_mention` requires the agent to already be running |
| Read what an agent just did | `terminal read --cursor <prev> --limit 1000` | 0 tokens from observed agent. AgentRoom requires agent to have actively posted something |
| Pass large / unicode private data | `orchestration send --body "..."` | ~7KB, unicode-safe, no channel noise, private. Channel broadcasts to all |
| Wait for one specific agent's reply | `orchestration check --wait` | Cleaner bilateral exchange when only two parties involved |
| Task state machine | `task-create / dispatch / task-update` | Structured lifecycle tracking; no AgentRoom equivalent |
| Human approves before pipeline continues | `gate-create / gate-resolve` | Blocks pipeline; no AgentRoom equivalent |

**Anti-pattern:** Using AgentRoom channel to deliver a task to a specific agent that is currently idle. The agent is not blocking on `wait_for_message` — it will never see the message until it runs `read_history` or compacts. Use `terminal send` to wake it, then optionally post the task to channel for persistence.

---

### 3B. AgentRoom-Only — when to use AgentRoom and nothing else

Use AgentRoom alone when the agent is already running and blocking, when broadcast is needed, or when the human is coordinating.

| Task | Tool | Why Orca is wrong here |
|------|------|------------------------|
| Agent efficiently waits for its turn | `wait_for_mention` | Orca has no equivalent push-on-event primitive. Agent would have to poll `orchestration check` in a loop |
| Agent waits for any channel activity | `wait_for_message` | Same — polling loop in Orca wastes tokens |
| One message to all agents at once | `send_message` | Orca requires looping over N terminal handles |
| Human doesn't know which agent needs this | Channel post | Human can't easily address Orca `terminal send` without knowing handles. Channel delivers to all; relevant agents self-select |
| Human prompts without interrupting mid-task agent | Channel @mention | `terminal send` injects into PTY mid-execution. Channel @mention waits until agent is in `wait_for_mention` loop — natural yielding |
| Post-compaction recovery | `get_context` / `read_history` / `get_unread` | Orca terminal history is session-scoped and not structured. Channel history survives compaction with file pointers |
| Cross-session delivery (agent offline when message sent) | Channel + PERSIST_FILE | Orca handles change per session. A `terminal send` to a stale handle is lost |
| Stream structured output chunks | `stream_output` | No Orca equivalent |

**Anti-pattern:** Posting a task to the channel when the target agent is idle. Agent won't see it until it checks. Use `terminal send` to wake it first.

---

### 3C. Status Monitoring — neither system auto-notifies

**Critical design constraint:** Status is never automatically pushed to the orchestrator. In both systems, the orchestrator must explicitly pull or block.

| Method | How it works | Agent cost | Orchestrator cost | When to use |
|--------|-------------|-----------|-------------------|-------------|
| Orca `terminal read --cursor` | Orchestrator reads terminal delta | 0 — passive | Orchestrator calls `terminal read` | Best when agent produces terminal output naturally |
| Completion tag in terminal | Agent echoes `echo TASK:X:DONE` at end of task | 1 echo call | Orchestrator greps for tag | Best for unambiguous task completion |
| `orchestration check --wait` | Orchestrator blocks; agent sends `orchestration send` | Agent must explicitly send | Orchestrator blocks (no polling) | Best for bilateral confirmed handoff |
| AgentRoom `wait_for_message` | Orchestrator blocks on channel; agent posts completion | Agent must post to channel | Orchestrator blocks | Best when completion should be human-visible |
| AgentRoom `get_unread` | Orchestrator polls channel for new messages | Agent must have posted | Orchestrator polls | Best for async catch-up after other work |

**Decision for status:**
- Agent produces natural terminal output → use `terminal read --cursor` (0 agent cost)
- Need confirmed receipt (agent acknowledges) → use `orchestration check --wait` + agent sends reply
- Need human-visible completion record → agent posts to channel, orchestrator `wait_for_message`
- Orchestrator has other work to do → completion tag in terminal + grep later; or agent posts to channel

---

### 3D. Merged — when you need both

Use both when a single system cannot satisfy all requirements of the interaction.

| Scenario | Orca part | AgentRoom part | Why both |
|----------|-----------|----------------|----------|
| Wake agent AND have task persist across compaction | `terminal send` to wake | Channel post with task description | Orca wakes; AgentRoom preserves |
| Confirm plan publicly then dispatch privately | Channel plan post + @acknowledge | `terminal send` individual tasks | Channel for human visibility; Orca for targeted dispatch |
| Monitor work AND signal phase completion to human | `terminal read` passive monitoring | Agent posts milestone to channel | Orca for efficiency; channel for human visibility |
| Agent A hands off to Agent B (private, persistent) | `terminal send` to wake B after A signals | AgentRoom DM from A to B (or `orchestration send`) | Wake requires Orca; content routing requires AgentRoom |

---

### 3E. User → Agent paths

The user has direct terminal access. They do not need AgentRoom web UI to communicate with specific agents.

| User goal | Method | Why |
|-----------|--------|-----|
| Talk to a specific agent right now | `terminal send` (Orca) | Direct, immediate, wakes agent |
| Read what an agent produced | `terminal read` (Orca) | Direct access, 0 tokens |
| Prompt without interrupting mid-task | Channel @mention (AgentRoom) | Agent picks it up at next `wait_for_mention` loop — no PTY injection |
| Not sure which agent should handle this | Channel post (AgentRoom) | Broadcast; agents self-select or orchestrator routes |
| See full coordination history | AgentRoom `read_history` or web UI | Channel is the structured record; terminal is raw |
| Inject urgent context mid-task | `terminal send` (Orca) | Interrupts but that's the intent |

**User does NOT need AgentRoom DM.** AgentRoom DM is for agent→agent routing. User→agent has direct terminal access. AgentRoom's value to the user is the non-interrupting channel and the broadcast capability when they don't know which agent needs the message.

---

## 4. Should AgentRoom DM Exist? (The Merge Question)

Orca `orchestration send` and AgentRoom DM appear to solve the same problem. They don't.

| Property | Orca `orchestration send` | AgentRoom DM |
|----------|--------------------------|--------------|
| Addressing | Terminal handle (session-specific, must be re-looked-up) | Entity name/ID (persistent across sessions) |
| Persistence | Lost when handle changes or agent compacts | Survives in `dev-state.json` across restart + compaction |
| Wake target | No — mailbox only, does not wake | No — same limitation |
| To wake: combine with | `terminal send` | Channel @mention |
| Visibility | Human sees it in sending agent's terminal only | Both parties see thread; human sees in AgentRoom history |
| Both sides readable | Agent only sees what was sent TO it | Both parties can call `read_history` on the DM thread |
| Size limit | ~7KB | Message size same as channel (no extra limit) |
| Use by user | User can `orchestration check` to read | User sees in channel history |

**When `orchestration send` is better:**
- Data > 1KB or unicode
- You know the handle (orchestrator-to-worker in same session)
- No need for session-persistence
- Private and you don't want it in any channel record

**When AgentRoom DM is better:**
- Agent-to-agent where you don't know the target's current handle
- Content needs to survive compaction (agent reads `get_unread` after compact)
- Both agents need to read the full thread history later
- You want the human to be able to see it in the structured channel history

**Can they merge?**  
They can be combined: use `orchestration send` for large/private immediate data, use AgentRoom DM for persistent addressed routing. They serve different scopes of the same intent. Building AgentRoom DM does not eliminate `orchestration send` — it adds a persistent, session-independent, human-observable lane.

**Wake + DM combined pattern (merged):**
```
1. Agent A writes DM to Agent B via AgentRoom (persistent, entity-addressed)
2. Agent A sends @mention to channel (or orchestration send) to wake B
3. Agent B wakes, calls get_unread, reads DM thread
4. B replies via DM — both parties have full thread
```

---

## 5. Agent Initialization Sequence

```
1. Orca bootstrap spawns terminal
2. Agent receives context briefing (Orca handles, working dir, orchestrator handle)
3. Agent: authenticate → connect_service → join channel (AgentRoom MCP)
4. Agent: get_context or read_history → recover state if post-compaction
5. Agent: wait_for_mention → blocking, addressable by @name in channel

Agent is now reachable via:
  - Orca terminal send  (push by handle — wakes immediately)
  - AgentRoom @mention  (push by entity name — wakes at wait_for_mention)
  - Orca terminal read  (passive observation — 0 agent tokens)
```

### Post-compaction resume

```
1. Context compacted → agent re-enters at top of context
2. get_context → AI-ready summary of recent channel activity
3. get_unread → any DMs or @mentions sent while compacted
4. Read file paths referenced in those messages
5. Resume — no orchestrator re-brief needed
```

---

## 6. Communication Decision Tree

### Branch A: Sending to another agent

```
WHO is the target agent right now?
│
├── IDLE (not running wait_for_mention, not blocking on anything)
│   │
│   ├── Just need to wake it, no content
│   │   └── Orca terminal send (empty prompt or "check channel")
│   │
│   ├── Wake + deliver task (content < 1KB, no persistence needed)
│   │   └── Orca terminal send (task in prompt text)
│   │
│   ├── Wake + deliver task (content > 1KB or unicode)
│   │   └── Orca orchestration send (content) + terminal send (wake: "check your mailbox")
│   │
│   ├── Wake + need task to persist across compaction
│   │   └── AgentRoom channel post (task + file pointer) + Orca terminal send (wake: "check channel")
│   │
│   └── Wake + private content only this agent should see
│       └── Orca orchestration send (content) + terminal send (wake)
│           OR (if session-persistence needed): AgentRoom DM + terminal send (wake)
│
├── BLOCKING on wait_for_mention (ready for next task)
│   │
│   ├── Task is for this agent only
│   │   └── AgentRoom: @mention in channel (agent wakes, reads message)
│   │
│   ├── Task is for all agents
│   │   └── AgentRoom: channel send_message (all blocking agents wake on mention)
│   │
│   └── Private context for this agent only
│       └── AgentRoom DM (G2) or orchestration send + @mention to signal
│
├── MID-TASK (actively executing, should not be interrupted)
│   │
│   ├── Non-urgent — can wait
│   │   └── AgentRoom: channel @mention (agent picks up at next wait_for_mention)
│   │       OR write to file + post path to channel (agent reads on next cycle)
│   │
│   └── Urgent — must interrupt
│       └── Orca terminal send (PTY inject — deliberate interruption)
│
└── UNKNOWN state / unsure which agent(s) need this
    └── AgentRoom: channel post (agents self-select or orchestrator routes)
        Do NOT use terminal send — you'd need to loop all handles
```

---

### Branch B: Checking status of an agent

```
IMPORTANT: Neither system auto-notifies. You must actively pull or pre-arrange a signal.

WHAT does the agent produce?
│
├── Natural terminal output (file writes, compile output, test results)
│   └── Orca terminal read --cursor <prev> --limit 1000
│       (passive, 0 agent tokens, most efficient)
│
├── Structured completion you need confirmed
│   │
│   ├── Only you need to know (bilateral)
│   │   └── Pre-arrange: agent calls orchestration send when done
│   │       Orchestrator: orchestration check --wait
│   │
│   └── Human + other agents should also see it
│       └── Pre-arrange: agent posts "[agent][task] Done — see file X" to channel
│           Orchestrator: wait_for_message (blocks) or get_unread (polls)
│
├── Completion tag (best for parallel workers)
│   └── Pre-arrange: agent echoes "TASK:X:DONE" to terminal at end
│       Orchestrator: terminal read --cursor, grep for tag
│       Works for N workers in parallel — cursor per worker
│
└── Agent has been silent — unsure if still running
    └── Orca terminal wait --for tui-idle --timeout-ms 5000
        Then: terminal read --cursor to see output
        Liveness: terminal wait --for exit --timeout-ms 1000
                  (returns immediately if process is dead)
```

---

### Branch C: User → Agent communication

```
User goal?
│
├── Talk to a specific agent right now
│   └── Orca terminal send (direct, wakes agent)
│
├── Read what an agent produced
│   └── Orca terminal read (direct, 0 tokens)
│
├── Prompt without interrupting mid-task agent
│   └── AgentRoom channel @mention
│       (agent picks up at next wait_for_mention — no PTY injection)
│
├── Not sure which agent should handle this
│   └── AgentRoom channel post
│       (all agents see it; relevant ones self-select or orchestrator routes)
│
├── See coordination history (what agents agreed on, what files they produced)
│   └── AgentRoom read_history or web UI
│       (structured record; terminal is raw prompts only)
│
└── Urgent — interrupt whatever agent is doing
    └── Orca terminal send (PTY inject — deliberate)
```

---

### Branch D: Agent → Agent communication

```
Does the content need to reach a specific agent or all agents?
│
├── SPECIFIC agent only
│   │
│   ├── Content is large (>1KB) or unicode
│   │   └── Orca orchestration send (7KB limit, unicode-safe)
│   │       + terminal send or @mention to wake if agent is idle/blocking
│   │
│   ├── Content needs to persist across compaction / sessions
│   │   └── AgentRoom DM (G2) — entity-addressed, survives restart
│   │       + channel @mention to wake
│   │
│   ├── Content is small, same session, no persistence needed
│   │   └── Orca orchestration send (simpler, no AgentRoom setup needed)
│   │
│   └── Both agents need to read the full thread later
│       └── AgentRoom DM (both parties can read_history on thread)
│           Orca orchestration check --all only shows one side
│
└── ALL agents (broadcast)
    └── AgentRoom channel send_message
        Orca cannot broadcast — would require looping all handles
```

---

### Branch E: Markdown files — when to write vs when to post

```
Agent produced output. What now?
│
├── Output is work product (code, analysis, plan, doc)
│   └── Write to filesystem (markdown / code file)
│       Then post ONE line to channel: "Done — see path/file.md §section"
│       Do NOT paste content into channel
│
├── Output is a coordination signal (decision, handoff, milestone)
│   └── Post to channel (short, structured, with file pointer if relevant)
│       Terminal already shows the raw execution — don't duplicate
│
├── Output is a private data handoff to one agent
│   └── Write to file + send file path via orchestration send or DM
│       Do NOT post file path to channel if content is private
│
└── Output is just execution noise (compile steps, intermediate logs)
    └── Leave it in terminal only
        No channel post. No file. Orchestrator can terminal read if needed.
```

---

## 6. DM Backend — Implementation Design

### Problem

`/dm` currently sends a channel broadcast with `isDm: true` (ignored by server). The original README intended point-to-point routing: `{ "action": "dm", "to": "Bob", "message": "..." }`. Infrastructure to implement this is almost entirely already present.

### Existing infrastructure to reuse

| Component | What it provides |
|-----------|-----------------|
| `Topics.entity(entityId)` | Personal pubsub topic — already subscribed on auth |
| Auth subscription in `gateway.ts` line ~120 | Every connection already listens on `Topics.entity(conn.entityId)` |
| `processMentions` | Already publishes `type:'mention'` to entity topic |
| `saveMessage` + `listMessages` | Existing storage — works for any channelId string |
| `MessageVisibility.USER_BASED` | Already defined, unused — fits DM semantics exactly |

### Design: Virtual DM Channel

Use a deterministic virtual channel ID for each pair:

```
dmChannelId = "dm:" + [entityIdA, entityIdB].sort().join(":")
```

- Both parties are virtual members of this channel
- Messages saved with `channelId = dmChannelId`, `type = MessageType.DM`, `visibility = USER_BASED`
- Delivery via `Topics.entity(targetEntityId)` (existing personal topic, no new subscription needed)
- History read via existing `listMessages(dmChannelId, cursor, limit)`
- `saveMessage` requires no schema changes

### Changes required

**1. `packages/@agent-chat/types/src/messages.ts`**
```typescript
enum MessageType {
  // ... existing values ...
  DM = 'dm',   // add this
}
```

**2. `apps/ws-server/src/gateway.ts` — add `case 'dm'` to `handleAction`**
```typescript
case 'dm': {
  const { to, content } = payload as { to: string; content: string };
  if (!content?.trim()) {
    send(conn.ws, makeWire('error', 'system', { error: 'content required' }));
    break;
  }
  const target = await this.storage.findEntityByName(to)
    ?? await this.storage.findEntityById(to);
  if (!target) {
    send(conn.ws, makeWire('error', 'system', { error: `Entity not found: ${to}` }));
    break;
  }
  const dmChannelId = ['dm', ...[conn.entityId, target.id].sort()].join(':');
  const saved = await this.storage.saveMessage({
    channelId: dmChannelId,
    senderId: conn.entityId,
    type: MessageType.DM,
    content,
    visibility: MessageVisibility.USER_BASED,
  });
  const wire = makeWire('dm', conn.entityId, {
    messageId: saved.id,
    content,
    senderName: conn.entityName,
    dmChannelId,
  });
  await this.pubsub.publish(Topics.entity(target.id), wire);
  send(conn.ws, makeWire('response', 'system', {
    action: 'dm', success: true, messageId: saved.id, dmChannelId,
  }));
  break;
}
```

**3. `apps/ws-bridge.ts` — route incoming `dm` type to signal handlers**

`type:'dm'` arrives on the entity topic (same path as `type:'mention'`). Already handled by:
```typescript
if (msg.type === 'mention' || msg.type === 'signal') {
  for (const h of this.signalHandlers) h(msg);
}
```
Change to include `'dm'`:
```typescript
if (msg.type === 'mention' || msg.type === 'signal' || msg.type === 'dm') {
  for (const h of this.signalHandlers) h(msg);
}
```

**4. `apps/api-server/src/routes/entities.ts` — DM history endpoint**
```
GET /entities/me/dm/:targetId/messages?cursor=&limit=
```
- Derives `dmChannelId` from `[caller.sub, targetId].sort()`
- Calls `storage.listMessages(dmChannelId, cursor, limit ?? 50)`
- Returns `{ messages, count, nextCursor }` (same shape as channel messages)

**5. MCP gateway — `send_dm` tool (optional but clean)**
```typescript
server.registerTool('send_dm', {
  description: 'Send a private direct message to a specific entity by name or ID.',
  inputSchema: z.object({
    to: z.string().describe('Entity name or ID'),
    content: z.string().describe('Message content'),
  }),
}, async (params) => {
  if (!bridge) throw new Error('Not connected.');
  // sends { type: 'action', payload: { action: 'dm', to, content } }
  // bridge already routes this via action()
});
```

**6. Web client — DM inbox sidebar section (deferred — WEB UI customization)**

### What this enables

- True point-to-point routing — only target receives the message
- Persistent history in `dev-state.json` — survives compaction
- Both parties can read thread via `GET /entities/me/dm/:targetId/messages`
- MCP agents use `send_dm` tool; WS clients use `dm` action
- Human can see DM history via web UI DM inbox (future)
- `get_unread` can be extended to include DM channels

### Files to change

| File | Change |
|------|--------|
| `packages/@agent-chat/types/src/messages.ts` | Add `MessageType.DM = 'dm'` |
| `apps/ws-server/src/gateway.ts` | Add `case 'dm'` to `handleAction` |
| `apps/agent-gateway/src/ws-bridge.ts` | Route `type:'dm'` to signal handlers |
| `apps/api-server/src/routes/entities.ts` | Add `GET /me/dm/:targetId/messages` |
| `apps/agent-gateway/src/create-server.ts` | Add `send_dm` MCP tool |

No storage schema changes. No new pubsub topics. No new subscriptions.

---

## 7. 2-Agent vs 3+ Agent Patterns

The system behaves differently in scale. Patterns that work fine at 2 agents break or become noisy at 3+.

---

### 2 Agents (orchestrator + 1 worker)

Everything is bilateral. All channel messages are implicitly addressed to the other party. Terminal monitoring is a single cursor read.

**What works simply:**

| Task | Pattern |
|------|---------|
| Task dispatch | `terminal send` to the one worker |
| Monitor completion | Single cursor read on one terminal |
| Completion signal | Any channel post — there's only one other party |
| Wait for work | `wait_for_message` is fine — only one agent posting |
| Data handoff | `orchestration send` or channel message — both reach the right party |
| DM | Largely optional — channel is already effectively private at 2 people |

**Compaction at 2 agents:** Worker calls `get_context`, reads the plan, resumes. Orchestrator re-reads worker terminal delta. Simple.

---

### 3+ Agents

Coordination complexity compounds. Problems that don't exist at 2 agents:

1. **`wait_for_message` wakes all** — if multiple agents are blocking on `wait_for_message` in the same channel, one new message wakes ALL of them. They may all try to act on it.
2. **Channel noise** — every agent's completion signal lands in the same channel. At 5 workers, the channel fills with status posts and agents must filter what's addressed to them.
3. **Completion disambiguation** — orchestrator receives multiple "done" signals; must know which task and which agent each belongs to.
4. **Terminal monitoring fan-out** — orchestrator must read N terminals, not 1. Without a strategy, it either polls all of them or misses output.
5. **Shared file conflicts** — two workers writing to the same file simultaneously corrupts output. No coordination layer by default.
6. **Sub-orchestration** — a worker may need to spawn and manage its own sub-agents. Role boundaries blur.

---

### Rules that change at 3+

**`wait_for_mention` instead of `wait_for_message`**

At 3+, agents should block on `wait_for_mention` not `wait_for_message`. Only the @mentioned agent wakes. All others stay suspended. A channel message without a mention does not interrupt any blocking agent.

```
2 agents:  wait_for_message is fine (only 1 other person posting)
3+ agents: use wait_for_mention — otherwise all blocking agents wake on every post
```

**Tag completion signals for disambiguation**

Every agent includes its ID and task ID in its channel completion post:

```
"[agent-B][task:auth-review] Done — see docs/auth-analysis.md §3"
```

Orchestrator greps for its task tag rather than just waiting for any message.

Same pattern in terminal output for Orca reads:

```powershell
terminal send --text "task. when done echo 'TASK:auth:DONE' to terminal" --enter
# then: terminal read --cursor <prev> | grep "TASK:auth:DONE"
```

**Cursor-per-worker for terminal monitoring**

Orchestrator captures a cursor for each worker terminal before dispatching:

```
workerA_cursor = terminal read --terminal <hA>  → nextCursor
workerB_cursor = terminal read --terminal <hB>  → nextCursor
workerC_cursor = terminal read --terminal <hC>  → nextCursor
[dispatch all three tasks]
[wait for all three completion tags in channel or terminals]
deltaA = terminal read --terminal <hA> --cursor workerA_cursor
deltaB = terminal read --terminal <hB> --cursor workerB_cursor
deltaC = terminal read --terminal <hC> --cursor workerC_cursor
```

**DM becomes necessary at 3+**

At 2 agents you can use the channel for targeted handoffs. At 3+, a channel message reaches everyone. If orchestrator needs Agent B to do the next task without Agent C acting on it, DM (or `orchestration send`) is required. Until G2 is built, use `orchestration send` for targeted handoffs.

```
2 agents:  channel post is fine for targeted task assignment
3+ agents: use DM (G2) or orchestration send — channel broadcasts to all
```

**Gate pattern for phase synchronization**

When N parallel workers must all complete before the next phase starts:

```powershell
# Orchestrator creates a gate before dispatching
$gate = orchestration gate-create --task <phase-task-id> --question "All workers done?"

# Each worker reports completion via orchestration send
# Orchestrator polls channel for N tagged completion signals
# Then resolves the gate
orchestration gate-resolve --id $gate.id --resolution "all 3 workers confirmed done"
```

At 2 agents this is overkill — just wait for one completion. At 3+ it is the right synchronization primitive.

**Consider domain channels instead of one #general**

At 3+, a single #general fills with cross-cutting noise. Consider:

```
#general     — plan, human coordination, major milestones
#backend     — backend workers only
#frontend    — frontend workers only
#research    — research/analysis agents
```

Agents join only the channels relevant to their task. `wait_for_mention` in their domain channel is now much lower noise. Orchestrator joins all channels.

---

### Sub-orchestration (3+ only)

Any agent can run the Orca orchestrator skill. At 3+, a natural hierarchy can emerge without pre-assignment:

```
Orchestrator (Sonnet)
  └── Sub-orchestrator B (Haiku — running orchestrator skill)
        ├── Worker C
        └── Worker D
```

B was tasked as a worker but promoted itself to sub-orchestrator by spawning C and D via bootstrap script. B uses AgentRoom DM (or `orchestration send`) to brief C and D on their sub-tasks. B posts to #general only when its full subtree is complete.

The orchestrator doesn't need to know about C and D — it only tracks B's terminal and completion signal.

---

### Summary table

| Concern | 2 Agents | 3+ Agents |
|---------|----------|-----------|
| `wait_for_message` | Fine | Risky — wakes all; use `wait_for_mention` |
| Completion signals | Any channel post | Tag with `[agent][task]` |
| Terminal monitoring | Single cursor read | Cursor per worker |
| Targeted task handoff | Channel post fine | DM or `orchestration send` |
| Phase synchronization | Simple sequential | `gate-create / gate-resolve` |
| Channel structure | One #general | Domain channels (#backend, #frontend) |
| Sub-orchestration | N/A | Any agent can promote itself |
| Shared file conflicts | Low risk | Coordinate by task assignment (non-overlapping files) |
| DM necessity | Optional | Required for targeted handoffs |

---

## 8. Conversation Insights (Session Log)

Key design decisions reached in conversation — preserved here as the reasoning record.

**On terminal visibility:** The human CAN see all agent terminals in Orca ADE. `orchestration send` is not invisible — it's visible as terminal I/O. The distinction between Orca and AgentRoom is raw-prompts-vs-structured-messages, not visible-vs-hidden.

**On roles:** Any agent can run the orchestrator skill — roles are fluid, prompted into memory. There is no fixed hub. Orca routing still requires terminal handles (session-specific lookup); AgentRoom routes by persistent entity name.

**On channel messages:** Agents can read each other's terminal history via `terminal read`. Therefore: never post to channel what is already visible in the terminal. Channel posts are intentional signals — completion, file pointers, decisions, @mentions. Not status narration.

**On `wait_for_mention`:** Not all agents are waiting in a polling loop. AgentRoom's MCP tools (`wait_for_mention`, `wait_for_message`) allow agents to block efficiently until an event arrives — zero tokens between wakes. Orca terminal read is for the orchestrator to passively observe; AgentRoom is the push delivery system for agents that need to be woken by events.

**On persistence and compaction:** The user compacts Claude Code sessions frequently. This is the primary reason persistence matters — not just restart survival. Channel history = the shared external memory that survives compaction. After compact: call `get_context` → find file pointers → read files. No orchestrator re-brief needed.

**On `/dm` naming:** README Part 1 explicitly described "point-to-point private messaging" with a dedicated WS action `{ "action": "dm", "to": "Bob" }`. The current implementation is a channel broadcast with a cosmetic badge — incorrectly named. The design above implements what was originally intended.

**On channel post discipline:** Agents can read each other's terminal history. Channel messages are intentional coordination signals — file pointers, decisions, @mentions, completion notices. Never post what is already visible in a terminal. Never dump file content into a message.

**On compaction and persistence:** User compacts Claude Code sessions frequently. AgentRoom channel history + PERSIST_FILE is the intentional shared external memory. Channel = index of what was built. Filesystem = the content. Post meaningful file pointers at milestones, not summaries.

**On `wait_for_mention` / `wait_for_message`:** Not all agents are waiting. These MCP tools allow efficient agent suspend — zero tokens between wakes. They are the push delivery mechanism that makes AgentRoom active rather than polled. Orca terminal read is passive observation by the orchestrator; AgentRoom MCP is for agents that need to be woken by events.

---

## 8. Orca Skill Reference

**Binary:** `C:\Users\ricar\AppData\Local\Programs\Orca\bin\orca.cmd`

### Terminal commands

```powershell
terminal list --json                                    # always run first — handles are session-specific
terminal create --json
terminal send --terminal <h> --text "..." --enter --json   # max 3KB; double-quotes stripped
terminal read --terminal <h> --json                     # 23-line snapshot
terminal read --terminal <h> --cursor <n> --limit 1000 --json  # full delta
terminal wait --terminal <h> --for tui-idle --timeout-ms N --json
```

### Orchestration commands (prefer for data passing)

```powershell
orchestration send  --to <h> --from <h> --subject "x" --body "y" --json   # ~7KB, unicode-safe
orchestration check --terminal <h> --wait --timeout-ms 30000 --json        # block until message
orchestration check --terminal <h> --all --json                            # idempotent read
orchestration reply --id <msg_id> --body "..." --from <h> --json
orchestration task-create --spec "..." --json
orchestration dispatch   --task <id> --to <h> --json
orchestration task-update --id <id> --status completed --json
orchestration gate-create  --task <id> --question "..." --json
orchestration gate-resolve --id <id> --resolution "..." --json
```

### Browser commands (Orca browser — NOT computer use API)

```powershell
goto --url <url> --json
snapshot --json          # DOM + refs
screenshot --json
fill --ref <r> --value "..." --json
click --ref <r> --json
```

### Key constraints

| Limit | Detail |
|-------|--------|
| `terminal send` max | 3KB; double-quotes stripped — use `.ps1` file for complex payloads |
| `orchestration send` max | ~7KB; 8KB = Windows CMD line-length error — use file handoff |
| `orchestration send` wake | Mailbox only — does NOT wake idle agent; use `terminal send` to trigger |
| Unicode | Always `orchestration send` — PTY garbles multibyte |
| Handles | Session-specific — always `terminal list` at session start |
| Browser tabs | Never auto-close — user cannot reposition without UI drag |
