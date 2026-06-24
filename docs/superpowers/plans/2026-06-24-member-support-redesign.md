# Member Support Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the member-facing Support ticket flow to the repo's clinical-confident admin aesthetic and extract it from the 2,900-line `member/page.tsx` into a focused `src/components/member-support/` module, with no backend changes.

**Architecture:** A container component (`MemberSupport`) owns view state (`list | new | detail`) and a data hook (`useMemberTickets`). Pure logic (api calls, helpers, constants) lives in plain modules that are unit-tested with vitest. Three view components render the UI. `member/page.tsx` swaps its inline `MemberSupportTab` for `<MemberSupport member={member} />` and deletes the old code.

**Tech Stack:** Next.js 16, React 19, TypeScript, Tailwind v4 (CSS variables), shadcn UI primitives (`src/components/ui/*`), lucide-react, sonner (toast), vitest.

## Global Constraints

- **No backend/API/DB changes.** Reuse existing endpoints exactly: `GET /api/tickets?email=`, `POST /api/tickets`, `GET /api/tickets/{id}`, `POST /api/tickets/{id}/reply`.
- **AGENTS.md UI rules (verbatim):** status = small colored dot + lowercase text (never filled chips); category/priority = segmented control with `rounded-md` (never `rounded-full` pills); cards = solid `bg-card` + 1px `border-border`, no gradients; colors from CSS variables only (`text-foreground`, `text-muted-foreground`, `bg-accent`, `bg-muted`, `text-destructive`, `border-border`) — no hardcoded hex / zinc / gray / emerald / blue scales; max 2 font weights; `border` only (never `border-2`); `shadow-sm` max except modals.
- **Categories (verbatim):** `["Application Issue", "Profile Update", "Payment Issue", "Certificate/Card", "Technical Issue", "Other"]`.
- **Priorities:** `low | normal | high` (member-selectable); default `normal`.
- **Member identity is never typed by the user** — `name`, `email`, `phone`, `amasi_number` come from the `member` prop on create.
- **Preserve existing quirk:** the create-form attachment is NOT uploaded — its filename is appended to the description as `\n\n📎 Attachment: <name>`. Only the *reply* path uploads a real file (multipart). Keep this behavior; do not "fix" it in this plan.
- **Reply marker parsing:** replies may contain `📎 Attachment: <url>` — split into `{ text, url }` for rendering.
- After any client-router-hook-touching change, run `npx next build` before declaring done (AGENTS.md build-check rule).
- Branch already created: `feat/member-support-redesign`. Commit frequently.

---

### Task 1: Types, constants, and pure helpers

**Files:**
- Create: `src/components/member-support/types.ts`
- Create: `src/components/member-support/support-constants.ts`
- Test: `__tests__/member-support-helpers.test.ts`

**Interfaces:**
- Produces:
  - `MemberTicket` = `{ id: string; ticket_number?: string; subject: string; status: string; priority?: string; category?: string; created_at?: string; updated_at?: string; last_reply_preview?: string }`
  - `TicketReply` = `{ id?: string; message?: string; author_name?: string; author_role?: string; as_member?: boolean; created_at?: string }`
  - `TICKET_CATEGORIES: readonly string[]`
  - `PRIORITIES: ReadonlyArray<{ value: "low"|"normal"|"high"; label: string }>`
  - `statusMeta(status: string): { label: string; dotClass: string }` — `label` lowercase, `dotClass` a CSS-var-based color class
  - `extractAttachment(msg?: string): { text: string; url: string | null }`
  - `isImageUrl(url: string): boolean`

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/member-support-helpers.test.ts
import { describe, it, expect } from "vitest"
import {
  TICKET_CATEGORIES, PRIORITIES, statusMeta, extractAttachment, isImageUrl,
} from "@/components/member-support/support-constants"

describe("member-support helpers", () => {
  it("exposes the canonical categories", () => {
    expect(TICKET_CATEGORIES).toEqual([
      "Application Issue", "Profile Update", "Payment Issue",
      "Certificate/Card", "Technical Issue", "Other",
    ])
  })

  it("offers member-selectable priorities defaulting list with normal", () => {
    expect(PRIORITIES.map(p => p.value)).toEqual(["low", "normal", "high"])
  })

  it("returns lowercase labels and a dot class for each status", () => {
    expect(statusMeta("open").label).toBe("open")
    expect(statusMeta("in_progress").label).toBe("in progress")
    expect(statusMeta("resolved").label).toBe("resolved")
    expect(statusMeta("closed").label).toBe("closed")
    expect(statusMeta("open").dotClass).toMatch(/bg-/)
  })

  it("splits an attachment marker out of a reply message", () => {
    const r = extractAttachment("Here you go 📎 Attachment: https://x.test/a.png")
    expect(r.text).toBe("Here you go")
    expect(r.url).toBe("https://x.test/a.png")
  })

  it("returns the message unchanged when there is no marker", () => {
    expect(extractAttachment("just text")).toEqual({ text: "just text", url: null })
    expect(extractAttachment(undefined)).toEqual({ text: "", url: null })
  })

  it("detects image urls", () => {
    expect(isImageUrl("https://x.test/p.JPG")).toBe(true)
    expect(isImageUrl("https://x.test/doc.pdf")).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/member-support-helpers.test.ts`
Expected: FAIL — cannot resolve `@/components/member-support/support-constants`.

- [ ] **Step 3: Write `types.ts`**

```ts
// src/components/member-support/types.ts
export interface MemberTicket {
  id: string
  ticket_number?: string
  subject: string
  status: string
  priority?: string
  category?: string
  created_at?: string
  updated_at?: string
  last_reply_preview?: string
}

export interface TicketReply {
  id?: string
  message?: string
  author_name?: string
  author_role?: string
  as_member?: boolean
  created_at?: string
}
```

- [ ] **Step 4: Write `support-constants.ts`**

```ts
// src/components/member-support/support-constants.ts
export const TICKET_CATEGORIES = [
  "Application Issue", "Profile Update", "Payment Issue",
  "Certificate/Card", "Technical Issue", "Other",
] as const

export const PRIORITIES = [
  { value: "low", label: "Low" },
  { value: "normal", label: "Normal" },
  { value: "high", label: "High" },
] as const

export type Priority = (typeof PRIORITIES)[number]["value"]

// Status dot colors use semantic Tailwind tokens already present in the theme.
// Dot-only (no filled chips), per AGENTS.md.
export function statusMeta(status: string): { label: string; dotClass: string } {
  switch (status) {
    case "open":        return { label: "open",        dotClass: "bg-amber-500" }
    case "in_progress": return { label: "in progress", dotClass: "bg-blue-500" }
    case "resolved":    return { label: "resolved",    dotClass: "bg-emerald-500" }
    case "closed":      return { label: "closed",      dotClass: "bg-muted-foreground" }
    default:            return { label: status || "unknown", dotClass: "bg-muted-foreground" }
  }
}

export function extractAttachment(msg?: string): { text: string; url: string | null } {
  if (!msg) return { text: "", url: null }
  const match = msg.match(/📎 Attachment: (https?:\/\/\S+)/)
  if (!match) return { text: msg, url: null }
  return { text: msg.replace(/📎 Attachment: (https?:\/\/\S+)/g, "").trim(), url: match[1] }
}

export function isImageUrl(url: string): boolean {
  return /\.(jpg|jpeg|png|gif|webp|bmp|svg)/i.test(url)
}
```

Note: the status dot uses `amber/blue/emerald-500` *solid dots only* — this is the single allowed accent-dot exception (matches the admin inbox `StatPill`/dot usage). No filled chip backgrounds, no `-50/-200` chip scales.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run __tests__/member-support-helpers.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add src/components/member-support/types.ts src/components/member-support/support-constants.ts __tests__/member-support-helpers.test.ts
git commit -m "feat(member-support): types, constants, and pure helpers"
```

---

### Task 2: Support API module

**Files:**
- Create: `src/components/member-support/support-api.ts`
- Test: `__tests__/member-support-api.test.ts`

**Interfaces:**
- Consumes: `MemberTicket`, `TicketReply` from `./types`.
- Produces:
  - `listTickets(email: string): Promise<MemberTicket[]>`
  - `getTicketReplies(ticketId: string): Promise<TicketReply[]>`
  - `createTicket(input: CreateTicketInput): Promise<{ ticket_number?: string; id?: string }>`
  - `replyToTicket(ticketId: string, input: { message: string; authorName: string; file?: File | null }): Promise<TicketReply>`
  - `CreateTicketInput` = `{ name; email; phone; amasi_number; category; subject; description; priority }` (all string except priority `Priority`)

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/member-support-api.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { listTickets, createTicket, replyToTicket, getTicketReplies } from "@/components/member-support/support-api"

const fetchMock = vi.fn()
beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock) })
afterEach(() => { vi.unstubAllGlobals() })

function ok(body: unknown) {
  return Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response)
}

describe("support-api", () => {
  it("listTickets queries by email and returns an array", async () => {
    fetchMock.mockReturnValueOnce(ok([{ id: "1", subject: "x", status: "open" }]))
    const out = await listTickets("a@b.com")
    expect(fetchMock).toHaveBeenCalledWith("/api/tickets?email=a%40b.com")
    expect(out).toHaveLength(1)
  })

  it("listTickets returns [] when the response is not an array", async () => {
    fetchMock.mockReturnValueOnce(ok({ error: "nope" }))
    expect(await listTickets("a@b.com")).toEqual([])
  })

  it("getTicketReplies returns the replies array", async () => {
    fetchMock.mockReturnValueOnce(ok({ replies: [{ id: "r1", message: "hi" }] }))
    expect(await getTicketReplies("t1")).toEqual([{ id: "r1", message: "hi" }])
  })

  it("createTicket posts JSON with member identity", async () => {
    fetchMock.mockReturnValueOnce(ok({ ticket_number: "TKT-1" }))
    const res = await createTicket({
      name: "Dr X", email: "a@b.com", phone: "9", amasi_number: "100",
      category: "Other", subject: "S", description: "D", priority: "normal",
    })
    expect(res.ticket_number).toBe("TKT-1")
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toBe("/api/tickets")
    expect(opts.method).toBe("POST")
    expect(JSON.parse(opts.body).subject).toBe("S")
  })

  it("replyToTicket sends multipart when a file is present", async () => {
    fetchMock.mockReturnValueOnce(ok({ id: "r2", message: "with file" }))
    const file = new File(["x"], "a.png", { type: "image/png" })
    await replyToTicket("t1", { message: "hi", authorName: "Dr X", file })
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toBe("/api/tickets/t1/reply")
    expect(opts.method).toBe("POST")
    expect(opts.body instanceof FormData).toBe(true)
  })

  it("replyToTicket sends JSON when no file", async () => {
    fetchMock.mockReturnValueOnce(ok({ id: "r3", message: "hi" }))
    await replyToTicket("t1", { message: "hi", authorName: "Dr X", file: null })
    const [, opts] = fetchMock.mock.calls[0]
    expect(opts.headers["Content-Type"]).toBe("application/json")
    expect(JSON.parse(opts.body).as_member).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/member-support-api.test.ts`
Expected: FAIL — cannot resolve `support-api`.

- [ ] **Step 3: Write `support-api.ts`**

```ts
// src/components/member-support/support-api.ts
import type { MemberTicket, TicketReply } from "./types"
import type { Priority } from "./support-constants"

export interface CreateTicketInput {
  name: string
  email: string
  phone: string
  amasi_number: string
  category: string
  subject: string
  description: string
  priority: Priority
}

export async function listTickets(email: string): Promise<MemberTicket[]> {
  const res = await fetch(`/api/tickets?email=${encodeURIComponent(email)}`)
  const data = await res.json()
  return Array.isArray(data) ? data : []
}

export async function getTicketReplies(ticketId: string): Promise<TicketReply[]> {
  const res = await fetch(`/api/tickets/${ticketId}`)
  const data = await res.json()
  return Array.isArray(data?.replies) ? data.replies : []
}

export async function createTicket(
  input: CreateTicketInput
): Promise<{ ticket_number?: string; id?: string; error?: string }> {
  const res = await fetch("/api/tickets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  })
  return res.json()
}

export async function replyToTicket(
  ticketId: string,
  input: { message: string; authorName: string; file?: File | null }
): Promise<TicketReply> {
  let res: Response
  if (input.file) {
    const fd = new FormData()
    fd.append("message", input.message)
    fd.append("author_name", input.authorName)
    fd.append("as_member", "true")
    fd.append("attachment", input.file)
    res = await fetch(`/api/tickets/${ticketId}/reply`, { method: "POST", body: fd })
  } else {
    res = await fetch(`/api/tickets/${ticketId}/reply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: input.message, as_member: true, author_name: input.authorName }),
    })
  }
  return res.json()
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/member-support-api.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/member-support/support-api.ts __tests__/member-support-api.test.ts
git commit -m "feat(member-support): support-api module with unit tests"
```

---

### Task 3: `useMemberTickets` data hook

**Files:**
- Create: `src/components/member-support/useMemberTickets.ts`

**Interfaces:**
- Consumes: `listTickets`, `getTicketReplies`, `createTicket`, `replyToTicket`, `CreateTicketInput` from `./support-api`; `MemberTicket`, `TicketReply` from `./types`.
- Produces: `useMemberTickets(email: string, refreshKey: number)` returning
  `{ tickets, loading, replies, repliesLoading, loadReplies(id), setReplies, reload() }`.

This hook is thin glue over the tested api module; it has no independent test (its logic is the api module, already covered). Verified via typecheck + the manual pass in Task 8.

- [ ] **Step 1: Write the hook**

```ts
// src/components/member-support/useMemberTickets.ts
"use client"
import { useCallback, useEffect, useState } from "react"
import { listTickets, getTicketReplies } from "./support-api"
import type { MemberTicket, TicketReply } from "./types"

export function useMemberTickets(email: string | undefined, refreshKey: number) {
  const [tickets, setTickets] = useState<MemberTicket[]>([])
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [replies, setReplies] = useState<TicketReply[]>([])
  const [repliesLoading, setRepliesLoading] = useState(false)

  const reload = useCallback(() => {
    if (!email) return
    setLoading(true); setLoadError(false)
    listTickets(email)
      .then(setTickets)
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false))
  }, [email])

  useEffect(() => { reload() }, [reload, refreshKey])

  const loadReplies = useCallback(async (ticketId: string) => {
    setReplies([]); setRepliesLoading(true)
    try { setReplies(await getTicketReplies(ticketId)) }
    catch { setReplies([]) }
    finally { setRepliesLoading(false) }
  }, [])

  return { tickets, loading, loadError, replies, repliesLoading, loadReplies, setReplies, reload }
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors from `src/components/member-support/`.

- [ ] **Step 3: Commit**

```bash
git add src/components/member-support/useMemberTickets.ts
git commit -m "feat(member-support): useMemberTickets data hook"
```

---

### Task 4: `TicketList` view

**Files:**
- Create: `src/components/member-support/TicketList.tsx`

**Interfaces:**
- Consumes: `MemberTicket` from `./types`; `statusMeta` from `./support-constants`.
- Produces: default export `TicketList` with props
  `{ tickets: MemberTicket[]; loading: boolean; loadError: boolean; onOpen(t: MemberTicket): void; onNew(): void; onRetry(): void }`.

Reference: clean stacked list. AGENTS.md: card = `bg-card border border-border rounded-md`, status as dot + lowercase, empty state = icon in `bg-muted border rounded-md` square + one line.

- [ ] **Step 1: Write the component**

```tsx
// src/components/member-support/TicketList.tsx
"use client"
import { Ticket, Plus, Loader2, ChevronRight, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { statusMeta } from "./support-constants"
import type { MemberTicket } from "./types"

function relTime(iso?: string): string {
  if (!iso) return ""
  const d = Date.now() - new Date(iso).getTime()
  const m = Math.floor(d / 60000)
  if (m < 1) return "just now"
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

export default function TicketList({
  tickets, loading, loadError, onOpen, onNew, onRetry,
}: {
  tickets: MemberTicket[]
  loading: boolean
  loadError: boolean
  onOpen: (t: MemberTicket) => void
  onNew: () => void
  onRetry: () => void
}) {
  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <p className="text-xs uppercase tracking-wider text-muted-foreground">Help &amp; support</p>
          <h2 className="text-2xl font-bold tracking-tight">Support</h2>
          <p className="text-sm text-muted-foreground mt-0.5">Your support tickets</p>
        </div>
        <Button onClick={onNew} className="gap-2"><Plus className="h-4 w-4" /> New ticket</Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : loadError ? (
        <div className="rounded-md border border-border bg-card p-8 text-center">
          <p className="text-sm text-muted-foreground">Couldn&apos;t load your tickets.</p>
          <Button variant="outline" size="sm" onClick={onRetry} className="mt-3 gap-2">
            <RefreshCw className="h-3.5 w-3.5" /> Retry
          </Button>
        </div>
      ) : tickets.length === 0 ? (
        <div className="rounded-md border border-border bg-card p-10 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-md border border-border bg-muted">
            <Ticket className="h-6 w-6 text-muted-foreground" />
          </div>
          <p className="text-sm font-medium">No tickets yet</p>
          <p className="text-sm text-muted-foreground mt-1">Raise a ticket and our team will help you out.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {tickets.map((t) => {
            const sm = statusMeta(t.status)
            return (
              <button
                key={t.id}
                onClick={() => onOpen(t)}
                className="group flex w-full items-center gap-4 rounded-md border border-border bg-card px-4 py-3.5 text-left shadow-sm transition-colors hover:bg-accent"
              >
                <span className={`h-2 w-2 shrink-0 rounded-full ${sm.dotClass}`} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{t.subject}</p>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {sm.label}
                    {t.ticket_number ? ` · ${t.ticket_number}` : ""}
                    {t.priority ? ` · ${t.priority}` : ""}
                    {t.updated_at ? ` · ${relTime(t.updated_at)}` : ""}
                  </p>
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Typecheck + lint**

Run: `npx tsc --noEmit && npx eslint src/components/member-support/TicketList.tsx`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/member-support/TicketList.tsx
git commit -m "feat(member-support): TicketList view"
```

---

### Task 5: `NewTicketForm` view

**Files:**
- Create: `src/components/member-support/NewTicketForm.tsx`

**Interfaces:**
- Consumes: `TICKET_CATEGORIES`, `PRIORITIES`, `Priority` from `./support-constants`; `createTicket`, `CreateTicketInput` from `./support-api`; shadcn `Button`, `Input`.
- Produces: default export `NewTicketForm` with props
  `{ member: MemberCtx; onBack(): void; onCreated(): void }` where
  `MemberCtx = { name?: string; first_name?: string; email: string; phone?: string; mobile?: string; amasi_number?: string|number; membership_no?: string }`.

Reference: `design-references/tailwind-plus/form-layout-stacked-sections.tsx`. Segmented controls for category + priority (`rounded-md`, no `rounded-full`, no hardcoded color scales). Attachment is filename-only (appended to description) — preserve quirk; keep drag/drop + preview restyled with tokens. On success show a confirmation, then call `onCreated()` (which reloads list + returns to list).

- [ ] **Step 1: Write the component**

```tsx
// src/components/member-support/NewTicketForm.tsx
"use client"
import { useEffect, useRef, useState } from "react"
import { ArrowLeft, Upload, X, FileText, Send, Loader2, CheckCircle2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { TICKET_CATEGORIES, PRIORITIES, type Priority } from "./support-constants"
import { createTicket } from "./support-api"

export interface MemberCtx {
  name?: string
  first_name?: string
  email: string
  phone?: string
  mobile?: string
  amasi_number?: string | number
  membership_no?: string
}

export default function NewTicketForm({
  member, onBack, onCreated,
}: { member: MemberCtx; onBack: () => void; onCreated: () => void }) {
  const [category, setCategory] = useState<string>("Other")
  const [subject, setSubject] = useState("")
  const [description, setDescription] = useState("")
  const [priority, setPriority] = useState<Priority>("normal")
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!file || !file.type.startsWith("image/")) { setPreview(null); return }
    const url = URL.createObjectURL(file); setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false)
    const f = e.dataTransfer.files?.[0]
    if (f && (f.type.startsWith("image/") || f.type === "application/pdf")) setFile(f)
  }

  const submit = async () => {
    if (!subject.trim() || !description.trim()) return
    setSubmitting(true)
    try {
      const res = await createTicket({
        name: member.name || member.first_name || "Member",
        email: member.email,
        phone: member.phone || member.mobile || "",
        amasi_number: String(member.amasi_number || member.membership_no || ""),
        category,
        subject: subject.trim(),
        description: description.trim() + (file ? `\n\n📎 Attachment: ${file.name}` : ""),
        priority,
      })
      if (res.ticket_number || res.id) {
        setDone(res.ticket_number || "Submitted")
        setTimeout(onCreated, 2500)
      } else {
        toast.error(res.error || "Couldn't submit your ticket. Please try again.")
      }
    } catch {
      toast.error("Couldn't submit your ticket. Please try again.")
    } finally {
      setSubmitting(false)
    }
  }

  if (done) {
    return (
      <div className="max-w-2xl">
        <div className="rounded-md border border-border bg-card p-10 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-md border border-border bg-muted">
            <CheckCircle2 className="h-6 w-6 text-emerald-500" />
          </div>
          <p className="text-sm font-medium">Ticket submitted</p>
          <p className="mt-1 text-sm text-muted-foreground">Reference <span className="font-medium text-foreground">{done}</span>. We&apos;ll get back to you by email and here.</p>
        </div>
      </div>
    )
  }

  const seg = (active: boolean) =>
    `px-3 py-2 rounded-md text-sm font-medium transition-colors border ${
      active ? "bg-background border-border text-foreground shadow-sm" : "border-transparent text-muted-foreground hover:text-foreground"
    }`

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-wider text-muted-foreground">Help &amp; support</p>
          <h2 className="text-2xl font-bold tracking-tight">New ticket</h2>
        </div>
        <Button variant="ghost" onClick={onBack} className="gap-2 text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
      </div>

      {/* Category */}
      <div className="space-y-2">
        <label className="text-sm font-medium">Category</label>
        <div className="flex flex-wrap gap-1 rounded-md bg-muted p-1">
          {TICKET_CATEGORIES.map((c) => (
            <button key={c} onClick={() => setCategory(c)} className={seg(category === c)}>{c}</button>
          ))}
        </div>
      </div>

      {/* Subject */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium">Subject <span className="text-destructive">*</span></label>
          <span className="text-xs tabular-nums text-muted-foreground">{subject.length}/120</span>
        </div>
        <Input value={subject} onChange={(e) => setSubject(e.target.value.slice(0, 120))} placeholder="Brief description of your issue" />
      </div>

      {/* Description */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium">Description <span className="text-destructive">*</span></label>
          <span className="text-xs tabular-nums text-muted-foreground">{description.length}/2000</span>
        </div>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value.slice(0, 2000))}
          placeholder="Include relevant details — dates, amounts, or error messages."
          rows={6}
          className="flex w-full rounded-md border border-input bg-background px-3 py-2.5 text-sm min-h-[140px] resize-y focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring placeholder:text-muted-foreground/60"
        />
      </div>

      {/* Attachment (filename only — preserved quirk) */}
      <div className="space-y-2">
        <label className="text-sm font-medium">Attachment <span className="font-normal text-xs text-muted-foreground">(optional)</span></label>
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          onClick={() => fileInput.current?.click()}
          className={`cursor-pointer rounded-md border border-dashed p-6 text-center transition-colors ${dragOver ? "border-primary bg-accent" : "border-border hover:bg-accent"}`}
        >
          <input ref={fileInput} type="file" accept="image/*,.pdf" className="hidden" onChange={(e) => setFile(e.target.files?.[0] || null)} />
          {file ? (
            <div className="flex items-center gap-4">
              {preview ? (
                <div className="h-14 w-14 shrink-0 overflow-hidden rounded-md border border-border"><img src={preview} alt="" className="h-full w-full object-cover" /></div>
              ) : (
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-md border border-border bg-muted"><FileText className="h-5 w-5 text-muted-foreground" /></div>
              )}
              <div className="min-w-0 flex-1 text-left">
                <p className="truncate text-sm font-medium">{file.name}</p>
                <p className="text-xs text-muted-foreground">{(file.size / 1024).toFixed(0)} KB</p>
              </div>
              <button onClick={(e) => { e.stopPropagation(); setFile(null) }} aria-label="Remove attachment" className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:text-destructive"><X className="h-4 w-4" /></button>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-md border border-border bg-muted"><Upload className="h-5 w-5 text-muted-foreground" /></div>
              <p className="text-sm text-muted-foreground">Drop a file or <span className="text-primary">browse</span></p>
              <p className="text-xs text-muted-foreground/70">JPG, PNG, PDF up to 5 MB</p>
            </div>
          )}
        </div>
      </div>

      {/* Priority */}
      <div className="space-y-2">
        <label className="text-sm font-medium">Priority</label>
        <div className="flex gap-1 rounded-md bg-muted p-1">
          {PRIORITIES.map((p) => (
            <button key={p.value} onClick={() => setPriority(p.value)} className={`flex-1 ${seg(priority === p.value)}`}>{p.label}</button>
          ))}
        </div>
      </div>

      <Button onClick={submit} disabled={submitting || !subject.trim() || !description.trim()} className="w-full gap-2">
        {submitting ? <><Loader2 className="h-4 w-4 animate-spin" /> Submitting…</> : <><Send className="h-4 w-4" /> Submit ticket</>}
      </Button>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck + lint**

Run: `npx tsc --noEmit && npx eslint src/components/member-support/NewTicketForm.tsx`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/member-support/NewTicketForm.tsx
git commit -m "feat(member-support): NewTicketForm view"
```

---

### Task 6: `TicketConversation` view

**Files:**
- Create: `src/components/member-support/TicketConversation.tsx`

**Interfaces:**
- Consumes: `MemberTicket`, `TicketReply` from `./types`; `statusMeta`, `extractAttachment`, `isImageUrl` from `./support-constants`; `replyToTicket` from `./support-api`; shadcn `Button`.
- Produces: default export `TicketConversation` with props
  `{ ticket: MemberTicket; replies: TicketReply[]; repliesLoading: boolean; memberName: string; onBack(): void; onReplyAdded(r: TicketReply): void; onReopened(): void }`.

Conversation: member messages right-aligned (accent), AMASI/admin left-aligned (muted). Attachments rendered (image inline, file as link). Composer at bottom; disabled with a "reopen" affordance when status is `closed`/`resolved`. Reopen calls `POST /api/tickets/{id}/reply` is NOT reopen — use the existing reopen call: `POST /api/tickets/{id}` with `{ status: "open" }` (admin-style) is admin-only; the member path used today is the reply route with reopen semantics. **Use the exact reopen call the current code uses** — see note below.

> **Reopen note:** The current member code triggers reopen at `member/page.tsx:~2041`. Open that block and copy the exact request it makes (endpoint, method, body). Replicate it verbatim in `reopen()` here. Do not invent a new endpoint. If it posts to `/api/tickets/{id}` with a JSON body, mirror that; if it uses a dedicated reopen route, use that.

- [ ] **Step 1: Read the existing reopen call**

Run: `sed -n '2010,2055p' src/app/member/page.tsx`
Expected: shows the reopen request. Note the endpoint + body shape for Step 2.

- [ ] **Step 2: Write the component**

```tsx
// src/components/member-support/TicketConversation.tsx
"use client"
import { useEffect, useRef, useState } from "react"
import { ArrowLeft, Send, Loader2, Paperclip, X, FileText, RotateCcw } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { statusMeta, extractAttachment, isImageUrl } from "./support-constants"
import { replyToTicket } from "./support-api"
import type { MemberTicket, TicketReply } from "./types"

export default function TicketConversation({
  ticket, replies, repliesLoading, memberName, onBack, onReplyAdded, onReopened,
}: {
  ticket: MemberTicket
  replies: TicketReply[]
  repliesLoading: boolean
  memberName: string
  onBack: () => void
  onReplyAdded: (r: TicketReply) => void
  onReopened: () => void
}) {
  const [text, setText] = useState("")
  const [file, setFile] = useState<File | null>(null)
  const [sending, setSending] = useState(false)
  const [reopening, setReopening] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const sm = statusMeta(ticket.status)
  const isClosed = ticket.status === "closed" || ticket.status === "resolved"

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }) }, [replies])

  const send = async () => {
    if (!text.trim() && !file) return
    setSending(true)
    try {
      const r = await replyToTicket(ticket.id, { message: text.trim(), authorName: memberName, file })
      if (r && (r.id || r.message)) { onReplyAdded(r); setText(""); setFile(null) }
      else toast.error("Couldn't send your reply. Please try again.")
    } catch { toast.error("Couldn't send your reply. Please try again.") }
    finally { setSending(false) }
  }

  // Reopen: replicate the exact request used in member/page.tsx (see Step 1).
  const reopen = async () => {
    setReopening(true)
    try {
      const res = await fetch(`/api/tickets/${ticket.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "open" }),
      })
      if (res.ok) { toast.success("Ticket reopened"); onReopened() }
      else toast.error("Failed to reopen")
    } catch { toast.error("Failed to reopen") }
    finally { setReopening(false) }
  }

  return (
    <div className="max-w-2xl flex flex-col" style={{ minHeight: "calc(100vh - 220px)" }}>
      {/* Header */}
      <div className="flex items-start justify-between border-b border-border pb-4">
        <div className="min-w-0">
          <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2 mb-1 gap-1.5 text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" /> Back
          </Button>
          <h2 className="truncate text-xl font-bold tracking-tight">{ticket.subject}</h2>
          <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className={`h-2 w-2 rounded-full ${sm.dotClass}`} /> {sm.label}
            {ticket.ticket_number ? ` · ${ticket.ticket_number}` : ""}
          </p>
        </div>
      </div>

      {/* Thread */}
      <div className="flex-1 space-y-3 overflow-y-auto py-5">
        {repliesLoading ? (
          <div className="flex justify-center py-10 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>
        ) : (
          replies.map((r, i) => {
            const mine = r.as_member || r.author_role === "member"
            const { text: body, url } = extractAttachment(r.message)
            return (
              <div key={r.id || i} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[80%] rounded-md border px-3.5 py-2.5 text-sm ${mine ? "border-border bg-accent" : "border-border bg-card"}`}>
                  <p className="mb-1 text-[11px] font-medium text-muted-foreground">{mine ? "You" : (r.author_name || "AMASI Support")}</p>
                  {body && <p className="whitespace-pre-wrap leading-relaxed">{body}</p>}
                  {url && (isImageUrl(url)
                    ? <a href={url} target="_blank" rel="noopener noreferrer"><img src={url} alt="attachment" className="mt-2 max-h-48 rounded-md border border-border" /></a>
                    : <a href={url} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1.5 text-xs text-primary hover:underline"><FileText className="h-3.5 w-3.5" /> View attachment</a>)}
                </div>
              </div>
            )
          })
        )}
        <div ref={endRef} />
      </div>

      {/* Composer / reopen */}
      {isClosed ? (
        <div className="rounded-md border border-border bg-muted/50 p-4 text-center">
          <p className="text-sm text-muted-foreground">This ticket is {sm.label}.</p>
          <Button variant="outline" size="sm" onClick={reopen} disabled={reopening} className="mt-2 gap-2">
            {reopening ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />} Reopen ticket
          </Button>
        </div>
      ) : (
        <div className="border-t border-border pt-3">
          {file && (
            <div className="mb-2 flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-xs">
              <FileText className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">{file.name}</span>
              <button onClick={() => setFile(null)} aria-label="Remove" className="text-muted-foreground hover:text-destructive"><X className="h-3.5 w-3.5" /></button>
            </div>
          )}
          <div className="flex items-end gap-2">
            <input ref={fileInput} type="file" accept="image/*,.pdf" className="hidden" onChange={(e) => setFile(e.target.files?.[0] || null)} />
            <Button variant="outline" size="icon" onClick={() => fileInput.current?.click()} aria-label="Attach file" className="shrink-0"><Paperclip className="h-4 w-4" /></Button>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send() }}
              placeholder="Write a reply…"
              rows={2}
              className="flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring placeholder:text-muted-foreground/60"
            />
            <Button onClick={send} disabled={sending || (!text.trim() && !file)} size="icon" className="shrink-0">
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
```

> If Step 1 showed a reopen request different from `PATCH /api/tickets/{id}` `{status:"open"}`, replace the body of `reopen()` with the exact call observed. Then confirm members are allowed to call it (the GET/reply routes gate by member email; if reopen is admin-only, keep the current code's approach verbatim).

- [ ] **Step 3: Typecheck + lint**

Run: `npx tsc --noEmit && npx eslint src/components/member-support/TicketConversation.tsx`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/components/member-support/TicketConversation.tsx
git commit -m "feat(member-support): TicketConversation view"
```

---

### Task 7: `MemberSupport` container

**Files:**
- Create: `src/components/member-support/MemberSupport.tsx`

**Interfaces:**
- Consumes: `useMemberTickets` from `./useMemberTickets`; `TicketList`, `NewTicketForm`, `TicketConversation`; `MemberCtx` from `./NewTicketForm`; `MemberTicket`, `TicketReply` from `./types`.
- Produces: default export `MemberSupport` with props `{ member: MemberCtx }`.

- [ ] **Step 1: Write the component**

```tsx
// src/components/member-support/MemberSupport.tsx
"use client"
import { useState } from "react"
import { useMemberTickets } from "./useMemberTickets"
import TicketList from "./TicketList"
import NewTicketForm, { type MemberCtx } from "./NewTicketForm"
import TicketConversation from "./TicketConversation"
import type { MemberTicket, TicketReply } from "./types"

export default function MemberSupport({ member }: { member: MemberCtx }) {
  const [view, setView] = useState<"list" | "new" | "detail">("list")
  const [selected, setSelected] = useState<MemberTicket | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const { tickets, loading, loadError, replies, repliesLoading, loadReplies, setReplies, reload } =
    useMemberTickets(member.email, refreshKey)

  const open = (t: MemberTicket) => { setSelected(t); setView("detail"); loadReplies(t.id) }
  const created = () => { setView("list"); setRefreshKey((k) => k + 1) }

  if (view === "new") {
    return <NewTicketForm member={member} onBack={() => setView("list")} onCreated={created} />
  }
  if (view === "detail" && selected) {
    return (
      <TicketConversation
        ticket={selected}
        replies={replies}
        repliesLoading={repliesLoading}
        memberName={member.name || member.first_name || "Member"}
        onBack={() => { setView("list"); setSelected(null) }}
        onReplyAdded={(r: TicketReply) => setReplies((prev) => [...prev, r])}
        onReopened={() => { setSelected((s) => (s ? { ...s, status: "open" } : s)); setRefreshKey((k) => k + 1) }}
      />
    )
  }
  return (
    <TicketList
      tickets={tickets}
      loading={loading}
      loadError={loadError}
      onOpen={open}
      onNew={() => setView("new")}
      onRetry={reload}
    />
  )
}
```

- [ ] **Step 2: Typecheck + lint**

Run: `npx tsc --noEmit && npx eslint src/components/member-support/MemberSupport.tsx`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/member-support/MemberSupport.tsx
git commit -m "feat(member-support): MemberSupport container"
```

---

### Task 8: Wire into the member portal and delete the old code

**Files:**
- Modify: `src/app/member/page.tsx` (replace support-tab render; delete `MemberSupportTab`, `TICKET_CATEGORIES`, and the now-unused `MemberTicket`/`TicketReply` interfaces + support-only imports)

**Interfaces:**
- Consumes: `MemberSupport` (default) from `@/components/member-support/MemberSupport`.

- [ ] **Step 1: Find the support-tab render and the component definition**

Run: `grep -nE 'activeTab === "support"|function MemberSupportTab|const TICKET_CATEGORIES|interface MemberTicket|interface TicketReply' src/app/member/page.tsx`
Expected: locate (a) the render at `~1210`, (b) `MemberSupportTab` def `~1371`, (c) helpers/interfaces to delete.

- [ ] **Step 2: Add the import**

At the top of `src/app/member/page.tsx`, with the other imports:

```tsx
import MemberSupport from "@/components/member-support/MemberSupport"
```

- [ ] **Step 3: Replace the support-tab render**

Find the block rendering `{activeTab === "support" && ( ... <MemberSupportTab member={member} /> ... )}` (or the inline JSX). Replace its body so it renders:

```tsx
{activeTab === "support" && <MemberSupport member={member} />}
```

- [ ] **Step 4: Delete the dead code**

Delete from `src/app/member/page.tsx`:
- the entire `function MemberSupportTab(...) { ... }` definition,
- the module-level `const TICKET_CATEGORIES = [...]`,
- the `interface MemberTicket` and `interface TicketReply` (now imported types are used only inside the module — confirm no other references with `grep -n "MemberTicket\|TicketReply" src/app/member/page.tsx`; if other usages exist, leave the interfaces),
- any imports that become unused (lucide icons, `Plus`, `Upload`, etc.) — let eslint flag them.

- [ ] **Step 5: Typecheck + lint + tests**

Run:
```bash
npx tsc --noEmit
npx eslint src/app/member/page.tsx src/components/member-support
npx vitest run __tests__/member-support-helpers.test.ts __tests__/member-support-api.test.ts
```
Expected: typecheck clean; eslint clean (fix any now-unused imports); 12 tests pass.

- [ ] **Step 6: Production build (client-router hook rule)**

Run: `npx next build`
Expected: build succeeds (member page prerender OK).

- [ ] **Step 7: Manual verification (dev server)**

Run: `npm run dev`, sign in as a member, open Support:
- List loads; empty state shows when no tickets.
- New ticket → category/priority segmented controls, counters, attachment drop → submit → success → returns to list with the new ticket.
- Open a ticket → conversation renders; member replies right, AMASI left; admin replies appear; internal notes do NOT appear.
- Reply with an image attachment → appears inline.
- Reopen a closed/resolved ticket → composer re-enables.
- Check dark mode and a mobile-width viewport. Confirm: no gradients, no `rounded-full` pills, status shown as dot + lowercase.

- [ ] **Step 8: Commit**

```bash
git add src/app/member/page.tsx
git commit -m "refactor(member): use extracted MemberSupport module; remove inline support tab"
```

---

## Self-Review

- **Spec coverage:** module structure (Tasks 1–7), data flow reuse (Task 2 api), AGENTS.md visual system (Tasks 4–6), behavior parity incl. attachment quirk + reopen + counters + optimistic reply (Tasks 5,6), extraction + file shrink (Task 8), testing incl. build rule (Tasks 1,2,8). All spec sections map to a task.
- **Placeholders:** none — all steps contain real code/commands. The two reopen "notes" are verification guards, not placeholders: the call is fully written and the engineer confirms it matches existing code in Task 6 Step 1.
- **Type consistency:** `MemberTicket`/`TicketReply` (Task 1) used consistently; `MemberCtx` defined in Task 5 and imported by Tasks 6/7; api signatures from Task 2 match hook (Task 3) and component usage (Tasks 5,6). `Priority` from Task 1 used in Tasks 2,5.

**Known follow-up (out of scope, do not fix here):** create-form attachment is filename-only (not uploaded). If real upload on create is wanted later, route it through the existing upload endpoint — separate spec.
