---
name: orca-orchestration
description: Orca ADE — CLI control, multi-agent orchestration, browser automation (NOT Claude computer use API), and 3rd-party CLI spawning. Use for any Orca ADE workflow.
origin: local
---

# Orca ADE Orchestration

**CLI:** `C:\Users\ricar\AppData\Local\Programs\Orca\bin\orca.cmd`
**Bootstrap:** `C:\Users\ricar\.claude\scripts\orca-bootstrap.ps1`

## When to Activate

- Orchestrating agents in Orca / spawning worker agents
- Two-way communication between Claude models or 3rd-party CLIs
- Browser automation inside Orca (NOT Claude computer use API)
- Starting a new session — re-establish pipeline
- 2+ CLI errors — spawn helper agent

## Standing Rules

**Browser tabs:** Never auto-close. User cannot reposition without UI drag-and-drop. Ask permission before closing.

**2+ errors → spawn helper** (models hallucinate CLI commands):

| Situation | Method | Model/CLI |
|-----------|--------|-----------|
| Quick debug | Native `Agent` tool | Haiku |
| Deep reasoning | Native `Agent` tool | Opus |
| General coding | Native `Agent` tool | Sonnet |
| 3rd-party model | claudish MCP | OpenRouter |
| Different AI CLI | Orca tab `-CLI <name>` | opencode/aider/codex/goose/amp/agy/pi |
| Context full / long task | Orca tab | Any |

**Web-search-first:** Verify 3rd-party CLI syntax before spawning — model knowledge may be stale.

**Read state first:** Always `terminal list` + `tab list` before creating anything new.

**Output reads:** For long output, capture the terminal's `nextCursor` BEFORE dispatching a command to that terminal, then read the delta AFTER it finishes with `--cursor <prev> --limit 1000` — captures everything, not just the 23-line snapshot. → `parts/cli.md` (Cursor-Based Reads)

**Large payload:** `terminal send` truncates >3KB. Use `orchestration send` (~7KB OK; 8KB hits the Windows CMD line-length limit) or write to file + notify agent with the path. For >7KB use a file. → `parts/cli.md` (T2), `parts/orchestration.md`

**Unicode:** Use `orchestration send` — bypasses PTY, preserves emoji/multibyte. File-based also works (file stored correctly, read it directly). Never rely on `terminal read` tail for unicode display. → `parts/cli.md` (Unicode)

**Double quotes in `terminal send --text`:** Stripped. Write the command to a `.ps1` file and execute the file instead. → `parts/cli.md` (T1)

## Sub-Files (load the relevant part, not the whole skill)

| Part | File | Contents |
|------|------|----------|
| CLI reference | `parts/cli.md` | terminal, file, worktree, tab types, edge cases |
| Orchestration | `parts/orchestration.md` | native orca orchestration + manual pipeline |
| Browser | `parts/browser.md` | browser automation, nuances, proven flows |
| Error recovery | `parts/error-recovery.md` | spawn matrix + all 3rd-party CLI syntax |
| Portability | `parts/portability.md` | new device setup, files to copy, path updates |

## Quick Reference

```powershell
$ORCA = 'C:\Users\ricar\AppData\Local\Programs\Orca\bin\orca.cmd'
& $ORCA status --json                                        # verify connected
& $ORCA terminal list --json                                 # list terminals (do first)
& $ORCA tab list --json                                      # list browser tabs
& $ORCA terminal read --terminal <h> --json                  # default 23-line snapshot
& $ORCA terminal read --terminal <h> --cursor <n> --limit 1000 --json  # full delta read
& $ORCA snapshot --json                                      # browser DOM + refs
& $ORCA screenshot --json                                    # browser visual
& 'C:\Users\ricar\.claude\scripts\orca-bootstrap.ps1' -CLI "claude" -Model "claude-haiku-4-5-20251001" -OrchestratorHandle <h>
```
