# Orca + AgentRoom — Unified Coordination Design (v2)

> Agent instructions. Every rule carries a WHY. Read as directives, not descriptions.
> Parent folder: `agentroom/` (AgentRoom) and `Orca Skills/` (Orca) are siblings. End goal: merge into one coordination layer.

---

## 1. Purpose and Merge Goal

### Why Both Systems Exist as Siblings Today

AgentRoom and Orca Skills exist as separate sibling directories because they solved different problems at different times, without a shared abstraction. Do not treat their separation as a design choice to preserve — treat it as a debt to resolve.

**AgentRoom owns exclusively:**
- Persistent channel state (`dev-state.json` is the source of truth for message history, channel membership, entity addresses)
- The MCP tool surface agents use to communicate (`send_message`, `wait_for_mention`, `wait_for_message`, `read_history`, `get_context`, `stream_output`, `send_dm`)
- Entity-addressed routing — agents reachable by name, not session handle, because handles are ephemeral and names are stable
- The WebSocket/REST/MCP gateway that decouples senders from receivers

**Orca Skills owns exclusively:**
- Live process control — spawning terminals, reading output, injecting input, killing processes
- Session-specific terminal handles required for any operation that touches a running process
- Task DAG dispatch with preamble injection — handing a new agent its full context at spawn time
- Messaging between agent terminals (`orchestration send/check/reply/inbox`)
- Decision gates (`gate-create / gate-resolve`) and coordinator loops (`orchestration run`) that react to terminal state, not message state
- Browser automation (`goto / snapshot / fill / click`) against the running Orca browser tab

**What they share (and why that creates friction today):**
Both systems participate in agent coordination. Orca spawns agents; AgentRoom routes messages between them. But currently an Orca-spawned agent that needs to communicate must discover AgentRoom independently, and an AgentRoom participant that needs to spawn a subprocess must reach for Orca without a defined contract. The two systems do not hand off — they collide.

### What the Merged System Looks Like

The merged system is not AgentRoom absorbing Orca, and not Orca replacing AgentRoom. It is a unified coordination layer with a clear division of authority:

- **Orca handles process control.** Use Orca when you need to start, stop, observe, or inject into a running OS process. Orca's jurisdiction ends at the process boundary.
- **AgentRoom handles communication state.** Use AgentRoom when you need to send a message, wait for a reply, record history, or address an agent by name. AgentRoom's jurisdiction ends at the channel boundary.
- **The handoff point is agent spawn time.** When Orca spawns an agent, it injects an AgentRoom channel identity into the preamble — the agent's name, its assigned channel, and the MCP endpoint. From that moment the agent communicates through AgentRoom, not through Orca terminal reads.

Do not use Orca terminal reads to poll for agent responses after spawn. That approach worked before AgentRoom existed, but it bypasses persistent history, breaks entity addressing, and creates polling loops that scale poorly. Use `wait_for_mention` instead. Orca terminal observation is reserved for processes that cannot speak MCP — legacy tools, shell scripts, external CLIs.

The goal of the merge: no agent should need to know whether another agent was spawned by Orca or connected directly. The channel is the coordination surface. Orca is infrastructure.

---

## 1B. Role Model — Human Always Owner

AgentRoom channel roles map to a fixed hierarchy. This is NOT about which agent has the Orca orchestrator skill in memory — any agent can run that skill. These roles are the **agreed-upon channel permissions** at the AgentRoom level.

| Role | Who | Why |
|------|-----|-----|
| **Owner** | Human (always, permanent) | Agents are processes — they crash, get replaced, exhaust context. If an agent held Owner and crashed, channel governance becomes unrecoverable. Anchor ownership to the human so channel configuration always has a stable, non-process authority. Never design a workflow that requires the human to relinquish Owner, even temporarily. |
| **Admin** | Current orchestrator agent | The orchestrator needs to manage channel membership — adding workers when tasks expand, removing them when done. Admin is a channel-level agreement about who is currently orchestrating. Do not conflate it with running the Orca skill (any agent can do that). Grant Admin to the agent responsible for the current coordination task; revoke it when orchestration shifts. Do not grant Admin to workers — they can accidentally restructure channels and break orchestration topology. |
| **Member** | Worker agents | Minimum permission for full participation: send messages, receive mentions, read history, stream output. Not Guest, because workers must actively communicate — reporting results, signaling completion, asking for clarification. Restricting to Guest would force the orchestrator to poll instead of receive. |
| **Guest** | Observer / read-only agents | No task to execute. Giving observers Member rights pollutes channel history with monitoring noise and makes it harder to distinguish authoritative agent communication from passive observation. Guest makes the role legible in the channel structure itself. |

---

## 2. The Three-Layer Model

Use exactly three layers. Do not conflate them. Each has a different failure mode, a different persistence guarantee, and a different authority.

| Layer | Medium | Readable by | Persistence | Authority |
|-------|--------|-------------|-------------|-----------|
| **Filesystem** | Markdown / code files | Any agent (direct read) | Permanent | File owner |
| **Orca terminal** | Raw PTY I/O | Any agent via `terminal read` | Session only | Orca process |
| **AgentRoom channel** | Structured messages | All channel members | Survives restart + compaction | AgentRoom entity |

### Why each layer exists

**Filesystem** is the only layer that survives process restarts unconditionally. Write here when state must outlast any session. Do not use it as a message bus — it has no notification mechanism, so polling it for new messages forces busy-waits and creates race conditions on concurrent writes. One writer per file at a time.

**Terminal** is Orca's domain. Handles are valid only for the lifetime of a session — do not store them in long-lived state. Use the terminal layer for: spawning agents, injecting context at startup, observing non-MCP processes, detecting crashes. Do not use it for agent-to-agent coordination after spawn — it has no history, no persistent addressing, and no delivery guarantees. A message sent via terminal inject is gone if the process was not at the prompt at that exact moment.

**Channel** is AgentRoom's domain. Provides persistent history, named addressing, role-gated permissions, and guaranteed delivery to connected clients. Use for all agent-to-agent communication after spawn time. Channels exist because point-to-point terminal messaging does not scale past two agents and cannot be audited after the fact.

### Hard rules

- **Never post to channel what is already visible in the terminal.** Terminal output is observable by any agent. Channel messages are intentional signals — a post means "I am communicating this deliberately." Narrating work that is already in the terminal wastes every subscriber's tokens.
- **Never dump file content into a channel message.** Post the path and section. Other agents read the file directly. Inlining content bloats all subscribers' context, not just the recipient's.
- **Channel history is the post-compaction index.** When context is compacted, `get_context` / `read_history` retrieves the pointer trail. The filesystem holds the content. The channel holds the map to the content.

---

## 3. System Ownership Rules

### 3A. Use Orca-Only When

Use Orca exclusively for agent lifecycle operations: spawning, waking, killing, and process-level control.

**Wake an idle agent → `terminal send`**
`terminal send` injects directly into the PTY and the receiving process does not need to be in any particular state — it will be interrupted from idle. If you use AgentRoom `send_message` to wake an idle agent, the message lands in the channel but no process is polling it. The agent never wakes. The message silently ages in history. This is the most common dispatch mistake.

**Task DAGs, gates, coordinator loops → Orca**
These require sequenced process-level control with blocking and branching on exit codes or completion signals. AgentRoom has no concept of a gate condition or a DAG edge. Modeling a gate in AgentRoom requires an agent to manually poll history and implement blocking logic itself — duplicating the coordinator pattern already solved in Orca and adding failure surface whenever the polling agent compacts.

**Browser automation, process spawning → Orca**
These are process-scoped operations with no representation in AgentRoom's message-passing model. There is nothing in AgentRoom to call for `orca browser fill` or `orca spawn`. Routing these through AgentRoom adds a pointless relay hop and breaks the direct PTY path these commands require.

**Passive output observation → `terminal read --cursor`**
AgentRoom `get_unread` only returns what the agent has actively written to the channel. If the agent is mid-task and not writing status, `get_unread` returns nothing useful. `terminal read` captures what is on the PTY regardless of whether the agent addressed it to anyone. Cost: 0 agent tokens.

**Anti-pattern:** Using AgentRoom send to wake an idle agent. Failure mode: silent non-delivery. The orchestrator believes a task was dispatched; nothing happens.

**Anti-pattern:** Routing browser or spawn commands through AgentRoom. Failure mode: relay agent must be running to re-issue the command. If relay is idle, the chain blocks silently.

### 3B. Use AgentRoom-Only When

Use AgentRoom exclusively for persistent, entity-addressed messaging that must survive session boundaries and compaction.

**Non-interrupting user prompts → channel @mention**
`terminal send` arrives as a PTY inject mid-execution — it can corrupt streaming output, break mid-task context, or force a context switch the agent is not prepared for. A channel @mention waits until the agent's next `wait_for_mention` cycle. The agent picks it up at a natural yield point. The non-interrupting property is a coordination contract, not a convenience.

**Broadcast to unknown recipients → channel**
`terminal send` and `orchestration send` require a handle. If you do not know which agent should handle a message, or you need all agents to see it, broadcasting to a channel is the only mechanism. Sending to a wrong handle sends to the wrong agent. Sending to no handle sends to nothing.

**Cross-session and post-compaction continuity → channel + PERSIST_FILE**
Orca handles are process-scoped. When a session ends the handle is gone. If an agent restarts or compacts, any `orchestration send` sent to the old handle is lost. AgentRoom history persists. An agent recovering from compaction calls `get_context` and retrieves the coordination record intact.

**Structured status broadcast → `stream_output`**
`terminal read` works per-terminal and requires the orchestrator to already know which terminal to read. `stream_output` pushes to a channel where any subscriber can observe it. In a many-agent system, replacing `stream_output` with `terminal read` means the orchestrator loops across N handles continuously — cost proportional to fleet size. AgentRoom inverts the cost: agents push once, observers pull once.

**Anti-pattern:** Posting a task to channel when the target agent is idle. Failure mode: agent does not see the message until it explicitly calls `read_history` — which it won't do until something else wakes it. Use `terminal send` to wake first.

**Anti-pattern:** Using `wait_for_message` at 3+ agents. Failure mode: all blocking agents wake simultaneously on any message. See §7.

### 3C. Status Monitoring — Pull-Only

Neither system auto-notifies the orchestrator. Design every monitoring strategy around this constraint before writing orchestration code.

An agent that finishes goes silent. An agent that crashes goes silent. An agent waiting for input goes silent. Silence is the default in both systems.

This exists because Orca terminals produce output only when something executes, and AgentRoom channels contain messages only when an agent posts. There is no heartbeat or lifecycle hook that fires without agent cooperation.

**Choose your monitoring method before dispatch** — some methods require the agent to emit a specific signal you must instruct it to produce.

| Method | Agent cost | Orchestrator cost | Requires agent cooperation | Use when |
|--------|-----------|-------------------|---------------------------|---------|
| `terminal read --cursor` | 0 | Orchestrator polls | No | Agent produces natural terminal output |
| Completion tag + grep | 1 echo | Orchestrator greps cursor delta | Yes — agent must echo tag | Parallel workers, unambiguous detection |
| `orchestration check --wait` | Agent sends reply | Orchestrator blocks | Yes — agent must call `orchestration send` | Bilateral confirmed handoff |
| AgentRoom `wait_for_message` | Agent posts | Orchestrator blocks | Yes — agent must channel post | Human-visible completion, 2 agents |
| AgentRoom `wait_for_mention` | Agent posts with @mention | Orchestrator blocks | Yes — agent must @mention | Human-visible completion, 3+ agents |

### 3D. Merged — Use Both When

**Wake + persist context:** Write full task brief to AgentRoom channel first (durable, survives delay). Then `terminal send` with a short pointer: "check channel for your task." The channel write happens before the wake because reversing the order creates a race — the agent wakes and starts executing before context is available.

**Plan publicly, dispatch privately:** Channel plan post + @acknowledge from all agents (human-visible, persistent). Then `terminal send` individual task prompts (targeted, small, no channel noise). The channel handles visibility; Orca handles triggering.

**Monitor work + signal milestone to human:** `terminal read` passive monitoring (0 agent tokens). Agent posts milestone to channel (human-visible, compaction-safe). Orca for efficiency; channel for visibility. Both needed because neither alone satisfies both requirements.

### 3E. User → Agent Paths

The user has direct terminal access. The user does NOT need AgentRoom DM to reach specific agents.

**Reach specific known agent immediately → `terminal send`**
Direct, immediate, wakes agent. AgentRoom DM adds a mailbox layer with latency proportional to task depth. When you have the handle, use it.

**Prompt without interrupting → channel @mention**
PTY inject arrives immediately regardless of what the agent is doing. Channel @mention waits for the agent's next `wait_for_mention` cycle — natural yield point, no mid-task context contamination.

**Unsure which agent needs this → channel post**
Broadcast. Agents self-select or orchestrator routes. This is the primary value of AgentRoom to the user: sending without knowing the recipient. `terminal send` requires a specific handle; channel does not.

**Read what agent produced → `terminal read`**
Direct access, 0 tokens. No need to ask the agent to report back.

---

## 4. Should AgentRoom DM Exist Given Orca Has `orchestration send`?

### What Each Does

| Property | Orca `orchestration send` | AgentRoom DM |
|----------|--------------------------|--------------|
| Addressing | Terminal handle (session-specific, must re-discover each session) | Entity name/ID (persistent across sessions) |
| Persistence | Lost when handle changes or agent compacts | Survives in `dev-state.json` across restart + compaction |
| Wakes target | No | No |
| To wake: pair with | `terminal send` | Channel @mention |
| Visibility to human | Visible in sending agent's terminal only | Both parties see thread; human sees in AgentRoom history |
| Both sides readable | Agent sees only what was sent TO its handle | Both parties can call `read_history` on the DM thread |
| Size limit | ~7KB | Same as channel messages |

### Where They Overlap

Both deliver a private message to a specific agent without broadcasting. Both are non-waking. Both support asynchronous delivery. In a narrow operational band — a running agent with a live handle, small payload, same session — they are functionally equivalent. For this case, `orchestration send` is strictly cheaper: no MCP call, no persistence overhead, no entity resolution. Use `orchestration send` here.

### Where They Diverge (and why DM exists)

**Handle dependency:** `orchestration send` requires a live session handle. If the target has restarted, compacted, or not yet been spawned, there is no handle. AgentRoom DM requires only a stable entity name. This is the most important divergence: `orchestration send` is unreliable across session boundaries; AgentRoom DM is reliable by design.

**Payload persistence:** `orchestration send` payloads are ephemeral. If the target compacts before reading, the message may be lost. AgentRoom DM persists and remains readable after compaction. Use AgentRoom DM whenever the message must survive a session gap on either side.

**Both-sides thread:** `orchestration check --all` shows only what was sent TO that handle. `read_history` on a DM thread shows the complete exchange. When an agent needs to re-read what it agreed to, `orchestration check` cannot help it.

### Can They Merge?

No — structural divergence. `orchestration send` addresses processes; AgentRoom DM addresses entities. Merging them would require either making AgentRoom entity addresses always resolve to live handles (fails when agent is not running) or making `orchestration send` durable (not its architecture). The correct relationship is layered: `orchestration send` is the fast in-session private path; AgentRoom DM is the durable entity-addressed path. Use `orchestration send` when you hold a confirmed live handle in the current session. Use AgentRoom DM when session continuity is not guaranteed.

### Wake + DM Combined Pattern

Neither `orchestration send` nor AgentRoom DM wakes an idle agent. Any "send private message to agent that may be idle" requires a third element:

1. **Write** private message to AgentRoom DM (entity-addressed, durable, no handle required)
2. **Wake** target with `terminal send`: "you have a DM in AgentRoom, read it"
3. **Agent wakes**, calls `get_unread`, retrieves full message

Use this pattern (not `orchestration send` + `terminal send`) when: the agent may have restarted between handle acquisition and now; payload exceeds 3KB; the message must be auditable; or session boundary between sender and recipient is not guaranteed to be the same.

---

## 5. Status Monitoring Rules

Status is never automatically pushed. Choose the method before dispatch.

### Method 1: `terminal read --cursor` — Use First

Capture cursor before dispatch: `cursor = terminal read → nextCursor`. After work completes, read delta: `terminal read --cursor <saved> --limit 1000`. Cost: 0 agent tokens. Works even if agent is silent, crashed, or uncooperative. This is the baseline monitoring method — always available, always passive.

Do not read without a saved cursor. Without it, you get full terminal history on every poll — noisy, slow, and unreliable for detecting completion in a multi-agent setup.

### Method 2: Completion Tags — Use for Parallel Workers

Instruct every agent: `echo "TASK:<task_id>:DONE"` on completion. Grep the cursor delta for the tag. The tag is the key; the signal is the value.

At 3+ workers, tags must include `[agent-id][task-id]` because bare "DONE" is unambiguous only when there is one agent. Multiple simultaneous completions with no identity information cannot be matched to dispatched tasks.

Do not parse unstructured output. LLM output variation breaks parsers. Tags are immune to variation.

### Method 3: `orchestration check --wait` — Use for Bilateral Confirmed Handoff

Orchestrator blocks. Agent calls `orchestration send` when done. Maximally efficient: zero polling overhead. Always pair with a timeout because crashed agents never signal and an untimed check blocks forever.

Do not use at 3+ parallel workers. You can only block on one at a time. Use cursor polling with tags for parallel scenarios.

### Method 4: `wait_for_mention` — Use for Human-Visible Completion at 3+

Agent posts completion to channel with @orchestrator mention. Orchestrator was in `wait_for_mention` and wakes. Completion is recorded in persistent channel history.

Use `wait_for_mention` (not `wait_for_message`) at 3+ agents because `wait_for_message` wakes ALL blocking agents on any channel post. See §7.1.

### Method 5: `get_unread` + `get_context` — Post-Compaction Recovery

Call `get_context` first (AI-ready summary of channel activity), then `get_unread` (directed messages missed during compaction), then read files referenced in those messages. This ordering is mandatory — context first provides the vocabulary to interpret directed messages; directed messages point to the specific files worth reading.

---

## 6. Communication Decision Tree

Resolve three facts before entering the tree: WHO is communicating, TO WHOM, and what STATE is the recipient in.

---

### Branch A — Sending to Another Agent (by recipient state)

```
Recipient state?
│
├── IDLE (process exists, no task running, not polling mailbox)
│   │
│   ├── Just wake, no content needed
│   │   └── orca terminal send --text "check channel" --enter
│   │   WHY: terminal send is the only push that wakes an idle process.
│   │        orchestration send goes to mailbox but idle agent is not polling it.
│   │        Silent non-delivery is the failure mode if you use mailbox here.
│   │
│   ├── Wake + content < 3KB, transient (no persistence needed)
│   │   └── orca terminal send --text "<task prompt>" --enter
│   │   WHY: Small enough to fit in PTY inject. No round-trip to channel.
│   │        Single operation: wake + brief simultaneously.
│   │   NOT: orchestration send — does not wake.
│   │
│   ├── Wake + content > 3KB or unicode
│   │   └── Step 1: AgentRoom channel post or orchestration send (content, durable)
│   │       Step 2: terminal send "check channel / check mailbox for task"
│   │   WHY: PTY inject is capped at 3KB and strips unicode. Content goes via
│   │        the appropriate channel; terminal send is only the wake trigger.
│   │        The content write must happen BEFORE the wake to avoid race where
│   │        agent starts executing before context is available.
│   │
│   └── Wake + content must persist across compaction
│       └── Step 1: AgentRoom channel post (path + section pointer)
│           Step 2: terminal send "check channel for your task brief"
│       WHY: orchestration send does not survive session boundary.
│            Channel post persists — agent can recover via get_unread after
│            any future compaction.
│
├── BLOCKING on orchestration check --wait
│   └── orca orchestration send --to <handle> --body "<content>"
│       OR orca orchestration dispatch --task <id> --to <handle> --inject
│   WHY: Agent is actively polling its mailbox. orchestration send delivers
│        to mailbox; agent picks it up when check --wait unblocks. For a
│        structured task assignment, dispatch --inject is preferred because
│        it teaches the agent how to report back via worker_done.
│   NOT: Channel post only — agent in orchestration check --wait is not
│        subscribed to wait_for_message. The channel message will be missed.
│
├── BLOCKING on wait_for_mention (AgentRoom)
│   │
│   ├── Message for this agent only
│   │   └── AgentRoom send_message with @agent-name mention
│   │   WHY: @mention is the exact trigger wait_for_mention listens for.
│   │        Channel message without a mention will NOT unblock this agent.
│   │   NOT: channel post without mention — agent stays blocked.
│   │
│   └── Message for all agents in channel
│       └── AgentRoom send_message mentioning each agent explicitly
│       WHY: Each agent has its own mention check. One message can carry
│            multiple mentions. All mentioned agents unblock simultaneously.
│       COST: O(N) mentions. At large N, use a task queue pattern instead.
│
├── MID-TASK (actively executing)
│   │
│   ├── Interrupt is intentional and urgent
│   │   └── orca terminal send --text "<message>" --enter
│   │   WHY: PTY inject is the only mechanism that reaches an agent mid-execution.
│   │        Risk: may corrupt streaming output or break mid-task state.
│   │        Use only when the cost of interruption is lower than cost of waiting.
│   │
│   └── Can wait until agent yields naturally
│       └── AgentRoom channel @mention (or orchestration send to mailbox)
│       WHY: Agent picks up channel @mention at next wait_for_mention cycle.
│            No PTY contamination. Agent finishes current task first.
│       NOT: terminal send — forces immediate interruption.
│
└── UNKNOWN state
    └── Step 1: terminal read --cursor (observe last output, 0 tokens)
        Step 2: Route to A.IDLE / A.BLOCKING / A.MID-TASK above
    WHY: Never guess state. A blind terminal send to an agent in
         wait_for_mention loop is redundant. A blind channel post to an idle
         agent is a silent miss. Read first; cost is zero.
```

---

### Branch B — Checking Agent Status

```
What does the agent produce?
│
├── Natural terminal output (build output, test results, file writes)
│   └── terminal read --cursor <per-worker-cursor> --limit 1000
│   WHY: Agent is not required to cooperate. Read is passive. Works regardless
│        of whether agent is idle, crashed, or busy.
│   PAIR WITH: per-worker cursor captured before dispatch (see §7.3).
│
├── Structured completion tags (TASK:X:DONE)
│   └── terminal read --cursor + grep for "TASK:<id>:DONE"
│   WHY: Deterministic. Tag either exists or does not. No LLM output parsing.
│        Per-worker cursor prevents other agents' tags from appearing in the
│        delta window.
│   AT 3+: Tags must carry [agent-id][task-id]. See §7.2.
│
├── Posts to AgentRoom channel on completion
│   │
│   ├── 2 agents on channel
│   │   └── wait_for_message on target channel
│   │   WHY: Clean block, wakes when agent posts, no wasted cycles.
│   │
│   └── 3+ agents on channel
│       └── wait_for_mention with @orchestrator in agent's completion post
│       WHY: wait_for_message at 3+ wakes ALL blocking agents simultaneously.
│            Only the mentioned orchestrator should process the completion.
│            Instruct agents at dispatch: "when done, post Done + @orchestrator."
│
├── Calls orchestration send on completion (bilateral handoff)
│   └── orchestration check --wait + timeout
│   WHY: Zero polling. Orchestrator sleeps until signal arrives.
│        ALWAYS set timeout. Crashed agents never signal.
│   NOT FOR: parallel workers. Only one orchestration check --wait can be
│             active at a time. Use cursor polling + tags for parallel scenarios.
│
└── Sub-orchestrator (managing its own worker pool)
    └── Track sub-orchestrator terminal + wait for completion signal on its channel
    WHY: Main orchestrator must NOT reach into sub-orchestrator's workers.
         Breaking the sub-orchestration boundary creates ambiguous authority
         over worker state. One tracking path per sub-orchestration unit.
    NOT: Monitoring individual sub-worker terminals from main orchestrator —
         creates N monitoring paths, defeats the sub-orchestration abstraction.
```

---

### Branch C — User → Agent

```
User goal?
│
├── Reach specific agent immediately
│   └── orca terminal send --terminal <handle> --text "..." --enter
│   WHY: User has direct terminal access. Direct PTY path, no intermediary.
│        AgentRoom DM adds mailbox latency. When you have the handle, use it.
│
├── Prompt without interrupting mid-task agent
│   └── AgentRoom channel @mention
│   WHY: PTY inject arrives immediately regardless of what agent is doing.
│        Channel @mention waits until agent's next wait_for_mention cycle —
│        natural yield point. No mid-task context contamination.
│
├── Unsure which agent needs this (broadcast)
│   └── AgentRoom channel post (with or without mention)
│   WHY: Orca terminal send requires a specific handle. Channel reaches all
│        subscribed agents. This is the primary value of AgentRoom to the user:
│        sending without knowing the recipient. Relevant agents self-select.
│
├── Read what agent produced
│   └── orca terminal read --terminal <handle> --cursor <prev>
│   WHY: Direct access, 0 tokens. No need to ask agent to report back.
│
└── Instruction that must survive agent compaction
    └── Write to file AND post channel message with path pointer
    WHY: Channel message alone is ephemeral from agent's perspective —
         compaction erases it from active context. File persists.
         Post triggers immediate action; file ensures instruction survives context loss.
```

---

### Branch D — Agent → Agent

```
One specific recipient or broadcast?
│
├── ONE specific recipient
│   │
│   ├── Small payload (< 3KB), same session, no persistence needed
│   │   └── orca orchestration send (if handle known) OR AgentRoom @mention
│   │   WHY: orchestration send is cheaper (no MCP call, no entity resolution).
│   │        Use it when you hold a confirmed live handle for this session.
│   │        If handle is unknown or may have changed, use AgentRoom @mention.
│   │
│   ├── Large payload (> 3KB) or unicode
│   │   └── Write to file → send_message with file path reference
│   │   WHY: PTY inject is 3KB capped and strips unicode. orchestration send
│   │        is ~7KB. File separates delivery (channel) from content (file).
│   │        Recipient reads file at its own pace and after any compaction.
│   │
│   ├── Must persist across compaction / sessions
│   │   └── AgentRoom DM → wake via channel @mention
│   │   WHY: orchestration send is lost when session ends or agent compacts.
│   │        AgentRoom DM is entity-addressed and persists in dev-state.json.
│   │        Agent reads via get_unread after recovering from compaction.
│   │
│   └── Private (other channel members must not see it)
│       └── AgentRoom DM (G2 pending) OR write to agent-specific file + notify path
│       WHY: Channel broadcasts to all subscribers. Sensitive content (credentials,
│            per-agent config) must not appear in shared channel history.
│            Until DM is implemented, write to a file only the target is
│            instructed to read.
│
└── BROADCAST (all agents)
    │
    ├── Informational (no action required)
    │   └── AgentRoom send_message to domain channel (no mention)
    │   WHY: Low-priority. Agents see it when they read channel history.
    │        Not mentioning avoids waking N agents for a non-actionable message.
    │
    └── Directive (all must act)
        └── AgentRoom send_message with @mention of each agent that must act
        WHY: Without explicit mention, agents blocking on wait_for_mention will
             not wake. Mention is the wake trigger.
        COST: O(N) mentions. At large N, use task queue pattern:
              agents pull from queue, no per-agent send needed.
```

---

### Branch E — Markdown Files: Write vs Post vs Both

```
What is this content?
│
├── Living artifact (spec, plan, task list, decision record)
│   └── Write file AND post channel message with absolute path reference
│   WHY: File = persistent, readable after compaction, source of truth.
│        Channel message = delivery trigger that informs the right agents.
│        Without channel post: no one knows the file exists.
│        Without file: content is lost after compaction.
│   PATH: Always absolute paths. Relative paths break when agents have
│         different working directories.
│
├── Transient handoff (one-time task brief, consumed once)
│   │
│   ├── Agent will read it immediately, compaction unlikely before read
│   │   └── Post to channel only (inline content or file ref)
│   │   WHY: File write overhead not justified for once-read content.
│   │
│   └── Agent may compact before reading (long-running task)
│       └── Write file + post channel with path
│       WHY: Agent recovers by re-reading the file. Without file,
│            the task brief is gone after compaction and task cannot resume.
│
├── Shared reference (multiple agents read same content)
│   └── Write file + post to domain channel (#backend, #frontend)
│   WHY: Single file = single source of truth. Multiple agents read from
│        same path — no divergence between copies. Domain channel limits
│        noise to agents that care.
│   NOT: Inline in channel — each agent gets a copy in context; copies diverge.
│
└── Orchestrator-internal state (task assignments, DAG, worker status)
    └── Write file only (no channel broadcast)
    WHY: Orchestrator state is private. Broadcasting it leaks task assignment
         information between agents that should be isolated from each other
         and adds irrelevant content to every subscriber's context.
    NOT: Channel broadcast of orchestrator internals.
```

---

## 7. 2-Agent vs 3+ Agent Rules

Every rule in this section changes at the 3-agent threshold. Apply the 2-agent variant below that threshold; switch at or above it.

### 7.1 Blocking: `wait_for_message` → `wait_for_mention`

**2 agents:** `wait_for_message` is unambiguous. Only one other party posts.

**3+ agents:** Switch every blocking agent to `wait_for_mention`. `wait_for_message` wakes ALL agents blocking on that channel when any message arrives. Every agent fires; all compete to act; only one should. The others waste tokens and introduce race conditions. `wait_for_mention` wakes only the named agent. At 3+ agents, no agent may block on `wait_for_message` in a shared channel. This is a hard rule, not a recommendation.

### 7.2 Completion Signals: Plain Text → Tagged

**2 agents:** "Done" is unambiguous — one worker, one outstanding task.

**3+ agents:** Tag every signal: `[worker-frontend][task-build-ui] COMPLETE`. Without both agent ID and task ID, the orchestrator cannot match a signal to a dispatched task when multiple workers complete concurrently. A bare "Done" under concurrency is an unmatched event that the orchestrator must either drop or guess at.

### 7.3 Terminal Reads: Shared Cursor → Cursor-Per-Worker

**2 agents:** One worker cursor. Sequential reads, no collision.

**3+ agents:** Capture the terminal cursor for each worker before dispatch. After completion, delta-read from that cursor. Without per-worker cursors, concurrent worker output interleaves in the read window — you cannot reconstruct which output belongs to which task.

Rule: Store `cursor_before[worker_id]` on dispatch. Read `delta(cursor_before, cursor_now)` per worker, never shared.

### 7.4 Targeted Handoffs: Channel → DM

**2 agents:** Channel post reaches exactly the right party.

**3+ agents:** Use DM for any message with exactly one intended recipient. A channel post reaches every agent in that channel — all others must read and discard a message not meant for them. At 3+ agents, this is noise that accumulates. DM makes the recipient boundary explicit. Use channel only for broadcast, status, and coordination all members should see.

### 7.5 Phase Synchronization: Inline → gate-create / gate-resolve

**2 agents:** Inline acknowledgment. "Confirm received" → "Confirmed." Two turns.

**3+ agents:** `gate-create` defines a synchronization point with an explicit condition. `gate-resolve` fires when it is met. Without gates, the orchestrator counts completion signals in working memory — error-prone, breaks on compaction. Gates externalize the condition. Never advance a pipeline phase by counting signals in memory when more than two agents are in flight.

### 7.6 Channel Structure: One #general → Domain Channels

**2 agents:** One channel is enough. Signal-to-noise is perfect.

**3+ agents:** Create domain channels (#backend, #frontend, #data). A backend worker waking to process a frontend deployment message is pure overhead. Domain channels scope traffic to agents that care. Keep #general for cross-domain announcements and orchestrator-wide status only.

### 7.7 Sub-Orchestration

Any agent can become a sub-orchestrator. When a task cluster is large enough to warrant its own coordination layer, promote the handling agent rather than routing all sub-tasks through the root orchestrator.

```
Root Orchestrator (Owner: human, Admin in parent channel)
    └── Sub-Orchestrator (Admin in sub-channel, Member in parent channel)
            ├── Worker A (Member in sub-channel)
            └── Worker B (Member in sub-channel)
```

**The boundary rule:** Root orchestrator tracks only the sub-orchestrator — one terminal, one channel signal. It does not reach into sub-workers. What the sub-orchestrator does internally is opaque to the root. Breaking this boundary couples the root's task graph to leaf-level implementation and defeats the abstraction.

**Role assignment:** Sub-orchestrator gets Admin in its sub-channel. Root retains Admin in the parent channel. Permission scope matches coordination scope.

**Spawn sequence:**
1. Root dispatches to named agent with sub-orchestrator role
2. Sub-orchestrator receives task cluster via DM (targeted, private)
3. Sub-orchestrator runs `orca-bootstrap.ps1` with its own handle as `-OrchestratorHandle`
4. Sub-orchestrator manages gates, aggregates results, posts `[sub-orch-id][cluster] COMPLETE` to parent channel
5. Root advances on that one signal

---

## 8. Agent Initialization and Post-Compaction Resume

### 8.1 Initialization Sequence

Steps must be performed in order. Each step depends on the previous being complete.

**Step 1 — Orca Briefing (handles)**
Run `orca terminal list --json`. Discover your own handle and the orchestrator's handle. Send acknowledgment to orchestrator. 
*Why first:* Every subsequent step requires handles. You cannot communicate, join a channel, or confirm entity auth without knowing your own handle and the orchestrator's. Handles are the foundation; everything else is built on them.

**Step 2 — AgentRoom MCP Auth (entity registration)**
Authenticate with AgentRoom MCP server. Establish your agent entity and receive entity ID.  
*Why second:* MCP auth registers you as a named entity. Without this, `wait_for_mention` cannot match messages addressed to you — the mention refers to an entity that does not yet exist. Auth must precede channel join because you cannot join as an entity that does not exist.

**Step 3 — Channel Join**
Join the channels specified in your briefing (domain channel, #general, any gate channels).  
*Why third:* You cannot receive channel messages until you are a member. `wait_for_mention` only fires for mentions in channels you have joined. Join before entering the wait loop, not after — a message that arrives in the window between auth and join is silently missed.

**Step 4 — wait_for_mention**
Begin blocking on `wait_for_mention` in your assigned channel.  
*Why last:* You are now fully initialized — handle, entity, channel membership. Entering the wait before any of these are established creates races: a task dispatch arriving before your entity exists cannot reach you; one arriving before channel join cannot wake you.

### 8.2 Post-Compaction Resume Sequence

Context compaction discards your conversation buffer. You retain role and tools but lose working memory of recent events. Perform steps in order before resuming work.

**Step 1 — `get_context`**
Call `get_context` on primary channel(s).  
*Why first:* Pre-processed AI-ready summary of recent channel activity. Cheaper than `read_history` (raw messages) and gives orientation before you know which specific messages or files to look for. You cannot make good decisions about what to read next without this overview.

**Step 2 — `get_unread`**
Retrieve DMs and mentions that arrived while compacted.  
*Why second, not first:* Directed messages are higher-signal, but you need the channel context from Step 1 to interpret them correctly. A DM saying "the auth module is ready, proceed" means nothing without knowing the current project phase. Context first; directed messages second.

**Step 3 — Read Referenced Files**
Read only files that Steps 1 and 2 point to. Do not read speculatively.  
*Why third:* Files are content, not orientation. You cannot know which files are relevant until you have the state from Steps 1 and 2. Reading files before context and messages wastes tokens on content that may be irrelevant to your next action.

**Step 4 — Resume `wait_for_mention`**
After processing any pending directed messages and completing work they require, return to the wait loop.  
*Why explicit:* After compaction, do not assume clean idle state. You may have unprocessed mentions or incomplete tasks that predate compaction. Complete those first; then re-enter the wait loop. Skipping directly to `wait_for_mention` risks ignoring already-assigned work.

### 8.3 Ordering Invariant

```
get_context (where are we?) → get_unread (what was I asked to do?) → file reads (what do I need to read to do it?)
```

This ordering is not optional. Inverting it is always more expensive and less accurate:
- Files before messages → you read the wrong files
- Messages before context → you misinterpret the messages

---

## 9. Orca Skill Reference

**Canonical skill locations:**
- `C:\Users\ricar\.agents\skills\orca-cli\SKILL.md` — terminal, browser, worktree, automations
- `C:\Users\ricar\.agents\skills\orchestration\SKILL.md` — inter-agent messaging, tasks, dispatch, gates, coordinator loops

**Binary:** `C:\Users\ricar\AppData\Local\Programs\Orca\bin\orca.cmd` (Windows/macOS). Linux: `orca-ide`.  
**Bootstrap (merged):** `orca-integration/orca-bootstrap-agentroom.ps1`

---

### Critical distinction: `orchestration send` vs `orchestration dispatch --inject`

These are not the same. Getting them confused is the most common orchestration mistake.

| Command | Delivery | Wakes idle agent | When to use |
|---------|---------|-----------------|-------------|
| `orchestration send` | Mailbox (push-on-idle) | No — agent must be executing and finish | Private data, large payloads, non-urgent |
| `orchestration dispatch --inject` | Injects preamble directly into terminal | **Yes** — PTY inject, agent acts immediately | Assigning a task to a worker; structured dispatch |
| `terminal send` | PTY inject | **Yes** | Short prompts < 3KB; wake with pointer to content |

**Push-on-idle:** `orchestration send` messages are delivered automatically when the recipient agent goes idle (finishes its current task). This is NOT a wake mechanism. If the agent is already idle and not polling, messages wait in the mailbox. Use `orchestration dispatch --inject` or `terminal send` to actively deliver.

---

### Terminal commands

```bash
orca terminal list --json                                      # always first — handles are session-specific
orca terminal create --json                                    # new background panel
orca terminal create --title "worker-1" --command "claude" --json  # spawn Claude Code directly
orca terminal split --terminal <h> --direction vertical --json
orca terminal send --terminal <h> --text "..." --enter --json  # max 3KB; double-quotes stripped
orca terminal read --terminal <h> --json                       # 23-line snapshot
orca terminal read --terminal <h> --cursor <n> --limit 1000 --json  # full delta (use this)
orca terminal wait --terminal <h> --for tui-idle --timeout-ms 60000 --json  # wait for agent CLI to finish
orca terminal wait --terminal <h> --for exit --timeout-ms 5000 --json       # wait for process exit
orca terminal stop --terminal <h> --json
orca terminal close --terminal <h> --json
```

After `terminal create --command "claude"`, always `terminal wait --for tui-idle` before dispatching — waits for the agent to boot.

---

### Orchestration commands (inter-agent coordination)

```bash
# Messaging (SQLite-backed, push-on-idle delivery)
orca orchestration send --to <handle|@group> --subject "x" --body "y" [--type worker_done] [--inject] --json
orca orchestration check [--terminal <h>] [--wait] [--timeout-ms 120000] [--types worker_done,escalation] --json
orca orchestration reply --id <msg_id> --body "..." --json
orca orchestration inbox --json

# Task DAG
orca orchestration task-create --spec "..." [--deps '["task_id1"]'] --json
orca orchestration task-list [--ready] [--status dispatched] --json
orca orchestration task-update --id <task_id> --status completed [--result '{}'] --json

# Dispatch (assigns task to terminal, optionally injects preamble)
orca orchestration dispatch --task <id> --to <handle> [--inject] --json  # --inject = active delivery
orca orchestration dispatch-show --task <id> --json

# Decision gates (human-in-the-loop)
orca orchestration gate-create --task <id> --question "Proceed?" --json
orca orchestration gate-resolve --id <gate_id> --resolution "yes" --json
orca orchestration gate-list [--task <id>] --json

# Coordinator loop (automated DAG management)
orca orchestration run --spec "build feature X" --json   # returns immediately, runs in background
orca orchestration run-stop --json

# Lifecycle
orca orchestration reset --all --json
```

**Group addressing (broadcast within Orca):**
`@all` (all terminals except sender), `@idle` (only idle agents), `@claude` (Claude Code terminals), `@codex`, `@opencode`, `@gemini`, `@worktree:<id>` (all in a worktree)

**Message types:** `status`, `dispatch`, `worker_done`, `merge_ready`, `escalation`, `handoff`, `decision_gate`

---

### Typical coordinator pattern (dispatch → wait → advance)

```bash
# 1. Create terminal with Claude Code
orca terminal create --title "worker-1" --command "claude" --json  # → handle: term_abc
orca terminal wait --terminal term_abc --for tui-idle --timeout-ms 60000 --json

# 2. Create task and dispatch with preamble injection (ACTIVE delivery)
orca orchestration task-create --spec "Fix auth button CSS" --json  # → id: task_xyz
orca orchestration dispatch --task task_xyz --to term_abc --inject --json

# 3. Block until worker reports worker_done (no sleep loops)
orca orchestration check --wait --types worker_done,escalation --timeout-ms 300000 --json

# 4. Mark complete → auto-promotes dependent tasks to ready
orca orchestration task-update --id task_xyz --status completed --json
```

---

### Worktree commands (for code isolation between agents)

```bash
orca worktree ps --json                                        # list active worktrees
orca worktree current --json                                   # current worktree identity
orca worktree create --repo id:<repoId> --name "feature-x" --json
orca worktree set --worktree active --comment "fixing auth" --json  # update status in Orca UI
orca worktree rm --worktree id:<id> --force --json
```

Update `--comment` at every meaningful checkpoint. This is the Orca UI's live status indicator.

---

### Automations (scheduled agent tasks)

```bash
orca automations list --json
orca automations create --name "Daily review" --trigger daily --time 09:00 \
  --prompt "Review open PRs" --provider claude --repo id:<repoId> --json
orca automations run <automationId> --json
orca automations remove <automationId> --json
```

---

### Browser commands

```bash
orca goto --url <url> --json                   # navigate (blocks until loaded)
orca snapshot [--page <browserPageId>] --json  # accessibility tree + element refs
orca screenshot --json
orca click --element @e3 [--page <id>] --json
orca fill --element @e1 --value "..." [--page <id>] --json
orca tab list --json
orca tab create --url <url> --json
orca tab switch --page <browserPageId> --json  # use --page for stable multi-tab targeting
orca tab close --page <browserPageId> --json
orca wait --text "Dashboard" --timeout 5000 --json  # prefer over bare orca wait
```

Always re-snapshot after navigation. Use `--page <browserPageId>` for concurrent browser work.  
Never auto-close tabs — user cannot reposition without manual UI drag-and-drop.

---

### Key constraints (from verified edge tests — see `orca-integration/edge-test-findings.md`)

| Constraint | Detail | Fix |
|-----------|--------|-----|
| `terminal send` max | 3KB; truncated silently | Write to file, pass path |
| Double-quotes in `terminal send` | Stripped by PTY | Use single-quoted strings or `.ps1` file |
| Non-ASCII / unicode in `terminal send` | Silently dropped at PTY | Write UTF-8 file, pass path via `terminal send` |
| Terminal scrollback | Fixed 23-line window; older output lost | Redirect to file: `cmd > out.txt; echo TASK:X:DONE` |
| Handles | Session-specific — go stale on Orca restart | Always `terminal list` at session start; never store |
| `orchestration send` | Mailbox (push-on-idle); does NOT wake idle agent | Use `dispatch --inject` or `terminal send` for active delivery |
| `tab create` exit code | May return `runtime_unavailable` exit 1 but still creates tab | Don't retry; verify with `tab list` |
| Stale element refs | Cross-page refs fail with `browser_stale_ref` | Re-snapshot after any navigation |
