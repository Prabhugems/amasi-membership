# Backlog — tracked tech debt and follow-ups

One-line items per row. Each entry has: date added, area, owner (optional), short description, link to context.

| Added | Area | Description | Context | Deadline |
|---|---|---|---|---|
| 2026-04-26 | lint / types | 29 pre-existing `@typescript-eslint/no-explicit-any` errors in `src/app/api/payments/verify/route.ts` (6), `src/app/api/payments/create-order/route.ts` (6), `src/app/apply/page.tsx` (17). Surfaced when fix #4 (`d3e4011`) was bypassed via `--no-verify`. **Two-step fix:** (a) tomorrow morning: switch `lint-staged` to diff-only (e.g. via `lint-staged-eslint-diff`) so unrelated commits to these files don't get blocked; (b) this date: clean the 29 errors so the hook stays honest. `apply/page.tsx` is the top fragile file (24 fix commits, 2,985 LOC) — debt cleanup compounds with the planned state-machine extraction. | fix #4 commit `d3e4011`; pre-commit hook in `.husky/pre-commit`; audit §6.2 | **2026-05-10** |
| 2026-04-26 | infra / kill-switch | `MAINTENANCE_MODE` is a `NEXT_PUBLIC_*` env, baked into the bundle at build time (`c0c5feb`). Toggling requires a full Vercel redeploy. Move to a runtime gate: server component reading `process.env.MAINTENANCE_MODE` (no `NEXT_PUBLIC_` prefix) or a Supabase row in `app_config`. Lets you flip the kill-switch in seconds when needed. | `c0c5feb feat(apply): add MAINTENANCE_MODE env gate`; `src/app/apply/page.tsx` `ApplyPage` shell | **2026-05-17** |

## Data integrity
- Kumar Kaushik (members #18263) — membership_applications.member_id is null despite members row existing with application_no='AMASI-2026-F1A29BDA64'. Back-link not populated at member creation. Fix: backfill query to populate member_id on application row from members.application_no match. Not urgent.
