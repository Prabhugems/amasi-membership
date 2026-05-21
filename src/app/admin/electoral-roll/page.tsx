"use client"

import { useCallback, useEffect, useState } from "react"
import { Loader2, ChevronLeft, ChevronRight, Inbox } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "sonner"

interface Objection {
  id: string
  target_amasi_number: number | null
  objection_type: "incorrect_details" | "should_be_removed" | "should_be_added" | "other"
  objection_text: string
  objector_name: string
  objector_email: string
  objector_phone: string | null
  objector_relation: string | null
  status: "open" | "in_review" | "resolved" | "dismissed"
  resolution_notes: string | null
  resolved_at: string | null
  resolved_by: string | null
  created_at: string
  updated_at: string
}

const STATUS_FILTERS = [
  { value: "", label: "All" },
  { value: "open", label: "Open" },
  { value: "in_review", label: "In review" },
  { value: "resolved", label: "Resolved" },
  { value: "dismissed", label: "Dismissed" },
] as const

const TYPE_LABEL: Record<Objection["objection_type"], string> = {
  incorrect_details: "Incorrect details",
  should_be_removed: "Remove from roll",
  should_be_added: "Add to roll",
  other: "Other",
}

const PAGE_SIZE = 50

function statusVariant(s: Objection["status"]): "warning" | "secondary" | "success" | "destructive" {
  switch (s) {
    case "open": return "warning"
    case "in_review": return "secondary"
    case "resolved": return "success"
    case "dismissed": return "destructive"
  }
}

function formatDate(iso: string | null): string {
  if (!iso) return "—"
  try { return new Date(iso).toLocaleString() } catch { return iso }
}

export default function AdminElectoralRollPage() {
  const [rows, setRows] = useState<Objection[]>([])
  const [count, setCount] = useState(0)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [statusFilter, setStatusFilter] = useState<string>("open")
  const [loading, setLoading] = useState(true)
  const [authorized, setAuthorized] = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [notesDraft, setNotesDraft] = useState<Record<string, string>>({})
  const [updatingId, setUpdatingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) })
      if (statusFilter) params.set("status", statusFilter)
      const res = await fetch(`/api/admin/electoral-roll/objections?${params.toString()}`)
      if (res.status === 401) {
        setAuthorized(false)
        return
      }
      const json = await res.json()
      if (!json.status) throw new Error(json.error || "Failed to load objections")
      setRows(json.data || [])
      setCount(json.count || 0)
      setTotalPages(json.totalPages || 1)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load")
    } finally {
      setLoading(false)
    }
  }, [page, statusFilter])

  useEffect(() => { void load() }, [load])

  const updateStatus = async (id: string, status: Objection["status"]) => {
    setUpdatingId(id)
    try {
      const res = await fetch(`/api/admin/electoral-roll/objections/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, resolution_notes: notesDraft[id] ?? null }),
      })
      const json = await res.json()
      if (!json.status) throw new Error(json.error || "Update failed")
      toast.success(`Marked as ${status.replace("_", " ")}`)
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Update failed")
    } finally {
      setUpdatingId(null)
    }
  }

  if (!authorized) {
    return (
      <div className="max-w-3xl mx-auto py-16 text-center">
        <p className="text-sm text-muted-foreground">You do not have permission to view this page.</p>
      </div>
    )
  }

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <div className="space-y-2">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">Admin</p>
        <h1 className="text-2xl font-bold tracking-tight">Electoral Roll Objections</h1>
        <p className="text-sm text-muted-foreground">
          Triage public objections to the 2026 Provisional Electoral Roll.
        </p>
      </div>

      {/* Status filter */}
      <div className="flex items-center gap-2 flex-wrap">
        {STATUS_FILTERS.map((f) => (
          <Button
            key={f.value || "all"}
            variant={statusFilter === f.value ? "default" : "outline"}
            size="sm"
            onClick={() => {
              setStatusFilter(f.value)
              setPage(1)
            }}
          >
            {f.label}
          </Button>
        ))}
      </div>

      {/* List */}
      <div className="text-sm text-muted-foreground">
        {loading ? "Loading…" : `${count.toLocaleString("en-IN")} objection${count === 1 ? "" : "s"}`}
      </div>

      {loading && rows.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
          </CardContent>
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center space-y-3">
            <div className="mx-auto w-12 h-12 rounded-md bg-muted border border-border flex items-center justify-center">
              <Inbox className="h-5 w-5 text-muted-foreground" />
            </div>
            <p className="text-sm text-muted-foreground">No objections in this view.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {rows.map((o) => {
            const expanded = expandedId === o.id
            return (
              <Card key={o.id}>
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1.5 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant={statusVariant(o.status)}>{o.status.replace("_", " ")}</Badge>
                        <span className="text-sm font-medium">{TYPE_LABEL[o.objection_type]}</span>
                        {o.target_amasi_number && (
                          <span className="text-sm text-muted-foreground">
                            re: AMASI <span className="font-mono">{o.target_amasi_number}</span>
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-foreground line-clamp-2">{o.objection_text}</p>
                      <p className="text-xs text-muted-foreground">
                        From {o.objector_name} ({o.objector_email})
                        {o.objector_phone ? ` · ${o.objector_phone}` : ""}
                        {" · "}
                        {formatDate(o.created_at)}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setExpandedId(expanded ? null : o.id)}
                    >
                      {expanded ? "Collapse" : "Review"}
                    </Button>
                  </div>

                  {expanded && (
                    <div className="border-t border-border pt-3 space-y-3">
                      <div className="space-y-1">
                        <p className="text-xs uppercase tracking-wider text-muted-foreground">Full text</p>
                        <p className="text-sm whitespace-pre-wrap">{o.objection_text}</p>
                      </div>

                      {o.resolution_notes && (
                        <div className="space-y-1">
                          <p className="text-xs uppercase tracking-wider text-muted-foreground">Resolution notes</p>
                          <p className="text-sm whitespace-pre-wrap">{o.resolution_notes}</p>
                          {o.resolved_by && (
                            <p className="text-xs text-muted-foreground">
                              By {o.resolved_by} on {formatDate(o.resolved_at)}
                            </p>
                          )}
                        </div>
                      )}

                      <div className="space-y-1">
                        <p className="text-xs uppercase tracking-wider text-muted-foreground">Add resolution notes</p>
                        <Textarea
                          rows={3}
                          placeholder="Optional notes shown in the audit log alongside the status change."
                          value={notesDraft[o.id] ?? o.resolution_notes ?? ""}
                          onChange={(e) =>
                            setNotesDraft((prev) => ({ ...prev, [o.id]: e.target.value }))
                          }
                        />
                      </div>

                      <div className="flex flex-wrap items-center gap-2 justify-end">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={updatingId === o.id || o.status === "in_review"}
                          onClick={() => updateStatus(o.id, "in_review")}
                        >
                          Mark in review
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={updatingId === o.id || o.status === "dismissed"}
                          onClick={() => updateStatus(o.id, "dismissed")}
                        >
                          Dismiss
                        </Button>
                        <Button
                          variant="default"
                          size="sm"
                          disabled={updatingId === o.id || o.status === "resolved"}
                          onClick={() => updateStatus(o.id, "resolved")}
                        >
                          {updatingId === o.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            "Resolve"
                          )}
                        </Button>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between gap-3 pt-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1 || loading}
          >
            <ChevronLeft className="h-4 w-4 mr-1" />
            Previous
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {page} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages || loading}
          >
            Next
            <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        </div>
      )}
    </div>
  )
}
