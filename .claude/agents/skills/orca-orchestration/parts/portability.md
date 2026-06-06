# Portability — New Device Setup

## Files to Copy to New Machine

| Source | Destination | Purpose |
|--------|-------------|---------|
| `~/.claude/scripts/orca-bootstrap.ps1` | same path | Spawn any agent |
| `~/.claude/skills/orca-orchestration/` | same path | This skill (all parts) |
| `~/.claude/rules/common/orca-orchestration.md` | same path | Auto-loaded every session |
| `~/.claude/scripts/orca-orchestration-prompt.md` | same path | Standalone prompt |

## Setup Steps

```powershell
# 1. Install Orca ADE
# Download from https://onorca.dev

# 2. Verify CLI path (may differ on new machine)
$ORCA = 'C:\Users\<username>\AppData\Local\Programs\Orca\bin\orca.cmd'
& $ORCA status --json

# 3. Update paths in the bootstrap script on THIS (new) machine if the username differs
# Edit: C:\Users\<new-username>\.claude\scripts\orca-bootstrap.ps1
# Update: $ORCA = 'C:\Users\<new-username>\AppData\Local\Programs\Orca\bin\orca.cmd'

# 3b. In the same file, update the WorkDir default to the new machine's project path
# Update: $WorkDir default → 'C:\Users\<new-username>\...\<project>'

# 4. Test connection
& $ORCA terminal list --json
```

## Path Variables to Update on New Machine

- `$ORCA` in `orca-bootstrap.ps1` — Orca binary path
- `WorkDir` default in `orca-bootstrap.ps1` — project directory
- Context briefing template handles — always re-listed per session anyway

## Notes

- Terminal handles are session-specific — never hardcode them, always `terminal list` at session start
- Browser tab positions are remembered by Orca UI — may need to reposition on new machine
- Project memory in `~/.claude/projects/...` is machine-specific — it repopulates automatically as you run sessions; nothing to copy
