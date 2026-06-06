# Orca CLI Reference

$ORCA = 'C:\Users\ricar\AppData\Local\Programs\Orca\bin\orca.cmd'

> Placeholders: `<handle>` = a terminal handle string from `terminal list` (e.g. `term_abc123`). In code blocks it is stored as `$h`. `<n>` = a number.

## Terminal

```powershell
& $ORCA terminal list --json
& $ORCA terminal create --title "name" --focus --json
& $ORCA terminal create --worktree path:"C:\path\to\proj" --command "opencode" --json  # spawn CLI in a worktree
#   --worktree selectors: path:<p> | branch:<b> | issue:<n> | id:<id> | active | current
#   --command runs on startup (launch any CLI directly without the bootstrap script)
& $ORCA terminal send --terminal <h> --text "cmd" --enter --json
& $ORCA terminal read --terminal <h> --json          # default 23-line snapshot
& $ORCA terminal read --terminal <h> --cursor <n> --limit 1000 --json  # full delta since cursor <n>
& $ORCA terminal wait --terminal <h> --for tui-idle --timeout-ms 30000 --json
& $ORCA terminal split --terminal <h> --direction vertical --json    # RIGHT
& $ORCA terminal split --terminal <h> --direction horizontal --json  # DOWN
& $ORCA terminal split --terminal <h> --direction vertical --command "codex" --json  # split + launch CLI
& $ORCA terminal switch --terminal <h> --json
& $ORCA terminal rename --terminal <h> --title "Name" --json
& $ORCA terminal close --terminal <h> --json
```

## Terminal Edge Cases (Tested)

| Issue | Behavior |
|-------|----------|
| `terminal read` buffer | Default = 23-line snapshot. Use `--limit 1000` for up to 1000 lines. |
| `terminal read --cursor` | Returns ONLY lines since cursor — use for clean delta reads |
| Non-ASCII / emoji in `terminal send` | Silently dropped at PTY input — use `orchestration send` or file-based handoff |
| `terminal read` with unicode output | PTY garbles non-ASCII display — read result file directly, not terminal tail |
| Payload >3KB in `terminal send` | Truncated at ~3.6KB |
| Payload >32KB | Windows CMD error: "command line is too long" |
| Double quotes in `--text` | Stripped — write to `.ps1` file and execute file instead |
| Closed handle `terminal send` | `terminal_not_writable` (exit 1) — clear error |
| Unknown handle | `terminal_handle_stale` (exit 1) — clear error |
| `terminal wait --for exit` on closed handle | Returns immediately: `satisfied:true`, `exitCode:-1073741510` — use as liveness probe |

## Cursor-Based Reads (Preferred for Long Output)

```powershell
# Capture cursor BEFORE sending command
$before = & $ORCA terminal read --terminal $h --json | ConvertFrom-Json
$cursor = $before.result.terminal.nextCursor

# Send your command
& $ORCA terminal send --terminal $h --text ".\run.ps1" --enter --json
Start-Sleep -Seconds 3   # adjust to expected command duration; or use terminal wait --for tui-idle for interactive CLIs

# Read ONLY output since cursor — clean delta, no old terminal history
$delta = & $ORCA terminal read --terminal $h --cursor $cursor --json | ConvertFrom-Json
$delta.result.terminal.tail | Where-Object { $_ -match '\S' }

# For very long output, add --limit (tested: 1000 lines returned correctly)
$delta = & $ORCA terminal read --terminal $h --cursor $cursor --limit 1000 --json | ConvertFrom-Json
```

## Workarounds for Known Failures (Confirmed by Testing)

### T1 — Double quotes in `--text`: write to .ps1 file ✓
```powershell
# Double quotes are STRIPPED when passed inline to terminal send
# WRONG: & $ORCA terminal send --terminal $h --text 'echo "hello world"' --enter
# RIGHT: write to file
Set-Content -Path "run.ps1" -Value 'echo "hello world"' -Encoding UTF8
& $ORCA terminal send --terminal $h --text ".\run.ps1" --enter --json
```

### T2 — Payload >3KB: file-based task handoff ✓
```powershell
# Write task to file, agent reads it — 5006 chars confirmed recovered
Set-Content -Path "task.md" -Value $largeContent -Encoding UTF8
& $ORCA terminal send --terminal $h --text "Get-Content task.md" --enter --json
# For instructions: "read task.md and execute, write output to result.md"
```

### Unicode — Best method: `orchestration send` ✓
```powershell
# orchestration send bypasses PTY — unicode and emoji preserved perfectly
& $ORCA orchestration send --to $agentHandle --from $myHandle --subject "task" --body $unicodeContent --json
# Limit: ~7KB (8KB hits Windows CMD line length limit)
```

### Unicode — Alternative: Base64 + file ✓
```powershell
# Orchestrator encodes to Base64 (ASCII-safe for terminal send)
$b64 = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($unicodeContent))

# Agent decodes + writes to file (NOT prints — PTY garbles non-ASCII output)
$script = "[System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('$b64')) | Set-Content 'result.txt' -Encoding UTF8; Write-Host 'DONE'"
Set-Content -Path "decode.ps1" -Value $script -Encoding UTF8
& $ORCA terminal send --terminal $h --text ".\decode.ps1" --enter --json
Start-Sleep -Seconds 2
# Orchestrator reads file directly — full unicode confirmed recovered
$result = Get-Content "result.txt" -Encoding UTF8
```

### General: use .ps1 script files to avoid escaping issues ✓
```powershell
# Complex commands with quotes, $vars, special chars — write to .ps1 first
Set-Content -Path "run.ps1" -Value $yourScript -Encoding UTF8
& $ORCA terminal send --terminal $h --text ".\run.ps1" --enter --json
```

## Agent Liveness Probe

```powershell
$alive = (& $ORCA terminal wait --terminal $h --for exit --timeout-ms 1000 --json | ConvertFrom-Json)
if ($alive.result.satisfied) { Write-Host "Agent is DEAD (exitCode: $($alive.result.exitCode))" }
else { Write-Host "Agent is ALIVE" }
```
> Check the `satisfied` field, NOT `$LASTEXITCODE`: when the agent is alive the wait times out and the command exits **1** (not satisfied). `satisfied:true` = dead. A script branching on exit code alone would read "alive" backwards.

## Tab Types

| Type | Command | Notes |
|------|---------|-------|
| Command shell | `terminal create --title "name"` | Default |
| PowerShell | `terminal create --command "powershell"` | Wait 2s for init |
| Markdown/File | `file open "relative/path.md"` | Relative to worktree root — absolute paths fail |
| Browser tab | `tab create --url <url>` | `ok:false` is false negative — verify with `tab list`. Full browser commands: `parts/browser.md` |

## Panel Split Directions

- `--direction vertical` = right
- `--direction horizontal` = below
- Browser tab position: UI-only (drag-and-drop) — not settable via CLI

## Worktree & File

```powershell
& $ORCA worktree ps --json
& $ORCA worktree current --json
& $ORCA file open "src/App.tsx"           # relative to worktree — absolute paths fail
& $ORCA file diff "src/App.tsx" --staged
& $ORCA file open-changed --json          # open all git-changed files
& $ORCA status --json                     # verify CLI connected
```
