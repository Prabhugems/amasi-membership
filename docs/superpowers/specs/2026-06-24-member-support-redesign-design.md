# Member Support — Redesign + Extract

**Date:** 2026-06-24
**Status:** Approved (design)
**Author:** Prabhu + Claude

## Summary

Redesign the member-facing Support experience to the repo's "clinical-confident"
admin-grade quality, and extract it out of the 2,900-line `src/app/member/page.tsx`
into its own focused module. **No backend changes** — every endpoint already
supports member sessions; this is purely a UI/UX + refactor effort.

## Background / current state

A member-facing ticket flow already exists, embedded in `member/page.tsx` as the
`MemberSupportTab({ member })` component (~lines 1367–2060), rendered by the
`support` tab. It supports: list own tickets, create ticket, open thread, reply
with attachment, reopen closed ticket.

Problems with the current implementation:
- It lives inside `member/page.tsx`, which `.claude/CONTEXT.md` flags as a fragile,
  recurring-bug hotspot (2,900 LOC). Any change risks the whole portal.
- The styling violates several `AGENTS.md` UI rules: `rounded-full` category/priority
  pills, hardcoded color scales (`emerald/red/blue-50`), gradient cards
  (success + welcome), filled status chips instead of dot + lowercase text.

The public `/support` Center (FAQ + create + track) and the admin `/tickets` inbox
are out of scope and unchanged.

## Goals

1. Restyle the member Support UI to match the admin inbox aesthetic (Linear/Stripe,
   clinical-confident), fully compliant with `AGENTS.md`.
2. Extract the flow into its own module so `member/page.tsx` shrinks by ~700 lines
   and the Support UI is independently maintainable.
3. Preserve all existing behavior and the existing backend contract exactly.

## Non-goals (YAGNI)

- No new capabilities: no CSAT rating, no in-portal FAQ, no email-notification
  changes, no new ticket fields.
- No backend/API changes. No DB changes.
- No changes to admin `/tickets` or public `/support`.

## Layout — Hybrid (approved)

- **List view:** full-width clean card list + "New ticket" action + dignified empty
  state. Each card: status dot + lowercase status, subject, `ticket_number`,
  priority, relative time, last-reply preview.
- **New view:** stacked form (category segmented control, subject w/ counter,
  description w/ counter, attachment drop zone, priority segmented control, submit)
  → success confirmation → back to list.
- **Detail view:** full-width focused conversation — header (back, ticket #, status
  dot, subject), chat bubbles (member right / AMASI left, attachments rendered),
  reply composer with attachment, reopen action when closed/resolved.

Single column that swaps between the three views (not split-pane); responsive to
mobile.

## Module structure

```
src/components/member-support/
  MemberSupport.tsx        # container: view state (list|new|detail), composes the three views
  TicketList.tsx           # card list, New-ticket button, empty state
  NewTicketForm.tsx        # stacked create form + success state
  TicketConversation.tsx   # thread header + chat bubbles + reply composer + reopen
  useMemberTickets.ts      # data hook: list, detail, create, reply, reopen (wraps fetch)
  support-constants.ts     # TICKET_CATEGORIES, priority meta, status meta (dot color via CSS vars)
  types.ts                 # MemberTicket, TicketReply
```

`member/page.tsx`: the `support` tab body becomes `<MemberSupport member={member} />`.
Delete `MemberSupportTab` and its module-local helpers/`TICKET_CATEGORIES` from
`member/page.tsx` after the move. Net: ~700 lines removed from the fragile file.

## Data flow (unchanged endpoints)

| Action | Call |
|---|---|
| List own tickets | `GET /api/tickets?email=<member.email>` (safe columns) |
| Create | `POST /api/tickets` — prefill `name`, `email`, `amasi_number` from member |
| Detail + thread | `GET /api/tickets/{id}` — internal notes filtered server-side for members |
| Reply (+attachment) | `POST /api/tickets/{id}/reply` — multipart when a file is attached; `as_member: true` |
| Reopen | existing reopen path used by current code |

Server already enforces: ownership by session email (404 on others' tickets),
internal-note filtering for non-admins, member-safe column stripping, and blocking
member replies on closed/resolved tickets until reopened.

## Visual system (AGENTS.md compliance)

- **Status:** small colored dot + lowercase text (e.g. `● open`), not filled chips.
  Dot colors from semantic CSS vars / existing token usage, not raw `-50/-600` scales.
- **Category & Priority:** segmented control (`bg-muted` track, `bg-background` active
  + `border`), `rounded-md` — not `rounded-full` pills.
- **Cards:** solid `bg-card` + 1px `border-border`, `rounded-md`, `shadow-sm`. No
  gradients anywhere (remove success-card and any welcome gradient in this UI).
- **Color:** CSS variables only — `text-foreground`, `text-muted-foreground`,
  `bg-accent`, `text-destructive`, `border-border`. No hardcoded hex / zinc / gray /
  emerald / blue scales.
- **Typography:** eyebrow (`text-xs uppercase tracking-wider text-muted-foreground`)
  + one display weight (`text-2xl font-bold`) + one body weight (`text-sm`). Max 2 weights.
- **Empty state:** one lucide icon in a `bg-muted border rounded-md` square + one line.
- **Primitives:** reuse `src/components/ui/*` (Button, Input, Card, Avatar, Badge).
- **References:** `design-references/tailwind-plus/form-layout-stacked-sections.tsx`
  for the new-ticket form; admin `src/app/tickets/components/ChatBubble.tsx` &
  `TicketBadges.tsx` patterns for the conversation styling (adapt, don't import admin
  internals).

## Behavior parity (must keep)

- Subject (120) / description (2000) character counters.
- Drag-and-drop + browse attachment, image preview, JPG/PNG/PDF up to 5 MB, remove.
- Optimistic reply append; scroll-to-latest.
- Reopen on closed/resolved → re-enables composer.
- Attachment marker parsing (`📎 Attachment: <url>`) for legacy replies; image vs
  file rendering.
- Prefill create form identity from `member` (name/email/amasi_number); member does
  not type these.

## Error handling

- Surface API errors via `toast` (sonner) — already the pattern. No silent failures.
- Failed list/detail load → inline retry affordance, not a blank pane.
- Keep impossible-state handling explicit (per AGENTS.md "crash loudly"): unexpected
  view/state logs to console; never silently strands the user.

## Testing

- **Manual:** create (with + without attachment) → appears in list → open → reply
  with attachment → admin replies show → reopen a closed ticket → reply again.
  Verify internal notes never appear. Check light/dark and mobile width.
- **Static:** `npx tsc --noEmit` and `npx eslint` clean.
- **Build:** `npx next build` (member page uses client-router hooks — per AGENTS.md
  build-check rule).

## Rollout

Single PR off `main` (branch first). Feature-flag not required — behavior is
preserved; this is a visual/structural change behind existing member auth.
