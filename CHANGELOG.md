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

### 2026-08-07 — bulk-draft-reminders skip approved members — `35b77d6`
- **File(s):** `src/lib/bulk-draft-reminders.ts:81-90`
- **Root cause:** The reminder-eligibility exclusion set only anti-joined idle drafts against `membership_applications`, never `members`. An approved member with a stray `in_progress` draft (created via `/api/otp/send`, which creates a draft whenever `/apply` is visited with a `membershipType` and never checks the `members` table) has no matching `membership_applications` row under the same email, so nothing excluded them — they received "incomplete application" reminder emails despite already being members. The sibling job `cleanup-drafts/route.ts` already anti-joined against both tables; the lesson was never ported here.
- **Fix:** Added a parallel `members` table query and merged its emails into the `alreadySubmitted` exclusion set, mirroring `cleanup-drafts/route.ts`'s existing pattern.
- **Test:** `__tests__/bulk-draft-reminders-member-exclusion.test.ts` — asserts a draft whose email matches a `members` row is skipped (not sent, not claimed) while an unrelated draft is sent normally.

---

## Backfill (pre-2026-04-26)

The first 213 commits of this repo (Jan 2026 → 2026-04-26) are not individually logged here. See `AUDIT-2026-04.md` §2 for the recurring-bug analysis covering that period, and `git log --grep="^fix" --since=2026-01-01 --no-merges` for the raw list.
