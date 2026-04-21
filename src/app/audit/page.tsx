"use client"

import { useQuery } from "@tanstack/react-query"
import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  ScrollText,
  Loader2,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  XCircle,
  MessageSquare,
  ArrowUpCircle,
  HelpCircle,
  FileEdit,
  MailQuestion,
  RotateCcw,
  StickyNote,
} from "lucide-react"

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

const ACTION_CONFIG: Record<string, { label: string; icon: typeof CheckCircle2; color: string; bg: string }> = {
  approve_application: { label: "Approved Application", icon: CheckCircle2, color: "text-emerald-600 dark:text-emerald-300", bg: "bg-emerald-50 dark:bg-emerald-500/15" },
  reject_application: { label: "Rejected Application", icon: XCircle, color: "text-red-600 dark:text-red-300", bg: "bg-red-50 dark:bg-red-500/15" },
  request_clarification: { label: "Requested Clarification", icon: MailQuestion, color: "text-blue-600 dark:text-blue-300", bg: "bg-blue-50 dark:bg-blue-500/15" },
  request_resubmit: { label: "Requested Resubmission", icon: RotateCcw, color: "text-amber-600 dark:text-amber-300", bg: "bg-amber-50 dark:bg-amber-500/15" },
  add_internal_note: { label: "Added Internal Note", icon: StickyNote, color: "text-gray-600 dark:text-gray-300", bg: "bg-gray-50 dark:bg-gray-500/15" },
  approve_upgrade: { label: "Approved Upgrade", icon: ArrowUpCircle, color: "text-emerald-600 dark:text-emerald-300", bg: "bg-emerald-50 dark:bg-emerald-500/15" },
  reject_upgrade: { label: "Rejected Upgrade", icon: XCircle, color: "text-red-600 dark:text-red-300", bg: "bg-red-50 dark:bg-red-500/15" },
  reply_ticket: { label: "Replied to Ticket", icon: MessageSquare, color: "text-blue-600 dark:text-blue-300", bg: "bg-blue-50 dark:bg-blue-500/15" },
  close_ticket: { label: "Closed Ticket", icon: CheckCircle2, color: "text-gray-600 dark:text-gray-300", bg: "bg-gray-50 dark:bg-gray-500/15" },
  update_ticket_status: { label: "Updated Ticket Status", icon: FileEdit, color: "text-violet-600 dark:text-violet-300", bg: "bg-violet-50 dark:bg-violet-500/15" },
}

const ENTITY_TYPES = ["application", "member", "ticket", "upgrade", "notification"]
const ACTIONS = Object.keys(ACTION_CONFIG)

const PAGE_SIZE = 30

function formatDateTime(dateStr: string): string {
  const d = new Date(dateStr)
  return d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }) + " " + d.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  })
}

function formatRelativeTime(dateStr: string): string {
  const now = new Date()
  const date = new Date(dateStr)
  const diffMs = now.getTime() - date.getTime()
  const diffMin = Math.floor(diffMs / 60000)
  if (diffMin < 1) return "Just now"
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  const diffDays = Math.floor(diffHr / 24)
  if (diffDays === 1) return "Yesterday"
  if (diffDays < 7) return `${diffDays}d ago`
  return formatDateTime(dateStr)
}

export default function AuditPage() {
  const [actionFilter, setActionFilter] = useState("")
  const [entityTypeFilter, setEntityTypeFilter] = useState("")
  const [page, setPage] = useState(0)

  const offset = page * PAGE_SIZE

  const { data, isLoading, isError } = useQuery<{ data: AuditEntry[]; total: number }>({
    queryKey: ["audit-log", actionFilter, entityTypeFilter, page],
    queryFn: async () => {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(offset),
      })
      if (actionFilter) params.set("action", actionFilter)
      if (entityTypeFilter) params.set("entityType", entityTypeFilter)
      const res = await fetch(`/api/audit?${params}`)
      if (!res.ok) throw new Error("Failed to fetch audit log")
      return res.json()
    },
    refetchInterval: 30000,
  })

  const entries = data?.data ?? []
  const total = data?.total ?? 0
  const totalPages = Math.ceil(total / PAGE_SIZE)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-violet-100 dark:bg-violet-500/20">
            <ScrollText className="h-5 w-5 text-violet-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Activity Log</h1>
            <p className="text-sm text-muted-foreground">
              {total.toLocaleString()} recorded action{total !== 1 ? "s" : ""}
            </p>
          </div>
        </div>
      </div>

      {/* Filters */}
      <Card className="border-0 shadow-sm">
        <CardContent className="pt-6">
          <div className="flex flex-wrap gap-3">
            <select
              value={actionFilter}
              onChange={(e) => { setActionFilter(e.target.value); setPage(0) }}
              className="rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">All Actions</option>
              {ACTIONS.map((a) => (
                <option key={a} value={a}>
                  {ACTION_CONFIG[a]?.label || a}
                </option>
              ))}
            </select>
            <select
              value={entityTypeFilter}
              onChange={(e) => { setEntityTypeFilter(e.target.value); setPage(0) }}
              className="rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">All Entity Types</option>
              {ENTITY_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </option>
              ))}
            </select>
            {(actionFilter || entityTypeFilter) && (
              <button
                onClick={() => { setActionFilter(""); setEntityTypeFilter(""); setPage(0) }}
                className="rounded-lg border px-3 py-2 text-sm text-muted-foreground hover:bg-accent transition-colors"
              >
                Clear filters
              </button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-0">
          <CardTitle className="text-base font-semibold">Audit Entries</CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : isError ? (
            <div className="flex flex-col items-center justify-center py-16 gap-2 text-muted-foreground">
              <AlertCircle className="h-8 w-8" />
              <p className="text-sm">Failed to load audit log</p>
            </div>
          ) : entries.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-2 text-muted-foreground">
              <ScrollText className="h-8 w-8" />
              <p className="text-sm">No activity recorded yet</p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b text-xs text-muted-foreground">
                      <th scope="col" className="pb-3 text-left font-medium">Date</th>
                      <th scope="col" className="pb-3 text-left font-medium">Admin</th>
                      <th scope="col" className="pb-3 text-left font-medium">Action</th>
                      <th scope="col" className="pb-3 text-left font-medium hidden md:table-cell">Entity</th>
                      <th scope="col" className="pb-3 text-left font-medium hidden lg:table-cell">Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((entry) => {
                      const config = ACTION_CONFIG[entry.action] || {
                        label: entry.action,
                        icon: HelpCircle,
                        color: "text-gray-500",
                        bg: "bg-gray-50 dark:bg-gray-500/15",
                      }
                      const IconComp = config.icon

                      return (
                        <tr
                          key={entry.id}
                          className="border-b last:border-0 hover:bg-muted/30 transition-colors row-glow"
                        >
                          <td className="py-3 pr-3">
                            <div>
                              <p className="text-sm whitespace-nowrap">{formatRelativeTime(entry.created_at)}</p>
                              <p className="text-xs text-muted-foreground whitespace-nowrap hidden sm:block">
                                {formatDateTime(entry.created_at)}
                              </p>
                            </div>
                          </td>
                          <td className="py-3 pr-3">
                            <div>
                              <p className="text-sm font-medium truncate max-w-[160px]">
                                {entry.admin_name || "Admin"}
                              </p>
                              <p className="text-xs text-muted-foreground truncate max-w-[160px]">
                                {entry.admin_email}
                              </p>
                            </div>
                          </td>
                          <td className="py-3 pr-3">
                            <div className="flex items-center gap-2">
                              <div className={`flex h-7 w-7 items-center justify-center rounded-full ${config.bg}`}>
                                <IconComp className={`h-3.5 w-3.5 ${config.color}`} />
                              </div>
                              <span className="text-sm font-medium whitespace-nowrap">
                                {config.label}
                              </span>
                            </div>
                          </td>
                          <td className="py-3 pr-3 hidden md:table-cell">
                            <div>
                              <p className="text-sm truncate max-w-[200px]">
                                {entry.entity_name || "-"}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {entry.entity_type}
                                {entry.entity_id && (
                                  <span className="ml-1 font-mono text-[10px]">
                                    {entry.entity_id.slice(0, 8)}...
                                  </span>
                                )}
                              </p>
                            </div>
                          </td>
                          <td className="py-3 hidden lg:table-cell">
                            {entry.details ? (
                              <pre className="text-xs text-muted-foreground bg-muted/50 rounded px-2 py-1 max-w-[300px] overflow-hidden truncate">
                                {JSON.stringify(entry.details, null, 0).slice(0, 120)}
                              </pre>
                            ) : (
                              <span className="text-xs text-muted-foreground">-</span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between pt-4 border-t mt-4">
                  <p className="text-sm text-muted-foreground">
                    Showing {offset + 1}-{Math.min(offset + PAGE_SIZE, total)} of {total}
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setPage(Math.max(0, page - 1))}
                      disabled={page === 0}
                      className="inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:bg-accent transition-colors"
                    >
                      <ChevronLeft className="h-4 w-4" />
                      Previous
                    </button>
                    <span className="text-sm text-muted-foreground px-2">
                      Page {page + 1} of {totalPages}
                    </span>
                    <button
                      onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
                      disabled={page >= totalPages - 1}
                      className="inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:bg-accent transition-colors"
                    >
                      Next
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
