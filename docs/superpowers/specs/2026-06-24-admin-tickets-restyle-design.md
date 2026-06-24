# Admin Tickets Inbox — Full Restyle

**Date:** 2026-06-24
**Status:** Approved (design)
**Author:** Prabhu + Claude

## Summary

Restyle the admin support-tickets inbox (`/tickets`) to the repo's clinical-confident
"Linear/Stripe" aesthetic per `AGENTS.md`. This is a **visual-only** pass: no behavior,
data, endpoint, or layout-structure changes. Same panels, same flows, same components —
only the skin (colors, badges, bubbles, spacing) changes.

## Background / current state

The admin inbox (`src/app/tickets/`) is functional but drifts from AGENTS.md:
- **436** hardcoded color-scale classes (`bg/text/border-{amber,blue,emerald,red,slate,gray,zinc,teal}-{50..900}`), **17** inline hex, **21** `rounded-full`, **1** gradient (analytics).
- Status/priority/SLA render as **filled colored chips** (chip-soup), not the AGENTS.md "dot + lowercase text" pattern.
- Filter tabs use filled solid-color active states (`bg-amber-600`, `bg-blue-600`, …).
- Admin reply bubbles are saturated solid `bg-teal-600` + `rounded-2xl` + `shadow-md`.
- Color lives mostly in `lib/constants.ts` (`STATUS_CONFIG`, `PRIORITY_CONFIG`, `FILTER_TABS`) and a few components, so a calm restyle propagates from a small set of edits.

## Goals

1. Apply a calm, token-based visual system across the whole `/tickets` UI.
2. Full AGENTS.md compliance: no hardcoded color scales / hex / gradients; status as dot + lowercase; segmented controls not `rounded-full` pills; `border` 1px only; `shadow-sm` max; `rounded-md` default.
3. Improve attachment rendering (filename + type icon + thumbnail), no more generic "Attachment" fallback.
4. Preserve all behavior and the 361 passing tests.

## Non-goals (YAGNI)

- No new features, no layout restructure, no logic/endpoint/DB changes.
- No test rewrites; no dialog *layout* redesign (only color-tokenize the dialogs).
- No changes to the member-facing Support module (separate, already shipped).

## The calm design language

| Element | Now | After |
|---|---|---|
| Status (list + detail) | filled chip `bg-amber-50 …` | dot + lowercase text (`● open`), no chip bg/border |
| Priority | filled chip (`HIGH`, `URGENT`) | dot + lowercase text (`● urgent`); urgent dot uses `bg-destructive` |
| SLA | filled red/amber chip | subtle: small `text-destructive`/`text-muted-foreground` label (with clock icon), no filled bg |
| Filter tabs | solid `bg-amber-600`/`bg-blue-600` active | segmented control: `bg-muted` track, active `bg-background` + `border-border` + `shadow-sm` |
| Admin reply bubble | solid `bg-teal-600` white, `rounded-2xl`, `shadow-md` | **soft accent tint**: `bg-primary/10` + `border-border`, `text-foreground`, `rounded-md`, `shadow-sm`, right-aligned |
| Member reply bubble | `bg-white dark:bg-slate-900` + slate borders | `bg-card` + `border-border`, `rounded-md`, left-aligned |
| Internal note | amber filled, `rounded-2xl` | tokenized amber-tinted (`bg-amber-500/10` + `border-l-2 border-amber-500/50`), `rounded-md`, kept visually distinct |
| Stat pills (page header) | `bg-amber-100/blue-100/emerald-100` | dot + count + label, muted text; count emphasized; no filled chip |
| Avatars | `bg-teal-100`/`bg-gray-100` + dark variants | tokenized (`bg-primary/10 text-primary`, `bg-muted text-muted-foreground`) |
| Attachments | generic chip / `alt="Attachment"` | filename + lucide type icon + size; images in a `border-border rounded-md` thumb frame; clear download affordance |

Colors come exclusively from CSS variables already in `globals.css` (`background`, `foreground`,
`card`, `muted`, `muted-foreground`, `accent`, `border`, `primary`, `destructive`). The accent
status/priority **dots** (amber/blue/emerald/red-500 solids) are the one allowed accent exception,
consistent with the member-support module shipped earlier.

## Files touched (visual only)

- `src/app/tickets/lib/constants.ts` — rework `STATUS_CONFIG`, `PRIORITY_CONFIG`, `FILTER_TABS` to a token-based scheme: each status/priority exposes `{ label (lowercase), dotColor }`; drop the filled `className`/`tabBg`/`tabText` color strings (or repoint to tokens). Keep keys/labels/option arrays intact.
- `src/app/tickets/components/TicketBadges.tsx` — `StatusBadge`/`PriorityBadge` render dot + lowercase text (no chip bg, no `rounded-full`, no border). `SlaBadge` → subtle text label. `CategoryBadge` stays an outline `Badge` (already token-based).
- `src/app/tickets/components/ChatBubble.tsx` — admin bubble soft accent tint; member bubble `bg-card`; internal note tokenized; `rounded-md`; `shadow-sm`; tokenize all `teal/slate/gray/amber` scales; improve attachment rendering (filename/icon/thumb).
- `src/app/tickets/components/TicketListItem.tsx` — calmer row: dot+text status/priority, subtle SLA, tokenized hover/selected (`bg-accent`), fewer competing colors.
- `src/app/tickets/components/TicketListPanel.tsx` — filter tabs → segmented control; tokenize search/filter chrome.
- `src/app/tickets/components/TicketDetailPanel.tsx` — header badges via the new dot+text badges; tokenize; tighten spacing; keep the status/priority/assign selects + Save/Reopen actions.
- `src/app/tickets/components/ReplyComposer.tsx` — tokenize colors; keep quick-replies/attachment/internal-note toggle/Send + Cmd+Enter.
- `src/app/tickets/page.tsx` — restyle the header `StatPill`s to dot + count + muted label (no filled chips); keep the teal icon tile (it's a brand accent on a solid token).
- `src/app/tickets/components/ReplyTemplatesDialog.tsx`, `RoutingRulesDialog.tsx` — color-tokenize only (no layout change).
- `src/app/tickets/analytics/page.tsx` — remove the gradient; tokenize chart/card colors where they violate the rules (chart series colors may stay as explicit values where a palette is required — note inline).

## Behavior parity (must keep)

All flows unchanged: search/filter/SLA-filter, open ticket, status/priority/assignee change + Save, Reopen, reply (text/attachment/internal note, Cmd+Enter), quick replies, routing rules, templates, merge, analytics. Dot/label semantics map 1:1 to the existing status/priority values. No prop/signature changes except internal config shape in `constants.ts` (update its consumers in the same change).

## Error handling

No new error paths (visual-only). Existing toasts/handlers untouched.

## Testing

- **Static:** `npx tsc --noEmit` clean; `npx eslint src/app/tickets` no errors; the repo CI `lint` job is diff-scoped so new code must be clean.
- **Build:** `npx next build` succeeds.
- **Tests:** existing suite stays green (`npx vitest run`, 361). No new unit tests (pure visual); any `ticket-utils` logic touched keeps/los its tests.
- **Manual:** load `/tickets` in dark AND light mode; verify list rows, detail header, conversation (admin soft-tint right, member card left, internal note distinct), attachments (filename/thumb), filter segmented control, stat pills, analytics. Compare against AGENTS.md "would Linear/Stripe ship this?".

## Rollout

Single PR off `main` (branch `feat/admin-tickets-restyle`). Visual-only behind existing admin auth; no flag needed.
