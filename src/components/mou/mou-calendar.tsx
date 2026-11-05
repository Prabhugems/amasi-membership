"use client"

import { useMemo, useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { ChevronLeft, ChevronRight, Loader2, AlertTriangle, Plus, CalendarDays } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { getEventTypeConfig } from "@/lib/mou/event-type-config"
import type { AcademicEventApplication } from "@/lib/mou/types"
import {
  CALENDAR_CATEGORIES,
  CALENDAR_CATEGORY_LABELS,
  ZONES,
  buildCalendarItems,
  findClashes,
  isZone,
  itemsOnDay,
  monthGrid,
  monthRange,
  toIsoDate,
  type CalendarCategory,
  type CalendarEntry,
  type CalendarItem,
  type Zone,
} from "@/lib/mou/calendar"
import { cn } from "@/lib/utils"

// Calendar view for /admin/mou-applications. Shows approved/completed MOU
// applications (passed in by the page, which already fetches that set) plus
// admin-added endorsed events (fetched here from /api/admin/mou-calendar).
// Filled dot = MOU application, hollow dot = endorsed event.

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
const MAX_CHIPS_PER_DAY = 3

interface EntriesResponse {
  status: boolean
  entries: CalendarEntry[]
}

interface FormState {
  title: string
  category: CalendarCategory
  start_date: string
  end_date: string
  organizer: string
  city: string
  state: string
  zone: Zone | ""
  notes: string
}

function emptyForm(startDate: string): FormState {
  return { title: "", category: "endorsed", start_date: startDate, end_date: "", organizer: "", city: "", state: "", zone: "", notes: "" }
}

function formFromEntry(entry: CalendarEntry): FormState {
  return {
    title: entry.title,
    category: entry.category,
    start_date: entry.start_date,
    end_date: entry.end_date ?? "",
    organizer: entry.organizer ?? "",
    city: entry.city ?? "",
    state: entry.state ?? "",
    zone: entry.zone ?? "",
    notes: entry.notes ?? "",
  }
}

function todayIso(): string {
  const now = new Date()
  return toIsoDate(now.getFullYear(), now.getMonth(), now.getDate())
}

function formatShort(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })
}

function itemDateLabel(item: CalendarItem): string {
  return item.startDate === item.endDate ? formatShort(item.startDate) : `${formatShort(item.startDate)} – ${formatShort(item.endDate)}`
}

function kindLabel(item: CalendarItem): string {
  if (item.source === "endorsed") return CALENDAR_CATEGORY_LABELS[item.kind as CalendarCategory] ?? "Endorsed event"
  return getEventTypeConfig(item.kind)?.label ?? item.kind
}

function Dot({ item }: { item: CalendarItem }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-block h-2 w-2 shrink-0 rounded-full border",
        item.cancelled
          ? "border-muted-foreground bg-muted-foreground/40"
          : item.source === "mou"
            ? "border-primary bg-primary"
            : "border-primary bg-transparent"
      )}
    />
  )
}

// Shown next to an event that shares a zone and dates with another one.
function ClashMark({ others }: { others: CalendarItem[] }) {
  return (
    <span title={`Clashes with: ${others.map((o) => o.title).join("; ")}`} className="inline-flex shrink-0">
      <AlertTriangle className="h-3 w-3 text-warning" aria-label="Date clash in the same zone" />
    </span>
  )
}

interface MouCalendarProps {
  applications: AcademicEventApplication[]
  isLoading: boolean
  isError: boolean
  onOpenApplication: (id: string) => void
}

export function MouCalendar({ applications, isLoading, isError, onOpenApplication }: MouCalendarProps) {
  const queryClient = useQueryClient()
  const today = todayIso()
  const [cursor, setCursor] = useState(() => {
    const now = new Date()
    return { year: now.getFullYear(), month: now.getMonth() }
  })
  // null = closed. `editing` set = edit that entry; otherwise create.
  const [dialog, setDialog] = useState<{ editing: CalendarEntry | null; startDate: string } | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<CalendarEntry | null>(null)
  // "" = all zones, "none" = events with no zone set.
  const [zoneFilter, setZoneFilter] = useState<"" | Zone | "none">("")

  const { from, to } = monthRange(cursor.year, cursor.month)

  const entriesQuery = useQuery<EntriesResponse>({
    queryKey: ["mou-calendar-entries", from, to],
    queryFn: async () => {
      const res = await fetch(`/api/admin/mou-calendar?from=${from}&to=${to}`)
      if (!res.ok) throw new Error("Failed to load endorsed events")
      return res.json()
    },
  })

  const entries = useMemo(() => entriesQuery.data?.entries ?? [], [entriesQuery.data])
  const allItems = useMemo(() => buildCalendarItems(applications, entries), [applications, entries])
  // Clashes are found across everything, so the markers stay right while filtered.
  const clashes = useMemo(() => findClashes(allItems), [allItems])
  const items = useMemo(
    () =>
      zoneFilter === ""
        ? allItems
        : allItems.filter((i) => (zoneFilter === "none" ? i.zone === null : i.zone === zoneFilter)),
    [allItems, zoneFilter]
  )
  const cells = useMemo(() => monthGrid(cursor.year, cursor.month), [cursor])
  const monthItems = useMemo(() => items.filter((i) => i.startDate <= to && i.endDate >= from), [items, from, to])

  const monthTitle = new Date(Date.UTC(cursor.year, cursor.month, 1)).toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  })

  function shiftMonth(delta: number) {
    setCursor((c) => {
      const d = new Date(Date.UTC(c.year, c.month + delta, 1))
      return { year: d.getUTCFullYear(), month: d.getUTCMonth() }
    })
  }

  function openItem(item: CalendarItem) {
    if (item.source === "mou") {
      onOpenApplication(item.id)
      return
    }
    const entry = entries.find((e) => e.id === item.id)
    if (entry) setDialog({ editing: entry, startDate: entry.start_date })
  }

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/admin/mou-calendar/${id}`, { method: "DELETE" })
      if (!res.ok) {
        const json = await res.json().catch(() => null)
        throw new Error(json?.message || "Failed to delete event")
      }
    },
    onSuccess: () => {
      toast.success("Event removed from the calendar")
      setConfirmDelete(null)
      setDialog(null)
      queryClient.invalidateQueries({ queryKey: ["mou-calendar-entries"] })
    },
    onError: (err: Error) => toast.error(err.message),
  })

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <Button variant="outline" size="sm" className="h-8 w-8 p-0" aria-label="Previous month" onClick={() => shiftMonth(-1)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" className="h-8 w-8 p-0" aria-label="Next month" onClick={() => shiftMonth(1)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-xs"
            onClick={() => {
              const now = new Date()
              setCursor({ year: now.getFullYear(), month: now.getMonth() })
            }}
          >
            Today
          </Button>
        </div>
        <h2 className="text-sm font-medium">{monthTitle}</h2>
        <select
          value={zoneFilter}
          aria-label="Filter by zone"
          onChange={(e) => setZoneFilter(e.target.value as "" | Zone | "none")}
          className="text-xs h-8 border rounded-md px-2 bg-background hover:bg-muted/50 focus:outline-none focus:ring-2 focus:ring-primary/20"
        >
          <option value="">All zones</option>
          {ZONES.map((z) => (
            <option key={z} value={z}>
              {z}
            </option>
          ))}
          <option value="none">No zone set</option>
        </select>
        <div className="ml-auto flex items-center gap-4">
          <div className="hidden lg:flex items-center gap-3 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden="true" className="inline-block h-2 w-2 rounded-full border border-primary bg-primary" />
              MOU application
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden="true" className="inline-block h-2 w-2 rounded-full border border-primary bg-transparent" />
              Endorsed event
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden="true" className="inline-block h-2 w-2 rounded-full border border-muted-foreground bg-muted-foreground/40" />
              Cancelled
            </span>
            <span className="inline-flex items-center gap-1.5">
              <AlertTriangle className="h-3 w-3 text-warning" aria-hidden="true" />
              Same-zone clash
            </span>
          </div>
          <Button size="sm" className="h-8 text-xs gap-1" onClick={() => setDialog({ editing: null, startDate: today })}>
            <Plus className="h-3.5 w-3.5" />
            Add endorsed event
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="border rounded-md p-16 text-center bg-card">
          <Loader2 className="h-8 w-8 animate-spin mx-auto text-muted-foreground" />
          <p className="text-sm text-muted-foreground mt-3">Loading calendar…</p>
        </div>
      ) : isError ? (
        <div className="border rounded-md p-12 text-center bg-card">
          <AlertTriangle className="h-8 w-8 mx-auto text-destructive" />
          <p className="font-semibold mt-2">Failed to load</p>
          <p className="text-sm text-muted-foreground mt-1">Try refreshing the page.</p>
        </div>
      ) : (
        <>
          {entriesQuery.isError && (
            <p role="alert" className="text-xs text-destructive">
              Endorsed events could not be loaded — only MOU applications are shown.
            </p>
          )}

          <div className="border rounded-md overflow-hidden bg-card">
            <div className="grid grid-cols-7 border-b bg-muted/40">
              {WEEKDAYS.map((d) => (
                <div key={d} className="px-2 py-2 text-xs uppercase tracking-wider text-muted-foreground">
                  {d}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7">
              {cells.map((iso, idx) => {
                if (!iso) {
                  return <div key={`pad-${idx}`} className="min-h-24 border-b border-r bg-muted/20 last:border-r-0" />
                }
                const dayItems = itemsOnDay(items, iso)
                const shown = dayItems.slice(0, MAX_CHIPS_PER_DAY)
                const extra = dayItems.length - shown.length
                const isToday = iso === today
                return (
                  <div key={iso} className="group relative min-h-24 border-b border-r p-1.5">
                    <div className="flex items-center justify-between">
                      <span
                        className={cn(
                          "inline-flex h-5 min-w-5 items-center justify-center rounded-md px-1 text-xs tabular-nums",
                          isToday ? "bg-primary text-primary-foreground" : "text-muted-foreground"
                        )}
                      >
                        {Number(iso.slice(8))}
                      </span>
                      <button
                        type="button"
                        aria-label={`Add event on ${formatShort(iso)}`}
                        onClick={() => setDialog({ editing: null, startDate: iso })}
                        className="rounded-md p-0.5 text-muted-foreground opacity-0 hover:bg-muted focus-visible:opacity-100 group-hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                      >
                        <Plus className="h-3 w-3" />
                      </button>
                    </div>
                    <div className="mt-1 space-y-0.5">
                      {shown.map((item) => (
                        <button
                          key={item.key}
                          type="button"
                          title={item.title}
                          onClick={() => openItem(item)}
                          className="flex w-full items-center gap-1.5 rounded-md px-1 py-0.5 text-left text-xs hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                        >
                          <Dot item={item} />
                          <span className={cn("truncate", item.cancelled && "text-muted-foreground line-through")}>{item.title}</span>
                          {clashes.has(item.key) && <ClashMark others={clashes.get(item.key) ?? []} />}
                        </button>
                      ))}
                      {extra > 0 && <p className="px-1 text-xs text-muted-foreground">+{extra} more</p>}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          <div className="border rounded-md bg-card">
            <div className="border-b px-4 py-2.5 text-xs uppercase tracking-wider text-muted-foreground">
              This month · {monthItems.length}
            </div>
            {monthItems.length === 0 ? (
              <div className="p-10 text-center">
                <div className="h-10 w-10 rounded-md bg-muted border flex items-center justify-center mx-auto mb-3">
                  <CalendarDays className="h-5 w-5 text-muted-foreground" />
                </div>
                <p className="text-sm text-muted-foreground">Nothing scheduled this month.</p>
              </div>
            ) : (
              <ul className="divide-y">
                {monthItems.map((item) => (
                  <li key={item.key}>
                    <button
                      type="button"
                      onClick={() => openItem(item)}
                      className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                    >
                      <Dot item={item} />
                      <span className="w-28 shrink-0 text-xs tabular-nums text-muted-foreground">{itemDateLabel(item)}</span>
                      <span className="min-w-0 flex-1">
                        <span
                          className={cn(
                            "block truncate text-sm font-medium",
                            item.cancelled && "text-muted-foreground line-through"
                          )}
                        >
                          {item.title}
                        </span>
                        {item.subtitle && <span className="block truncate text-xs text-muted-foreground">{item.subtitle}</span>}
                        {clashes.has(item.key) && (
                          <span className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                            <ClashMark others={clashes.get(item.key) ?? []} />
                            Clashes with {(clashes.get(item.key) ?? []).map((o) => o.title).join("; ")}
                          </span>
                        )}
                      </span>
                      <span className="hidden shrink-0 text-right text-xs text-muted-foreground sm:block">
                        {item.cancelled ? "Cancelled" : kindLabel(item)}
                        {item.zone && <span className="block">{item.zone} zone</span>}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}

      {dialog && (
        <EntryDialog
          // Remount per target so the form state always starts from the right entry.
          key={dialog.editing?.id ?? `new-${dialog.startDate}`}
          editing={dialog.editing}
          startDate={dialog.startDate}
          onClose={() => setDialog(null)}
          onDelete={(entry) => setConfirmDelete(entry)}
        />
      )}

      <ConfirmDialog
        open={confirmDelete !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmDelete(null)
        }}
        title="Remove this event?"
        description={confirmDelete ? `“${confirmDelete.title}” will be removed from the calendar. This cannot be undone.` : undefined}
        confirmLabel="Remove"
        variant="destructive"
        isPending={deleteMutation.isPending}
        onConfirm={() => {
          if (confirmDelete) deleteMutation.mutate(confirmDelete.id)
        }}
      />
    </div>
  )
}

function EntryDialog({
  editing,
  startDate,
  onClose,
  onDelete,
}: {
  editing: CalendarEntry | null
  startDate: string
  onClose: () => void
  onDelete: (entry: CalendarEntry) => void
}) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState<FormState>(() => (editing ? formFromEntry(editing) : emptyForm(startDate)))

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(editing ? `/api/admin/mou-calendar/${editing.id}` : "/api/admin/mou-calendar", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, end_date: form.end_date || null, zone: form.zone || null }),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => null)
        throw new Error(json?.message || "Failed to save event")
      }
    },
    onSuccess: () => {
      toast.success(editing ? "Event updated" : "Event added to the calendar")
      queryClient.invalidateQueries({ queryKey: ["mou-calendar-entries"] })
      onClose()
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const canSave = form.title.trim().length > 0 && form.start_date.length > 0 && (!form.end_date || form.end_date >= form.start_date)

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit endorsed event" : "Add endorsed event"}</DialogTitle>
          <DialogDescription>
            For events AMASI has endorsed that did not come through an MOU application.
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault()
            if (canSave && !saveMutation.isPending) saveMutation.mutate()
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="cal-title">Event name</Label>
            <Input id="cal-title" value={form.title} maxLength={200} onChange={(e) => set("title", e.target.value)} autoFocus />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="cal-start">Start date</Label>
              <Input id="cal-start" type="date" value={form.start_date} onChange={(e) => set("start_date", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cal-end">End date (optional)</Label>
              <Input id="cal-end" type="date" min={form.start_date} value={form.end_date} onChange={(e) => set("end_date", e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="cal-category">Type</Label>
              <select
                id="cal-category"
                value={form.category}
                onChange={(e) => set("category", e.target.value as CalendarCategory)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {CALENDAR_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {CALENDAR_CATEGORY_LABELS[c]}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cal-zone">Zone</Label>
              <select
                id="cal-zone"
                value={form.zone}
                onChange={(e) => set("zone", isZone(e.target.value) ? e.target.value : "")}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="">Not set</option>
                {ZONES.map((z) => (
                  <option key={z} value={z}>
                    {z}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cal-organizer">Organiser</Label>
            <Input id="cal-organizer" value={form.organizer} maxLength={200} onChange={(e) => set("organizer", e.target.value)} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="cal-city">City</Label>
              <Input id="cal-city" value={form.city} maxLength={100} onChange={(e) => set("city", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cal-state">State</Label>
              <Input id="cal-state" value={form.state} maxLength={100} onChange={(e) => set("state", e.target.value)} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cal-notes">Notes</Label>
            <Textarea id="cal-notes" rows={3} value={form.notes} maxLength={2000} onChange={(e) => set("notes", e.target.value)} />
          </div>

          <div className="flex items-center justify-between pt-2">
            {editing ? (
              <Button type="button" variant="ghost" size="sm" className="text-destructive" onClick={() => onDelete(editing)}>
                Remove
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={saveMutation.isPending}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={!canSave || saveMutation.isPending}>
                {saveMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                    Saving…
                  </>
                ) : editing ? (
                  "Save changes"
                ) : (
                  "Add to calendar"
                )}
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
