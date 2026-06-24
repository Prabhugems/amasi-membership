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
