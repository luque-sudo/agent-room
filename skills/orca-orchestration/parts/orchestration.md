# Orca Orchestration

$ORCA = 'C:\Users\ricar\AppData\Local\Programs\Orca\bin\orca.cmd'

## Native Orca Orchestration Commands (prefer over manual terminal send)

> Flags below verified against `--help`. Exact flag names matter — wrong flags error out or produce unexpected output. Use exactly as shown.

```powershell
# Messaging — structured queue, bypasses PTY, preserves unicode, supports ~7KB body
& $ORCA orchestration send  --to <handle> --from <handle> --subject "task" --body "content" --json
& $ORCA orchestration check --terminal <h> --json              # unread only, marks them read
& $ORCA orchestration check --terminal <h> --all --json        # every msg, does NOT mark read
& $ORCA orchestration check --terminal <h> --wait --timeout-ms 30000 --json  # block until a msg arrives
& $ORCA orchestration reply --id <msg_id> --body "response" --from <handle> --json
& $ORCA orchestration inbox --json

# Task management   (task-create uses --spec, NOT --title; updates use --id, NOT --task)
& $ORCA orchestration task-create --spec "Feature X: do Y" --json
& $ORCA orchestration task-list --json
& $ORCA orchestration dispatch --task <task_id> --to <handle> --json
& $ORCA orchestration task-update --id <task_id> --status completed --json
#   valid --status: pending | ready | dispatched | completed | failed | blocked

# Coordinator / gates   (gate-resolve uses --id + --resolution)
& $ORCA orchestration gate-create  --task <task_id> --question "Proceed?" --json
& $ORCA orchestration gate-resolve --id <gate_id> --resolution "yes, proceed" --json
& $ORCA orchestration run --json        # start coordinator loop
& $ORCA orchestration run-stop --json
& $ORCA orchestration reset --json
```

### `orchestration send` key properties (confirmed)
- Unicode and emoji preserved perfectly — bypasses PTY entirely
- Body size limit: ~7KB OK, 8KB = "command line too long" (Windows CMD limit)
- For >7KB: use file-based handoff + notify via `orchestration send` with file path
- Agent receives via `orchestration check --terminal <own-handle> --wait --timeout-ms 30000` (blocks until a message arrives). Without `--wait`, `check` returns immediately — only then poll in a loop.
- `check --unread` (default) marks read; `check --all` does not — use `--all` for idempotent reads
- Returns structured `message` object with `id`, `from_handle`, `to_handle`, `subject`, `body`

> **Validated bidirectionally with a live agent (round-trip):** orchestrator → `send` → agent reads via `check` → agent replies via `send` → orchestrator reads via `check --wait`. Unicode/emoji returned byte-for-byte intact. This is the PREFERRED inter-agent channel — unicode-safe, structured, no quote-stripping (unlike `terminal send`).
>
> **`orchestration send` is a mailbox, not a push.** Queuing a message does NOT wake an idle interactive agent. To make an idle Claude/CLI agent act you must still `terminal send` a prompt (or have the agent run `check --wait` in a loop). Use `terminal send` to *prompt/task* an interactive agent; use `orchestration send` to pass *structured data, unicode, and replies*.

## Manual Pipeline (direct terminal messaging)

### Escalation Chain
```
Sonnet (orchestrator)
    └── Haiku (worker + can sub-orchestrate)
            └── SubAgents (via bootstrap script)
```

### Session Start — always re-list handles
```powershell
(& $ORCA terminal list --json | ConvertFrom-Json).result.terminals |
  ForEach-Object { Write-Host "$($_.handle) — $($_.title)" }
```

### Spawn Worker via Bootstrap
```powershell
& 'C:\Users\ricar\.claude\scripts\orca-bootstrap.ps1' `
  -CLI "claude" -Model "claude-haiku-4-5-20251001" `
  -Role "worker" -OrchestratorHandle "<your-handle>"
```

### Dispatch Task with Completion Signal
```powershell
& $ORCA terminal send --terminal <agent-h> `
  --text "task. when done: & '$ORCA' terminal send --terminal <your-h> --text 'DONE: summary' --enter" `
  --enter --json
```

### Agent Context Briefing Template
```
You are a [ROLE] agent in a multi-agent pipeline on Orca ADE.
(1) ORCA CLI: C:\Users\ricar\AppData\Local\Programs\Orca\bin\orca.cmd
(2) ORCHESTRATOR handle: [ORCHESTRATOR_HANDLE]
(3) YOUR handle: [AGENT_HANDLE]
(4) WORKING DIR: [WORKING_DIR]
(5) REPORT BACK (preferred, unicode-safe): & 'C:\Users\ricar\AppData\Local\Programs\Orca\bin\orca.cmd' orchestration send --to [ORCHESTRATOR_HANDLE] --from [AGENT_HANDLE] --subject 'RESULT' --body 'your result'
    (orchestrator reads it with: orchestration check --terminal [ORCHESTRATOR_HANDLE] --wait)
(6) SPAWN SUB-AGENTS: & 'C:\Users\ricar\.claude\scripts\orca-bootstrap.ps1' -OrchestratorHandle [AGENT_HANDLE]
Acknowledge by messaging orchestrator now.
```

## Orchestration Edge Cases (Tested)

| Issue | Behavior |
|-------|----------|
| Crash detection | `terminal_not_writable` on send to dead terminal — not silent |
| Liveness probe | `terminal wait --for exit --timeout-ms 1000` — returns immediately if dead |
| Dead terminal exitCode | `-1073741510` (0xC000013A) = force-killed; `0` = clean exit |
| Large task payload via terminal send | >3KB truncated, >32KB errors — use `orchestration send` or file handoff |
| Large payload via orchestration send | ~7KB body OK, 8KB = "command line too long" |
| Double quotes in `terminal send --text` | Stripped — write to `.ps1` file and execute file |
| Unicode via terminal send | PTY garbles both input and output display — use `orchestration send` |
| Rapid dispatch ordering | Safe — PTY serializes input; commands run in send order, no reordering. No extra handling needed. |
| Rapid dispatch + tagging | Tag output (`echo TASK:A:done`) — tags preserved verbatim, grep-able from tail |
| Long output reads | Use `--limit 1000` + `--cursor <prev>` for full delta read — not 23-line limited |

## Recommended Dispatch Pattern (cursor + tagging)

```powershell
# Capture cursor BEFORE dispatching
$cursor = (& $ORCA terminal read --terminal $h --json | ConvertFrom-Json).result.terminal.nextCursor

# Tag each task's output so responses are matchable
# If a task command contains double quotes or other special chars, write it to a .ps1 file first (see cli.md T1)
& $ORCA terminal send --terminal $h --text "your-cmd-a > task_a.txt; echo TASK:A:done" --enter --json
& $ORCA terminal send --terminal $h --text "your-cmd-b > task_b.txt; echo TASK:B:done" --enter --json
Start-Sleep -Seconds 5   # adjust to expected task duration; or use terminal wait --for tui-idle

# Read ONLY delta since cursor — use --limit for long output
$out = (& $ORCA terminal read --terminal $h --cursor $cursor --limit 1000 --json | ConvertFrom-Json).result.terminal.tail
$doneA = $out | Where-Object { $_ -match "TASK:A:done" }
$doneB = $out | Where-Object { $_ -match "TASK:B:done" }
```

## Model Reference

| Role | Model ID |
|------|----------|
| Worker (fast) | `claude-haiku-4-5-20251001` |
| Orchestrator | `claude-sonnet-4-6` |
| Deep reasoning | `claude-opus-4-8` |
