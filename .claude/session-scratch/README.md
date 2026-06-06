# Session Scratch Files

This directory is for session-specific scratch files, quick test scripts, and working documents
that are not part of the canonical codebase but should not be permanently deleted.

## What belongs here

- One-off test scripts written during a debugging session
- Planning documents and punch lists for a specific work session
- Temporary WS/REST probing scripts
- Anything that is "done" but worth keeping as a reference

## Contents

Files archived here during the 2026-06-03 fork audit session were permanently lost because they
were untracked in git at the time of deletion. Their content is preserved in README-PART2.md:

| File (lost) | Content location |
|-------------|-----------------|
| `BUG_REPORT.md` | README-PART2 §4 (Bug Fix Changelog) |
| `PUNCH-LIST.md` | README-PART2 §4a (Session 2 Fixes) |
| `STRESS-TEST-PLAN.md` | README-PART2 §4b (Integration Test Results) |
| `b30-test.cjs` / `b30-test.js` | Superseded by `scripts/` test suite |
| `haiku-say.mjs` / `haiku-ws.mjs` / `haiku-ws-test.mjs` | Quick WS probe scripts, no lasting value |

## Going forward

Put new session scratch files here before they get lost. Commit this directory so git tracks them.
Reproducible integration tests belong in `scripts/` instead.
