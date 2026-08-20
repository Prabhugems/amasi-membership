"use client"

import { useState, useCallback, useEffect, Suspense } from "react"
import { useSearchParams } from "next/navigation"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { motion, AnimatePresence } from "framer-motion"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { EditDraftDialog } from "@/components/admin/edit-draft-dialog"
import { useAdminRole } from "@/hooks/use-admin-role"
import { toast } from "sonner"
import { formatDate } from "@/lib/utils"
import {
  Search, Loader2, Inbox, Eye, Trash2, Send, Clock,
  AlertTriangle, CreditCard, RotateCcw, FileX, PauseCircle,
  XCircle, AlertCircle, Mail, MessageCircle, Pencil, CheckCircle2,
} from "lucide-react"

// ─── Types ──────────────────────────────────────────────────────────────────

type TabFilter = "all" | "in_progress" | "stuck" | "payment_on_hold" | "refund_initiated" | "expired"
type StageFilter = "all" | 1 | 2 | 3 | 4 | 5 | 6
type FaultFilter = "all" | "applicant" | "system"

interface IncompleteDraft {
  id: string
  email: string
  phone: string | number | null
  membership_type: string
  current_step: number
  status: string
  failure_reason: string | null
  payment_status: string | null
  stuck_at: string
  created_at: string
  updated_at: string
}

interface IncompleteCounts {
  total: number
  in_progress?: number
  stuck: number
  payment_on_hold: number
  refund_initiated: number
  expired?: number
  by_step?: Record<number, number>
}

// ─── Constants ──────────────────────────────────────────────────────────────

const STEP_LABELS: Record<number, string> = {
  1: "Select Type",
  2: "Email/OTP Verification",
  3: "Upload Docs",
  4: "Review Details",
  5: "Payment",
  6: "Submission",
}

const STAGE_ORDER: number[] = [1, 2, 3, 4, 5, 6]

const MEMBERSHIP_TYPE_LABELS: Record<string, string> = {
  LM: "Life Member",
  ALM: "Associate Life Member",
  ACM: "Associate Candidate Member",
  ILM: "International Life Member",
}

// Applicant vs system fault categorisation. Prefix-based; legacy free-text
// values (pre-2026-05-26) don't match either prefix and return null.
function getFaultCategory(failureReason: string | null): "applicant" | "system" | null {
  if (!failureReason) return null
  if (failureReason.startsWith("applicant_")) return "applicant"
  if (failureReason.startsWith("system_")) return "system"
  return null
}

function getFailureReasonLabel(failureReason: string | null): string | null {
  if (!failureReason) return null
  const idleMatch = failureReason.match(/^applicant_idle_step_(\d+)$/)
  if (idleMatch) {
    const step = parseInt(idleMatch[1], 10)
    return `Idle at: ${STEP_LABELS[step] || `Step ${step}`}`
  }
  switch (failureReason) {
    case "applicant_unpaid_expired": return "Expired unpaid"
    case "applicant_paid_no_submission": return "Paid but never submitted"
    case "applicant_otp_only_no_formdata": return "Verified email but never started form"
    case "system_payment_verification_failed": return "Payment verified, docs failed validation"
    case "system_upload_failed_no_fileurl": return "Upload to storage failed"
    default: return failureReason
  }
}

const TAB_STYLES: Record<TabFilter, { icon: typeof Clock; activeClass: string; dotColor: string }> = {
  all: { icon: FileX, activeClass: "bg-gray-800 text-white border-gray-800", dotColor: "bg-gray-500" },
  in_progress: { icon: Clock, activeClass: "bg-blue-600 text-white border-blue-600", dotColor: "bg-blue-500" },
  stuck: { icon: AlertTriangle, activeClass: "bg-red-600 text-white border-red-600", dotColor: "bg-red-500" },
  payment_on_hold: { icon: PauseCircle, activeClass: "bg-amber-600 text-white border-amber-600", dotColor: "bg-amber-500" },
  refund_initiated: { icon: RotateCcw, activeClass: "bg-sky-600 text-white border-sky-600", dotColor: "bg-sky-500" },
  expired: { icon: XCircle, activeClass: "bg-slate-600 text-white border-slate-600", dotColor: "bg-slate-500" },
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function timeAgo(date: string) {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000)
  if (seconds < 60) return "just now"
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  return `${Math.floor(seconds / 86400)}d ago`
}

/**
 * Normalize a phone value (bigint/string) to a plain 10-digit Indian number.
 * Strips non-digits, a leading 91 country code, and any leading zero.
 * Returns null if the result is empty / too short to be usable.
 */
function normalizeIndianPhone(raw: string | number | null | undefined): string | null {
  if (raw === null || raw === undefined) return null
  let digits = String(raw).replace(/\D/g, "")
  if (!digits) return null
  if (digits.startsWith("91") && digits.length > 10) {
    digits = digits.slice(2)
  }
  digits = digits.replace(/^0+/, "")
  if (digits.length < 10) return null
  // Collapse to the last 10 digits (defensive — mobile numbers are always 10 locally).
  return digits.slice(-10)
}

function buildWhatsappUrl(phone10: string, stageLabel: string): string {
  const text = `Hi from AMASI — we noticed your membership application is incomplete at the ${stageLabel} step. Can I help you complete it?`
  return `https://wa.me/91${phone10}?text=${encodeURIComponent(text)}`
}

function buildMailtoUrl(email: string, stageLabel: string): string {
  const subject = "Your AMASI application"
  const body = `Hi,\n\nWe noticed your membership application is still incomplete at the ${stageLabel} step. Let us know if we can help you finish it.\n\n— AMASI`
  return `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}

function getPaymentBadge(paymentStatus: string | null) {
  if (paymentStatus === "paid_on_hold") {
    return <Badge className="bg-amber-50 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-400/30 text-xs">Paid (on hold)</Badge>
  }
  if (paymentStatus === "refund_initiated") {
    return <Badge className="bg-sky-50 dark:bg-sky-500/15 text-sky-700 dark:text-sky-300 border border-sky-200 dark:border-sky-400/30 text-xs">Refund initiated</Badge>
  }
  return <Badge variant="outline" className="text-xs text-muted-foreground">None</Badge>
}

// ─── Loading Skeleton ───────────────────────────────────────────────────────

function LoadingSkeleton() {
  return (
    <div className="space-y-3">
      {[1, 2, 3, 4].map((i) => (
        <Card key={i} className="rounded-xl">
          <CardContent className="p-5">
            <div className="flex items-center gap-4 animate-pulse">
              <div className="flex-1 space-y-2">
                <div className="h-4 bg-muted rounded w-48" />
                <div className="h-3 bg-muted rounded w-72" />
              </div>
              <div className="h-8 bg-muted rounded w-24" />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

// ─── Stage Breadcrumb (per-row) ─────────────────────────────────────────────

function StageBreadcrumb({ currentStep }: { currentStep: number }) {
  return (
    <div className="flex items-center gap-1 flex-wrap" aria-label={`Stuck at step ${currentStep}: ${STEP_LABELS[currentStep] ?? ""}`}>
      {STAGE_ORDER.map((step, idx) => {
        const isCurrent = step === currentStep
        const isPast = step < currentStep
        const label = STEP_LABELS[step]
        const base = "inline-flex items-center gap-1.5 h-6 px-2 rounded-md text-[11px] font-medium border transition-colors"
        const stateClass = isCurrent
          ? "bg-teal-600 text-white border-teal-600 shadow-sm"
          : isPast
            ? "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-400/30"
            : "bg-muted/50 text-muted-foreground border-border/60"
        return (
          <span key={step} className="inline-flex items-center gap-1">
            <span className={`${base} ${stateClass}`}>
              <span className={`inline-flex items-center justify-center h-4 w-4 rounded-full text-[10px] font-bold ${
                isCurrent
                  ? "bg-white/25 text-white"
                  : isPast
                    ? "bg-emerald-500/20 text-emerald-700 dark:text-emerald-300"
                    : "bg-muted text-muted-foreground"
              }`}>
                {step}
              </span>
              <span className="whitespace-nowrap">{label}</span>
            </span>
            {idx < STAGE_ORDER.length - 1 && (
              <span className="text-muted-foreground/40 text-[10px]">›</span>
            )}
          </span>
        )
      })}
    </div>
  )
}

// ─── Main Page ──────────────────────────────────────────────────────────────

const VALID_TABS: TabFilter[] = ["all", "in_progress", "stuck", "payment_on_hold", "refund_initiated", "expired"]
const VALID_FAULTS: FaultFilter[] = ["all", "applicant", "system"]

// Pull a display name from the draft's step_data.formData when available.
// Falls back to the email so we always show something the admin can identify
// the applicant by in confirmation dialogs.
function draftDisplayName(draft: IncompleteDraft): string {
  const stepData = (draft as unknown as {
    step_data?: { formData?: { firstName?: string; lastName?: string; salutation?: string } }
  }).step_data
  const fd = stepData?.formData
  if (fd?.firstName && fd?.lastName) {
    const sal = fd.salutation ? `${fd.salutation} ` : ""
    return `${sal}${fd.firstName} ${fd.lastName}`.trim()
  }
  return draft.email
}

function IncompletePageInner() {
  const searchParams = useSearchParams()
  const initialTab = (() => {
    const fromUrl = searchParams.get("status") as TabFilter | null
    return fromUrl && VALID_TABS.includes(fromUrl) ? fromUrl : "all"
  })()
  const [tab, setTab] = useState<TabFilter>(initialTab)
  const initialFault = (() => {
    const fromUrl = searchParams.get("fault") as FaultFilter | null
    return fromUrl && VALID_FAULTS.includes(fromUrl) ? fromUrl : "all"
  })()
  const [fault, setFault] = useState<FaultFilter>(initialFault)
  const [stage, setStage] = useState<StageFilter>("all")
  const [search, setSearch] = useState("")
  const [refundDialogDraft, setRefundDialogDraft] = useState<IncompleteDraft | null>(null)
  const [deleteDialogDraft, setDeleteDialogDraft] = useState<IncompleteDraft | null>(null)
  const [unexpireDialogDraft, setUnexpireDialogDraft] = useState<IncompleteDraft | null>(null)
  const [completeDialogDraft, setCompleteDialogDraft] = useState<IncompleteDraft | null>(null)
  const [editDialogDraft, setEditDialogDraft] = useState<IncompleteDraft | null>(null)
  const [pendingReminderId, setPendingReminderId] = useState<string | null>(null)
  const [pendingResumeId, setPendingResumeId] = useState<string | null>(null)
  const [bulkDialogOpen, setBulkDialogOpen] = useState(false)
  const adminRole = useAdminRole()

  // If the URL ?status param changes (e.g., nav from dashboard widget),
  // sync the active tab.
  useEffect(() => {
    const fromUrl = searchParams.get("status") as TabFilter | null
    if (fromUrl && VALID_TABS.includes(fromUrl) && fromUrl !== tab) {
      setTab(fromUrl)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  useEffect(() => {
    const fromUrl = searchParams.get("fault") as FaultFilter | null
    if (fromUrl && VALID_FAULTS.includes(fromUrl) && fromUrl !== fault) {
      setFault(fromUrl)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  const queryClient = useQueryClient()

  // ─── Fetch counts for stats bar ────────────────────────────────────────
  const { data: counts } = useQuery<IncompleteCounts>({
    queryKey: ["incomplete-counts"],
    queryFn: async () => {
      const res = await fetch("/api/applications/incomplete?action=counts")
      if (!res.ok) throw new Error("Failed to fetch counts")
      return res.json()
    },
  })

  // ─── Fetch drafts list ─────────────────────────────────────────────────
  const { data: draftsData, isLoading, isError } = useQuery<{ drafts: IncompleteDraft[] }>({
    queryKey: ["incomplete-drafts", tab],
    queryFn: async () => {
      const res = await fetch(`/api/applications/incomplete?status=${tab}`)
      if (!res.ok) throw new Error("Failed to fetch drafts")
      return res.json()
    },
  })

  // ─── Mutations ─────────────────────────────────────────────────────────
  const refundMutation = useMutation({
    mutationFn: async (draftId: string) => {
      const res = await fetch("/api/applications/refund", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftId }),
      })
      if (!res.ok) throw new Error("Refund request failed")
      return res.json()
    },
    onSuccess: () => {
      toast.success("Refund initiated successfully")
      queryClient.invalidateQueries({ queryKey: ["incomplete-drafts"] })
      queryClient.invalidateQueries({ queryKey: ["incomplete-counts"] })
      setRefundDialogDraft(null)
    },
    onError: () => {
      toast.error("Failed to initiate refund")
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async (draftId: string) => {
      const res = await fetch("/api/applications/incomplete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", draftId }),
      })
      if (!res.ok) throw new Error("Delete failed")
      return res.json()
    },
    onSuccess: () => {
      toast.success("Draft deleted successfully")
      queryClient.invalidateQueries({ queryKey: ["incomplete-drafts"] })
      queryClient.invalidateQueries({ queryKey: ["incomplete-counts"] })
      setDeleteDialogDraft(null)
    },
    onError: () => {
      toast.error("Failed to delete draft")
    },
  })

  const reminderMutation = useMutation({
    mutationFn: async (draftId: string) => {
      const res = await fetch("/api/applications/incomplete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "send_reminder", draftId }),
      })
      if (!res.ok) throw new Error("Send reminder failed")
      return res.json()
    },
    onMutate: (draftId: string) => {
      setPendingReminderId(draftId)
    },
    onSuccess: () => {
      toast.success("Reminder email sent")
      setPendingReminderId(null)
    },
    onError: () => {
      toast.error("Failed to send reminder")
      setPendingReminderId(null)
    },
  })

  // ─── Bulk reminders preview (eligible count) ─────────────────────────────
  const { data: bulkPreview } = useQuery<{ eligible_count: number; min_hours_idle: number }>({
    queryKey: ["bulk-reminders-preview"],
    queryFn: async () => {
      const res = await fetch("/api/admin/bulk-draft-reminders")
      if (!res.ok) throw new Error("Preview failed")
      return res.json()
    },
    refetchInterval: 60_000,
  })

  const bulkRemindersMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/admin/bulk-draft-reminders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      })
      if (!res.ok) throw new Error("Bulk send failed")
      return res.json() as Promise<{ sent: number; skipped: number; skippedDetails: { email: string; reason: string }[] }>
    },
    onSuccess: (data) => {
      toast.success(`Sent ${data.sent} reminder${data.sent === 1 ? "" : "s"}${data.skipped ? `, skipped ${data.skipped}` : ""}`)
      setBulkDialogOpen(false)
      queryClient.invalidateQueries({ queryKey: ["bulk-reminders-preview"] })
      queryClient.invalidateQueries({ queryKey: ["incomplete-drafts"] })
    },
    onError: () => {
      toast.error("Bulk reminder send failed")
    },
  })

  const resumeMutation = useMutation({
    mutationFn: async (draftId: string) => {
      const res = await fetch("/api/applications/incomplete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "resume", draftId }),
      })
      if (!res.ok) throw new Error("Resume failed")
      return res.json()
    },
    onMutate: (draftId: string) => {
      setPendingResumeId(draftId)
    },
    onSuccess: () => {
      toast.success("Application resumed for the applicant")
      queryClient.invalidateQueries({ queryKey: ["incomplete-drafts"] })
      queryClient.invalidateQueries({ queryKey: ["incomplete-counts"] })
      setPendingResumeId(null)
    },
    onError: () => {
      toast.error("Failed to resume application")
      setPendingResumeId(null)
    },
  })

  // Unexpire — Phase 1 of admin recovery tooling. Calls the new endpoint
  // /api/admin/drafts/[id]/unexpire (super_admin-only). On success the draft
  // flips status='expired' → 'in_progress' with deleted_at cleared, ready
  // for the applicant to resume via /apply.
  const unexpireMutation = useMutation({
    mutationFn: async (draftId: string) => {
      const res = await fetch(`/api/admin/drafts/${draftId}/unexpire`, {
        method: "POST",
      })
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string }
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Failed to restore draft")
      }
      return data
    },
    onSuccess: () => {
      toast.success("Draft restored. Applicant can now resume.")
      queryClient.invalidateQueries({ queryKey: ["incomplete-drafts"] })
      queryClient.invalidateQueries({ queryKey: ["incomplete-counts"] })
      setUnexpireDialogDraft(null)
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to restore draft")
    },
  })

  // Complete & Submit — calls /api/admin/drafts/[id]/complete-and-submit.
  // Promotes a payment_on_hold draft into a pending_review application via
  // the shared promoteDraftToApplication() logic (same as Orphan Payments'
  // "Move to pending action" button, triggered from the draft side instead
  // of the payment side).
  const completeAndSubmitMutation = useMutation({
    mutationFn: async (draftId: string) => {
      const res = await fetch(`/api/admin/drafts/${draftId}/complete-and-submit`, { method: "POST" })
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; referenceNumber?: string; applicationId?: string }
      if (!res.ok || data.ok === false) {
        throw new Error(data.error || "Failed to complete and submit")
      }
      return data as { ok: true; applicationId: string; referenceNumber: string }
    },
    onSuccess: (data) => {
      toast.success(`Submitted for review — reference ${data.referenceNumber}`)
      queryClient.invalidateQueries({ queryKey: ["incomplete-drafts"] })
      queryClient.invalidateQueries({ queryKey: ["incomplete-counts"] })
      // /pending's query key — refreshes if the admin navigates there next
      // in this same tab. Does NOT reach a second tab already open on
      // /pending; that tab needs its own refresh.
      queryClient.invalidateQueries({ queryKey: ["applications"] })
      setCompleteDialogDraft(null)
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to complete and submit")
    },
  })

  // ─── Filter by search + stage ──────────────────────────────────────────
  const drafts = (draftsData?.drafts || []).filter((draft: IncompleteDraft) => {
    if (stage !== "all" && draft.current_step !== stage) return false
    if (fault !== "all") {
      const cat = getFaultCategory(draft.failure_reason)
      if (cat !== fault) return false
    }
    if (!search) return true
    const q = search.toLowerCase()
    return draft.email?.toLowerCase().includes(q)
  })

  // True when a client-side filter (stage / fault / search) is narrowing the
  // loaded list — used to distinguish "this status has nothing" from "filters
  // hid everything" in the empty state.
  const loadedCount = draftsData?.drafts?.length || 0
  const clientFiltersActive = stage !== "all" || fault !== "all" || search.trim() !== ""

  const tabs: { key: TabFilter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "in_progress", label: "In Progress" },
    { key: "stuck", label: "Stuck" },
    { key: "payment_on_hold", label: "Payment on Hold" },
    { key: "refund_initiated", label: "Refund Initiated" },
    { key: "expired", label: "Expired" },
  ]

  const tabCountMap: Record<string, number | undefined> = {
    all: counts?.total,
    in_progress: counts?.in_progress,
    stuck: counts?.stuck,
    payment_on_hold: counts?.payment_on_hold,
    refund_initiated: counts?.refund_initiated,
    expired: counts?.expired,
  }

  // Counts for the stage chips. Fall back to computing from the currently
  // loaded draft list when the server hasn't returned `by_step` yet.
  const stageCountMap: Record<number, number> = (() => {
    // The server's by_step counts are not fault/search aware, so they'd
    // overstate the chips whenever a fault or search filter is active (e.g.
    // showing "Email/OTP 70" while the System-fault list is empty). When such a
    // filter is on, derive the stage counts from the loaded list scoped to that
    // filter so the chips match what the list actually shows.
    const faultOrSearchActive = fault !== "all" || search.trim() !== ""
    if (counts?.by_step && !faultOrSearchActive) return counts.by_step
    const map: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 }
    for (const d of draftsData?.drafts || []) {
      if (fault !== "all" && getFaultCategory(d.failure_reason) !== fault) continue
      if (search.trim() && !d.email?.toLowerCase().includes(search.toLowerCase())) continue
      if (d.current_step >= 1 && d.current_step <= 6) {
        map[d.current_step] = (map[d.current_step] || 0) + 1
      }
    }
    return map
  })()
  const stageTotalCount = STAGE_ORDER.reduce((sum, s) => sum + (stageCountMap[s] || 0), 0)

  // Fault category counts — computed from the currently-loaded draft list.
  // The API hasn't been extended for fault counts; this reflects what's
  // visible in the active status tab.
  const faultCountMap: Record<FaultFilter, number> = (() => {
    const map: Record<FaultFilter, number> = { all: 0, applicant: 0, system: 0 }
    for (const d of draftsData?.drafts || []) {
      map.all++
      const cat = getFaultCategory(d.failure_reason)
      if (cat === "applicant") map.applicant++
      else if (cat === "system") map.system++
    }
    return map
  })()

  // ─── Render action buttons based on status ─────────────────────────────
  const renderActions = useCallback((draft: IncompleteDraft) => {
    // Edit button (Phase 4a) — super_admin only; never shown on in_progress
    // drafts (applicant has an active session, race risk) or completed
    // (doesn't appear on /incomplete anyway). Same gate the server enforces.
    const editBtn =
      adminRole === "super_admin" && draft.status !== "in_progress" && draft.status !== "completed" ? (
        <Button
          size="sm"
          variant="outline"
          className="h-8 px-3 text-xs font-medium text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-400/30 hover:bg-slate-50 dark:hover:bg-slate-500/15 gap-1.5"
          onClick={() => setEditDialogDraft(draft)}
        >
          <Pencil className="h-3 w-3" />
          Edit
        </Button>
      ) : null

    if (draft.status === "in_progress") {
      return (
        <Button size="sm" variant="ghost" className="h-8 px-2.5 text-muted-foreground" disabled>
          <Eye className="h-3.5 w-3.5" />
        </Button>
      )
    }

    if (draft.status === "stuck") {
      return (
        <div className="flex items-center gap-1.5">
          {editBtn}
          <Button
            size="sm"
            variant="outline"
            className="h-8 px-3 text-xs font-medium text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-400/30 hover:bg-blue-50 dark:hover:bg-blue-500/15 gap-1.5"
            onClick={() => reminderMutation.mutate(draft.id)}
            disabled={pendingReminderId === draft.id}
          >
            {pendingReminderId === draft.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
            Send Reminder
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8 px-3 text-xs font-medium text-red-600 dark:text-red-300 border-red-200 dark:border-red-400/30 hover:bg-red-50 dark:hover:bg-red-500/15 gap-1.5"
            onClick={() => setDeleteDialogDraft(draft)}
          >
            <Trash2 className="h-3 w-3" />
            Delete
          </Button>
        </div>
      )
    }

    if (draft.status === "payment_on_hold") {
      return (
        <div className="flex items-center gap-1.5">
          {editBtn}
          {adminRole === "super_admin" && (
            <Button
              size="sm"
              variant="outline"
              className="h-8 px-3 text-xs font-medium text-teal-700 dark:text-teal-300 border-teal-200 dark:border-teal-400/30 hover:bg-teal-50 dark:hover:bg-teal-500/15 gap-1.5"
              onClick={() => setCompleteDialogDraft(draft)}
            >
              <CheckCircle2 className="h-3 w-3" />
              Complete & Submit
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            className="h-8 px-3 text-xs font-medium text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-400/30 hover:bg-emerald-50 dark:hover:bg-emerald-500/15 gap-1.5"
            onClick={() => resumeMutation.mutate(draft.id)}
            disabled={pendingResumeId === draft.id}
          >
            {pendingResumeId === draft.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
            Resume Application
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8 px-3 text-xs font-medium text-red-600 dark:text-red-300 border-red-200 dark:border-red-400/30 hover:bg-red-50 dark:hover:bg-red-500/15 gap-1.5"
            onClick={() => setRefundDialogDraft(draft)}
          >
            <CreditCard className="h-3 w-3" />
            Initiate Refund
          </Button>
        </div>
      )
    }

    if (draft.status === "refund_initiated") {
      return (
        <div className="flex items-center gap-1.5">
          {editBtn}
          <Button size="sm" variant="ghost" className="h-8 px-3 text-xs text-muted-foreground gap-1.5" disabled>
            <RotateCcw className="h-3 w-3" />
            Refund Pending
          </Button>
        </div>
      )
    }

    if (draft.status === "expired") {
      // Unexpire is the only state-transition action for an expired row.
      // Super_admin-gated both client-side (button hidden for non-super_admin
      // per the useAdminRole pattern in CLAUDE.md) and server-side (the
      // endpoint 403s for non-super_admin regardless). Edit button appears
      // alongside it for super_admin via editBtn.
      if (adminRole !== "super_admin") {
        return (
          <Button size="sm" variant="ghost" className="h-8 px-3 text-xs text-muted-foreground gap-1.5" disabled>
            <XCircle className="h-3 w-3" />
            Expired
          </Button>
        )
      }
      return (
        <div className="flex items-center gap-1.5">
          {editBtn}
          <Button
            size="sm"
            variant="outline"
            className="h-8 px-3 text-xs font-medium text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-400/30 hover:bg-emerald-50 dark:hover:bg-emerald-500/15 gap-1.5"
            onClick={() => setUnexpireDialogDraft(draft)}
          >
            <RotateCcw className="h-3 w-3" />
            Unexpire
          </Button>
        </div>
      )
    }

    return null
  }, [reminderMutation, resumeMutation, pendingReminderId, pendingResumeId, adminRole])

  return (
    <div className="space-y-6">
      {/* ─── Page Header ──────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Incomplete Applications</h1>
          <p className="text-muted-foreground mt-1">
            Track and manage draft applications that were not submitted
          </p>
        </div>
        <Button
          onClick={() => setBulkDialogOpen(true)}
          disabled={!bulkPreview || bulkPreview.eligible_count === 0}
          size="sm"
          className="gap-2"
        >
          <Mail className="h-4 w-4" />
          Send Reminders
          {bulkPreview && (
            <span className="ml-1 inline-flex items-center justify-center h-5 min-w-5 px-1.5 text-xs font-bold rounded-full bg-primary-foreground/20">
              {bulkPreview.eligible_count}
            </span>
          )}
        </Button>
      </div>

      {/* ─── Bulk reminder confirm dialog ───────────────────────────────── */}
      <Dialog open={bulkDialogOpen} onOpenChange={setBulkDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send reminder emails?</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm text-muted-foreground">
            <p>
              This will email <strong className="text-foreground">{bulkPreview?.eligible_count ?? 0}</strong> applicants
              whose drafts are idle for at least <strong className="text-foreground">{bulkPreview?.min_hours_idle ?? 24} hours</strong>.
            </p>
            <p>
              Applicants who already submitted a full application, or whose email matches a test/internal pattern, are skipped automatically.
              A second reminder to the same applicant is suppressed for 48 hours.
            </p>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={() => setBulkDialogOpen(false)} disabled={bulkRemindersMutation.isPending}>
              Cancel
            </Button>
            <Button size="sm" onClick={() => bulkRemindersMutation.mutate()} disabled={bulkRemindersMutation.isPending}>
              {bulkRemindersMutation.isPending ? (
                <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" />Sending…</>
              ) : (
                <><Send className="h-4 w-4 mr-1.5" />Send Now</>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ─── Stats Bar ────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="rounded-xl shadow-sm">
          <CardContent className="p-5">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-50 dark:bg-teal-500/15">
                <FileX className="h-5 w-5 text-teal-600 dark:text-teal-300" />
              </div>
              <div>
                <p className="text-2xl font-bold">{counts?.total ?? "--"}</p>
                <p className="text-xs text-muted-foreground font-medium">Total Incomplete</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="rounded-xl shadow-sm">
          <CardContent className="p-5">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-50 dark:bg-red-500/15">
                <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-300" />
              </div>
              <div>
                <p className="text-2xl font-bold">{counts?.stuck ?? "--"}</p>
                <p className="text-xs text-muted-foreground font-medium">Stuck (no payment)</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="rounded-xl shadow-sm">
          <CardContent className="p-5">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50 dark:bg-amber-500/15">
                <PauseCircle className="h-5 w-5 text-amber-600 dark:text-amber-300" />
              </div>
              <div>
                <p className="text-2xl font-bold">{counts?.payment_on_hold ?? "--"}</p>
                <p className="text-xs text-muted-foreground font-medium">Payment on Hold</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="rounded-xl shadow-sm">
          <CardContent className="p-5">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-50 dark:bg-sky-500/15">
                <RotateCcw className="h-5 w-5 text-sky-600 dark:text-sky-300" />
              </div>
              <div>
                <p className="text-2xl font-bold">{counts?.refund_initiated ?? "--"}</p>
                <p className="text-xs text-muted-foreground font-medium">Refund Initiated</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ─── Filter Tabs ──────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-2">
        {tabs.map((t) => {
          const style = TAB_STYLES[t.key]
          const isActive = tab === t.key
          const TabIcon = style.icon
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold border transition-all ${
                isActive
                  ? style.activeClass + " shadow-sm"
                  : "bg-card border-border hover:bg-accent text-muted-foreground hover:text-foreground"
              }`}
            >
              <TabIcon className="h-4 w-4" />
              {t.label}
              {tabCountMap[t.key] !== undefined && (
                <span className={`inline-flex items-center justify-center h-5 min-w-5 px-1.5 text-xs font-bold rounded-full ${
                  isActive ? "bg-white/20 text-inherit" : "bg-muted text-muted-foreground"
                }`}>
                  {tabCountMap[t.key]}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* ─── Fault Chips (applicant vs system fault) ───────────────── */}
      <div className="flex flex-wrap gap-2">
        {(["all", "applicant", "system"] as const).map((f) => {
          const isActive = fault === f
          const label = f === "all" ? "All faults" : f === "applicant" ? "Applicant fault" : "System fault"
          const activeClass = f === "system"
            ? "bg-red-600 border-red-600 text-white shadow-sm"
            : f === "applicant"
              ? "bg-amber-600 border-amber-600 text-white shadow-sm"
              : "bg-teal-600 border-teal-600 text-white shadow-sm"
          return (
            <button
              key={`fault-${f}`}
              onClick={() => setFault(f)}
              className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                isActive
                  ? activeClass
                  : "bg-card border-border hover:bg-accent text-muted-foreground hover:text-foreground"
              }`}
              aria-pressed={isActive}
            >
              <span className="whitespace-nowrap">{label}</span>
              <span className={`inline-flex items-center justify-center h-4 min-w-4 px-1 text-[10px] font-bold rounded-full ${
                isActive ? "bg-white/20 text-inherit" : "bg-muted text-muted-foreground"
              }`}>
                {faultCountMap[f]}
              </span>
            </button>
          )
        })}
      </div>

      {/* ─── Stage Chips (filter by current_step) ───────────────────── */}
      <div className="flex flex-wrap gap-2">
        <button
          key="stage-all"
          onClick={() => setStage("all")}
          className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
            stage === "all"
              ? "bg-teal-600 border-teal-600 text-white shadow-sm"
              : "bg-card border-border hover:bg-accent text-muted-foreground hover:text-foreground"
          }`}
          aria-pressed={stage === "all"}
        >
          All stages
          <span className={`inline-flex items-center justify-center h-4 min-w-4 px-1 text-[10px] font-bold rounded-full ${
            stage === "all" ? "bg-white/20 text-inherit" : "bg-muted text-muted-foreground"
          }`}>
            {stageTotalCount}
          </span>
        </button>
        {STAGE_ORDER.map((s) => {
          const isActive = stage === s
          const label = STEP_LABELS[s]
          const n = stageCountMap[s] ?? 0
          return (
            <button
              key={`stage-${s}`}
              onClick={() => setStage(s as StageFilter)}
              className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                isActive
                  ? "bg-teal-600 border-teal-600 text-white shadow-sm"
                  : "bg-card border-border hover:bg-accent text-muted-foreground hover:text-foreground"
              }`}
              aria-pressed={isActive}
            >
              <span className={`inline-flex items-center justify-center h-4 w-4 rounded-full text-[10px] font-bold ${
                isActive ? "bg-white/20 text-inherit" : "bg-muted text-muted-foreground"
              }`}>
                {s}
              </span>
              <span className="whitespace-nowrap">{label}</span>
              <span className={`inline-flex items-center justify-center h-4 min-w-4 px-1 text-[10px] font-bold rounded-full ${
                isActive ? "bg-white/20 text-inherit" : "bg-muted text-muted-foreground"
              }`}>
                {n}
              </span>
            </button>
          )
        })}
      </div>

      {/* ─── Search Bar ───────────────────────────────────────────────── */}
      <div className="relative max-w-md">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search by email..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-10 h-11 shadow-sm"
        />
      </div>

      {/* ─── Content Area ─────────────────────────────────────────────── */}
      <AnimatePresence mode="wait">
        <motion.div
          key={tab}
          initial={{ opacity: 0, x: 40 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -40 }}
          transition={{ duration: 0.25, ease: "easeOut" }}
          className="space-y-3"
        >
          {/* Loading */}
          {isLoading && <LoadingSkeleton />}

          {/* Error */}
          {isError && (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <AlertCircle className="h-10 w-10 text-destructive mb-3" />
              <p className="text-lg font-medium">Failed to load incomplete applications</p>
              <p className="text-sm text-muted-foreground mt-1">Please try refreshing the page</p>
            </div>
          )}

          {/* Empty state */}
          {!isLoading && !isError && drafts.length === 0 && (
            <Card className="border-dashed rounded-xl">
              <CardContent className="py-16 text-center">
                <Inbox className="h-14 w-14 text-muted-foreground/30 mx-auto mb-4" />
                {loadedCount > 0 && clientFiltersActive ? (
                  <>
                    <p className="text-lg font-semibold">No applications match the active filters</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      {loadedCount} {loadedCount === 1 ? "application is" : "applications are"} hidden by the current filter{
                        [stage !== "all", fault !== "all", search.trim() !== ""].filter(Boolean).length > 1 ? "s" : ""
                      } — clear {loadedCount === 1 ? "it" : "them"} to see {loadedCount === 1 ? "it" : "them"}.
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-4"
                      onClick={() => { setStage("all"); setFault("all"); setSearch("") }}
                    >
                      Clear filters
                    </Button>
                  </>
                ) : (
                  <>
                    <p className="text-lg font-semibold">No incomplete applications</p>
                    <p className="text-sm text-muted-foreground mt-1">All applications are accounted for</p>
                  </>
                )}
              </CardContent>
            </Card>
          )}

          {/* Draft cards */}
          {!isLoading && !isError && drafts.map((draft) => {
            const stepLabel = STEP_LABELS[draft.current_step] || `Step ${draft.current_step}`
            const membershipLabel = MEMBERSHIP_TYPE_LABELS[draft.membership_type] || draft.membership_type || "N/A"
            const phone10 = normalizeIndianPhone(draft.phone)

            const borderClass =
              draft.status === "stuck" ? "border-l-4 border-l-red-400" :
              draft.status === "payment_on_hold" ? "border-l-4 border-l-amber-400" :
              draft.status === "refund_initiated" ? "border-l-4 border-l-sky-400" :
              draft.status === "in_progress" ? "border-l-4 border-l-blue-400" :
              ""

            return (
              <Card
                key={draft.id}
                className={`rounded-xl transition-all hover:shadow-md ${borderClass}`}
              >
                <CardContent className="p-5">
                  <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                    {/* Left: Info */}
                    <div className="flex-1 min-w-0 space-y-2.5">
                      {/* Top row: email + badges */}
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-bold text-sm truncate">{draft.email}</p>
                        {phone10 && (
                          <>
                            <span className="text-border hidden sm:inline">|</span>
                            <span className="text-xs text-muted-foreground">+91 {phone10}</span>
                          </>
                        )}
                        <span className="text-border hidden sm:inline">|</span>
                        <span className="text-xs font-semibold text-muted-foreground">{membershipLabel}</span>
                      </div>

                      {/* Stage breadcrumb */}
                      <StageBreadcrumb currentStep={draft.current_step} />

                      {/* Secondary row: payment, time */}
                      <div className="flex items-center gap-3 flex-wrap text-xs">
                        {getPaymentBadge(draft.payment_status)}
                        <span className="text-border">|</span>
                        <span className="inline-flex items-center gap-1 text-muted-foreground">
                          <Clock className="h-3 w-3" />
                          {timeAgo(draft.stuck_at || draft.updated_at)}
                        </span>
                      </div>

                      {/* Failure reason — categorised */}
                      {draft.failure_reason && (() => {
                        const cat = getFaultCategory(draft.failure_reason)
                        const label = getFailureReasonLabel(draft.failure_reason)
                        const colorClass = cat === "system"
                          ? "text-red-600 dark:text-red-400"
                          : cat === "applicant"
                            ? "text-amber-600 dark:text-amber-400"
                            : "text-muted-foreground"
                        return (
                          <p className={`text-xs flex items-start gap-1.5 ${colorClass}`}>
                            <XCircle className="h-3 w-3 shrink-0 mt-0.5" />
                            {label}
                          </p>
                        )
                      })()}
                    </div>

                    {/* Right: Contact + Actions */}
                    <div className="shrink-0 flex items-center gap-2">
                      <div className="flex items-center gap-1">
                        {phone10 && (
                          <a
                            href={buildWhatsappUrl(phone10, stepLabel)}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="WhatsApp"
                            aria-label={`WhatsApp ${draft.email}`}
                            className="inline-flex items-center justify-center h-8 w-8 rounded-lg border border-border text-emerald-600 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-500/15 hover:border-emerald-200 dark:hover:border-emerald-400/30 transition-colors"
                          >
                            <MessageCircle className="h-4 w-4" />
                          </a>
                        )}
                        <a
                          href={buildMailtoUrl(draft.email, stepLabel)}
                          title="Email"
                          aria-label={`Email ${draft.email}`}
                          className="inline-flex items-center justify-center h-8 w-8 rounded-lg border border-border text-blue-600 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-500/15 hover:border-blue-200 dark:hover:border-blue-400/30 transition-colors"
                        >
                          <Mail className="h-4 w-4" />
                        </a>
                      </div>
                      {renderActions(draft)}
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })}

          {/* Total count */}
          {draftsData?.drafts && draftsData.drafts.length > 0 && (
            <p className="text-sm text-muted-foreground text-center pt-2">
              Showing {drafts.length} of {draftsData.drafts.length} incomplete applications
              {clientFiltersActive && drafts.length !== draftsData.drafts.length ? " (filtered)" : ""}
            </p>
          )}
        </motion.div>
      </AnimatePresence>

      {/* ─── Refund Confirmation Dialog ────────────────────────────────── */}
      <Dialog open={!!refundDialogDraft} onOpenChange={() => setRefundDialogDraft(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600 dark:text-red-400">
              <CreditCard className="h-5 w-5" />
              Initiate Refund
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Are you sure? This will refund the payment to the applicant. Refunds take 5-7 business days.
            </p>
            {refundDialogDraft && (
              <div className="bg-muted/50 rounded-lg p-3 text-sm space-y-1">
                <p><span className="font-medium text-muted-foreground">Email:</span> {refundDialogDraft.email}</p>
                <p><span className="font-medium text-muted-foreground">Draft ID:</span> <span className="font-mono text-xs">{refundDialogDraft.id}</span></p>
              </div>
            )}
            <div className="flex gap-3 justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setRefundDialogDraft(null)}
                disabled={refundMutation.isPending}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                variant="destructive"
                className="gap-1.5 shadow-sm"
                onClick={() => refundDialogDraft && refundMutation.mutate(refundDialogDraft.id)}
                disabled={refundMutation.isPending}
              >
                {refundMutation.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <CreditCard className="h-3.5 w-3.5" />
                )}
                Confirm Refund
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ─── Delete Confirmation Dialog ────────────────────────────────── */}
      <Dialog open={!!deleteDialogDraft} onOpenChange={() => setDeleteDialogDraft(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600 dark:text-red-400">
              <Trash2 className="h-5 w-5" />
              Delete Draft Application
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Are you sure you want to permanently delete this draft application? This action cannot be undone.
            </p>
            {deleteDialogDraft && (
              <div className="bg-muted/50 rounded-lg p-3 text-sm space-y-1">
                <p><span className="font-medium text-muted-foreground">Email:</span> {deleteDialogDraft.email}</p>
                <p><span className="font-medium text-muted-foreground">Stuck at:</span> {STEP_LABELS[deleteDialogDraft.current_step] || `Step ${deleteDialogDraft.current_step}`}</p>
              </div>
            )}
            <div className="flex gap-3 justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setDeleteDialogDraft(null)}
                disabled={deleteMutation.isPending}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                variant="destructive"
                className="gap-1.5 shadow-sm"
                onClick={() => deleteDialogDraft && deleteMutation.mutate(deleteDialogDraft.id)}
                disabled={deleteMutation.isPending}
              >
                {deleteMutation.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Trash2 className="h-3.5 w-3.5" />
                )}
                Confirm Delete
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ─── Unexpire Confirmation Dialog ──────────────────────────────── */}
      <ConfirmDialog
        open={!!unexpireDialogDraft}
        onOpenChange={(o) => { if (!o) setUnexpireDialogDraft(null) }}
        title="Restore expired draft?"
        description={
          unexpireDialogDraft
            ? `${draftDisplayName(unexpireDialogDraft)}'s application will be moved back to in-progress. They can resume from where they left off via /apply (email + OTP). Draft ID: ${unexpireDialogDraft.id.slice(0, 8)}.`
            : undefined
        }
        confirmLabel="Restore Draft"
        onConfirm={() => unexpireDialogDraft && unexpireMutation.mutate(unexpireDialogDraft.id)}
        isPending={unexpireMutation.isPending}
      />

      {/* ─── Complete & Submit Confirmation Dialog ─────────────────────── */}
      <ConfirmDialog
        open={!!completeDialogDraft}
        onOpenChange={(o) => { if (!o) setCompleteDialogDraft(null) }}
        title="Complete & submit this application?"
        confirmLabel="Complete & Submit"
        onConfirm={() => completeDialogDraft && completeAndSubmitMutation.mutate(completeDialogDraft.id)}
        isPending={completeAndSubmitMutation.isPending}
      >
        {completeDialogDraft && (
          <div className="space-y-3">
            <div className="bg-muted/50 rounded-lg p-3 text-sm space-y-1">
              <p><span className="font-medium text-muted-foreground">Applicant:</span> {draftDisplayName(completeDialogDraft)}</p>
              <p><span className="font-medium text-muted-foreground">Email:</span> {completeDialogDraft.email}</p>
              <p><span className="font-medium text-muted-foreground">Membership type:</span> {completeDialogDraft.membership_type}</p>
            </div>
            <p>
              This submits the application for manual review. It will never be
              auto-approved — a staff member still has to review and approve
              it in the Pending queue before {draftDisplayName(completeDialogDraft)} becomes a member.
            </p>
          </div>
        )}
      </ConfirmDialog>

      {/* ─── Edit Draft Fields Dialog (Phase 4a) ───────────────────────── */}
      {/* key prop forces a remount when the selected draft changes so the
          form's lazy initial state picks up the new draft's values without
          a useEffect (which would lint-warn for setState-in-effect). */}
      <EditDraftDialog
        key={editDialogDraft?.id ?? "closed"}
        open={!!editDialogDraft}
        onOpenChange={(o) => { if (!o) setEditDialogDraft(null) }}
        draftId={editDialogDraft?.id ?? null}
        displayName={editDialogDraft ? draftDisplayName(editDialogDraft) : ""}
        initialValues={(() => {
          if (!editDialogDraft) return {}
          const fd = (editDialogDraft as unknown as {
            step_data?: { formData?: Record<string, unknown> }
          }).step_data?.formData ?? {}
          return {
            salutation: typeof fd.salutation === "string" ? fd.salutation : "",
            firstName: typeof fd.firstName === "string" ? fd.firstName : "",
            middleName: typeof fd.middleName === "string" ? fd.middleName : "",
            lastName: typeof fd.lastName === "string" ? fd.lastName : "",
            dob: typeof fd.dob === "string" ? fd.dob : "",
            mobileCode: typeof fd.mobileCode === "string" ? fd.mobileCode : "",
            mobile: typeof fd.mobile === "string" ? fd.mobile : "",
            mciCouncilNumber: typeof fd.mciCouncilNumber === "string" ? fd.mciCouncilNumber : "",
            mciCouncilState: typeof fd.mciCouncilState === "string" ? fd.mciCouncilState : "",
          }
        })()}
        onSaved={(updated) => {
          const n = Object.keys(updated).length
          toast.success(n > 0 ? `Updated ${n} field${n === 1 ? "" : "s"}` : "No changes saved")
          queryClient.invalidateQueries({ queryKey: ["incomplete-drafts"] })
          queryClient.invalidateQueries({ queryKey: ["incomplete-counts"] })
          setEditDialogDraft(null)
        }}
      />
    </div>
  )
}

export default function IncompletePage() {
  return (
    <Suspense
      fallback={
        <div className="py-20 text-center text-sm text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />
          Loading incomplete applications…
        </div>
      }
    >
      <IncompletePageInner />
    </Suspense>
  )
}
