"use client"

import { useState, useEffect, useCallback, useRef, useMemo } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { motion, AnimatePresence, useReducedMotion } from "framer-motion"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar"
import { Textarea } from "@/components/ui/textarea"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
  CheckCircle, XCircle, Eye, Clock, Sparkles, AlertCircle,
  Search, FileText, Shield, Loader2, Inbox, MessageSquare, RotateCcw, ChevronDown,
  User, GraduationCap, Stethoscope, Camera, ExternalLink,
  Calendar, StickyNote, Filter, ChevronUp,
  Keyboard, CheckSquare, Square, MinusSquare, X,
} from "lucide-react"
import { toast } from "sonner"
import { formatDate, getInitials } from "@/lib/utils"
import { DOC_LABELS } from "@/lib/membership-types"
import type { DocType } from "@/lib/membership-types"

type TabFilter = "pending" | "ai_approved" | "approved" | "rejected" | "clarification" | "all"
type ActionMode = null | "reject" | "clarification" | "resubmit"

const TAB_STYLES: Record<TabFilter, { icon: typeof Clock; activeClass: string; dotColor: string }> = {
  pending: { icon: Clock, activeClass: "bg-amber-600 text-white border-amber-600", dotColor: "bg-amber-500" },
  ai_approved: { icon: Sparkles, activeClass: "bg-blue-600 text-white border-blue-600", dotColor: "bg-blue-500" },
  approved: { icon: CheckCircle, activeClass: "bg-emerald-600 text-white border-emerald-600", dotColor: "bg-emerald-500" },
  rejected: { icon: XCircle, activeClass: "bg-red-600 text-white border-red-600", dotColor: "bg-red-500" },
  clarification: { icon: MessageSquare, activeClass: "bg-orange-600 text-white border-orange-600", dotColor: "bg-orange-500" },
  all: { icon: FileText, activeClass: "bg-gray-800 text-white border-gray-800", dotColor: "bg-gray-500" },
}

const MEMBERSHIP_TYPE_LABELS: Record<string, string> = {
  LM: "Life Member",
  ALM: "Associate Life Member",
  ACM: "Associate Candidate Member",
  ILM: "International Life Member",
}

// ─── Confidence meter component ─────────────────────────────────────────────
function ConfidenceMeter({ score, label, size = "md" }: { score: number; label?: string; size?: "sm" | "md" }) {
  const color = score >= 80 ? "bg-emerald-500" : score >= 50 ? "bg-amber-500" : "bg-red-500"
  const textColor = score >= 80 ? "text-emerald-700 dark:text-emerald-300" : score >= 50 ? "text-amber-700 dark:text-amber-300" : "text-red-700 dark:text-red-300"
  const bgColor = score >= 80 ? "bg-emerald-100 dark:bg-emerald-500/20" : score >= 50 ? "bg-amber-100 dark:bg-amber-500/20" : "bg-red-100 dark:bg-red-500/20"
  const h = size === "sm" ? "h-1.5" : "h-2.5"

  return (
    <div className="flex-1 min-w-0">
      {label && (
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs font-medium text-muted-foreground truncate">{label}</span>
          <span className={`text-xs font-bold ${textColor}`}>{score}%</span>
        </div>
      )}
      <div className={`w-full ${bgColor} rounded-full ${h} overflow-hidden`}>
        <div
          className={`${color} ${h} rounded-full transition-all duration-500`}
          style={{ width: `${Math.min(100, Math.max(0, score))}%` }}
        />
      </div>
    </div>
  )
}

// ─── Timeline component ─────────────────────────────────────────────────────
function ApplicationTimeline({ app }: { app: any }) {
  const steps = [
    { label: "Submitted", date: app.created_at, done: true, icon: FileText },
    { label: "AI Reviewed", date: app.ai_reviewed_at || (app.ai_confidence ? app.created_at : null), done: !!app.ai_confidence, icon: Sparkles },
    {
      label: app.status === "need_clarification" ? "Clarification Requested" :
             app.status === "resubmit_requested" ? "Resubmit Requested" :
             app.status === "rejected" ? "Rejected" :
             app.status === "approved" ? "Approved" : "Pending Admin Action",
      date: app.reviewed_at,
      done: ["approved", "rejected", "need_clarification", "resubmit_requested"].includes(app.status),
      icon: app.status === "rejected" ? XCircle : app.status === "approved" ? CheckCircle : Clock,
    },
    {
      label: app.status === "approved" ? `AMASI #${app.assigned_amasi_number || ""}` :
             app.status === "rejected" ? "Application Closed" : "Awaiting Outcome",
      date: app.status === "approved" ? app.reviewed_at : null,
      done: app.status === "approved" || app.status === "rejected",
      icon: Shield,
    },
  ]

  return (
    <div className="flex items-center gap-0 overflow-x-auto py-2">
      {steps.map((step, i) => {
        const StepIcon = step.icon
        return (
          <div key={i} className="flex items-center">
            <div className="flex flex-col items-center min-w-[100px]">
              <div className={`flex h-8 w-8 items-center justify-center rounded-full border-2 transition-all ${
                step.done
                  ? app.status === "rejected" && i >= 2 ? "border-red-400 bg-red-50 dark:bg-red-500/15 text-red-600 dark:text-red-300" : "border-emerald-400 bg-emerald-50 dark:bg-emerald-500/15 text-emerald-600 dark:text-emerald-300"
                  : "border-gray-200 dark:border-gray-400/30 bg-gray-50 dark:bg-gray-500/15 text-gray-400"
              }`}>
                <StepIcon className="h-3.5 w-3.5" />
              </div>
              <p className={`text-[10px] font-semibold mt-1.5 text-center leading-tight ${step.done ? "text-foreground" : "text-muted-foreground"}`}>
                {step.label}
              </p>
              {step.date && (
                <p className="text-[9px] text-muted-foreground mt-0.5">{formatDate(step.date)}</p>
              )}
            </div>
            {i < steps.length - 1 && (
              <div className={`h-0.5 w-8 mx-1 rounded ${step.done ? "bg-emerald-300" : "bg-gray-200"}`} />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── Document thumbnail component ───────────────────────────────────────────
function DocThumbnail({ docKey, doc, onView }: { docKey: string; doc: any; onView: () => void }) {
  const label = DOC_LABELS[docKey as DocType] || docKey.replace(/_/g, " ")
  const url = doc.fileUrl || doc.url || null
  const isImage = url && /\.(jpg|jpeg|png|webp|gif)/i.test(url)

  return (
    <button
      onClick={onView}
      className="group relative flex flex-col items-center gap-2 p-3 rounded-xl border bg-card hover:bg-accent/50 hover:border-primary/30 transition-all w-28 text-center"
    >
      <div className="relative w-16 h-16 rounded-lg overflow-hidden bg-muted flex items-center justify-center">
        {isImage && url ? (
          <img src={url} alt={label} className="w-full h-full object-cover" />
        ) : url ? (
          <FileText className="h-6 w-6 text-muted-foreground" />
        ) : (
          <Camera className="h-6 w-6 text-muted-foreground/40" />
        )}
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-all flex items-center justify-center">
          <ExternalLink className="h-4 w-4 text-white opacity-0 group-hover:opacity-100 transition-opacity drop-shadow" />
        </div>
        <div className={`absolute top-0.5 right-0.5 h-3 w-3 rounded-full border border-white ${
          doc.status === "extracted" ? "bg-emerald-500" : doc.status === "uploaded" ? "bg-amber-500" : "bg-red-500"
        }`} />
      </div>
      <span className="text-[10px] font-medium text-muted-foreground leading-tight line-clamp-2">{label}</span>
    </button>
  )
}

// ─── Data comparison row ────────────────────────────────────────────────────
function CompareRow({ label, formValue, ocrValue }: { label: string; formValue: string; ocrValue: string }) {
  const match = formValue && ocrValue &&
    formValue.toLowerCase().trim() === ocrValue.toLowerCase().trim()
  const mismatch = formValue && ocrValue && !match

  return (
    <tr className={mismatch ? "bg-red-50 dark:bg-red-500/15" : ""}>
      <td className="px-3 py-1.5 text-xs font-medium text-muted-foreground whitespace-nowrap">{label}</td>
      <td className="px-3 py-1.5 text-xs">{formValue || <span className="text-muted-foreground/50">--</span>}</td>
      <td className={`px-3 py-1.5 text-xs ${mismatch ? "text-red-700 dark:text-red-300 font-semibold" : ""}`}>
        {ocrValue || <span className="text-muted-foreground/50">--</span>}
        {match && <CheckCircle className="inline h-3 w-3 ml-1 text-emerald-500" />}
        {mismatch && <AlertCircle className="inline h-3 w-3 ml-1 text-red-500" />}
      </td>
    </tr>
  )
}

// ─── Main page ──────────────────────────────────────────────────────────────
export default function PendingPage() {
  const [tab, setTab] = useState<TabFilter>("pending")
  const reduced = useReducedMotion()
  const [search, setSearch] = useState("")
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [actionMode, setActionMode] = useState<ActionMode>(null)
  const [actionMessage, setActionMessage] = useState("")
  const [rejectReason, setRejectReason] = useState("")
  const [approveNotes, setApproveNotes] = useState("")
  const [showActions, setShowActions] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [focusIndex, setFocusIndex] = useState(-1)
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)
  const [internalNote, setInternalNote] = useState("")
  const [showNotes, setShowNotes] = useState<string | null>(null)
  const [showFilters, setShowFilters] = useState(false)
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")
  const [membershipTypeFilter, setMembershipTypeFilter] = useState("")
  const [confidenceFilter, setConfidenceFilter] = useState<"" | "high" | "medium" | "low">("")
  const [showCompare, setShowCompare] = useState<string | null>(null)
  const [showKeyboardHelp, setShowKeyboardHelp] = useState(false)
  const [nmcResults, setNmcResults] = useState<Record<string, { loading: boolean; reachable?: boolean; verified?: boolean; doctors?: any[]; message?: string }>>({})

  const verifyNmc = useCallback(async (appId: string, regNo: string, state?: string) => {
    setNmcResults((prev) => ({ ...prev, [appId]: { loading: true } }))
    try {
      const params = new URLSearchParams({ regNo })
      if (state) params.set("state", state)
      const res = await fetch(`/api/nmc/verify?${params}`)
      const result = await res.json()
      setNmcResults((prev) => ({ ...prev, [appId]: { loading: false, ...result } }))
    } catch {
      setNmcResults((prev) => ({ ...prev, [appId]: { loading: false, reachable: false, verified: false, message: "Failed to reach NMC. Please try again later." } }))
    }
  }, [])
  const queryClient = useQueryClient()
  const listRef = useRef<HTMLDivElement>(null)

  const { data, isLoading, isError } = useQuery({
    queryKey: ["applications", tab],
    queryFn: async () => {
      const res = await fetch(`/api/applications/list?status=${tab}&limit=100`)
      return res.json()
    },
  })

  const approveMutation = useMutation({
    mutationFn: async ({ id, notes }: { id: string; notes: string }) => {
      const res = await fetch("/api/applications/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ applicationId: id, notes }),
      })
      if (!res.ok) throw new Error("Request failed")
      return res.json()
    },
    onSuccess: (data) => {
      if (data.status) {
        toast.success(data.message)
        queryClient.invalidateQueries({ queryKey: ["applications"] })
        setExpandedId(null)
        setInternalNote("")
        setShowNotes(null)
      } else {
        toast.error(data.message)
      }
    },
    onError: (err: any) => {
      toast.error(err?.message || "Something went wrong. Please try again.")
    },
  })

  const rejectMutation = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      const res = await fetch("/api/applications/reject", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ applicationId: id, reason }),
      })
      if (!res.ok) throw new Error("Request failed")
      return res.json()
    },
    onSuccess: (data) => {
      if (data.status) {
        toast.success(data.message)
        queryClient.invalidateQueries({ queryKey: ["applications"] })
        setExpandedId(null)
        setRejectReason("")
        setActionMode(null)
        setInternalNote("")
        setShowNotes(null)
      } else {
        toast.error(data.message)
      }
    },
    onError: (err: any) => {
      toast.error(err?.message || "Something went wrong. Please try again.")
    },
  })

  const clarificationMutation = useMutation({
    mutationFn: async ({ id, action, message }: { id: string; action: string; message: string }) => {
      const res = await fetch("/api/applications/clarification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ applicationId: id, action, message }),
      })
      if (!res.ok) throw new Error("Request failed")
      return res.json()
    },
    onSuccess: (data) => {
      if (data.status) {
        toast.success(data.message)
        queryClient.invalidateQueries({ queryKey: ["applications"] })
        setExpandedId(null)
        setActionMode(null)
        setActionMessage("")
        setInternalNote("")
        setShowNotes(null)
      } else {
        toast.error(data.message)
      }
    },
    onError: (err: any) => {
      toast.error(err?.message || "Something went wrong. Please try again.")
    },
  })

  // Save internal note mutation (stores in application metadata)
  const noteMutation = useMutation({
    mutationFn: async ({ id, note }: { id: string; note: string }) => {
      const res = await fetch("/api/applications/clarification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ applicationId: id, action: "internal_note", message: note }),
      })
      return res.json()
    },
    onSuccess: (data) => {
      if (data.status) {
        toast.success("Internal note saved")
        queryClient.invalidateQueries({ queryKey: ["applications"] })
        setInternalNote("")
      } else {
        toast.error(data.message || "Failed to save note")
      }
    },
  })

  // Bulk approve
  const bulkApproveMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const results = await Promise.allSettled(
        ids.map(id =>
          fetch("/api/applications/approve", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ applicationId: id, notes: "Bulk approved by admin" }),
          }).then(r => r.json())
        )
      )
      return results
    },
    onSuccess: (results) => {
      const succeeded = results.filter(r => r.status === "fulfilled" && (r as any).value?.status).length
      const failed = results.length - succeeded
      if (succeeded > 0) toast.success(`${succeeded} application(s) approved`)
      if (failed > 0) toast.error(`${failed} application(s) failed`)
      queryClient.invalidateQueries({ queryKey: ["applications"] })
      setSelectedIds(new Set())
    },
  })

  // Bulk reject
  const bulkRejectMutation = useMutation({
    mutationFn: async ({ ids, reason }: { ids: string[]; reason: string }) => {
      const results = await Promise.allSettled(
        ids.map(id =>
          fetch("/api/applications/reject", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ applicationId: id, reason }),
          }).then(r => r.json())
        )
      )
      return results
    },
    onSuccess: (results) => {
      const succeeded = results.filter(r => r.status === "fulfilled" && (r as any).value?.status).length
      const failed = results.length - succeeded
      if (succeeded > 0) toast.success(`${succeeded} application(s) rejected`)
      if (failed > 0) toast.error(`${failed} application(s) failed`)
      queryClient.invalidateQueries({ queryKey: ["applications"] })
      setSelectedIds(new Set())
    },
  })

  // Filter applications
  const applications = useMemo(() => (data?.data || []).filter((app: any) => {
    // Text search
    if (search) {
      const q = search.toLowerCase()
      const match =
        app.name?.toLowerCase().includes(q) ||
        app.first_name?.toLowerCase().includes(q) ||
        app.email?.toLowerCase().includes(q) ||
        app.phone?.includes(q) ||
        app.reference_number?.toLowerCase().includes(q)
      if (!match) return false
    }
    // Date range
    if (dateFrom && app.created_at < dateFrom) return false
    if (dateTo && app.created_at > dateTo + "T23:59:59") return false
    // Membership type
    if (membershipTypeFilter && app.membership_type !== membershipTypeFilter) return false
    // Confidence filter
    if (confidenceFilter) {
      const conf = app.ai_confidence || ""
      if (confidenceFilter === "high" && !conf.includes("high")) return false
      if (confidenceFilter === "medium" && !conf.includes("medium")) return false
      if (confidenceFilter === "low" && !conf.includes("low")) return false
    }
    return true
  }), [data, search, dateFrom, dateTo, membershipTypeFilter, confidenceFilter])

  // Keyboard navigation
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    // Don't intercept when typing in an input/textarea
    const tag = (e.target as HTMLElement)?.tagName
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return

    if (e.key === "ArrowDown") {
      e.preventDefault()
      setFocusIndex(prev => Math.min(prev + 1, applications.length - 1))
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setFocusIndex(prev => Math.max(prev - 1, 0))
    } else if (e.key === "Enter" && focusIndex >= 0 && focusIndex < applications.length) {
      e.preventDefault()
      const app = applications[focusIndex]
      setExpandedId(expandedId === app.id ? null : app.id)
      setActionMode(null)
      setInternalNote("")
      setShowNotes(null)
    } else if (e.key === "a" && expandedId) {
      // Approve shortcut
      e.preventDefault()
      approveMutation.mutate({ id: expandedId, notes: approveNotes || "Manually approved" })
    } else if (e.key === "r" && expandedId) {
      // Reject shortcut — open reject form
      e.preventDefault()
      setActionMode("reject")
    } else if (e.key === "Escape") {
      if (lightboxUrl) {
        setLightboxUrl(null)
      } else if (expandedId) {
        setExpandedId(null)
        setActionMode(null)
        setInternalNote("")
        setShowNotes(null)
      }
    }
    // Note: '?' handler removed — the global ShortcutHelp listener handles it.
  }, [applications, focusIndex, expandedId, approveNotes, approveMutation, lightboxUrl])

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [handleKeyDown])

  // Scroll focused item into view
  useEffect(() => {
    if (focusIndex >= 0 && listRef.current) {
      const cards = listRef.current.querySelectorAll("[data-app-card]")
      cards[focusIndex]?.scrollIntoView({ behavior: "smooth", block: "nearest" })
    }
  }, [focusIndex])

  // Bulk selection helpers
  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const selectAll = () => {
    const actionableIds = applications
      .filter((a: any) => ["submitted", "pending_review", "ai_approved", "need_clarification", "resubmit_requested", "documents_unreadable"].includes(a.status))
      .map((a: any) => a.id)
    setSelectedIds(new Set(actionableIds))
  }
  const deselectAll = () => setSelectedIds(new Set())
  const isActionable = (status: string) =>
    ["submitted", "pending_review", "ai_approved", "need_clarification", "resubmit_requested", "documents_unreadable"].includes(status)

  const tabs: { key: TabFilter; label: string }[] = [
    { key: "pending", label: "Pending Review" },
    { key: "ai_approved", label: "AI Approved" },
    { key: "clarification", label: "Clarification" },
    { key: "approved", label: "Approved" },
    { key: "rejected", label: "Rejected" },
    { key: "all", label: "All" },
  ]

  const activeFilterCount = [dateFrom, dateTo, membershipTypeFilter, confidenceFilter].filter(Boolean).length

  // Memoized tab counts to avoid re-filtering on every render
  const tabCounts = useMemo(() => {
    const allApps = data?.data || []
    return {
      pending: allApps.filter((a: any) => ["submitted", "pending_review"].includes(a.status)).length,
      ai_approved: allApps.filter((a: any) => a.status === "ai_approved").length,
      approved: allApps.filter((a: any) => a.status === "approved").length,
      rejected: allApps.filter((a: any) => a.status === "rejected").length,
      clarification: allApps.filter((a: any) => ["need_clarification", "resubmit_requested", "documents_unreadable"].includes(a.status)).length,
    } as Record<string, number>
  }, [data])

  // Extract AI score as number from ai_confidence string like "high (85%)" or the ai_score field
  function getAiScoreNum(app: any): number {
    if (typeof app.ai_score === "number") return app.ai_score
    const match = (app.ai_confidence || "").match(/(\d+)/)
    return match ? parseInt(match[1]) : -1
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Application Approvals</h1>
          <p className="text-muted-foreground mt-1">
            Review, approve, or reject membership applications
          </p>
        </div>
        <button
          onClick={() => setShowKeyboardHelp(true)}
          className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs text-muted-foreground hover:bg-accent transition-colors"
          title="Keyboard shortcuts"
        >
          <Keyboard className="h-3.5 w-3.5" />
          Shortcuts
        </button>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-2">
        {tabs.map((t) => {
          const style = TAB_STYLES[t.key]
          const isActive = tab === t.key
          const TabIcon = style.icon
          return (
            <button
              key={t.key}
              onClick={() => { setTab(t.key); setSelectedIds(new Set()); setFocusIndex(-1) }}
              className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold border transition-all ${
                isActive
                  ? style.activeClass + " shadow-sm"
                  : "bg-card border-border hover:bg-accent text-muted-foreground hover:text-foreground"
              }`}
            >
              <TabIcon className="h-4 w-4" />
              {t.label}
              {data?.data && t.key !== "all" && (
                <span className={`inline-flex items-center justify-center h-5 min-w-5 px-1.5 text-xs font-bold rounded-full ${
                  isActive ? "bg-white/20 text-inherit" : "bg-muted text-muted-foreground"
                }`}>
                  {tabCounts[t.key] ?? 0}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Search + Filters row */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[240px] max-w-md">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by name, email, phone, reference..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10 h-11 shadow-sm"
          />
        </div>
        <Button
          variant="outline"
          size="sm"
          className={`h-11 gap-2 ${showFilters || activeFilterCount > 0 ? "border-primary text-primary" : ""}`}
          onClick={() => setShowFilters(!showFilters)}
        >
          <Filter className="h-4 w-4" />
          Filters
          {activeFilterCount > 0 && (
            <span className="inline-flex items-center justify-center h-5 min-w-5 px-1 text-[10px] font-bold rounded-full bg-primary text-primary-foreground">
              {activeFilterCount}
            </span>
          )}
        </Button>
      </div>

      {/* Advanced Filters Panel */}
      {showFilters && (
        <Card>
          <CardContent className="p-4">
            <div className="flex flex-wrap gap-4 items-end">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Date From</Label>
                <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="h-9 w-40" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Date To</Label>
                <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="h-9 w-40" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Membership Type</Label>
                <select
                  value={membershipTypeFilter}
                  onChange={e => setMembershipTypeFilter(e.target.value)}
                  className="h-9 w-44 rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="">All Types</option>
                  <option value="LM">Life Member</option>
                  <option value="ALM">Associate Life Member</option>
                  <option value="ACM">Associate Candidate Member</option>
                  <option value="ILM">International Life Member</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">AI Confidence</Label>
                <select
                  value={confidenceFilter}
                  onChange={e => setConfidenceFilter(e.target.value as any)}
                  className="h-9 w-40 rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="">All Levels</option>
                  <option value="high">High (80-100%)</option>
                  <option value="medium">Medium (50-79%)</option>
                  <option value="low">Low (0-49%)</option>
                </select>
              </div>
              {activeFilterCount > 0 && (
                <Button variant="ghost" size="sm" className="h-9 text-xs"
                  onClick={() => { setDateFrom(""); setDateTo(""); setMembershipTypeFilter(""); setConfidenceFilter("") }}>
                  <X className="h-3.5 w-3.5 mr-1" /> Clear Filters
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Bulk actions bar */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-primary/5 border border-primary/20">
          <button
            onClick={deselectAll}
            aria-label="Clear selection"
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
          <span className="text-sm font-semibold">{selectedIds.size} selected</span>
          <div className="flex-1" />
          <Button
            size="sm"
            className="bg-emerald-600 hover:bg-emerald-700 shadow-sm gap-1.5"
            onClick={() => bulkApproveMutation.mutate(Array.from(selectedIds))}
            disabled={bulkApproveMutation.isPending}
          >
            {bulkApproveMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle className="h-3.5 w-3.5" />}
            Bulk Approve
          </Button>
          <Button
            size="sm"
            variant="destructive"
            className="gap-1.5"
            onClick={() => {
              const reason = prompt("Enter rejection reason for all selected applications:")
              if (reason?.trim()) {
                bulkRejectMutation.mutate({ ids: Array.from(selectedIds), reason })
              }
            }}
            disabled={bulkRejectMutation.isPending}
          >
            {bulkRejectMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <XCircle className="h-3.5 w-3.5" />}
            Bulk Reject
          </Button>
        </div>
      )}

      {/* Select all / deselect bar */}
      {applications.length > 0 && applications.some((a: any) => isActionable(a.status)) && (
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <button
            onClick={() => {
              const actionableIds = applications.filter((a: any) => isActionable(a.status)).map((a: any) => a.id)
              const allSelected = actionableIds.every((id: string) => selectedIds.has(id))
              if (allSelected) deselectAll()
              else selectAll()
            }}
            className="flex items-center gap-1.5 hover:text-foreground transition-colors"
          >
            {(() => {
              const actionableIds = applications.filter((a: any) => isActionable(a.status)).map((a: any) => a.id)
              const allSelected = actionableIds.length > 0 && actionableIds.every((id: string) => selectedIds.has(id))
              const someSelected = actionableIds.some((id: string) => selectedIds.has(id))
              if (allSelected) return <CheckSquare className="h-3.5 w-3.5" />
              if (someSelected) return <MinusSquare className="h-3.5 w-3.5" />
              return <Square className="h-3.5 w-3.5" />
            })()}
            Select all actionable
          </button>
          <span className="text-muted-foreground/40">|</span>
          <span>{applications.length} application{applications.length !== 1 ? "s" : ""}</span>
        </div>
      )}

      <AnimatePresence mode="wait">
        <motion.div
          key={tab}
          initial={reduced ? { opacity: 0 } : { opacity: 0, x: 40 }}
          animate={reduced ? { opacity: 1 } : { opacity: 1, x: 0 }}
          exit={reduced ? { opacity: 0 } : { opacity: 0, x: -40 }}
          transition={{ duration: 0.25, ease: "easeOut" }}
          className="space-y-6"
        >
      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground mr-2" />
          <span className="text-muted-foreground">Loading applications...</span>
        </div>
      )}

      {/* Error state */}
      {isError && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <AlertCircle className="h-10 w-10 text-destructive mb-3" />
          <p className="text-lg font-medium">Failed to load applications</p>
          <p className="text-sm text-muted-foreground mt-1">Please try refreshing the page</p>
        </div>
      )}

      {/* Empty state */}
      {!isLoading && !isError && applications.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="py-16 text-center">
            <Inbox className="h-14 w-14 text-muted-foreground/30 mx-auto mb-4" />
            <p className="text-lg font-semibold">No applications in this category</p>
            <p className="text-sm text-muted-foreground mt-1">All caught up!</p>
          </CardContent>
        </Card>
      )}

      {/* Application cards */}
      <div className={`space-y-3 ${selectedIds.size > 0 ? "rows-dimmed" : ""}`} ref={listRef}>
        {applications.map((app: any, idx: number) => {
          const isExpanded = expandedId === app.id
          const isFocused = focusIndex === idx
          const isSelected = selectedIds.has(app.id)
          const fullName = [app.salutation, app.first_name, app.middle_name, app.last_name].filter(Boolean).join(" ") || app.name
          const aiFlags = app.ai_flags || []
          const docs = app.documents || {}
          const ocrData = app.ocr_data || {}
          const aiScore = getAiScoreNum(app)
          const profileDoc = docs.profile || null

          const borderClass = app.status === "documents_unreadable"
            ? "border-l-4 border-l-red-500"
            : app.needs_manual_review
              ? "border-l-4 border-l-amber-400"
              : app.ai_verified
                ? "border-l-4 border-l-emerald-400"
                : app.status === "rejected"
                  ? "border-l-4 border-l-red-400"
                  : app.status === "approved"
                    ? "border-l-4 border-l-emerald-400"
                    : app.status === "ai_approved"
                      ? "border-l-4 border-l-blue-400"
                      : ""

          return (
            <Card
              key={app.id}
              data-app-card
              className={`row-glow transition-all hover:shadow-md ${borderClass} ${isFocused ? "ring-2 ring-primary/40" : ""} ${isSelected ? "row-active bg-primary/[0.02]" : ""}`}
            >
              <CardContent className="p-5">
                {/* Summary row */}
                <div className="flex items-center gap-4">
                  {/* Checkbox */}
                  {isActionable(app.status) && (
                    <button
                      onClick={() => toggleSelect(app.id)}
                      className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {isSelected ? <CheckSquare className="h-4.5 w-4.5 text-primary" /> : <Square className="h-4.5 w-4.5" />}
                    </button>
                  )}

                  <Avatar className="h-12 w-12 shrink-0 border shadow-sm">
                    {(profileDoc?.fileUrl || profileDoc?.url) && (
                      <AvatarImage src={profileDoc?.fileUrl || profileDoc?.url} alt={fullName} />
                    )}
                    <AvatarFallback className="text-sm font-semibold bg-primary/5 text-primary">
                      {getInitials(fullName)}
                    </AvatarFallback>
                  </Avatar>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-bold text-sm">{fullName}</p>
                      <Badge variant={
                        app.status === "approved" || app.status === "ai_approved" ? "success" :
                        app.status === "rejected" || app.status === "documents_unreadable" ? "destructive" :
                        app.status === "need_clarification" || app.status === "resubmit_requested" ? "outline" :
                        "warning"
                      } className={`text-xs ${app.status === "documents_unreadable" ? "bg-red-100 dark:bg-red-500/20 text-red-800 dark:text-red-200 border-red-300 dark:border-red-400/40 soft-pulse" : app.status === "need_clarification" ? "border-orange-300 dark:border-orange-400/30 text-orange-700 dark:text-orange-300 bg-orange-50 dark:bg-orange-500/15 soft-pulse" : app.status === "resubmit_requested" ? "border-amber-300 dark:border-amber-400/30 text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-500/15 soft-pulse" : ["pending_review", "submitted", "pending"].includes(app.status) ? "soft-pulse" : ""}`}>
                        {app.status === "ai_approved" ? "AI Approved" :
                         app.status === "pending_review" ? "Needs Review" :
                         app.status === "submitted" ? "Submitted" :
                         app.status === "need_clarification" ? "Clarification Needed" :
                         app.status === "resubmit_requested" ? "Resubmit Requested" :
                         app.status === "documents_unreadable" ? "Documents Unreadable" :
                         app.status}
                      </Badge>
                      {/* Inline AI confidence meter */}
                      {aiScore >= 0 && (
                        <div className="flex items-center gap-1.5 min-w-[100px]">
                          <Sparkles className={`h-3 w-3 shrink-0 ${
                            aiScore >= 80 ? "text-emerald-500" : aiScore >= 50 ? "text-amber-500" : "text-red-500"
                          }`} />
                          <div className="flex-1">
                            <ConfidenceMeter score={aiScore} size="sm" />
                          </div>
                          <span className={`text-[10px] font-bold ${
                            aiScore >= 80 ? "text-emerald-700 dark:text-emerald-300" : aiScore >= 50 ? "text-amber-700 dark:text-amber-300" : "text-red-700 dark:text-red-300"
                          }`}>{aiScore}%</span>
                        </div>
                      )}
                      {app.ai_confidence && aiScore < 0 && (
                        <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full border ${
                          app.ai_confidence.includes("high") ? "bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-400/30" :
                          app.ai_confidence.includes("medium") ? "bg-amber-50 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-400/30" :
                          "bg-red-50 dark:bg-red-500/15 text-red-700 dark:text-red-300 border-red-200 dark:border-red-400/30"
                        }`}>
                          <Sparkles className="h-3 w-3" />
                          {app.ai_confidence}
                        </span>
                      )}
                      {app.needs_manual_review && (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full bg-amber-50 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-400/30 soft-pulse">
                          <AlertCircle className="h-3 w-3" />
                          Manual Review
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-1.5 text-xs text-muted-foreground flex-wrap">
                      <span className="font-medium">{app.email}</span>
                      <span className="text-border">|</span>
                      <span>{app.phone}</span>
                      <span className="text-border">|</span>
                      <span className="font-semibold">{MEMBERSHIP_TYPE_LABELS[app.membership_type] || app.membership_type}</span>
                      <span className="text-border">|</span>
                      <span className="font-mono">{app.reference_number}</span>
                      <span className="text-border">|</span>
                      <span>{formatDate(app.created_at)}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {isActionable(app.status) && (
                      <div className="relative">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-9 px-3 shadow-sm"
                          onClick={() => setShowActions(showActions === app.id ? null : app.id)}
                        >
                          My Action <ChevronDown className="h-3.5 w-3.5 ml-1.5" />
                        </Button>
                        {showActions === app.id && (
                          <>
                            <div className="fixed inset-0 z-40" onClick={() => setShowActions(null)} />
                            <div className="absolute right-0 top-full mt-1 z-50 w-52 rounded-xl border bg-card shadow-xl py-1.5 animate-in fade-in slide-in-from-top-2 duration-150">
                              <button className="w-full px-4 py-2.5 text-left text-sm font-medium hover:bg-emerald-50 dark:hover:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 flex items-center gap-2.5 transition-colors"
                                onClick={() => { setShowActions(null); setExpandedId(app.id); setActionMode(null); setApproveNotes(""); setActionMessage(""); setRejectReason(""); setInternalNote(""); setShowNotes(null) }}>
                                <CheckCircle className="h-4 w-4" /> Approve
                              </button>
                              <button className="w-full px-4 py-2.5 text-left text-sm font-medium hover:bg-blue-50 dark:hover:bg-blue-500/15 text-blue-700 dark:text-blue-300 flex items-center gap-2.5 transition-colors"
                                onClick={() => { setShowActions(null); setExpandedId(app.id); setActionMode("clarification"); setActionMessage(""); setApproveNotes(""); setRejectReason(""); setInternalNote(""); setShowNotes(null) }}>
                                <MessageSquare className="h-4 w-4" /> Need Clarification
                              </button>
                              <button className="w-full px-4 py-2.5 text-left text-sm font-medium hover:bg-amber-50 dark:hover:bg-amber-500/15 text-amber-700 dark:text-amber-300 flex items-center gap-2.5 transition-colors"
                                onClick={() => { setShowActions(null); setExpandedId(app.id); setActionMode("resubmit"); setActionMessage(""); setApproveNotes(""); setRejectReason(""); setInternalNote(""); setShowNotes(null) }}>
                                <RotateCcw className="h-4 w-4" /> Ask to Resubmit
                              </button>
                              <div className="border-t my-1" />
                              <button className="w-full px-4 py-2.5 text-left text-sm font-medium hover:bg-red-50 dark:hover:bg-red-500/15 text-red-600 dark:text-red-300 flex items-center gap-2.5 transition-colors"
                                onClick={() => { setShowActions(null); setExpandedId(app.id); setActionMode("reject"); setRejectReason(""); setApproveNotes(""); setActionMessage(""); setInternalNote(""); setShowNotes(null) }}>
                                <XCircle className="h-4 w-4" /> Reject
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => { setExpandedId(isExpanded ? null : app.id); setActionMode(null); setApproveNotes(""); setActionMessage(""); setRejectReason(""); setInternalNote(""); setShowNotes(null) }}
                      className={`h-9 w-9 p-0 ${isExpanded ? "bg-accent" : ""}`}
                    >
                      {isExpanded ? <ChevronUp className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>

                {/* ─── Expanded Detail Panel ─────────────────────────── */}
                {isExpanded && (
                  <div className="mt-5 pt-5 border-t space-y-6">

                    {/* Application Timeline */}
                    <div className="bg-muted/30 rounded-xl p-4">
                      <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
                        <Calendar className="h-3.5 w-3.5" /> Application Timeline
                      </p>
                      <ApplicationTimeline app={app} />
                    </div>

                    {/* AI Flags with confidence meters */}
                    {(aiFlags.length > 0 || app.ai_checks) && (
                      <div className="bg-amber-50/50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-400/30 rounded-xl p-4 space-y-4">
                        <p className="text-sm font-bold text-amber-800 dark:text-amber-300 flex items-center gap-2">
                          <Sparkles className="h-4 w-4" /> AI Verification Results
                        </p>

                        {/* Per-check confidence bars */}
                        {app.ai_checks && Array.isArray(app.ai_checks) && (
                          <div className="space-y-2.5">
                            {app.ai_checks.map((check: any, i: number) => (
                              <div key={i} className="flex items-center gap-3">
                                <div className={`flex h-5 w-5 items-center justify-center rounded-full ${
                                  check.passed ? "bg-emerald-100 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-300" : "bg-red-100 dark:bg-red-500/20 text-red-600 dark:text-red-300"
                                }`}>
                                  {check.passed ? <CheckCircle className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                                </div>
                                <ConfidenceMeter score={check.score} label={check.check} />
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Overall score */}
                        {aiScore >= 0 && (
                          <div className="flex items-center gap-3 pt-2 border-t border-amber-200 dark:border-amber-400/30">
                            <span className="text-xs font-bold text-amber-800 dark:text-amber-300">Overall Score</span>
                            <div className="flex-1">
                              <ConfidenceMeter score={aiScore} />
                            </div>
                            <span className={`text-sm font-bold ${
                              aiScore >= 80 ? "text-emerald-700 dark:text-emerald-300" : aiScore >= 50 ? "text-amber-700 dark:text-amber-300" : "text-red-700 dark:text-red-300"
                            }`}>{aiScore}%</span>
                          </div>
                        )}

                        {/* Flag list — cleaned up for admin readability */}
                        {aiFlags.length > 0 && (
                          <div className="space-y-1.5 pt-2 border-t border-amber-200 dark:border-amber-400/30">
                            <p className="text-xs font-semibold text-amber-700 dark:text-amber-300 mb-1.5">Review Notes</p>
                            {aiFlags.map((flag: string, i: number) => {
                              // Parse "Check: score% ✓/✗ — detail" format into structured display
                              const match = flag.match(/^(.+?):\s*(\d+)%\s*(✓|✗)\s*—\s*(.+)$/)
                              if (match) {
                                const [, check, score, status, detail] = match
                                const passed = status === "✓"
                                return (
                                  <div key={i} className="flex items-start gap-2 text-xs">
                                    <span className={`shrink-0 mt-0.5 ${passed ? "text-emerald-600 dark:text-emerald-400" : "text-red-500 dark:text-red-400"}`}>
                                      {passed ? <CheckCircle className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                                    </span>
                                    <span className="text-muted-foreground">
                                      <span className="font-medium text-foreground">{check}</span>
                                      {" — "}{detail}
                                    </span>
                                  </div>
                                )
                              }
                              // Fallback for non-structured flags
                              return (
                                <p key={i} className="text-xs text-amber-700 dark:text-amber-300 flex items-start gap-2">
                                  <AlertCircle className="h-3 w-3 shrink-0 mt-0.5" />
                                  {flag}
                                </p>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Member Profile Panel — 2-column grid */}
                    <div className="grid gap-5 lg:grid-cols-2">
                      {/* Personal Details */}
                      <div className="bg-muted/40 rounded-xl p-5 space-y-3">
                        <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                          <User className="h-3.5 w-3.5" /> Personal Details
                        </p>
                        <div className="flex items-start gap-4">
                          {(profileDoc?.fileUrl || profileDoc?.url) && (
                            <button onClick={() => setLightboxUrl(profileDoc?.fileUrl || profileDoc.url)} className="shrink-0">
                              <img src={profileDoc?.fileUrl || profileDoc.url} alt="Profile" className="h-20 w-20 rounded-xl object-cover border shadow-sm hover:shadow-md transition-shadow" />
                            </button>
                          )}
                          <div className="grid grid-cols-2 gap-x-6 gap-y-2 flex-1 text-sm">
                            <div>
                              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Full Name</span>
                              <p className="font-semibold">{fullName}</p>
                            </div>
                            <div>
                              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Gender / DOB</span>
                              <p>{app.gender || "N/A"} &middot; {formatDate(app.date_of_birth)}</p>
                            </div>
                            <div>
                              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Father&apos;s Name</span>
                              <p>{app.father_name || "N/A"}</p>
                            </div>
                            <div>
                              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Nationality</span>
                              <p>{app.nationality || "Indian"}</p>
                            </div>
                            <div>
                              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Email</span>
                              <p className="truncate">{app.email}</p>
                            </div>
                            <div>
                              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Phone</span>
                              <p>{app.mobile_code || "+91"} {app.phone}</p>
                            </div>
                            <div className="col-span-2">
                              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Address</span>
                              <p className="text-muted-foreground">
                                {[app.street_address_1, app.street_address_2, app.city, app.state, app.postal_code, app.country].filter(Boolean).join(", ") || "N/A"}
                              </p>
                            </div>
                            {app.zone && (
                              <div>
                                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Zone</span>
                                <p>{app.zone}</p>
                              </div>
                            )}
                            <div>
                              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Membership Type</span>
                              <p className="font-medium">{MEMBERSHIP_TYPE_LABELS[app.membership_type] || app.membership_type}</p>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Registration + Payment */}
                      <div className="space-y-5">
                        <div className="bg-muted/40 rounded-xl p-5 space-y-3">
                          <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                            <Stethoscope className="h-3.5 w-3.5" /> Medical Registration
                          </p>
                          <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                            <div>
                              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">MCI / Council No</span>
                              <p className="font-semibold">{app.mci_council_number || "N/A"}</p>
                            </div>
                            <div>
                              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Council State</span>
                              <p>{app.mci_council_state || "N/A"}</p>
                            </div>
                            {app.imr_registration_no && (
                              <div>
                                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">IMR Reg No</span>
                                <p>{app.imr_registration_no}</p>
                              </div>
                            )}
                            {app.asi_membership_no && (
                              <div>
                                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">ASI Membership No</span>
                                <p className="font-medium">{app.asi_membership_no}</p>
                              </div>
                            )}
                            {app.asi_state && (
                              <div>
                                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">ASI State</span>
                                <p>{app.asi_state}</p>
                              </div>
                            )}
                          </div>
                          {/* NMC Verification */}
                          {app.mci_council_number && (
                            <div className="pt-2 border-t">
                              <div className="flex items-center gap-2 flex-wrap">
                                <button
                                  onClick={() => verifyNmc(app.id, app.mci_council_number, app.mci_council_state)}
                                  disabled={nmcResults[app.id]?.loading}
                                  className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-blue-50 dark:bg-blue-500/15 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-400/30 hover:bg-blue-100 dark:hover:bg-blue-500/25 transition-colors disabled:opacity-50"
                                >
                                  {nmcResults[app.id]?.loading ? (
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                  ) : (
                                    <Search className="h-3 w-3" />
                                  )}
                                  {nmcResults[app.id]?.loading ? "Checking..." : "Verify MCI with NMC"}
                                </button>
                                {nmcResults[app.id] && !nmcResults[app.id].loading && (
                                  nmcResults[app.id].verified ? (
                                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-500/15 border border-emerald-200 dark:border-emerald-400/30 px-2 py-1 rounded-full">
                                      <CheckCircle className="h-3 w-3" /> NMC Verified
                                    </span>
                                  ) : nmcResults[app.id].reachable === false ? (
                                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-500/15 border border-amber-200 dark:border-amber-400/30 px-2 py-1 rounded-full">
                                      <AlertCircle className="h-3 w-3" /> Verification unavailable
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-500/15 border border-red-200 dark:border-red-400/30 px-2 py-1 rounded-full">
                                      <XCircle className="h-3 w-3" /> Not found
                                    </span>
                                  )
                                )}
                              </div>
                              {nmcResults[app.id]?.verified && nmcResults[app.id].doctors && nmcResults[app.id].doctors!.length > 0 && (
                                <div className="mt-2 space-y-1.5">
                                  {nmcResults[app.id].doctors!.map((doc: any, idx: number) => (
                                    <div key={idx} className="text-xs bg-emerald-50/60 dark:bg-emerald-500/10 border border-emerald-100 dark:border-emerald-400/20 rounded-lg p-2 grid grid-cols-2 gap-x-4 gap-y-0.5">
                                      <span><span className="text-muted-foreground">Name:</span> <strong>{doc.name}</strong></span>
                                      <span><span className="text-muted-foreground">Council:</span> {doc.council}</span>
                                      <span><span className="text-muted-foreground">Degree:</span> {doc.degree}</span>
                                      <span><span className="text-muted-foreground">University:</span> {doc.university}</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                              {nmcResults[app.id] && !nmcResults[app.id].loading && !nmcResults[app.id].verified && nmcResults[app.id].message && (
                                <p className={`mt-1.5 text-[10px] ${nmcResults[app.id].reachable === false ? "text-amber-700" : "text-red-500"}`}>{nmcResults[app.id].message}</p>
                              )}
                            </div>
                          )}
                          <div className="pt-2 border-t">
                            <span className={`inline-flex items-center text-xs font-semibold px-2.5 py-1 rounded-full ${
                              app.payment_status === "paid"
                                ? "bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-400/30"
                                : "bg-red-50 dark:bg-red-500/15 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-400/30"
                            }`}>
                              {app.payment_status === "paid" ? "Payment Received" : "Payment Pending"}
                            </span>
                            {app.payment_id && <span className="ml-2 text-xs text-muted-foreground font-mono">{app.payment_id}</span>}
                          </div>
                        </div>

                        {/* Clinic Address */}
                        {(app.clinic_name || app.clinic_street_address_1) && (
                          <div className="bg-muted/40 rounded-xl p-5 space-y-2">
                            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Clinic / Work Address</p>
                            <div className="text-sm space-y-1">
                              {app.clinic_name && <p className="font-semibold">{app.clinic_name}</p>}
                              <p className="text-muted-foreground">
                                {[app.clinic_street_address_1, app.clinic_street_address_2, app.clinic_city, app.clinic_state, app.clinic_postal_code, app.clinic_country].filter(Boolean).join(", ")}
                              </p>
                              {(app.std_code || app.landline) && <p className="text-muted-foreground">Tel: {app.std_code ? `(${app.std_code}) ` : ""}{app.landline}</p>}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Education Qualifications Table */}
                    <div className="bg-muted/40 rounded-xl p-5">
                      <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
                        <GraduationCap className="h-3.5 w-3.5" /> Education Qualifications
                      </p>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b">
                              <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground">Level</th>
                              <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground">Degree</th>
                              <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground">College</th>
                              <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground">University</th>
                              <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground">Year</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(app.ug_degree || app.ug_college) && (
                              <tr className="border-b border-muted">
                                <td className="px-3 py-2 font-medium">MBBS</td>
                                <td className="px-3 py-2">{app.ug_degree || "MBBS"}</td>
                                <td className="px-3 py-2 max-w-[200px] truncate">{app.ug_college || "N/A"}</td>
                                <td className="px-3 py-2 max-w-[200px] truncate">{app.ug_university || "N/A"}</td>
                                <td className="px-3 py-2">{app.ug_year || "N/A"}</td>
                              </tr>
                            )}
                            {(app.pg_degree || app.pg_college) && (
                              <tr className="border-b border-muted">
                                <td className="px-3 py-2 font-medium">PG</td>
                                <td className="px-3 py-2">{app.pg_degree || "N/A"}</td>
                                <td className="px-3 py-2 max-w-[200px] truncate">{app.pg_college || "N/A"}</td>
                                <td className="px-3 py-2 max-w-[200px] truncate">{app.pg_university || "N/A"}</td>
                                <td className="px-3 py-2">{app.pg_year || "N/A"}</td>
                              </tr>
                            )}
                            {(app.ss_degree || app.ss_college) && (
                              <tr>
                                <td className="px-3 py-2 font-medium">Super Specialty</td>
                                <td className="px-3 py-2">{app.ss_degree || "N/A"}</td>
                                <td className="px-3 py-2 max-w-[200px] truncate">{app.ss_college || "N/A"}</td>
                                <td className="px-3 py-2 max-w-[200px] truncate">{app.ss_university || "N/A"}</td>
                                <td className="px-3 py-2">{app.ss_year || "N/A"}</td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    {/* Documents with thumbnails */}
                    {Object.keys(docs).length > 0 && (
                      <div>
                        <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
                          <FileText className="h-3.5 w-3.5" /> Uploaded Documents
                        </p>
                        <div className="flex flex-wrap gap-3">
                          {Object.entries(docs).map(([key, doc]: [string, any]) => (
                            <DocThumbnail
                              key={key}
                              docKey={key}
                              doc={doc}
                              onView={() => {
                                const url = doc.fileUrl || doc.url
                                if (url) setLightboxUrl(url)
                                else toast.error("No document URL available")
                              }}
                            />
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Document Comparison View */}
                    {Object.keys(ocrData).length > 0 && (
                      <div>
                        <div className="flex items-center justify-between mb-3">
                          <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                            <Sparkles className="h-3.5 w-3.5" /> AI Extracted Data vs Form Data
                          </p>
                          <button
                            onClick={() => setShowCompare(showCompare === app.id ? null : app.id)}
                            className="text-xs font-medium text-primary hover:underline"
                          >
                            {showCompare === app.id ? "Hide Comparison" : "Show Side-by-Side Comparison"}
                          </button>
                        </div>

                        {showCompare === app.id ? (
                          <div className="overflow-x-auto border rounded-xl">
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="bg-muted/50 border-b">
                                  <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground">Field</th>
                                  <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground">Form Data (Applicant)</th>
                                  <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground">OCR Extracted (AI)</th>
                                </tr>
                              </thead>
                              <tbody>
                                {/* Name comparison across documents */}
                                {Object.entries(ocrData).map(([docType, extracted]: [string, any]) => {
                                  if (!extracted || typeof extracted !== "object") return null
                                  const rows: { label: string; form: string; ocr: string }[] = []
                                  if (extracted.name) {
                                    rows.push({
                                      label: `Name (${docType.replace(/_/g, " ")})`,
                                      form: fullName,
                                      ocr: extracted.name,
                                    })
                                  }
                                  if (extracted.degree) {
                                    rows.push({
                                      label: `Degree (${docType.replace(/_/g, " ")})`,
                                      form: app.pg_degree || app.ug_degree || "",
                                      ocr: extracted.degree,
                                    })
                                  }
                                  if (extracted.college) {
                                    rows.push({
                                      label: `College (${docType.replace(/_/g, " ")})`,
                                      form: app.pg_college || app.ug_college || "",
                                      ocr: extracted.college,
                                    })
                                  }
                                  if (extracted.university) {
                                    rows.push({
                                      label: `University (${docType.replace(/_/g, " ")})`,
                                      form: app.pg_university || app.ug_university || "",
                                      ocr: extracted.university,
                                    })
                                  }
                                  if (extracted.registration_number) {
                                    rows.push({
                                      label: `Reg. No (${docType.replace(/_/g, " ")})`,
                                      form: app.mci_council_number || "",
                                      ocr: extracted.registration_number,
                                    })
                                  }
                                  if (extracted.year) {
                                    rows.push({
                                      label: `Year (${docType.replace(/_/g, " ")})`,
                                      form: app.pg_year || app.ug_year || "",
                                      ocr: extracted.year,
                                    })
                                  }
                                  return rows.map((row, i) => (
                                    <CompareRow key={`${docType}-${i}`} label={row.label} formValue={row.form} ocrValue={row.ocr} />
                                  ))
                                })}
                              </tbody>
                            </table>
                          </div>
                        ) : (
                          /* Compact OCR data view (original) */
                          <div className="bg-muted/50 rounded-xl p-4 text-xs space-y-1.5 max-h-40 overflow-auto font-mono">
                            {Object.entries(ocrData).map(([docType, extracted]: [string, any]) => (
                              <div key={docType}>
                                <span className="font-bold text-foreground">{docType}:</span>{" "}
                                <span className="text-muted-foreground">
                                  {Object.entries(extracted || {})
                                    .filter(([k]) => k !== "is_valid_medical_document" && k !== "rejection_reason")
                                    .map(([k, v]) => `${k}=${v}`)
                                    .join(", ")}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Admin notes for clarification/resubmit */}
                    {app.review_notes && (app.status === "need_clarification" || app.status === "resubmit_requested") && (
                      <div className={`border rounded-xl p-4 ${app.status === "need_clarification" ? "bg-blue-50 dark:bg-blue-500/15 border-blue-200 dark:border-blue-400/30" : "bg-amber-50 dark:bg-amber-500/15 border-amber-200 dark:border-amber-400/30"}`}>
                        <p className={`text-sm font-bold mb-1 flex items-center gap-2 ${app.status === "need_clarification" ? "text-blue-800 dark:text-blue-300" : "text-amber-800 dark:text-amber-300"}`}>
                          {app.status === "need_clarification" ? <MessageSquare className="h-4 w-4" /> : <RotateCcw className="h-4 w-4" />}
                          {app.status === "need_clarification" ? "Clarification Requested" : "Resubmission Requested"}
                        </p>
                        <p className={`text-sm ${app.status === "need_clarification" ? "text-blue-700 dark:text-blue-300" : "text-amber-700 dark:text-amber-300"}`}>{app.review_notes}</p>
                      </div>
                    )}

                    {/* Assigned number */}
                    {app.assigned_amasi_number && (
                      <div className="bg-emerald-50 dark:bg-emerald-500/15 border border-emerald-200 dark:border-emerald-400/30 rounded-xl p-4 flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-500/20">
                          <Shield className="h-5 w-5 text-emerald-600 dark:text-emerald-300" />
                        </div>
                        <div>
                          <p className="text-sm font-bold text-emerald-800 dark:text-emerald-300">AMASI #{app.assigned_amasi_number}</p>
                          <p className="text-xs text-emerald-600 dark:text-emerald-400">{app.review_notes}</p>
                        </div>
                      </div>
                    )}

                    {/* Internal Notes System */}
                    <div className="border rounded-xl p-4 space-y-3">
                      <button
                        onClick={() => setShowNotes(showNotes === app.id ? null : app.id)}
                        className="flex items-center gap-2 text-sm font-semibold text-muted-foreground hover:text-foreground transition-colors w-full"
                      >
                        <StickyNote className="h-4 w-4" />
                        Internal Notes
                        {app.internal_notes && Array.isArray(app.internal_notes) && app.internal_notes.length > 0 && (
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-muted">{app.internal_notes.length}</span>
                        )}
                        <ChevronDown className={`h-3.5 w-3.5 ml-auto transition-transform ${showNotes === app.id ? "rotate-180" : ""}`} />
                      </button>

                      {showNotes === app.id && (
                        <div className="space-y-3 pt-2">
                          {/* Existing notes */}
                          {app.internal_notes && Array.isArray(app.internal_notes) && app.internal_notes.length > 0 && (
                            <div className="space-y-2 max-h-40 overflow-auto">
                              {app.internal_notes.map((note: any, i: number) => (
                                <div key={i} className="bg-muted/50 rounded-lg p-3 text-sm">
                                  <p className="text-muted-foreground">{note.text || note}</p>
                                  {note.date && <p className="text-[10px] text-muted-foreground/60 mt-1">{formatDate(note.date)}</p>}
                                </div>
                              ))}
                            </div>
                          )}
                          {/* Add new note */}
                          <div className="flex gap-2">
                            <Input
                              value={internalNote}
                              onChange={e => setInternalNote(e.target.value)}
                              placeholder="Add an internal note (not sent to applicant)..."
                              className="flex-1 h-9 text-sm"
                              onKeyDown={e => {
                                if (e.key === "Enter" && internalNote.trim()) {
                                  e.stopPropagation()
                                  noteMutation.mutate({ id: app.id, note: internalNote })
                                }
                              }}
                            />
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-9"
                              onClick={() => noteMutation.mutate({ id: app.id, note: internalNote })}
                              disabled={!internalNote.trim() || noteMutation.isPending}
                            >
                              {noteMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save"}
                            </Button>
                          </div>
                          <p className="text-[10px] text-muted-foreground">Notes are private and not visible to the applicant.</p>
                        </div>
                      )}
                    </div>

                    {/* Need Clarification form */}
                    {actionMode === "clarification" && (
                      <div className="bg-blue-50 dark:bg-blue-500/15 border border-blue-200 dark:border-blue-400/30 rounded-xl p-4 space-y-3">
                        <div className="flex items-center gap-2">
                          <MessageSquare className="h-4 w-4 text-blue-600 dark:text-blue-300" />
                          <Label className="text-sm font-semibold text-blue-700 dark:text-blue-300">Need Clarification</Label>
                        </div>
                        <p className="text-xs text-blue-600 dark:text-blue-400">The applicant will receive an email with your message asking for additional information.</p>
                        <Textarea
                          value={actionMessage}
                          onChange={(e) => setActionMessage(e.target.value)}
                          placeholder="e.g. Please provide a clearer copy of your MCI registration certificate..."
                          className="border-blue-200 bg-white dark:bg-slate-900 min-h-[80px]"
                        />
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            className="bg-blue-600 hover:bg-blue-700 text-white shadow-sm"
                            onClick={() => clarificationMutation.mutate({ id: app.id, action: "need_clarification", message: actionMessage })}
                            disabled={!actionMessage.trim() || clarificationMutation.isPending}
                          >
                            {clarificationMutation.isPending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <MessageSquare className="h-4 w-4 mr-1.5" />}
                            Send Clarification Request
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setActionMode(null)}>Cancel</Button>
                        </div>
                      </div>
                    )}

                    {/* Ask to Resubmit form */}
                    {actionMode === "resubmit" && (
                      <div className="bg-amber-50 dark:bg-amber-500/15 border border-amber-200 dark:border-amber-400/30 rounded-xl p-4 space-y-3">
                        <div className="flex items-center gap-2">
                          <RotateCcw className="h-4 w-4 text-amber-600 dark:text-amber-300" />
                          <Label className="text-sm font-semibold text-amber-700 dark:text-amber-300">Ask to Resubmit</Label>
                        </div>
                        <p className="text-xs text-amber-600 dark:text-amber-400">The applicant will receive an email with instructions to correct and resubmit their application.</p>
                        <Textarea
                          value={actionMessage}
                          onChange={(e) => setActionMessage(e.target.value)}
                          placeholder="e.g. Your PG degree certificate appears to be a bank statement. Please upload the correct document..."
                          className="border-amber-200 bg-white dark:bg-slate-900 min-h-[80px]"
                        />
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            className="bg-amber-600 hover:bg-amber-700 text-white shadow-sm"
                            onClick={() => clarificationMutation.mutate({ id: app.id, action: "ask_resubmit", message: actionMessage })}
                            disabled={!actionMessage.trim() || clarificationMutation.isPending}
                          >
                            {clarificationMutation.isPending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <RotateCcw className="h-4 w-4 mr-1.5" />}
                            Send Resubmit Request
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setActionMode(null)}>Cancel</Button>
                        </div>
                      </div>
                    )}

                    {/* Reject form */}
                    {actionMode === "reject" && (
                      <div className="bg-red-50 dark:bg-red-500/15 border border-red-200 dark:border-red-400/30 rounded-xl p-4 space-y-3">
                        <div className="flex items-center gap-2">
                          <XCircle className="h-4 w-4 text-red-600 dark:text-red-300" />
                          <Label className="text-sm font-semibold text-red-700 dark:text-red-300">Reject Application</Label>
                        </div>
                        <Textarea
                          value={rejectReason}
                          onChange={(e) => setRejectReason(e.target.value)}
                          placeholder="e.g. Invalid MCI certificate, degree not verified..."
                          className="border-red-200 bg-white dark:bg-slate-900 min-h-[80px]"
                        />
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="destructive"
                            className="shadow-sm"
                            onClick={() => rejectMutation.mutate({ id: app.id, reason: rejectReason })}
                            disabled={!rejectReason.trim() || rejectMutation.isPending}
                          >
                            {rejectMutation.isPending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <XCircle className="h-4 w-4 mr-1.5" />}
                            Confirm Rejection
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setActionMode(null)}>Cancel</Button>
                        </div>
                      </div>
                    )}

                    {/* Approve with notes (show when no action mode is selected) */}
                    {!actionMode && isActionable(app.status) && (
                      <div className="bg-emerald-50 dark:bg-emerald-500/15 border border-emerald-200 dark:border-emerald-400/30 rounded-xl p-4 space-y-3">
                        <Label className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">Approval Notes (optional)</Label>
                        <Input
                          value={approveNotes}
                          onChange={(e) => setApproveNotes(e.target.value)}
                          placeholder="e.g. Documents verified manually..."
                          className="border-emerald-200 bg-white dark:bg-slate-900"
                        />
                        <Button
                          size="sm"
                          className="bg-emerald-600 hover:bg-emerald-700 shadow-sm"
                          onClick={() => approveMutation.mutate({ id: app.id, notes: approveNotes || "Manually approved" })}
                          disabled={approveMutation.isPending}
                        >
                          {approveMutation.isPending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <CheckCircle className="h-4 w-4 mr-1.5" />}
                          Approve & Assign Membership Number
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          )
        })}
      </div>

      {/* Total count */}
      {data?.total > 0 && (
        <p className="text-sm text-muted-foreground text-center pt-2">
          Showing {applications.length} of {data.total} applications
        </p>
      )}
        </motion.div>
      </AnimatePresence>

      {/* Document Lightbox */}
      <Dialog open={!!lightboxUrl} onOpenChange={() => setLightboxUrl(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh] p-0 overflow-hidden">
          <DialogHeader className="p-4 pb-0">
            <DialogTitle className="text-sm font-semibold">Document Preview</DialogTitle>
          </DialogHeader>
          {lightboxUrl && (
            <div className="p-4 pt-2 flex items-center justify-center max-h-[80vh] overflow-auto">
              {/\.(pdf)/i.test(lightboxUrl) ? (
                <iframe src={lightboxUrl} className="w-full h-[70vh] rounded-lg border" />
              ) : (
                <img src={lightboxUrl} alt="Document" className="max-w-full max-h-[70vh] object-contain rounded-lg" />
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Keyboard Shortcuts Help */}
      <Dialog open={showKeyboardHelp} onOpenChange={setShowKeyboardHelp}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Keyboard className="h-5 w-5" /> Keyboard Shortcuts
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            {[
              { keys: ["Up", "Down"], desc: "Navigate between applications" },
              { keys: ["Enter"], desc: "Expand / collapse application" },
              { keys: ["A"], desc: "Approve expanded application" },
              { keys: ["R"], desc: "Open reject form for expanded application" },
              { keys: ["Esc"], desc: "Close panel / lightbox" },
              { keys: ["?"], desc: "Toggle this help" },
            ].map(({ keys, desc }) => (
              <div key={desc} className="flex items-center justify-between">
                <span className="text-muted-foreground">{desc}</span>
                <div className="flex gap-1">
                  {keys.map(k => (
                    <kbd key={k} className="px-2 py-0.5 rounded bg-muted border text-xs font-mono font-semibold">{k}</kbd>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
