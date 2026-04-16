"use client"

import { useEffect, useMemo, type JSX } from "react"
import { useQuery } from "@tanstack/react-query"
import {
  Activity,
  ArrowUpCircle,
  CheckCircle2,
  FileEdit,
  FileText,
  LogIn,
  MailQuestion,
  MessageSquare,
  RotateCcw,
  StickyNote,
  X,
  XCircle,
} from "lucide-react"
import { cn } from "@/lib/utils"

export interface AdminActivityAdmin {
  id: string
  name: string
  email: string
  role?: string
  last_login?: string | null
}

export interface AdminActivityPanelProps {
  admin: AdminActivityAdmin | null
  open: boolean
  onClose: () => void
}

interface AuditEntry {
  id: string
  admin_email: string
  admin_name: string | null
  action: string
  entity_type: string
  entity_id: string | null
  entity_name: string | null
  details: Record<string, unknown> | null
  ip_address: string | null
  created_at: string
}

interface FeedResponse {
  data: AuditEntry[]
  total: number
}

interface SummaryResponse {
  summary: Record<string, number>
  total: number
}

type ActionMeta = {
  label: string
  icon: typeof CheckCircle2
  color: string
  bg: string
}

const ACTION_META: Record<string, ActionMeta> = {
  login: { label: "Logged in", icon: LogIn, color: "text-blue-600", bg: "bg-blue-50" },
  approve_application: {
    label: "Approved application",
    icon: CheckCircle2,
    color: "text-emerald-600",
    bg: "bg-emerald-50",
  },
  reject_application: {
    label: "Rejected application",
    icon: XCircle,
    color: "text-red-600",
    bg: "bg-red-50",
  },
  request_clarification: {
    label: "Requested clarification",
    icon: MailQuestion,
    color: "text-blue-600",
    bg: "bg-blue-50",
  },
  request_resubmit: {
    label: "Requested resubmit",
    icon: RotateCcw,
    color: "text-amber-600",
    bg: "bg-amber-50",
  },
  add_internal_note: {
    label: "Added note",
    icon: StickyNote,
    color: "text-slate-600",
    bg: "bg-slate-100",
  },
  approve_upgrade: {
    label: "Approved upgrade",
    icon: ArrowUpCircle,
    color: "text-emerald-600",
    bg: "bg-emerald-50",
  },
  reject_upgrade: {
    label: "Rejected upgrade",
    icon: XCircle,
    color: "text-red-600",
    bg: "bg-red-50",
  },
  reply_ticket: {
    label: "Replied to ticket",
    icon: MessageSquare,
    color: "text-blue-600",
    bg: "bg-blue-50",
  },
  close_ticket: {
    label: "Closed ticket",
    icon: CheckCircle2,
    color: "text-slate-600",
    bg: "bg-slate-100",
  },
  update_ticket_status: {
    label: "Updated ticket",
    icon: FileEdit,
    color: "text-violet-600",
    bg: "bg-violet-50",
  },
}

function metaFor(action: string): ActionMeta {
  return (
    ACTION_META[action] || {
      label: action,
      icon: FileText,
      color: "text-slate-600",
      bg: "bg-slate-100",
    }
  )
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return "just now"
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d}d ago`
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  })
}

function initialsOf(name: string, email: string): string {
  const base = (name || email || "?").trim()
  const parts = base.split(/\s+/).filter(Boolean)
  if (parts.length === 0) return "?"
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

export function AdminActivityPanel(props: AdminActivityPanelProps): JSX.Element | null {
  const { admin, open, onClose } = props

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, onClose])

  const { data: feed, isLoading: feedLoading } = useQuery({
    queryKey: ["admin-activity", admin?.email, "feed"],
    enabled: !!admin?.email && open,
    queryFn: async () => {
      const res = await fetch(
        `/api/audit?adminEmail=${encodeURIComponent(admin!.email)}&limit=50`,
      )
      if (!res.ok) throw new Error("Failed")
      return res.json() as Promise<FeedResponse>
    },
  })

  const { data: summary, isLoading: sumLoading } = useQuery({
    queryKey: ["admin-activity", admin?.email, "summary"],
    enabled: !!admin?.email && open,
    queryFn: async () => {
      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
      const res = await fetch(
        `/api/audit?adminEmail=${encodeURIComponent(admin!.email)}&summary=true&since=${since}`,
      )
      if (!res.ok) throw new Error("Failed")
      return res.json() as Promise<SummaryResponse>
    },
  })

  const stats = useMemo(() => {
    const map = summary?.summary ?? {}
    const entries = Object.entries(map).sort((a, b) => b[1] - a[1])
    const topEntry = entries[0]
    const topAction = topEntry
      ? { action: topEntry[0], label: metaFor(topEntry[0]).label, count: topEntry[1] }
      : null
    const approvals = (map.approve_application ?? 0) + (map.approve_upgrade ?? 0)
    const logins = map.login ?? 0
    const total = summary?.total ?? entries.reduce((acc, [, v]) => acc + v, 0)
    return { total, topAction, approvals, logins }
  }, [summary])

  if (!open || !admin) return null

  const initials = initialsOf(admin.name, admin.email)

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        role="dialog"
        aria-label={`Activity for ${admin.name || admin.email}`}
        className="fixed right-0 top-0 z-50 h-full w-full sm:w-[480px] bg-white shadow-2xl overflow-y-auto animate-in slide-in-from-right duration-300 admin-activity-panel-slide-in"
      >
        {/* Header */}
        <header className="relative bg-gradient-to-br from-teal-500 to-emerald-600 text-white p-6">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close panel"
            className="absolute right-4 top-4 rounded-full p-1.5 text-white/90 hover:bg-white/20 hover:text-white transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
          <div className="flex items-start gap-4">
            <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-full bg-white text-teal-700 text-lg font-semibold ring-2 ring-white/60 shadow">
              {initials}
            </div>
            <div className="min-w-0 flex-1 pr-8">
              <div className="text-xl font-semibold text-white truncate">
                {admin.name || admin.email}
              </div>
              <div className="text-sm text-white/80 truncate">{admin.email}</div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {admin.role ? (
                  <span className="inline-flex items-center rounded-full bg-white/20 px-2.5 py-0.5 text-xs font-medium text-white">
                    {admin.role}
                  </span>
                ) : null}
                {admin.last_login ? (
                  <span className="text-xs text-white/70">
                    Last login {relativeTime(admin.last_login)}
                  </span>
                ) : (
                  <span className="text-xs text-white/70">No login recorded</span>
                )}
              </div>
            </div>
          </div>
        </header>

        {/* Body */}
        <div className="p-6 space-y-6">
          {/* Summary */}
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-3">
              Last 30 days
            </h3>
            {sumLoading ? (
              <div className="grid grid-cols-2 gap-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div
                    key={i}
                    className="h-20 rounded-xl border border-slate-200 bg-slate-50 animate-pulse"
                  />
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <StatTile
                  label="Total actions"
                  value={String(stats.total ?? 0)}
                />
                <StatTile
                  label="Top action"
                  value={stats.topAction ? stats.topAction.label : "—"}
                  sub={
                    stats.topAction ? `${stats.topAction.count} times` : undefined
                  }
                />
                <StatTile label="Approvals" value={String(stats.approvals)} />
                <StatTile label="Logins" value={String(stats.logins)} />
              </div>
            )}
          </section>

          {/* Timeline */}
          <section>
            <h3 className="text-sm font-semibold text-slate-800 mb-3">
              Recent activity (last 50)
            </h3>

            {feedLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="flex items-start gap-3">
                    <div className="h-10 w-10 rounded-full bg-slate-100 animate-pulse" />
                    <div className="flex-1 space-y-2 py-1">
                      <div className="h-3 w-3/4 rounded bg-slate-100 animate-pulse" />
                      <div className="h-3 w-1/2 rounded bg-slate-100 animate-pulse" />
                    </div>
                  </div>
                ))}
              </div>
            ) : !feed || feed.data.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50/50 py-10 text-center">
                <Activity className="h-8 w-8 text-slate-400" />
                <p className="mt-2 text-sm font-medium text-slate-600">
                  No activity recorded yet
                </p>
                <p className="text-xs text-slate-500">
                  This admin has not performed any tracked actions.
                </p>
              </div>
            ) : (
              <ol className="relative space-y-4 border-l border-slate-200 pl-5">
                {feed.data.map((entry) => {
                  const meta = metaFor(entry.action)
                  const Icon = meta.icon
                  const entity =
                    entry.entity_name ||
                    entry.entity_id ||
                    entry.entity_type ||
                    null
                  return (
                    <li key={entry.id} className="relative">
                      <span
                        className={cn(
                          "absolute -left-[34px] flex h-7 w-7 items-center justify-center rounded-full ring-4 ring-white",
                          meta.bg,
                        )}
                      >
                        <Icon className={cn("h-3.5 w-3.5", meta.color)} />
                      </span>
                      <div className="rounded-lg border border-slate-100 bg-white p-3 shadow-sm">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm font-medium text-slate-800">
                            {meta.label}
                          </p>
                          <time
                            className="flex-shrink-0 text-xs text-slate-500"
                            dateTime={entry.created_at}
                          >
                            {relativeTime(entry.created_at)}
                          </time>
                        </div>
                        {entity ? (
                          <p className="mt-0.5 text-xs text-slate-500 truncate">
                            {entity}
                          </p>
                        ) : null}
                      </div>
                    </li>
                  )
                })}
              </ol>
            )}
          </section>
        </div>
      </aside>
    </>
  )
}

function StatTile(props: { label: string; value: string; sub?: string }): JSX.Element {
  const { label, value, sub } = props
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className="mt-1 text-xl font-semibold text-slate-900 truncate">
        {value}
      </div>
      {sub ? <div className="mt-0.5 text-xs text-slate-500">{sub}</div> : null}
    </div>
  )
}
