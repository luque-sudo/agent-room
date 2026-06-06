# Orca Browser Automation

> Orca's native browser panel — NOT Claude's computer use API.
> All commands via orca.cmd.

$ORCA = 'C:\Users\ricar\AppData\Local\Programs\Orca\bin\orca.cmd'

## Gotchas & Edge Cases (read before using)

| # | Nuance |
|---|--------|
| 1 | `goto` is **synchronous** — blocks until full page load. No sleep needed after `goto`. |
| 2 | `goto` / `tab create` return `runtime_unavailable` (exit 1) but **still succeed** — verify with `tab list`, never retry blindly. |
| 3 | `snapshot` without `--page` targets the **active tab** — not index 0. Use `tab current` to confirm. |
| 4 | Element refs: **no `@` prefix** — snapshot shows `ref=e1`, but commands use `--element e1`. |
| 5 | Same-URL reload **silently reuses** same ref IDs — pre-reload clicks succeed but may hit wrong DOM. Always re-snapshot. |
| 6 | Different-URL navigation: stale refs fail with `"Unknown ref: eXXX"` (exit 1) — clear error. |
| 7 | Google form fill triggers CAPTCHA — use direct search URL instead. |
| 8 | Browser tab panel position is UI-only — drag-and-drop to position, Orca remembers layout. |

## Proven Flow

```powershell
# 0. Check existing tabs FIRST — reuse with goto, don't create duplicates
$tabs = (& $ORCA tab list --json | ConvertFrom-Json).result.tabs
if ($tabs.Count -eq 0) {
    & $ORCA tab create --url "about:blank" --json | Out-Null   # may exit 1 (runtime_unavailable) — that's OK, it still succeeds
    Start-Sleep -Seconds 2   # tab create is async (unlike goto, which is synchronous) — wait for it to register
}

# 1. Navigate (goto is synchronous — no sleep needed after)
& $ORCA goto --url "https://duckduckgo.com/?q=your+query" --json | Out-Null

# 2. Snapshot (always re-snapshot after any navigation)
& $ORCA snapshot --json

# 3. Interact (no @ prefix)
& $ORCA click --element e1 --json
& $ORCA fill --element e1 --value "text" --json
& $ORCA keypress --key Enter --json

# 4. Screenshot
& $ORCA screenshot --json
# Do NOT close tab — user can't reposition without UI drag
```

## Search — Direct URL Avoids CAPTCHA

```powershell
& $ORCA goto --url "https://duckduckgo.com/?q=search+terms" --json     # preferred
& $ORCA goto --url "https://www.google.com/search?q=search+terms" --json
```

## Two Addressing Schemes (important — they differ)

| Command group | How to target a specific tab |
|---------------|------------------------------|
| Navigation + interaction (`goto`, `snapshot`, `click`, `fill`, …) | `--page <pageId>` (the page id field from `tab list --json`); omit = active tab |
| Tab management (`tab switch`, `tab close`) | `--index <n>` (the tab's index field from `tab list --json`) — **NOT** `--page` |

## Tab Management

```powershell
& $ORCA tab list --json                       # get page ids + indices
& $ORCA tab current --json
& $ORCA tab show --json                        # details of one tab
& $ORCA tab create --url <url> --json
& $ORCA tab create --url <url> --profile <id> --json   # specific browser profile
& $ORCA tab switch --index <n> --json          # switch by position, NOT page id
& $ORCA tab close --index <n> --json            # close by position — ask permission first
```

## Navigation

```powershell
& $ORCA goto --url <url> --json
& $ORCA goto --url <url> --page <pageId> --json   # explicit tab by page id
& $ORCA reload --json          # always re-snapshot after
& $ORCA back --json
& $ORCA forward --json
```

## Interact

```powershell
& $ORCA snapshot --json                            # get element refs (active tab; add --page <id> to target)
& $ORCA screenshot --json                          # add --format png|jpeg (default png)
& $ORCA click --element e3 --json
& $ORCA fill --element e1 --value "text" --json
& $ORCA type --input "text" --json
& $ORCA keypress --key Enter --json
& $ORCA select --element e4 --value "option" --json
& $ORCA check --element e5 --json
& $ORCA scroll --direction down --amount 500 --json   # --direction up|down, --amount in pixels
& $ORCA eval --expression "document.title" --json
```

All interaction commands accept `--page <pageId>` to target a specific tab; omit to use the active tab. **Keep `--page` consistent between `snapshot` and the `--element` commands that follow it — snapshotting tab A then clicking tab B produces stale-ref errors or wrong-DOM hits. Always re-snapshot after any navigation.**
