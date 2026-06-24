# Admin Tickets Inbox Restyle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the admin support-tickets inbox (`src/app/tickets/`) to clinical-confident AGENTS.md quality — dot+lowercase status/priority, segmented filter tabs, soft-accent reply bubbles, CSS-variable colors — with no behavior, data, or layout-structure changes.

**Architecture:** Color/visual config is centralized in `lib/constants.ts` + `components/TicketBadges.tsx`; restyling those calms most surfaces. Remaining components are tokenized by applying one canonical raw-scale→CSS-variable mapping. Pure-visual change: same components, props, flows, and tests.

**Tech Stack:** Next.js 16, React 19, TypeScript, Tailwind v4 (CSS variables in `src/app/globals.css`), shadcn UI, lucide-react.

## Global Constraints

- **Visual only.** No behavior/logic/endpoint/DB/layout-structure changes. No prop/signature changes except the internal config shape in `lib/constants.ts` (update its consumers in the same task). Existing test suite must stay green (`npx vitest run`, 361 passing).
- **AGENTS.md rules:** status & priority = small colored **dot + lowercase text** (never filled chips, never `rounded-full` pills); cards = solid `bg-card` + 1px `border-border`; colors from CSS variables only — NO hardcoded `{amber,blue,emerald,red,slate,gray,zinc,teal}-{50..900}` classes, NO inline hex, NO gradients; `border` only (never `border-2`); `shadow-sm` max (modals/popovers excepted); `rounded-md` default (`rounded-lg` only for elevated dialogs).
- **Allowed accent exception:** solid status/priority **dots** may use `bg-amber-500` / `bg-blue-500` / `bg-emerald-500` (and `bg-destructive` for urgent). Nothing else may use a raw color scale.
- **Admin reply bubble = soft accent tint:** `bg-primary/10` + `border border-border`, `text-foreground`, `rounded-md`, `shadow-sm`, right-aligned. Member bubble = `bg-card` + `border border-border`, left-aligned. Internal note = `bg-amber-500/10` + `border-l-2 border-amber-500/50`, `rounded-md`, kept distinct.
- **Canonical raw→token mapping** (apply everywhere; `globals.css` tokens already adapt to dark mode, so dark: variants are dropped):

  | Raw (and its dark: variant) | Token |
  |---|---|
  | `bg-white` / `dark:bg-slate-900` (surface) | `bg-card` |
  | `bg-gray-50/80` / `dark:bg-slate-800/60` (inputs/subtle) | `bg-muted` |
  | `bg-gray-100` / `dark:bg-slate-800` | `bg-muted` |
  | `bg-gray-50/50` / `dark:bg-slate-800/40` | `bg-muted/40` |
  | `hover:bg-gray-50` / `dark:hover:bg-slate-800(/60)` | `hover:bg-accent` |
  | `text-gray-800` / `dark:text-slate-200` | `text-foreground` |
  | `text-gray-500`/`text-gray-600` / `dark:text-slate-400` | `text-muted-foreground` |
  | `border-gray-200`/`border-gray-300` / `dark:border-slate-700` | `border-border` |
  | `bg-teal-600` (solid accent) | `bg-primary` (text `text-primary-foreground`) |
  | `text-teal-700`/`text-teal-500` / dark teal text | `text-primary` |
  | `bg-teal-100`/`bg-teal-50` / `dark:bg-teal-500/20` | `bg-primary/10` |
  | `bg-teal-500/30` (admin attachment) | `bg-primary/15` |
  | red / `text-red-600` / `bg-red-50` (errors, urgent, SLA breach) | `text-destructive` (dot: `bg-destructive`) |
  | inline `rgba(13,148,136,..)` / hex | nearest token (`ring-primary`, `border-border`, etc.) |

  Status/priority chip backgrounds and borders are **removed** (replaced by dot + lowercase text), not remapped.
- **Status dot colors:** open→`bg-amber-500`, in_progress→`bg-blue-500`, resolved→`bg-emerald-500`, closed→`bg-muted-foreground`. **Priority dot colors:** low→`bg-muted-foreground`, normal→`bg-blue-400`, high→`bg-amber-500`, urgent→`bg-destructive`.
- Branch already created: `feat/admin-tickets-restyle`. Commit per task.
- Per-task gate (every task): `npx tsc --noEmit` clean; `npx eslint <changed files>` no errors (repo warnings ok). Tasks that touch a file also run the grep in their final step and it must return nothing.

---

### Task 1: Dot badges

**Files:**
- Modify: `src/app/tickets/components/TicketBadges.tsx`

**Interfaces:**
- Consumes: existing `STATUS_CONFIG[s].{label,dotColor}` and `PRIORITY_CONFIG[p].{label,dotColor}` (both already present in `lib/constants.ts` today — do NOT change `constants.ts` in this task; its now-redundant color fields are removed in Task 8).
- Produces: `StatusBadge`, `PriorityBadge`, `CategoryBadge`, `SlaBadge` (same names/props; dot+text render).

- [ ] **Step 1: Rewrite `TicketBadges.tsx` to dot + lowercase text**

The existing `STATUS_CONFIG`/`PRIORITY_CONFIG` already expose `label` + `dotColor`, so this compiles against the current `constants.ts` with no config change (keeps the branch green per task).

```tsx
"use client"

import { Badge } from "@/components/ui/badge"
import { Clock } from "lucide-react"
import { STATUS_CONFIG, PRIORITY_CONFIG } from "../lib/constants"
import type { SupportTicket } from "../lib/types"
import { getSlaStatus } from "../lib/ticket-utils"

export function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.open
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
      <span className={`h-1.5 w-1.5 rounded-full ${cfg.dotColor}`} aria-hidden="true" />
      <span className="lowercase">{cfg.label}</span>
    </span>
  )
}

export function PriorityBadge({ priority }: { priority: string }) {
  const cfg = PRIORITY_CONFIG[priority] || PRIORITY_CONFIG.normal
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
      <span className={`h-1.5 w-1.5 rounded-full ${cfg.dotColor}`} aria-hidden="true" />
      <span className="lowercase">{cfg.label}</span>
    </span>
  )
}

export function CategoryBadge({ category }: { category: string }) {
  return (
    <Badge variant="outline" className="capitalize text-[10px]">
      {category}
    </Badge>
  )
}

export function SlaBadge({ ticket }: { ticket: SupportTicket }) {
  const sla = getSlaStatus(ticket)
  if (sla.type === "none" || sla.type === "ok") return null
  if (
    (ticket.status === "resolved" || ticket.status === "closed") &&
    sla.type !== "breached"
  ) return null

  const tone =
    sla.type === "breached" && (ticket.status === "open" || ticket.status === "in_progress")
      ? "text-destructive"
      : sla.type === "warning"
      ? "text-amber-600"
      : sla.type === "responded"
      ? "text-emerald-600"
      : null
  if (!tone) return null

  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-medium ${tone}`}>
      <Clock className="h-2.5 w-2.5" aria-hidden="true" />
      {sla.label}
    </span>
  )
}
```

Note: `text-amber-600`/`text-emerald-600` here are semantic SLA-state text colors (warning/responded) with no token equivalent; they are text-only (not chip backgrounds) and acceptable as the SLA accent. Breach uses the `text-destructive` token.

- [ ] **Step 2: Typecheck + lint + tests**

Run: `npx tsc --noEmit && npx eslint src/app/tickets/components/TicketBadges.tsx && npx vitest run`
Expected: tsc clean; eslint no errors; 361 tests pass. (No `constants.ts` change in this task, so all existing consumers still compile.)

- [ ] **Step 3: Commit**

```bash
git add src/app/tickets/components/TicketBadges.tsx
git commit -m "feat(tickets): dot + lowercase status/priority badges"
```

---

### Task 2: TicketListItem — calm row

**Files:**
- Modify: `src/app/tickets/components/TicketListItem.tsx`

**Interfaces:**
- Consumes: `StatusBadge`, `PriorityBadge`, `SlaBadge` from `./TicketBadges`; `STATUS_CONFIG`/`PRIORITY_CONFIG` from `../lib/constants`.

- [ ] **Step 1: Replace the component body**

Replace the whole file with this restyled version (removes the duplicate inline urgent/high chips → uses `PriorityBadge`; tokenizes selected/unread; drops the colored left rail and `priorityCfg.borderColor`):

```tsx
"use client"

import { Clock, MessageSquare } from "lucide-react"
import { toast } from "sonner"
import type { SupportTicket } from "../lib/types"
import { timeAgo, waitingTime, hasUnreadMemberReply, lastMessagePreview } from "../lib/ticket-utils"
import { StatusBadge, PriorityBadge, SlaBadge } from "./TicketBadges"

export function TicketListItem({
  ticket,
  isSelected,
  onClick,
}: {
  ticket: SupportTicket
  isSelected: boolean
  onClick: () => void
}) {
  const unread = hasUnreadMemberReply(ticket)
  const preview = lastMessagePreview(ticket)

  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-4 py-3.5 border-b border-border transition-colors ${
        isSelected ? "bg-accent" : "hover:bg-accent/50"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            {unread && (
              <span className="h-2 w-2 rounded-full bg-primary shrink-0" aria-hidden="true" />
            )}
            {unread && <span className="sr-only">Unread reply</span>}
            <p className={`text-[13px] truncate leading-tight ${unread ? "font-bold text-foreground" : "font-semibold text-foreground/90"}`}>
              {ticket.subject}
            </p>
          </div>
          <div className="flex items-center gap-1.5 mt-1">
            <span className="text-xs text-muted-foreground truncate">{ticket.name}</span>
            <span className="text-muted-foreground/40 text-[10px]">|</span>
            <span
              tabIndex={0}
              className="font-mono text-[10px] text-muted-foreground/60 hover:text-primary transition-colors cursor-pointer"
              title="Copy permalink"
              onClick={(e) => {
                e.stopPropagation()
                const url = `${window.location.origin}/support/${ticket.ticket_number}`
                if (navigator.clipboard) {
                  navigator.clipboard.writeText(url).then(() => toast.success("Permalink copied")).catch(() => toast.error("Copy failed"))
                } else {
                  toast.error("Copy not available (requires HTTPS)")
                }
              }}
            >
              {ticket.ticket_number}
            </span>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0 pt-0.5">
          <span className="text-[10px] text-muted-foreground whitespace-nowrap">
            {timeAgo(ticket.created_at)}
          </span>
          <StatusBadge status={ticket.status} />
        </div>
      </div>

      <p className="text-[11px] text-muted-foreground/70 mt-1.5 line-clamp-1 leading-snug">
        {preview}
      </p>

      <div className="flex items-center gap-3 mt-1.5">
        {(ticket.priority === "urgent" || ticket.priority === "high") && (
          <PriorityBadge priority={ticket.priority} />
        )}
        <SlaBadge ticket={ticket} />
        {(ticket.status === "open" || ticket.status === "in_progress") && (
          <span className="text-[10px] text-muted-foreground/60 flex items-center gap-0.5">
            <Clock className="h-2.5 w-2.5" />
            {waitingTime(ticket.created_at)}
          </span>
        )}
        {ticket.replies && ticket.replies.length > 0 && (
          <span className="text-[10px] text-muted-foreground/60 flex items-center gap-0.5 ml-auto">
            <MessageSquare className="h-2.5 w-2.5" />
            {ticket.replies.length}
          </span>
        )}
      </div>
    </button>
  )
}
```

- [ ] **Step 2: Gate**

Run: `npx tsc --noEmit && npx eslint src/app/tickets/components/TicketListItem.tsx`
Then verify no raw scales remain in this file:
`grep -nE "(bg|text|border|ring)-(amber|blue|emerald|red|slate|gray|zinc|teal)-(50|100|200|300|400|500|600|700|800|900)|rounded-full|#[0-9a-fA-F]{6}" src/app/tickets/components/TicketListItem.tsx`
Expected: tsc/eslint clean; grep prints nothing.

- [ ] **Step 3: Commit**

```bash
git add src/app/tickets/components/TicketListItem.tsx
git commit -m "feat(tickets): calm ticket list row (dot badges, tokenized states)"
```

---

### Task 3: TicketListPanel — segmented filters + StatPill + chrome

**Files:**
- Modify: `src/app/tickets/components/TicketListPanel.tsx`

- [ ] **Step 1: Replace `StatPill` and the filter/search chrome**

Replace the file with this version (StatPill → dot + count + muted label; filter tabs → segmented control on a `bg-muted` track; all surfaces tokenized). Keep the props, list rendering, `RoutingRulesDialog`, and bottom count logic exactly:

```tsx
"use client"

import { Search, ChevronDown, Loader2, AlertTriangle } from "lucide-react"
import { Input } from "@/components/ui/input"
import { CATEGORIES, FILTER_TABS, STATUS_CONFIG } from "../lib/constants"
import type { SupportTicket } from "../lib/types"
import { TicketListItem } from "./TicketListItem"
import { RoutingRulesDialog } from "./RoutingRulesDialog"

/* ---------- Stat pill: dot + count + muted label ---------- */
function StatPill({
  label,
  count,
  dotColor,
}: {
  label: string
  count: number
  active?: boolean
  dotColor?: string
}) {
  return (
    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs">
      {dotColor && <span className={`h-1.5 w-1.5 rounded-full ${dotColor}`} aria-hidden="true" />}
      <span className="font-semibold text-foreground">{count}</span>
      <span className="text-muted-foreground lowercase">{label}</span>
    </div>
  )
}

export { StatPill }

export function TicketListPanel({
  sortedTickets,
  stats,
  isLoading,
  isSearching,
  searchQuery,
  handleSearchChange,
  handleSearch,
  statusFilter,
  setStatusFilter,
  categoryFilter,
  setCategoryFilter,
  slaBreachedFilter,
  setSlaBreachedFilter,
  selectedTicketId,
  openTicket,
}: {
  sortedTickets: SupportTicket[]
  stats: { total: number; open: number; in_progress: number; resolved: number }
  isLoading: boolean
  isSearching: boolean
  searchQuery: string
  handleSearchChange: (value: string) => void
  handleSearch: (e: React.FormEvent) => void
  statusFilter: string
  setStatusFilter: (value: string) => void
  categoryFilter: string
  setCategoryFilter: (value: string) => void
  slaBreachedFilter: boolean
  setSlaBreachedFilter: (value: boolean) => void
  selectedTicketId: string | null
  openTicket: (ticket: SupportTicket) => void
}) {
  return (
    <div className="w-[380px] min-w-[320px] border-r border-border flex flex-col bg-card">
      <div className="p-3 border-b border-border">
        <form onSubmit={handleSearch}>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/50" />
            <Input
              placeholder="Search tickets, descriptions, messages..."
              value={searchQuery}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="pl-9 pr-8 h-9 text-xs bg-muted border-border focus:bg-background transition-colors"
            />
            {isSearching && (
              <Loader2 className="absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-primary" />
            )}
          </div>
        </form>

        {/* Status filter — segmented control */}
        <div className="flex gap-1 mt-2.5 rounded-md bg-muted p-1 overflow-x-auto">
          {FILTER_TABS.map((tab) => {
            const isActive = statusFilter === tab.value
            const count =
              tab.value === "" ? stats.total : stats[tab.value as keyof typeof stats] ?? 0
            return (
              <button
                key={tab.value}
                onClick={() => setStatusFilter(tab.value)}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium whitespace-nowrap transition-colors ${
                  isActive
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {tab.label}
                {count > 0 && <span className="text-[10px] text-muted-foreground">{count}</span>}
              </button>
            )
          })}
        </div>

        <div className="mt-2 flex items-center gap-1.5">
          <div className="relative flex-1">
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="w-full appearance-none rounded-md border border-border bg-muted px-2.5 py-1.5 pr-7 text-[11px] text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <option value="">All Categories</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <ChevronDown className="absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground/50 pointer-events-none" />
          </div>
          <RoutingRulesDialog />
        </div>

        <label className="flex items-center gap-2 mt-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={slaBreachedFilter}
            onChange={(e) => setSlaBreachedFilter(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-border accent-primary"
          />
          <span className="text-[11px] text-muted-foreground font-medium">SLA Breached only</span>
        </label>
      </div>

      <div className="flex-1 overflow-y-auto">
        {isLoading && (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}
        {!isLoading && sortedTickets.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
            <AlertTriangle className="h-6 w-6 text-muted-foreground/30 mb-2" />
            <p className="text-xs text-muted-foreground">No tickets match your filters</p>
          </div>
        )}
        {sortedTickets.map((ticket) => (
          <TicketListItem
            key={ticket.id}
            ticket={ticket}
            isSelected={ticket.id === selectedTicketId}
            onClick={() => openTicket(ticket)}
          />
        ))}
      </div>

      <div className="px-4 py-2 border-t border-border bg-muted/40 text-[10px] text-muted-foreground/60 font-medium">
        {sortedTickets.length} ticket{sortedTickets.length !== 1 ? "s" : ""}
        {statusFilter && ` (${STATUS_CONFIG[statusFilter]?.label || statusFilter})`}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Gate**

Run: `npx tsc --noEmit && npx eslint src/app/tickets/components/TicketListPanel.tsx`
Then: `grep -nE "(bg|text|border|ring)-(amber|blue|emerald|red|slate|gray|zinc|teal)-(50|100|200|300|400|500|600|700|800|900)|rounded-full|#[0-9a-fA-F]{6}" src/app/tickets/components/TicketListPanel.tsx`
Expected: tsc/eslint clean; grep prints nothing.

- [ ] **Step 3: Commit**

```bash
git add src/app/tickets/components/TicketListPanel.tsx
git commit -m "feat(tickets): segmented filter tabs + dot stat pills, tokenized panel"
```

---

### Task 4: ChatBubble — soft-accent bubbles + attachments

**Files:**
- Modify: `src/app/tickets/components/ChatBubble.tsx`

- [ ] **Step 1: Replace the file**

Replace `ChatBubble.tsx` with this version: admin = soft accent tint; member = `bg-card`; internal note tokenized; `rounded-md`; `shadow-sm`; attachment chip shows filename + size with a token style; images framed in `border-border rounded-md`. Behavior (admin/member/internal split, inline + structured attachments) unchanged.

```tsx
"use client"

import { ShieldCheck, User, FileText, ExternalLink, Paperclip } from "lucide-react"
import type { TicketReply, TicketAttachment } from "../lib/types"
import { extractAttachment, formatFileSize, timeAgo } from "../lib/ticket-utils"

function AttachmentChip({ att }: { att: TicketAttachment }) {
  return (
    <a
      href={att.url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-md border border-border bg-background/60 text-foreground hover:bg-accent transition-colors"
    >
      <Paperclip className="h-3 w-3 shrink-0" />
      <span className="truncate max-w-[140px]">{att.filename}</span>
      <span className="text-muted-foreground">({formatFileSize(att.size)})</span>
    </a>
  )
}

function InlineAttachment({ url, isImage }: { url: string; isImage: boolean }) {
  if (isImage) {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" className="block">
        <img
          src={url}
          alt="Attachment"
          className="rounded-md border border-border max-h-52 object-cover cursor-pointer hover:opacity-90 transition-opacity"
        />
      </a>
    )
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-2 text-xs font-medium px-3 py-2 rounded-md border border-border bg-background/60 text-foreground hover:bg-accent transition-colors"
    >
      <FileText className="h-3.5 w-3.5" />
      View attachment
      <ExternalLink className="h-3 w-3" />
    </a>
  )
}

export function ChatBubble({ reply }: { reply: TicketReply }) {
  const isAdmin = reply.is_admin
  const isInternal = reply.is_internal === true
  const { text, url, isImage } = extractAttachment(reply.message)
  const structuredAttachments = reply.attachments || []

  if (isInternal) {
    return (
      <div className="flex justify-end mb-4">
        <div className="flex gap-2.5 max-w-[75%] flex-row-reverse">
          <div className="shrink-0 h-8 w-8 rounded-full flex items-center justify-center mt-1 bg-amber-500/10 text-amber-600">
            <ShieldCheck className="h-4 w-4" />
          </div>
          <div className="space-y-1">
            <div className="text-[10px] font-semibold text-amber-600 px-1 text-right">Internal note</div>
            <div className="px-4 py-3 text-sm leading-relaxed bg-amber-500/10 border-l-2 border-amber-500/50 text-foreground rounded-md shadow-sm">
              {text && <p className="whitespace-pre-wrap">{text}</p>}
              {url && <div className={`mt-2 ${text ? "pt-2 border-t border-border" : ""}`}><InlineAttachment url={url} isImage={isImage} /></div>}
            </div>
            <div className="flex items-center gap-1.5 px-1 justify-end">
              <span className="text-[10px] text-muted-foreground font-medium">{reply.author_name}</span>
              <span className="text-[10px] text-muted-foreground/60">{timeAgo(reply.created_at)}</span>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={`flex ${isAdmin ? "justify-end" : "justify-start"} mb-4`}>
      <div className={`flex gap-2.5 max-w-[75%] ${isAdmin ? "flex-row-reverse" : "flex-row"}`}>
        <div className={`shrink-0 h-8 w-8 rounded-full flex items-center justify-center mt-1 ${isAdmin ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
          {isAdmin ? <ShieldCheck className="h-4 w-4" /> : <User className="h-4 w-4" />}
        </div>
        <div className="space-y-1">
          <div className={`px-4 py-3 text-sm leading-relaxed rounded-md border shadow-sm ${isAdmin ? "bg-primary/10 border-border text-foreground" : "bg-card border-border text-foreground"}`}>
            {text && <p className="whitespace-pre-wrap">{text}</p>}
            {url && <div className={`mt-2 ${text ? "pt-2 border-t border-border" : ""}`}><InlineAttachment url={url} isImage={isImage} /></div>}
            {structuredAttachments.length > 0 && (
              <div className={`flex flex-wrap gap-1.5 mt-2 ${text || url ? "pt-2 border-t border-border" : ""}`}>
                {structuredAttachments.map((att, i) => (
                  <AttachmentChip key={i} att={att} />
                ))}
              </div>
            )}
          </div>
          <div className={`flex items-center gap-1.5 px-1 ${isAdmin ? "justify-end" : ""}`}>
            <span className="text-[10px] text-muted-foreground font-medium">{reply.author_name}</span>
            <span className="text-[10px] text-muted-foreground/60">{timeAgo(reply.created_at)}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
```

Note: `text-amber-600` / `bg-amber-500/10` / `border-amber-500/50` are the deliberate internal-note accent (kept distinct from member/admin), consistent with the spec; no other raw scales remain.

- [ ] **Step 2: Gate**

Run: `npx tsc --noEmit && npx eslint src/app/tickets/components/ChatBubble.tsx`
Then: `grep -nE "(bg|text|border)-(blue|emerald|red|slate|gray|zinc|teal)-(50|100|200|300|400|500|600|700|800|900)|rounded-full|rounded-2xl|shadow-md|#[0-9a-fA-F]{6}" src/app/tickets/components/ChatBubble.tsx`
Expected: tsc/eslint clean; grep prints nothing (amber-500 internal-note tints are intentionally excluded from this grep).

- [ ] **Step 3: Commit**

```bash
git add src/app/tickets/components/ChatBubble.tsx
git commit -m "feat(tickets): soft-accent reply bubbles + tokenized attachments"
```

---

### Task 5: TicketDetailPanel — tokenize header + body

**Files:**
- Modify: `src/app/tickets/components/TicketDetailPanel.tsx`

This component (368 lines) is restyled by applying the canonical mapping (Global Constraints) and swapping any inline status/priority chips for the `StatusBadge`/`PriorityBadge` from `./TicketBadges`. Read the file in full first.

- [ ] **Step 1: Read the file**

Run: `sed -n '1,368p' src/app/tickets/components/TicketDetailPanel.tsx`
Identify every: (a) raw color-scale class, (b) inline hex, (c) `rounded-full`/`rounded-2xl`, (d) `shadow-md`/`shadow-lg`, (e) any place that renders status/priority as a filled chip.

- [ ] **Step 2: Apply the mapping**

For every occurrence found in Step 1, replace per the Global Constraints mapping table. Specifically:
- Surfaces `bg-white dark:bg-slate-900` → `bg-card`; subtle fills → `bg-muted`; borders → `border-border`; muted text → `text-muted-foreground`; body text → `text-foreground`.
- Any solid teal accent (`bg-teal-600`, buttons, the header status dot/tile) → `bg-primary`/`text-primary`/`bg-primary/10`.
- Header status indicator → use `<StatusBadge status={ticket.status} />`; header priority indicator → `<PriorityBadge priority={ticket.priority} />` (import from `./TicketBadges`); remove any bespoke filled status/priority chip markup.
- `rounded-2xl`→`rounded-md`; `rounded-full` (except avatar circles and dots) → `rounded-md`; `shadow-md`/`shadow-lg` → `shadow-sm`.
- Error/destructive text (`text-red-*`) → `text-destructive`.
- Keep ALL behavior: the status/priority/assign `<select>`s, Save, Reopen/close toggle, first-response meta, and the chat scroll region. Do not change handlers or props.

If a color has no obvious token mapping, STOP and report it (do not invent a new raw scale).

- [ ] **Step 3: Gate**

Run: `npx tsc --noEmit && npx eslint src/app/tickets/components/TicketDetailPanel.tsx`
Then: `grep -nE "(bg|text|border|ring)-(amber|blue|emerald|red|slate|gray|zinc|teal)-(50|100|200|300|400|500|600|700|800|900)|rounded-full|rounded-2xl|shadow-(md|lg|xl)|#[0-9a-fA-F]{6}" src/app/tickets/components/TicketDetailPanel.tsx`
Expected: tsc/eslint clean; grep prints nothing (if a legitimate status/priority **dot** uses `bg-{amber,blue,emerald}-500`, that is allowed — but those should now come from the badge components, so the file itself should be clean).

- [ ] **Step 4: Commit**

```bash
git add src/app/tickets/components/TicketDetailPanel.tsx
git commit -m "feat(tickets): tokenize ticket detail panel; dot badges in header"
```

---

### Task 6: page.tsx + ReplyComposer — tokenize

**Files:**
- Modify: `src/app/tickets/page.tsx`
- Modify: `src/app/tickets/components/ReplyComposer.tsx`

- [ ] **Step 1: Read both files**

Run: `sed -n '1,166p' src/app/tickets/page.tsx` and `sed -n '1,230p' src/app/tickets/components/ReplyComposer.tsx`

- [ ] **Step 2: page.tsx — restyle header StatPills + tokenize**

The header uses `StatPill` (from TicketListPanel) with a `color` prop (filled chip classes like `bg-amber-100 …`). With Task 3's new `StatPill` signature `{ label, count, active?, dotColor? }`, update the three usages to pass `dotColor` instead of `color`:
- Open → `dotColor="bg-amber-500"`
- In Progress → `dotColor="bg-blue-500"`
- Resolved → `dotColor="bg-emerald-500"`
Remove the now-invalid `color={...}` props. Tokenize any other raw scales in `page.tsx` per the mapping (e.g., the teal icon tile may keep `bg-primary` instead of a raw teal; `text-teal-600` spinner → `text-primary`). Keep the layout, stats, and Analytics link.

- [ ] **Step 3: ReplyComposer.tsx — tokenize**

Apply the canonical mapping to every raw scale / hex / `rounded-full` (except true pills like a small toggle, which become `rounded-md`) / shadow. Keep the quick-replies popover, attachment picker, internal-note toggle, Send button, and Cmd+Enter behavior unchanged. The internal-note toggle's "active" state may use `bg-amber-500/10 text-amber-600` (intentional internal-note accent) — that is acceptable; everything else uses tokens.

- [ ] **Step 4: Gate**

Run: `npx tsc --noEmit && npx eslint src/app/tickets/page.tsx src/app/tickets/components/ReplyComposer.tsx`
Then for each file: `grep -nE "(bg|text|border|ring)-(blue|emerald|red|slate|gray|zinc|teal)-(50|100|200|300|400|500|600|700|800|900)|rounded-full|#[0-9a-fA-F]{6}" <file>`
Expected: tsc/eslint clean; grep prints nothing (amber-500 internal-note accent in ReplyComposer is intentionally excluded; status dots `*-500` in page are allowed accents).

- [ ] **Step 5: Commit**

```bash
git add src/app/tickets/page.tsx src/app/tickets/components/ReplyComposer.tsx
git commit -m "feat(tickets): tokenize page header stat pills + reply composer"
```

---

### Task 7: Dialogs + analytics — tokenize colors, kill gradient

**Files:**
- Modify: `src/app/tickets/components/ReplyTemplatesDialog.tsx`
- Modify: `src/app/tickets/components/RoutingRulesDialog.tsx`
- Modify: `src/app/tickets/analytics/page.tsx`

Color-tokenization only — NO layout or behavior changes.

- [ ] **Step 1: Read the three files**

Run: `sed -n '1,308p' src/app/tickets/components/ReplyTemplatesDialog.tsx`, `sed -n '1,357p' src/app/tickets/components/RoutingRulesDialog.tsx`, `sed -n '1,400p' src/app/tickets/analytics/page.tsx`

- [ ] **Step 2: Apply the mapping + remove the gradient**

- Replace every raw color scale / inline hex per the canonical mapping table.
- In `analytics/page.tsx`, replace the `bg-gradient-to-*` with a solid `bg-card` (or `bg-primary` if it's an accent tile). For chart series colors that REQUIRE explicit values (e.g. a recharts palette passed as props/hex), those may remain as explicit hex IF they are data-viz series colors with no token equivalent — leave them and note each in the report; everything else must be tokens.
- Dialogs: surfaces→`bg-card`/`bg-muted`, borders→`border-border`, text→`text-foreground`/`text-muted-foreground`, accents→`primary`, destructive actions→`text-destructive`/`bg-destructive`. Keep `rounded-lg` only on the dialog container (elevated), `rounded-md` elsewhere.

- [ ] **Step 3: Gate**

Run: `npx tsc --noEmit && npx eslint src/app/tickets/components/ReplyTemplatesDialog.tsx src/app/tickets/components/RoutingRulesDialog.tsx src/app/tickets/analytics/page.tsx`
Then: `grep -rnE "gradient" src/app/tickets/analytics/page.tsx` (expect nothing) and for each dialog file `grep -nE "(bg|text|border)-(amber|blue|emerald|red|slate|gray|zinc|teal)-(50|100|200|300|400|500|600|700|800|900)|#[0-9a-fA-F]{6}" <file>` (expect nothing, except documented data-viz series hex in analytics noted in the report).

- [ ] **Step 4: Commit**

```bash
git add src/app/tickets/components/ReplyTemplatesDialog.tsx src/app/tickets/components/RoutingRulesDialog.tsx src/app/tickets/analytics/page.tsx
git commit -m "feat(tickets): tokenize dialogs + analytics, remove gradient"
```

---

### Task 8: Full verification

**Files:** `src/app/tickets/lib/constants.ts` (dead-field cleanup) + verification

- [ ] **Step 1: Remove now-dead color fields from `constants.ts`**

After Tasks 2/3/4 stopped reading them, the raw-color config fields are dead. Simplify (keep `CATEGORIES`, `STATUS_OPTIONS`, `PRIORITY_OPTIONS`, `FALLBACK_QUICK_REPLIES`, `ADMIN_ASSIGNEES` unchanged):

```ts
export const STATUS_CONFIG: Record<string, { label: string; dotColor: string }> = {
  open:        { label: "Open",        dotColor: "bg-amber-500" },
  in_progress: { label: "In Progress", dotColor: "bg-blue-500" },
  resolved:    { label: "Resolved",    dotColor: "bg-emerald-500" },
  closed:      { label: "Closed",      dotColor: "bg-muted-foreground" },
}

export const PRIORITY_CONFIG: Record<string, { label: string; dotColor: string }> = {
  low:    { label: "Low",    dotColor: "bg-muted-foreground" },
  normal: { label: "Normal", dotColor: "bg-blue-400" },
  high:   { label: "High",   dotColor: "bg-amber-500" },
  urgent: { label: "Urgent", dotColor: "bg-destructive" },
}

export const FILTER_TABS = [
  { value: "", label: "All" },
  { value: "open", label: "Open" },
  { value: "in_progress", label: "In Progress" },
  { value: "resolved", label: "Resolved" },
  { value: "closed", label: "Closed" },
] as const
```

Then `npx tsc --noEmit` — if it errors, a consumer still reads a removed field; fix that consumer per the mapping (it should already be updated by an earlier task) rather than re-adding the field.

- [ ] **Step 2: Repo-wide grep over the tickets UI**

Run:
```bash
grep -rnE "(bg|text|border|ring)-(slate|gray|zinc)-(50|100|200|300|400|500|600|700|800|900)|rounded-full|#[0-9a-fA-F]{6}|gradient" src/app/tickets/ | grep -v "rounded-full.*h-1.5 w-1.5" || echo "CLEAN"
```
Review remaining hits. Acceptable remainders ONLY: status/priority **dots** (`h-1.5/h-2 w-2 rounded-full bg-{amber,blue,emerald}-500`/`bg-primary`/`bg-destructive`/`bg-muted-foreground`), avatar circles (`rounded-full` on `h-8 w-8`), the intentional internal-note amber accent, and any documented analytics data-viz series hex. Anything else → fix in the owning component and re-commit.

- [ ] **Step 3: Static + tests + build**

Run:
```bash
npx tsc --noEmit
npx eslint src/app/tickets
npx vitest run
npx next build
```
Expected: tsc clean; eslint no errors; all tests pass (361); build succeeds.

- [ ] **Step 4: Manual (controller will do, not the subagent)**

Load `/tickets` in light AND dark mode: list rows (dot status/priority, subtle SLA), segmented filter tabs, dot stat pills, detail header badges, conversation (admin soft-tint right, member card left, internal note distinct), attachments (filename/thumb), analytics (no gradient). Confirm "would Linear/Stripe ship this?".

- [ ] **Step 5: Commit**

```bash
git add src/app/tickets/lib/constants.ts
git commit -m "refactor(tickets): drop dead color-config fields after restyle"
```

---

## Self-Review

- **Spec coverage:** dot+lowercase status/priority (Tasks 1,2,5), subtle SLA (Task 1), segmented filter tabs (Task 3), soft-accent bubbles (Task 4), stat pills (Tasks 3,6), tokenize all surfaces incl. detail/composer/dialogs (Tasks 5,6,7), attachments (Task 4), kill gradient (Task 7), dead-config cleanup + full AGENTS.md verification + build + tests (Task 8). All spec rows mapped.
- **Placeholders:** Tasks 1–4 carry complete code. Tasks 5–7 are mechanical color-tokenization driven by the canonical mapping table (the concrete "how"), bounded by read-the-file + grep-must-be-empty gates — not vague directives. No "TBD"/"handle X".
- **Type consistency & green-per-task:** Task 1 rewrites only `TicketBadges` against the EXISTING `{label,dotColor}` config — no `constants.ts` change, so every task stays `tsc`-green. Components stop reading the raw-color config fields (`TicketListItem` drops `borderColor` in Task 2; `TicketListPanel` drops `tab.color` + ships the new `StatPill` signature in Task 3; `page.tsx` switches `StatPill` to `dotColor` in Task 6). Only after those land does Task 8 remove the now-dead fields from `constants.ts`. No dangling references at any point.
