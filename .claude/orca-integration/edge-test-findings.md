# Orca ADE Edge Case Test Findings

Cross-reference this file to update `~/.claude/skills/orca-orchestration/SKILL.md` and `~/.claude/rules/common/orca-orchestration.md`.

---

## T1: PowerShell Escaping in Context Briefs
**Status:** NUANCE
- Paths with spaces: PASS — received intact
- `$HOME` variable: NUANCE — received as literal `$HOME` (not expanded) ✓ good
- Single quotes: PASS
- Double quotes: FAIL — `"double"` became `double` (quotes stripped by PowerShell)
- Backticks: NUANCE — double backtick `` `` `` became single `` ` ``

**Fix:** Use single-quoted strings for briefs containing double quotes. Avoid backticks in brief text. Bootstrap script should wrap `--text` in single quotes or use here-string.

---

## T2: Large Payload Truncation
**Status:** FAIL (confirmed limits)
- 5KB: TRUNCATED — sent 5000 chars, received 3647
- 32KB: ERROR — "The command line is too long" (Windows CMD limit)

**Fix:** For tasks >3KB, write to a temp file and pass the file path to the agent instead.
Pattern: `Set-Content -Path "task.md" -Value $taskContent; terminal send --text "read task from task.md and execute"`

---

## T3: Terminal Read Race Condition
**Status:** PASS — no race condition
- Immediate read (0ms): found output ✓
- After 1s: found output ✓
- Conclusion: `terminal read` returns buffered output immediately; no minimum sleep needed for reading existing output. Sleep IS still needed after sending a command to give the command time to execute.

---

## T4: Stale Handle Detection
**Status:** NUANCE — two distinct error codes depending on handle knowledge

**Procedure:** Created terminal (`term_f1faf7dd`), closed it with `terminal close`, then sent/read/waited on the closed handle.

**Results on a properly-closed (known) handle:**
- `terminal send` → `terminal_not_writable` (exit 1) — clear error, not silent
- `terminal read` → `ok: true`, `status: "exited"`, empty tail, exit 0 — succeeds but returns no lines
- `terminal wait --for exit --timeout-ms 3000` → `satisfied: true`, `status: exited`, `exitCode: -1073741510` (0xC000013A = `STATUS_CONTROL_C_EXIT`), exit 0 — reports as already exited

**Results on a completely unknown/bogus handle (never created or from another session):**
- `terminal send` → `terminal_handle_stale` (exit 1)
- `terminal read` → `ok: false`, `error.code: "terminal_handle_stale"`, exit 1
- `terminal wait --for exit --timeout-ms 3000` → `terminal_handle_stale` (exit 1)

**Key distinction:**
| Handle state | `send` | `read` | `wait` |
|---|---|---|---|
| Properly closed (known) | `terminal_not_writable` exit 1 | `ok:true status:exited` exit 0 | `satisfied:true` exit 0 |
| Unknown/bogus | `terminal_handle_stale` exit 1 | `ok:false terminal_handle_stale` exit 1 | `terminal_handle_stale` exit 1 |

**Error is NOT silent.** All attempts to write to a closed handle fail with a specific error code. The difference between `terminal_not_writable` (known exited terminal) and `terminal_handle_stale` (unrecognized handle) allows programmatic distinction.

**The `exitCode: -1073741510` (0xC000013A)** is the Windows `STATUS_CONTROL_C_EXIT` code — the terminal process was forcibly killed by the PTY when `terminal close` was called.

**Rule:** Check `send` exit code after every write. On `terminal_not_writable` (exit 1) the terminal is known-closed; on `terminal_handle_stale` (exit 1) the handle is unrecognized entirely.

---

## T5: Terminal Output Encoding
**Status:** FAIL — non-ASCII characters are silently stripped at PTY input level

**Procedure:** Created terminal, sent `echo café résumé naïve 🎉` via `terminal send`, read back output via `terminal read --json`.

**Results:**
- `terminal send` reported success: `Sent 31 bytes to <handle>` (exit 0)
- JSON output parsed cleanly — no JSON errors
- **Actual terminal content observed:** `eecho caf rsum naveecho caf rsum nave`
  - `café` → `caf` (é stripped)
  - `résumé` → `rsum` (r preserved, é+s+u+m+é mangled)
  - `naïve` → `nave` (ï stripped)
  - `🎉` → completely absent (entire 4-byte UTF-8 sequence dropped)
  - First character of command doubled (`eecho` instead of `echo`) — PTY raw input artifact

**ASCII baseline for comparison:**
- `echo abc` → `echo abc` — full ASCII preserved intact

**Character-by-character breakdown:**
| Input | Sent bytes | Received in terminal |
|---|---|---|
| `echo abc` | 8 bytes | `echo abc` ✓ |
| `echo café` | 10 bytes | `echo caf` — é dropped |
| `echo naïve` | 11 bytes | `echo nave` — ï dropped |
| `echo 🎉` | 9 bytes | `echo` only — 🎉 entirely dropped |

**Additional finding — terminal scrollback is a fixed 23-line window:**
- `terminal read` always returns `latestCursor: 23` regardless of how much output was produced
- The cursor does NOT advance beyond 23 — the buffer is a fixed-height screen snapshot, not a scrolling log
- Output that scrolls above the 23-line window is NOT recoverable via `terminal read`
- All output from a command appears collapsed onto line 23 (the last visible line), concatenated with the typed command characters (raw PTY echo)

**Root cause:** `terminal send` transmits raw bytes to the PTY. On Windows, the PTY discards bytes with the high bit set (non-ASCII bytes in UTF-8 multi-byte sequences). This is a PTY-level limitation, not a JSON serialization issue.

**Fix:** Never pass non-ASCII content via `terminal send --text`. For unicode file content, write it via PowerShell (`Set-Content -Encoding UTF8`) to a temp file, then instruct the agent to read that file. The `terminal read` JSON output itself is valid UTF-8 — the encoding problem is on input only.

---

## O1: Agent Crash Detection
**Status:** PASS — clear error codes, no silent failure; `terminal wait` correctly reports exit on killed process

**Procedure:** Created terminal, sent `Start-Sleep -Seconds 60`, immediately closed terminal with `terminal close` (simulating mid-command crash/kill), then tried to send another command and call `terminal wait` on the dead handle.

**Step-by-step results:**

1. `terminal create` → `Created terminal term_26fa0eac [visible]` ✓
2. `terminal send --text 'Start-Sleep -Seconds 60'` → `Sent 23 bytes` (exit 0) ✓
3. `terminal close` (immediately, while Sleep is running) → `Closed terminal term_26fa0eac. PTY killed.` (exit 0) ✓
4. `terminal send` on closed handle → `terminal_not_writable` (exit 1) — clear error, not silent ✓
5. `terminal wait --for exit --timeout-ms 3000` on closed handle → `satisfied: true`, `status: exited`, `exitCode: -1073741510` (exit 0) — correctly reports already exited ✓
6. `terminal read --json` on closed handle → `ok: true`, `status: "exited"`, empty tail (exit 0) ✓

**`exitCode: -1073741510` = `0xC000013A` = Windows `STATUS_CONTROL_C_EXIT`** — this is the code Windows assigns when a process is killed via Ctrl+C or PTY termination. It is observable and distinguishable from a clean process exit (exitCode 0) or application crash.

**Supplemental test — bogus handle vs closed handle:**
- Bogus handle (unknown) → `terminal_handle_stale` on send/wait/read (exit 1 on all)
- Properly closed handle (known) → `terminal_not_writable` on send (exit 1); read/wait succeed with `status: exited`

**Key takeaways:**
- Killing a terminal mid-command is safe — no orphaned handles, no silent state
- `terminal wait --for exit` on a dead terminal returns immediately with `satisfied: true` — useful as a liveness check
- `exitCode: -1073741510` on a `terminal wait` result signals a forcibly killed process (distinguish from graceful exit with exitCode 0)
- No silent failure anywhere in the crash detection flow — every operation returns a clear status

---

## O2: Rapid Dispatch Response Ordering
**Status:** PASS — ordering preserved; tagging helps but is not strictly required

**Procedure:** Created terminal (`term_99586b56`), sent two echo commands back-to-back with no sleep between sends:
1. `echo TASK_A_RESULT` → sent immediately
2. `echo TASK_B_RESULT` → sent immediately after (no sleep)

Read output once after a 500ms settle.

**Results:**
- Both outputs appeared: `TASK_A_RESULT` then `TASK_B_RESULT` — **in send order**
- PTY serializes input: commands queued and executed sequentially in the shell
- No interleaving, no missing output, no reordering observed
- The 23-line scrollback window (from T5) applies — rapid dispatch of many commands risks older output scrolling off

**Actual tail (relevant lines):**
```
echo TASK_A_RESULT    → TASK_A_RESULT
echo TASK_B_RESULT    → TASK_B_RESULT
```

**Tagged message test (`TASK:A:result_a` / `TASK:B:result_b`):**
- Tags preserved verbatim in output: `TASK:A:result_a`, `TASK:B:result_b`
- Tags appear in order, parseable by scanning lines for `TASK:<id>:` prefix
- **Finding: tagging works and is grep-able from the tail array**

**PTY echo artifact (from T5):** The first command's prompt line shows a doubled-char artifact (`echo TASK_A_Recho TASK_A_RESULT`) — this is a known PTY raw-input echo issue. The output line itself is clean.

**Key takeaways:**
- Output ordering is **preserved** — the PTY shell serializes all input; commands execute sequentially in order received
- Both results appear in a single `terminal read` call — no need to read between sends
- Ordering is reliable for simple commands; the only risk is the **23-line scrollback limit** if many commands are dispatched rapidly
- **Tagging is recommended** for multi-task dispatch: prefix each command's output with a unique tag (e.g. `echo TASK:A:$(the-command)`) so responses can be matched even if intermediate output exists between them
- For workflows dispatching >3-4 commands without reading between them, redirect each command's output to a file instead (`the-command > task_a.txt`) to avoid scrollback truncation

**Recommended pattern for multi-task dispatch:**
```powershell
# Safe: tag output + redirect if output may be long
terminal send --text 'cmd_a > task_a.txt; echo TASK:A:done' --enter
terminal send --text 'cmd_b > task_b.txt; echo TASK:B:done' --enter
# Read once, parse lines matching TASK:<id>:done to confirm completion
# Read task_a.txt / task_b.txt for actual output
```

---

## B1: Stale Element Refs After Reload
**Status:** COMPLETE — nuanced result (two cases)

**Setup:** Active tab on duckduckgo.com; pre-reload snapshot identified search box as `e174`; first 5 refs: `e16, e174, e152, e175, e177`.

**Case 1 — reload same page (same URL):**
- `reload` returned: `Reloaded https://duckduckgo.com/ — DuckDuckGo - Protection. Privacy. Peace of mind.`
- Clicked stale ref `e174` after 2s wait: **exit 0, "Clicked e174"** — no error
- Post-reload snapshot: search box still `e174`, first 5 refs still `e16, e174, e152, e175, e177`
- **Finding:** Refs reset to the same values after a same-URL reload. Stale ref from before `reload` works without error.

**Case 2 — navigate to different URL (duckduckgo.com → example.com):**
- `goto --url https://example.com` succeeded
- Clicked old DDG ref `e174` on example.com: **exit 1, "Unknown ref: e174"**
- Post-navigate snapshot on example.com: only 2 refs (`e1, e2`), completely different set
- **Finding:** Refs are page-scoped. Cross-page stale refs produce a clear, explicit error: `Unknown ref: <ref>` (no silent failure).

**Key takeaways:**
- After `reload` (same URL): refs regenerate with the same numbering — old refs work silently. This is surprising and could mask bugs where you intend to target the fresh DOM but use a pre-reload ref.
- After `goto` to a different URL: stale refs fail loudly with `Unknown ref: <ref>` (exit 1). Error is clear, no silent failure.
- Error code: **no error code field** — just the string "Unknown ref: e174" in stderr with exit 1.
- **Rule:** Always re-snapshot after any navigation to a different URL. After same-URL reload, re-snapshot to be safe even though old refs may still work.

---

## B2: Multi-Tab Targeting Without --page
**Status:** COMPLETE

**Setup:** Started with 1 pre-existing tab (DuckDuckGo, `c3db38eb`, active). Created second tab with `tab create --url https://example.com`.

**Observed behavior of `tab create`:**
- The command returns `runtime_unavailable` error (exit 1) but still creates the tab. On first invocation this appeared as a failure but the tab was created. After `orca open`, subsequent `tab create` calls continued to return `runtime_unavailable` yet created tabs. By the time tab list was re-checked, 4 tabs existed (3 example.com tabs were created from successive attempts). **Finding: `tab create` has a disconnect between exit code and actual behavior — the tab IS created even when the command reports `runtime_unavailable`.**

**Multi-tab snapshot targeting:**
- With 4 tabs open, active tab was `e7a63824` (example.com, index 3)
- `tab current` confirmed: `e7a63824`, `active: true`, example.com
- `snapshot` (no `--page`): returned page `e7a63824` with "Example Domain" content
- **Finding: `snapshot` without `--page` targets the ACTIVE tab, not the first tab (index 0).**

**`tab current` behavior:**
- Returns the tab where `active: true` in the tab list — the most recently focused/created tab.
- After `tab create`, the new tab becomes active.
- After `tab switch --page <id>`, the switched-to tab becomes active.

**Cleanup:** Closed 3 test-created example.com tabs (`53639f34`, `b512c402`, `e7a63824`) individually with `tab close --page <id>`. Only pre-existing DDG tab remained.

**Key takeaways:**
- `snapshot` without `--page` targets the active tab (the one with `active: true`).
- `tab create` may return `runtime_unavailable` (exit 1) while still creating the tab — do not retry on this error; check `tab list` first.
- For concurrent/multi-tab workflows, always use `--page <browserPageId>` to target a specific tab explicitly.

---

## B3: Early Snapshot Before Page Load
**Status:** COMPLETE — `goto` blocks until load; immediate snapshot is full

**Setup:** Pre-existing DuckDuckGo tab. Used `goto --url https://duckduckgo.com` to trigger a fresh navigation.

**`goto` blocking behavior:**
- `goto --url` took **7058ms** to return — it blocks until the page has finished loading and returns the page title: `Navigated to https://duckduckgo.com/ — DuckDuckGo - Protection. Privacy. Peace of mind.`
- **Finding: `goto` is synchronous and load-blocking. There is no "navigate started" vs "navigate completed" distinction — the command only returns after the page is ready.**

**Immediate snapshot (no sleep after `goto`):**
- Snapshot returned immediately in **915ms** with a **full** accessibility tree
- Ref count: **126 refs** — complete page content including nav, hero, comparison table, footer
- No empty or partial content observed.

**Delayed snapshot (3s after `goto`):**
- Snapshot returned in **1116ms** with **identical** content
- Ref count: **126 refs** — exactly the same as the immediate snapshot

**Key takeaways:**
- There is no "early snapshot" race condition to hit via `goto` alone, because `goto` itself waits for the page to load before returning.
- Immediate and delayed snapshots after `goto` are functionally identical — no difference in content or ref count.
- To test a truly partial/loading-state snapshot, you would need a way to trigger navigation asynchronously (e.g., `click` a link to navigate, then snapshot without waiting) — `goto --url` does not expose that race window.
- **Rule:** No sleep is needed after `goto` before snapshotting; the page is already ready.

---

## S1: Non-Claude CLI Syntax Verification
**Status:** COMPLETE — research conducted June 2026

---

### OpenCode

**STATUS:** PASS — active, well-documented, widely adopted

**CLI binary name:** `opencode`

**Install commands:**
```bash
# curl installer (Linux/macOS)
curl -fsSL https://raw.githubusercontent.com/opencode-ai/opencode/refs/heads/main/install | bash

# npm (cross-platform)
npm i -g opencode-ai@latest

# Homebrew (macOS)
brew install anomalyco/tap/opencode
```

**Model flag syntax:** `--model provider/model_id` (short: `-m`)
```bash
opencode run --model anthropic/claude-sonnet-4-20250514 "Explain this code"
opencode run --model google/gemini-2.5-pro "Review this"
opencode run -m openai/gpt-4o "Write tests"
```

**Supported providers:** Anthropic, OpenAI, Google, xAI, OpenRouter, Vercel AI Gateway, SAP AI Core, and local models via Atomic Chat. Provider packages are dynamically installed on first use.

**Breaking changes / notes:**
- Model format is always `provider_id/model_id` — bare model names are not accepted
- Use `opencode run --refresh` to update the cached model list when new models are added
- GitHub: `opencode-ai/opencode` (crossed 150K stars as of mid-2026, ~6.5M monthly active developers)

---

### Aider

**STATUS:** PASS — active, stable, pip-installable

**CLI binary name:** `aider`

**Install commands:**
```bash
# Recommended: pip with constrained upgrades
python -m pip install -U --upgrade-strategy only-if-needed aider-chat

# Isolated install (avoids dependency conflicts)
pipx install aider-chat

# Via aider-install helper
pip install aider-install && aider-install

# Via uv (handles Python version automatically)
uv tool install aider-chat
```

**Model flag syntax:** `--model <alias_or_full_id>`
```bash
# Short aliases
aider --model sonnet --api-key anthropic=YOUR_KEY
aider --model o3-mini --api-key openai=YOUR_KEY
aider --model deepseek

# Full provider-prefixed IDs (for OpenRouter etc.)
aider --model openrouter/anthropic/claude-3.7-sonnet
aider --model openrouter/deepseek/deepseek-chat

# Custom alias via CLI
aider --alias mymodel=anthropic/claude-opus-4 --model mymodel
```

**Supported providers:** OpenAI, Anthropic, Google, DeepSeek, xAI, Groq, Ollama, and any OpenRouter-proxied model.

**Breaking changes / notes:**
- Requires Python 3.9–3.12. Python 3.13 is NOT supported — use `uv` to auto-install a compatible Python version
- Latest PyPI release: `aider-chat` (February 2026). Package name on PyPI is `aider-chat`, not `aider`
- `--model sonnet` resolves to the latest Claude Sonnet; use full ID for reproducibility in automation

---

### Pi (Inflection AI chatbot)

**STATUS:** UNKNOWN — the consumer chatbot Pi from Inflection AI has no CLI tool

**Notes:** Pi (pi.ai / inflection.ai) is a conversational AI assistant with no official CLI. Do not include in bootstrap.

**What "Pi" DOES exist as a CLI:** There is an unrelated open-source project called **Pi Coding Agent** by Mario Zechner (`earendil-works/pi` on GitHub / `pi.dev`), which is a minimalist BYOK coding agent CLI — not affiliated with Inflection AI.

**Pi Coding Agent (earendil-works/pi) — STATUS: PASS if intended**

**CLI binary name:** `pi`

**Install commands:**
```bash
# curl installer
curl -fsSL https://pi.dev/install.sh | sh

# npm
npm install -g --ignore-scripts @earendil-works/pi-coding-agent

# pnpm / bun equivalents also supported
```

**Model flag syntax:** Model is configured at the provider level in config, not via a per-invocation flag. Models are specified in `~/.pi/config.toml` or equivalent config file. Supports Claude, GPT-5, Gemini, Grok, DeepSeek, Llama (BYOK).

**Notes:** Only 4 built-in tools (read, write, edit, bash). No MCP support by default — requires extensions. Intentionally minimal.

---

### Codex CLI (OpenAI)

**STATUS:** PASS — active, official OpenAI product

**CLI binary name:** `codex`

**Install commands:**
```bash
# macOS / Linux — native binary installer (recommended)
curl -fsSL https://chatgpt.com/codex/install.sh | sh

# Windows — native binary installer
powershell -ExecutionPolicy ByPass -c "irm https://chatgpt.com/codex/install.ps1 | iex"

# npm global (alternative)
npm install -g @openai/codex
```

**Model flag syntax:** `--model <model_id>` (short: `-m`)
```bash
codex --model gpt-5.4 "Refactor this function"
codex -m gpt-5.3-codex "Write unit tests"
codex -m gpt-5.4-mini "Quick fix"
```

**Available model IDs (as of June 2026):**
| Model ID | Description |
|----------|-------------|
| `gpt-5.5` | Newest frontier, complex coding + research |
| `gpt-5.4` | Flagship frontier (default) |
| `gpt-5.4-mini` | Fast, efficient, responsive |
| `gpt-5.3-codex` | Specialized coding model |

**Breaking changes / notes:**
- Model IDs `codex-1` and `o4-mini` are outdated — no longer in the current docs
- Config file lives at `~/.codex/config.toml`; `--model` flag overrides for a single run
- In-session model switching: `/model` command at the prompt
- Requires `OPENAI_API_KEY` env var

---

### Other CLI Tools to Add to Bootstrap

The following tools are prominent as of June 2026 and are candidates for bootstrap support:

| Tool | CLI binary | Install | Notes |
|------|------------|---------|-------|
| **Antigravity CLI** (Google) | `agy` | Native binary — NOT npm. Download from antigravity.google | Replaced Gemini CLI on May 19 2026. Gemini CLI consumer EOL: June 18 2026. Gemini CLI enterprise retains access. Default model: Gemini 3.5 Flash. No `--model` flag — model selected interactively or via config. |
| **Goose** (Block/Square) | `goose` | `curl -fsSL https://github.com/block/goose/releases/download/stable/download_cli.sh \| bash` | Open-source, MCP-first. Model via `goose configure` or `GOOSE_MODEL` env var. Strong for autonomous multi-step workflows. |
| **Amp** (Sourcegraph) | `amp` | `curl -fsSL https://ampcode.com/install.sh \| bash` or `npm install -g @sourcegraph/amp` | Model-agnostic (Claude, GPT-5, Gemini 2.5 Pro). Mode switching: `/mode free`, `/mode smart`. No explicit `--model` flag at CLI level — configured in account settings. |

**Tools confirmed NOT to add:**
- **Gemini CLI** (`gemini`) — deprecated, consumer EOL June 18 2026. Use `agy` instead.
- **Continue** — VS Code/JetBrains IDE extension, not a terminal CLI agent.
- **Cursor** — GUI IDE, no standalone CLI.

---

## Summary of Fixes Needed (so far)

| Issue | Fix |
|-------|-----|
| Double quotes stripped in terminal send | Use single-quoted strings in bootstrap |
| Payload >3KB truncated | File-based handoff pattern |
| 32KB payload = Windows CMD error | File-based handoff required above ~3KB |
| OpenCode model flag: use `provider/model` format | `opencode run --model anthropic/claude-sonnet-4-20250514 "..."` |
| Aider: Python 3.13 incompatible | Install via `uv` to auto-provision Python 3.12 |
| Codex CLI: old model IDs (`codex-1`, `o4-mini`) are stale | Use `gpt-5.4`, `gpt-5.3-codex`, `gpt-5.4-mini` |
| Gemini CLI deprecated (consumer EOL June 18 2026) | Replace with Antigravity CLI (`agy`) native binary |
| Pi (Inflection AI) has no CLI | Remove from bootstrap; if Pi Coding Agent (pi.dev) was intended, install via `curl -fsSL https://pi.dev/install.sh \| sh` |
| B1: Stale ref after reload (same URL) silently succeeds | Always re-snapshot after reload; refs reset to same values so old refs work but may target stale DOM |
| B1: Stale ref after goto different URL fails with "Unknown ref: X" (exit 1) | Re-snapshot after any URL navigation; no silent failure cross-page |
| B2: `snapshot` without `--page` targets active tab, not index 0 | Use `--page <browserPageId>` for explicit multi-tab targeting |
| B2: `tab create` may return `runtime_unavailable` (exit 1) but still creates the tab | Do not retry on this error; verify with `tab list` |
| B3: `goto --url` blocks until page load (~7s for DDG) — immediate snapshot is already full | No sleep needed after `goto`; snapshot is safe to call immediately |
| T4: Closed handle send → `terminal_not_writable` (not silent) | Check exit code after every `terminal send`; exit 1 = cannot write |
| T4: Unknown handle → `terminal_handle_stale` (all ops fail) | Distinguish stale (unknown) vs closed (known exited) by error code |
| T4: `terminal wait --for exit` on closed handle returns `satisfied:true` immediately | Use as liveness probe; exitCode -1073741510 (0xC000013A) = force-killed |
| T5: Non-ASCII chars (é, ï, 🎉) silently dropped by PTY on `terminal send` | Never send unicode via `terminal send --text`; write to UTF-8 file, then instruct agent to read it |
| T5: Terminal scrollback is fixed 23-line window — output scrolling off top is lost | For commands producing >23 lines, redirect output to a file and read the file |
| O1: `terminal close` during running command → clean kill, `terminal_not_writable` on next send | No orphaned state; mid-run kills are safe and detectable |
| O1: `terminal wait --for exit` on killed terminal → `satisfied:true`, exitCode -1073741510 | Use `terminal wait` as crash/liveness probe after any suspicious silence |
| O2: Rapid dispatch ordering is preserved — PTY serializes input | No sleep needed between sends; but tag output (`TASK:A:...`) for reliable matching; redirect to file if >3 commands to avoid 23-line scrollback loss |
