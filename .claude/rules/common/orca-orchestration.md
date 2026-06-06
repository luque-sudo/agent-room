# Orca ADE Orchestration

## Environment

User runs **Orca ADE** as their development environment. Claude Code sessions run inside Orca terminals and can control the editor via the Orca CLI.

**Orca CLI:** `C:\Users\ricar\AppData\Local\Programs\Orca\bin\orca.cmd`

## Bootstrap Script (Global)

`C:\Users\ricar\.claude\scripts\orca-bootstrap.ps1`

Spawns a new Claude agent in a separate Orca terminal panel, launches the model, and briefs it with full context automatically.

```powershell
# Spawn a Haiku worker from current session
& 'C:\Users\ricar\.claude\scripts\orca-bootstrap.ps1' -OrchestratorHandle <your-terminal-handle>

# Spawn with specific model and role
& 'C:\Users\ricar\.claude\scripts\orca-bootstrap.ps1' -Model "claude-sonnet-4-6" -Role "sub-orchestrator" -OrchestratorHandle <handle>
```

## Getting Your Terminal Handle

At the start of any session, find your handle:
```powershell
& 'C:\Users\ricar\AppData\Local\Programs\Orca\bin\orca.cmd' terminal list --json
```
Your terminal is the one whose title matches the current session or task.

## Two-Way Communication

```powershell
# Send to an agent
& 'C:\Users\ricar\AppData\Local\Programs\Orca\bin\orca.cmd' terminal send --terminal <handle> --text "message" --enter --json

# Read agent output
& 'C:\Users\ricar\AppData\Local\Programs\Orca\bin\orca.cmd' terminal read --terminal <handle> --json
```

## Escalation Chain

```
Sonnet (orchestrator)
    └── Haiku (worker / sub-orchestrator)
            └── SubAgents (spawned via bootstrap script)
```

Any agent can become an orchestrator by running the bootstrap script with its own handle as `-OrchestratorHandle`.

## Model IDs

| Role | Model ID |
|------|----------|
| Worker (fast/cheap) | `claude-haiku-4-5-20251001` |
| Orchestrator | `claude-sonnet-4-6` |
| Deep reasoning | `claude-opus-4-8` |

## Browser Tab Lifecycle Rule

**Never auto-close browser tabs.** User cannot reposition them without manual UI drag-and-drop.
- Leave tabs open after browser tasks
- Only close if it was a quick one-off task — inform or ask permission first

## Error Recovery — Spawn Helper Agent After 2+ Errors

Models can hallucinate Orca CLI commands that don't exist. If stuck or hitting 2+ consecutive errors:

**Choose spawn method based on situation:**

| Situation | Method | Model/CLI |
|-----------|--------|-----------|
| Quick debug / simple task | Native `Agent` tool | Haiku |
| Deep reasoning / architecture | Native `Agent` tool | Opus |
| General coding | Native `Agent` tool | Sonnet |
| 3rd-party model | claudish MCP `create_session` | Any OpenRouter model |
| aider / opencode / pi / codex / other | Orca tab `orca-bootstrap.ps1 -CLI <name>` | 3rd party CLI |
| Context window near full | Orca tab | Haiku or Sonnet |
| Long-running / persistent agent | Orca tab | Any |

Supported CLIs in bootstrap: `claude`, `opencode`, `aider`, `pi`, `codex` — or use `-CustomCommand`.
**Web-search-first:** Always verify 3rd-party CLI syntax before spawning — model knowledge may be stale.

Always try native `Agent` tool first — no extra overhead, no new tab needed.

## Agent Context Briefing Template

Send this to any newly launched agent:
```
you are a [ROLE] agent in a Claude multi-agent pipeline on Orca ADE.
CONTEXT:
(1) ORCA CLI: C:\Users\ricar\AppData\Local\Programs\Orca\bin\orca.cmd
(2) ORCHESTRATOR handle: [ORCHESTRATOR_HANDLE]
(3) YOUR handle: [AGENT_HANDLE]
(4) WORKING DIR: [WORKING_DIR]
(5) TO REPORT BACK: & 'C:\Users\ricar\AppData\Local\Programs\Orca\bin\orca.cmd' terminal send --terminal [ORCHESTRATOR_HANDLE] --text 'message' --enter
(6) TO SPAWN SUB-AGENTS: & 'C:\Users\ricar\.claude\scripts\orca-bootstrap.ps1' -OrchestratorHandle [AGENT_HANDLE]
(7) ROLE: receive tasks, execute, report back when done.
Acknowledge by messaging orchestrator now.
```
