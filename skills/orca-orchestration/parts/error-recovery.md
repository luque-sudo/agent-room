# Error Recovery & CLI Tools

## Spawn Decision Matrix (2+ errors or stuck)

| Situation | Method | Model/CLI |
|-----------|--------|-----------|
| Quick debug / simple task | Native `Agent` tool | Haiku |
| Deep reasoning / architecture | Native `Agent` tool | Opus |
| General coding | Native `Agent` tool | Sonnet |
| 3rd-party model | claudish MCP `create_session` | Any OpenRouter model |
| Different AI CLI needed | Orca tab `orca-bootstrap.ps1 -CLI <name>` | see below |
| Context window near full | Orca tab | Haiku or Sonnet |
| Long-running / persistent | Orca tab | Any |

> **Web-search-first:** Always verify 3rd-party CLI syntax before spawning — model knowledge may be stale.

## 3rd-Party CLI Tools

> Snapshot as of June 2026 — install commands, model IDs, and flags change often. **Web-search-first before using any entry here** (per the standing rule above). Do not treat this list as currently authoritative.

### OpenCode
- Binary: `opencode` | Install: `npm i -g opencode-ai@latest`
- Model: `--model provider/model_id` e.g. `anthropic/claude-sonnet-4-20250514`
- Bootstrap: `.\orca-bootstrap.ps1 -CLI "opencode" -Model "anthropic/claude-sonnet-4-20250514"`

### Aider
- Binary: `aider` | Install: `pipx install aider-chat` (Python ≤3.12 — use `uv` on Python 3.13)
- Model: `--model sonnet` or full `--model openrouter/anthropic/claude-3.7-sonnet`
- Bootstrap: `.\orca-bootstrap.ps1 -CLI "aider" -Model "sonnet"`

### Codex CLI (OpenAI)
- Binary: `codex` | Install: `powershell -c "irm https://chatgpt.com/codex/install.ps1 | iex"`
- Model: `--model gpt-5.4` (current: gpt-5.5, gpt-5.4, gpt-5.4-mini, gpt-5.3-codex)
- **STALE IDs:** `codex-1`, `o4-mini` — do not use
- Bootstrap: `.\orca-bootstrap.ps1 -CLI "codex" -Model "gpt-5.4"`

### Goose (Block/Square)
- Binary: `goose` | Install: via download_cli.sh
- Model: via `GOOSE_MODEL` env or `goose configure`
- Bootstrap: `.\orca-bootstrap.ps1 -CLI "goose"`

### Amp (Sourcegraph)
- Binary: `amp` | Install: `npm install -g @sourcegraph/amp`
- Model: configured in account settings (no CLI flag)
- Bootstrap: `.\orca-bootstrap.ps1 -CLI "amp"`

### Antigravity CLI (Google — replaces Gemini CLI)
- Binary: `agy` | Install: native binary from https://antigravity.google (NOT npm — no package manager; see site for current instructions)
- **Gemini CLI EOL: June 18 2026** — use `agy` instead
- Bootstrap: `.\orca-bootstrap.ps1 -CLI "agy"`

### Pi Coding Agent (pi.dev)
- Binary: `pi` | Install: `curl -fsSL https://pi.dev/install.sh | sh`
- Model: configured in `~/.pi/config.toml` (no per-run flag)
- **NOT Inflection AI Pi** (that has no CLI)
- Bootstrap: `.\orca-bootstrap.ps1 -CLI "pi"`

## Bootstrap Examples

```powershell
# Use the full path so it works from any directory (cwd is usually a project dir, not the scripts dir)
$BOOT = 'C:\Users\ricar\.claude\scripts\orca-bootstrap.ps1'
& $BOOT -CLI "claude" -Model "claude-haiku-4-5-20251001" -OrchestratorHandle <h>
& $BOOT -CLI "opencode" -Model "anthropic/claude-sonnet-4-20250514" -OrchestratorHandle <h>
& $BOOT -CLI "aider" -Model "sonnet" -OrchestratorHandle <h>
& $BOOT -CLI "codex" -Model "gpt-5.4" -OrchestratorHandle <h>
& $BOOT -CustomCommand "mytool --flag" -OrchestratorHandle <h>
```
