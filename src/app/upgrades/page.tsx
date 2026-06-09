"use client"

import { Suspense, useEffect, useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import {
  ArrowUpCircle,
  Loader2,
  Clock,
  CheckCircle2,
  XCircle,
  ExternalLink,
  FileText,
  Mail,
  ShieldCheck,
  ShieldAlert,
  ShieldQuestion,
  AlertTriangle,
  AlertCircle,
  Plus,
  Search,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { formatDate } from "@/lib/utils"
import { toast } from "sonner"

interface MemberLookupResult {
  id: string
  amasi_number: number
  name: string
  email: string
  membership_type: string
}

/* ---------- types ---------- */

interface UpgradeRecord {
  id: string
  upgrade_number: string
  member_id: string
  amasi_number: string
  member_name: string
  member_email: string
  from_type: string
  to_type: string
  asi_membership_no: string
  asi_state: string | null
  asi_certificate_url: string | null
  asi_email_proof_url: string | null
  ai_verified: boolean
  ai_confidence: "high" | "medium" | "low"
  review_notes: string | null
  status: string
  reviewed_at: string | null
  created_at: string
}

/* ---------- constants ---------- */

const FILTER_TABS = [
  { value: "", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
]

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  pending: { label: "Pending", className: "bg-amber-50 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-200 soft-pulse" },
  pending_review: { label: "Pending Review", className: "bg-amber-50 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-200 soft-pulse" },
  approved: { label: "Approved", className: "bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-200" },
  rejected: { label: "Rejected", className: "bg-red-50 dark:bg-red-500/15 text-red-700 dark:text-red-300 border-red-200" },
}

const CONFIDENCE_CONFIG: Record<string, { label: string; className: string; icon: typeof ShieldCheck }> = {
  high: { label: "High", className: "bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-200", icon: ShieldCheck },
  medium: { label: "Medium", className: "bg-amber-50 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-200", icon: ShieldQuestion },
  low: { label: "Low", className: "bg-red-50 dark:bg-red-500/15 text-red-700 dark:text-red-300 border-red-200", icon: ShieldAlert },
}

/* ---------- helpers ---------- */

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.pending
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${cfg.className}`}>
      {cfg.label}
    </span>
  )
}

function ConfidenceBadge({ confidence }: { confidence: string }) {
  const cfg = CONFIDENCE_CONFIG[confidence] || CONFIDENCE_CONFIG.low
  const Icon = cfg.icon
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${cfg.className}`}>
      <Icon className="h-3 w-3" />
      {cfg.label}
    </span>
  )
}

function StatCard({ label, count, color }: { label: string; count: number; color: string }) {
  return (
    <Card className="card-lift">
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-muted-foreground">{label}</p>
          <span className={`text-2xl font-bold ${color}`}>{count}</span>
        </div>
      </CardContent>
    </Card>
  )
}

/* ---------- main content ---------- */

function UpgradesContent() {
  const queryClient = useQueryClient()
  const [statusFilter, setStatusFilter] = useState("")
  const [searchTerm, setSearchTerm] = useState("")
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [rejectNotes, setRejectNotes] = useState("")
  const [initiateOpen, setInitiateOpen] = useState(false)

  /* --- data fetching --- */
  const { data: upgrades = [], isLoading, isError } = useQuery<UpgradeRecord[]>({
    queryKey: ["upgrades"],
    queryFn: async () => {
      const res = await fetch("/api/members/upgrade?all=1")
      const json = await res.json()
      if (!res.ok || !json.status) throw new Error(json.message || "Failed to fetch")
      return json.data
    },
  })

  /* --- mutations --- */
  const approveMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/members/upgrade/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve" }),
      })
      const json = await res.json()
      if (!res.ok || !json.status) throw new Error(json.message || "Failed to approve")
      return json
    },
    onSuccess: (data) => {
      toast.success(data.message || "Upgrade approved")
      queryClient.invalidateQueries({ queryKey: ["upgrades"] })
      setExpandedId(null)
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to approve upgrade")
    },
  })

  const rejectMutation = useMutation({
    mutationFn: async ({ id, notes }: { id: string; notes: string }) => {
      const res = await fetch(`/api/members/upgrade/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reject", notes }),
      })
      const json = await res.json()
      if (!res.ok || !json.status) throw new Error(json.message || "Failed to reject")
      return json
    },
    onSuccess: (data) => {
      toast.success(data.message || "Upgrade rejected")
      queryClient.invalidateQueries({ queryKey: ["upgrades"] })
      setExpandedId(null)
      setRejectNotes("")
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to reject upgrade")
    },
  })

  /* --- computed --- */
  const stats = {
    pending: upgrades.filter((u) => u.status === "pending" || u.status === "pending_review").length,
    approved: upgrades.filter((u) => u.status === "approved").length,
    rejected: upgrades.filter((u) => u.status === "rejected").length,
  }

  const filtered = upgrades.filter((u) => {
    if (statusFilter) {
      if (statusFilter === "pending" && u.status !== "pending" && u.status !== "pending_review") return false
      if (statusFilter !== "pending" && u.status !== statusFilter) return false
    }
    if (searchTerm) {
      const q = searchTerm.toLowerCase()
      const haystack = `${u.member_name} ${u.member_email} ${u.amasi_number} ${u.asi_membership_no} ${u.upgrade_number}`.toLowerCase()
      if (!haystack.includes(q)) return false
    }
    return true
  })

  const isPending = (status: string) => status === "pending" || status === "pending_review"

  /* --- render --- */
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <ArrowUpCircle className="h-7 w-7 text-primary" />
            Membership Upgrades
          </h1>
          <p className="text-muted-foreground mt-1">
            Review membership upgrade requests (ACM → LM / ALM)
          </p>
        </div>
        <Button onClick={() => setInitiateOpen(true)} className="gap-1.5 shrink-0">
          <Plus className="h-4 w-4" />
          Initiate Upgrade
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <StatCard label="Pending Review" count={stats.pending} color="text-amber-600" />
        <StatCard label="Approved" count={stats.approved} color="text-emerald-600" />
        <StatCard label="Rejected" count={stats.rejected} color="text-red-600" />
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 flex-wrap">
        {FILTER_TABS.map((tab) => {
          const isActive = statusFilter === tab.value
          return (
            <button
              key={tab.value}
              onClick={() => setStatusFilter(tab.value)}
              className={`px-4 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                isActive
                  ? "bg-gray-800 text-white border-gray-800"
                  : "bg-white text-gray-700 border-gray-200 hover:bg-gray-50"
              }`}
            >
              {tab.label}
              {tab.value === "pending" && stats.pending > 0 && (
                <span className="ml-1.5 bg-amber-500 text-white text-[10px] px-1.5 py-0.5 rounded-full">
                  {stats.pending}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <input
          type="text"
          placeholder="Search by name, email, AMASI #, or upgrade #..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full h-10 pl-9 pr-3 rounded-lg border border-input bg-background text-sm"
        />
        <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
      </div>

      {/* Upgrade request list */}
      <div className="space-y-3">
        {isLoading && (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {isError && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <AlertCircle className="h-10 w-10 text-destructive mb-3" />
            <p className="text-lg font-medium">Failed to load upgrade requests</p>
            <p className="text-sm text-muted-foreground mt-1">Please try refreshing the page</p>
          </div>
        )}

        {!isLoading && !isError && filtered.length === 0 && (
          <div className="rounded-xl border bg-card py-16 text-center shadow-sm">
            <AlertTriangle className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground">No upgrade requests found</p>
          </div>
        )}

        {filtered.map((upgrade) => {
          const isExpanded = expandedId === upgrade.id
          const confidenceCfg = CONFIDENCE_CONFIG[upgrade.ai_confidence] || CONFIDENCE_CONFIG.low

          return (
            <div
              key={upgrade.id}
              className="row-glow rounded-xl border bg-card shadow-sm hover:shadow-md transition-all overflow-hidden card-lift"
            >
              {/* Card content - clickable */}
              <button
                className="w-full text-left p-4 hover:bg-muted/30 transition-colors"
                onClick={() => {
                  setExpandedId(isExpanded ? null : upgrade.id)
                  setRejectNotes("")
                }}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1 space-y-2">
                    {/* Name + AMASI number */}
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-bold">{upgrade.member_name}</span>
                      <span className="font-mono text-xs text-muted-foreground">
                        AMASI #{upgrade.amasi_number}
                      </span>
                      <span className="text-xs text-muted-foreground">{upgrade.member_email}</span>
                    </div>

                    {/* ASI details */}
                    <div className="flex items-center gap-3 flex-wrap text-xs">
                      <span className="text-muted-foreground">
                        ASI No: <span className="font-semibold text-foreground">{upgrade.asi_membership_no}</span>
                      </span>
                      {upgrade.asi_state && (
                        <span className="text-muted-foreground">
                          State: <span className="font-medium text-foreground">{upgrade.asi_state}</span>
                        </span>
                      )}
                    </div>

                    {/* AI info row */}
                    <div className="flex items-center gap-3 flex-wrap">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-muted-foreground">AI Confidence:</span>
                        <ConfidenceBadge confidence={upgrade.ai_confidence} />
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-muted-foreground">AI Verified:</span>
                        {upgrade.ai_verified ? (
                          <Badge variant="success" className="text-[10px] px-2 py-0">Yes</Badge>
                        ) : (
                          <Badge variant="secondary" className="text-[10px] px-2 py-0">No</Badge>
                        )}
                      </div>
                    </div>

                    {/* AI Notes */}
                    {upgrade.review_notes && (
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        <span className="font-medium">Notes:</span> {upgrade.review_notes}
                      </p>
                    )}
                  </div>

                  {/* Right side: status + date + links */}
                  <div className="flex flex-col items-end gap-2 shrink-0">
                    <StatusBadge status={upgrade.status} />
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {formatDate(upgrade.created_at)}
                    </span>
                    <div className="flex items-center gap-2">
                      {upgrade.asi_certificate_url && (
                        <a
                          href={upgrade.asi_certificate_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <FileText className="h-3 w-3" />
                          Certificate
                          <ExternalLink className="h-2.5 w-2.5" />
                        </a>
                      )}
                      {upgrade.asi_email_proof_url && (
                        <a
                          href={upgrade.asi_email_proof_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Mail className="h-3 w-3" />
                          Email Proof
                          <ExternalLink className="h-2.5 w-2.5" />
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              </button>

              {/* Expanded action panel */}
              {isExpanded && isPending(upgrade.status) && (
                <div className="border-t bg-muted/20 p-4 space-y-3">
                  <div className="flex items-center gap-3">
                    <Button
                      size="sm"
                      className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5"
                      disabled={approveMutation.isPending || rejectMutation.isPending}
                      onClick={() => approveMutation.mutate(upgrade.id)}
                    >
                      {approveMutation.isPending ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      )}
                      Approve
                    </Button>
                    <span className="text-xs text-muted-foreground">or reject with reason below:</span>
                  </div>
                  <div className="flex gap-2">
                    <Textarea
                      placeholder="Reason for rejection..."
                      value={rejectNotes}
                      onChange={(e) => setRejectNotes(e.target.value)}
                      rows={2}
                      className="flex-1 resize-none"
                    />
                    <Button
                      size="sm"
                      variant="destructive"
                      className="gap-1.5 self-end"
                      disabled={!rejectNotes.trim() || approveMutation.isPending || rejectMutation.isPending}
                      onClick={() => rejectMutation.mutate({ id: upgrade.id, notes: rejectNotes.trim() })}
                    >
                      {rejectMutation.isPending ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <XCircle className="h-3.5 w-3.5" />
                      )}
                      Reject
                    </Button>
                  </div>
                </div>
              )}

              {/* Expanded but already resolved */}
              {isExpanded && !isPending(upgrade.status) && (
                <div className="border-t bg-muted/10 p-4">
                  <p className="text-xs text-muted-foreground">
                    This request was <span className="font-semibold">{upgrade.status}</span>
                    {upgrade.reviewed_at && <> on {formatDate(upgrade.reviewed_at)}</>}.
                  </p>
                </div>
              )}
            </div>
          )
        })}
      </div>

      <InitiateUpgradeDialog
        open={initiateOpen}
        onOpenChange={setInitiateOpen}
        onSuccess={() => queryClient.invalidateQueries({ queryKey: ["upgrades"] })}
      />
    </div>
  )
}

/* ---------- initiate upgrade dialog ---------- */

function InitiateUpgradeDialog({
  open,
  onOpenChange,
  onSuccess,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  onSuccess: () => void
}) {
  const [query, setQuery] = useState("")
  const [debouncedQuery, setDebouncedQuery] = useState("")
  const [results, setResults] = useState<MemberLookupResult[]>([])
  const [searching, setSearching] = useState(false)
  const [selected, setSelected] = useState<MemberLookupResult | null>(null)
  const [asiNo, setAsiNo] = useState("")
  const [asiState, setAsiState] = useState("")
  const [submitting, setSubmitting] = useState(false)

  // Reset everything on close so reopening starts clean.
  useEffect(() => {
    if (!open) {
      setQuery("")
      setDebouncedQuery("")
      setResults([])
      setSelected(null)
      setAsiNo("")
      setAsiState("")
    }
  }, [open])

  // Debounce typed query → triggers /api/members/search.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query.trim()), 300)
    return () => clearTimeout(t)
  }, [query])

  useEffect(() => {
    if (!debouncedQuery || debouncedQuery.length < 2 || selected) {
      setResults([])
      return
    }
    let cancelled = false
    setSearching(true)
    fetch(`/api/members/search?q=${encodeURIComponent(debouncedQuery)}`)
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return
        const raw = (j?.data || []) as Array<{
          id?: string
          amasi_number?: number
          name?: string
          email?: string
          membership_type?: string
        }>
        const mapped: MemberLookupResult[] = raw
          .filter((m) => m.id && m.amasi_number && m.email)
          .map((m) => ({
            id: m.id as string,
            amasi_number: m.amasi_number as number,
            name: m.name || "",
            email: m.email as string,
            membership_type: m.membership_type || "",
          }))
        setResults(mapped)
      })
      .catch(() => {
        if (!cancelled) setResults([])
      })
      .finally(() => {
        if (!cancelled) setSearching(false)
      })
    return () => {
      cancelled = true
    }
  }, [debouncedQuery, selected])

  const handleSubmit = async () => {
    if (!selected) return
    if (!asiNo.trim()) {
      toast.error("ASI membership number is required")
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch("/api/members/upgrade/initiate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          memberId: selected.id,
          asiMembershipNo: asiNo.trim(),
          asiState: asiState.trim() || null,
        }),
      })
      const json = await res.json()
      if (!res.ok || !json.status) {
        throw new Error(json.message || "Failed to initiate upgrade")
      }
      toast.success(json.message || "Member upgraded to Life Member")
      onSuccess()
      onOpenChange(false)
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to initiate upgrade"
      toast.error(message)
    } finally {
      setSubmitting(false)
    }
  }

  const memberTypeUpper = (selected?.membership_type || "").toUpperCase()
  const isALM = memberTypeUpper === "ALM" || memberTypeUpper.includes("ASSOCIATE LIFE")

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Initiate ALM → LM Upgrade</DialogTitle>
          <DialogDescription>
            Convert an Associate Life Member to Life Member on their behalf. The member is notified by email and WhatsApp; the upgrade is logged as admin-initiated.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          {/* Member picker */}
          <div className="space-y-1.5">
            <Label htmlFor="upg-initiate-search">Member</Label>
            {selected ? (
              <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/40 px-3 py-2 text-sm">
                <div className="min-w-0">
                  <p className="font-medium truncate">{selected.name}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    AMASI #{selected.amasi_number} · {selected.email}
                  </p>
                </div>
                <Badge variant={isALM ? "secondary" : "destructive"} className="shrink-0 text-[10px]">
                  {selected.membership_type || "—"}
                </Badge>
                <button
                  type="button"
                  onClick={() => setSelected(null)}
                  className="text-xs text-muted-foreground hover:text-foreground shrink-0"
                >
                  Change
                </button>
              </div>
            ) : (
              <>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="upg-initiate-search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search by email, AMASI number, or name"
                    className="pl-9"
                    autoComplete="off"
                  />
                </div>
                {searching && (
                  <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                    <Loader2 className="h-3 w-3 animate-spin" /> Searching…
                  </p>
                )}
                {!searching && debouncedQuery.length >= 2 && results.length === 0 && (
                  <p className="text-xs text-muted-foreground">No members match “{debouncedQuery}”.</p>
                )}
                {results.length > 0 && (
                  <div className="rounded-md border max-h-56 overflow-y-auto">
                    {results.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => setSelected(m)}
                        className="w-full text-left px-3 py-2 hover:bg-accent transition-colors border-b last:border-b-0 flex items-center justify-between gap-3"
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{m.name}</p>
                          <p className="text-xs text-muted-foreground truncate">
                            AMASI #{m.amasi_number} · {m.email}
                          </p>
                        </div>
                        <Badge variant="secondary" className="shrink-0 text-[10px]">
                          {m.membership_type || "—"}
                        </Badge>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          {selected && !isALM && (
            <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 dark:bg-red-950/30 dark:border-red-900/50 px-3 py-2 text-xs text-red-700 dark:text-red-300">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <p>This member is {selected.membership_type || "not ALM"}. Only ALM members can be upgraded to LM via this flow.</p>
            </div>
          )}

          {/* ASI details */}
          <div className="space-y-1.5">
            <Label htmlFor="upg-initiate-asi-no">ASI Membership Number</Label>
            <Input
              id="upg-initiate-asi-no"
              value={asiNo}
              onChange={(e) => setAsiNo(e.target.value)}
              placeholder="e.g. 12345"
              disabled={!selected || !isALM}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="upg-initiate-asi-state">ASI State (optional)</Label>
            <Input
              id="upg-initiate-asi-state"
              value={asiState}
              onChange={(e) => setAsiState(e.target.value)}
              placeholder="e.g. Maharashtra"
              disabled={!selected || !isALM}
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={submitting || !selected || !isALM || !asiNo.trim()}
            className="gap-1.5"
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            Upgrade to Life Member
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/* ---------- page export with Suspense ---------- */

export default function UpgradesPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <UpgradesContent />
    </Suspense>
  )
}
