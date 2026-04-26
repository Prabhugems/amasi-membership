# Changelog

Every bug fix shipped to this repo is logged here. Goal: prevent re-introducing fixed bugs.

## How to log

Add a new entry **at the top of the Unreleased section** for every bug fix commit. Use this exact shape:

```
### YYYY-MM-DD — short title — `<short-sha>`
- **File(s):** `path/to/file.ts:line` (and any others)
- **Root cause:** Why the bug was possible (the underlying defect, not the symptom).
- **Fix:** What you changed structurally or tactically.
- **Test:** Reference to the test in `__tests__/critical-paths.test.ts` that prevents regression, or `none — added to backlog` if not yet covered.
```

## Conventions

- Newest entry on top.
- One entry per bug fix. If two fixes share a root cause, group them.
- Skip trivial: typos, formatting, copy edits, dependency bumps without behavior change.
- If the same area gets fixed 3+ times, add a `### TODO: structural fix needed for X` heading at the top of Unreleased and stop writing tactical patches there until it's resolved.
- Update `.claude/CONTEXT.md` (`Recently Fixed Bugs` section) in the same commit.

---

## [Unreleased]

_No entries yet — start logging from the next bug-fix commit._

---

## Backfill (pre-2026-04-26)

The first 213 commits of this repo (Jan 2026 → 2026-04-26) are not individually logged here. See `AUDIT-2026-04.md` §2 for the recurring-bug analysis covering that period, and `git log --grep="^fix" --since=2026-01-01 --no-merges` for the raw list.
