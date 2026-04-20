"use client"

import { Suspense, useState, useEffect, useCallback, useRef } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  Search,
  Loader2,
  FileSearch,
  Award,
  CheckCircle,
  Clock,
  XCircle,
  CreditCard,
  Eye,
  ShieldCheck,
  AlertTriangle,
  Bell,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  FileEdit,
} from "lucide-react"
import { formatDate } from "@/lib/utils"
import { AdminBackLink } from "@/components/ui/admin-back-link"

interface ApplicationData {
  id: string
  reference_number: string
  name: string
  first_name: string
  middle_name: string
  last_name: string
  salutation: string
  membership_type: string
  status: string
  payment_status: string
  ai_confidence: string | null
  ai_verified: boolean
  needs_manual_review: boolean
  review_notes: string | null
  assigned_amasi_number: number | null
  created_at: string
  reviewed_at: string | null
  documents?: Record<string, string> | null
}

function statusBadgeVariant(status: string) {
  switch (status) {
    case "approved":
    case "ai_approved":
      return "success" as const
    case "rejected":
      return "destructive" as const
    case "need_clarification":
    case "resubmit_requested":
      return "warning" as const
    case "pending_review":
    case "submitted":
      return "warning" as const
    default:
      return "secondary" as const
  }
}

function statusLabel(status: string) {
  switch (status) {
    case "approved":
      return "Approved"
    case "rejected":
      return "Rejected"
    case "ai_approved":
      return "AI Approved"
    case "pending_review":
      return "Under Review"
    case "submitted":
      return "Submitted"
    case "need_clarification":
      return "Clarification Needed"
    case "resubmit_requested":
      return "Resubmit Requested"
    default:
      return status
  }
}

function paymentLabel(status: string) {
  switch (status) {
    case "paid":
      return "Paid"
    case "pending":
      return "Pending"
    case "failed":
      return "Failed"
    default:
      return status
  }
}

function membershipTypeLabel(type: string) {
  switch (type) {
    case "LM":
      return "Life Member"
    case "ALM":
      return "Associate Life Member"
    case "ACM":
      return "Associate Candidate Member"
    case "ILM":
      return "International Life Member"
    default:
      return type
  }
}

// ---------------------------------------------------------------------------
// Timeline component
// ---------------------------------------------------------------------------

interface TimelineStep {
  label: string
  description: string
  date?: string
  status: "completed" | "current" | "upcoming" | "error"
  icon: React.ReactNode
  retryPayment?: boolean
}

function getTimelineSteps(app: ApplicationData): TimelineStep[] {
  const steps: TimelineStep[] = []

  // Step 1: Submitted -- always completed if we have data
  steps.push({
    label: "Application Submitted",
    description: "Your application has been received",
    date: app.created_at,
    status: "completed",
    icon: <CheckCircle className="h-5 w-5" />,
  })

  // Step 2: Payment
  const paymentCompleted = app.payment_status === "paid"
  const paymentFailed = app.payment_status === "failed"
  steps.push({
    label: "Payment",
    description: paymentCompleted
      ? "Payment received successfully"
      : paymentFailed
        ? "Payment failed -- please retry"
        : "Awaiting payment confirmation",
    status: paymentFailed
      ? "error"
      : paymentCompleted
        ? "completed"
        : "current",
    icon: paymentCompleted ? (
      <CheckCircle className="h-5 w-5" />
    ) : paymentFailed ? (
      <XCircle className="h-5 w-5" />
    ) : (
      <CreditCard className="h-5 w-5" />
    ),
    ...(paymentFailed ? { retryPayment: true } : {}),
  } as TimelineStep)

  // Step 3: Under Review
  const isReviewing =
    app.status === "pending_review" || app.status === "submitted"
  const pastReview =
    app.status === "approved" ||
    app.status === "ai_approved" ||
    app.status === "rejected"
  const needsClarification =
    app.status === "need_clarification" ||
    app.status === "resubmit_requested"
  steps.push({
    label: "Under Review",
    description: pastReview
      ? "Review completed"
      : needsClarification
        ? "Action required from you"
        : isReviewing
          ? "Your application is being reviewed"
          : "Pending",
    status: pastReview
      ? "completed"
      : needsClarification
        ? "error"
        : isReviewing
          ? "current"
          : "upcoming",
    icon: pastReview ? (
      <CheckCircle className="h-5 w-5" />
    ) : needsClarification ? (
      <AlertTriangle className="h-5 w-5" />
    ) : (
      <Eye className="h-5 w-5" />
    ),
  })

  // Step 4: Decision
  const isApproved = app.status === "approved" || app.status === "ai_approved"
  const isRejected = app.status === "rejected"
  steps.push({
    label: isApproved
      ? "Approved"
      : isRejected
        ? "Rejected"
        : "Decision",
    description: isApproved
      ? "Congratulations! Your membership has been approved"
      : isRejected
        ? "Unfortunately your application was not approved"
        : "Pending decision",
    date: app.reviewed_at || undefined,
    status: isApproved
      ? "completed"
      : isRejected
        ? "error"
        : "upcoming",
    icon: isApproved ? (
      <ShieldCheck className="h-5 w-5" />
    ) : isRejected ? (
      <XCircle className="h-5 w-5" />
    ) : (
      <Clock className="h-5 w-5" />
    ),
  })

  return steps
}

function Timeline({ steps }: { steps: TimelineStep[] }) {
  return (
    <div className="relative">
      {steps.map((step, i) => {
        const isLast = i === steps.length - 1
        const colorMap = {
          completed: "text-green-600 bg-green-50 border-green-200",
          current: "text-primary bg-primary/10 border-primary/30",
          upcoming: "text-muted-foreground bg-muted/50 border-border",
          error: "text-red-500 bg-red-50 border-red-200",
        }
        const lineColor =
          step.status === "completed"
            ? "bg-green-300"
            : step.status === "error"
              ? "bg-red-200"
              : "bg-border"

        return (
          <div key={i} className="flex gap-4">
            {/* Icon column */}
            <div className="flex flex-col items-center">
              <div
                className={`w-10 h-10 rounded-full border-2 flex items-center justify-center shrink-0 ${colorMap[step.status]}`}
              >
                {step.icon}
              </div>
              {!isLast && (
                <div className={`w-0.5 flex-1 min-h-8 ${lineColor}`} />
              )}
            </div>

            {/* Content column */}
            <div className={`pb-6 ${isLast ? "pb-0" : ""}`}>
              <div className="flex items-center gap-2">
                <p
                  className={`font-semibold text-sm ${
                    step.status === "upcoming"
                      ? "text-muted-foreground"
                      : step.status === "error"
                        ? "text-red-700"
                        : "text-foreground"
                  }`}
                >
                  {step.label}
                </p>
                {step.status === "current" && (
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                {step.description}
              </p>
              {step.retryPayment && (
                <a
                  href="/apply"
                  className="inline-flex items-center gap-1.5 mt-2 px-3 py-1.5 rounded-lg bg-red-600 text-white text-xs font-semibold hover:bg-red-700 transition-colors shadow-sm"
                >
                  <CreditCard className="h-3.5 w-3.5" />
                  Retry Payment
                </a>
              )}
              {step.date && (
                <p className="text-xs text-muted-foreground/70 mt-0.5">
                  {formatDate(step.date)}
                </p>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Application card component
// ---------------------------------------------------------------------------

function ApplicationCard({
  app,
  isExpanded,
  onToggle,
  isOnly,
}: {
  app: ApplicationData
  isExpanded: boolean
  onToggle: () => void
  isOnly: boolean
}) {
  const cardRef = useRef<HTMLDivElement>(null)
  const displayName = [app.salutation, app.first_name, app.middle_name, app.last_name]
    .filter(Boolean)
    .join(" ") || app.name

  const steps = getTimelineSteps(app)
  const needsAction =
    app.status === "need_clarification" || app.status === "resubmit_requested"
  const isApproved = app.status === "approved" || app.status === "ai_approved"

  return (
    <Card
      ref={cardRef}
      className={`transition-all duration-200 ${
        needsAction ? "border-amber-300 shadow-amber-100/50 shadow-md" : ""
      } ${isApproved ? "border-green-200" : ""}`}
    >
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            {/* Avatar initial */}
            <div
              className={`w-11 h-11 rounded-full flex items-center justify-center shrink-0 text-sm font-bold ${
                isApproved
                  ? "bg-green-50 text-green-700 border border-green-200"
                  : needsAction
                    ? "bg-amber-50 text-amber-700 border border-amber-200"
                    : "bg-primary/10 text-primary border border-primary/20"
              }`}
            >
              {(app.first_name || app.name || "?").charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <CardTitle className="text-base truncate">{displayName}</CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5 font-mono">
                {app.reference_number}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Badge
              variant={statusBadgeVariant(app.status)}
              className={`${
                needsAction ? "animate-pulse" : ""
              }`}
            >
              {statusLabel(app.status)}
            </Badge>
            {!isOnly && (
              <button
                onClick={() => {
                  onToggle()
                  if (!isExpanded) {
                    setTimeout(() => {
                      cardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
                    }, 50)
                  }
                }}
                className="p-1 rounded-md hover:bg-muted transition-colors"
              >
                {isExpanded ? (
                  <ChevronUp className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                )}
              </button>
            )}
          </div>
        </div>
      </CardHeader>

      {(isExpanded || isOnly) && (
        <CardContent className="space-y-5 pt-0">
          {/* Approved: show AMASI number prominently */}
          {isApproved && app.assigned_amasi_number && (
            <div className="bg-green-50 border border-green-200 rounded-xl p-6 text-center">
              <div className="mx-auto w-12 h-12 rounded-full bg-green-100 flex items-center justify-center mb-3">
                <Award className="h-6 w-6 text-green-600" />
              </div>
              <p className="text-sm text-muted-foreground mb-1">
                Your AMASI Membership Number
              </p>
              <p className="text-4xl font-bold font-mono text-green-700 tracking-wider">
                {app.assigned_amasi_number}
              </p>
              <p className="text-xs text-muted-foreground mt-3">
                Use this number to access your membership card and certificate
              </p>
              <a
                href={`/verify?id=${app.assigned_amasi_number}`}
                className="inline-flex items-center gap-1.5 text-xs text-green-700 hover:underline mt-2"
              >
                View Verification Page
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          )}

          {/* Clarification / Resubmit banner -- prominent with attention indicator */}
          {needsAction && (
            <div className="relative overflow-hidden">
              {/* Animated attention border */}
              <div className="absolute inset-0 rounded-xl border-2 border-amber-400 animate-pulse pointer-events-none" />
              <div
                className={`rounded-xl p-5 ${
                  app.status === "need_clarification"
                    ? "bg-blue-50 border border-blue-200"
                    : "bg-amber-50 border border-amber-200"
                }`}
              >
                <div className="flex items-start gap-3">
                  <div
                    className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${
                      app.status === "need_clarification"
                        ? "bg-blue-100"
                        : "bg-amber-100"
                    }`}
                  >
                    <AlertTriangle
                      className={`h-5 w-5 ${
                        app.status === "need_clarification"
                          ? "text-blue-600"
                          : "text-amber-600"
                      }`}
                    />
                  </div>
                  <div className="flex-1">
                    <p
                      className={`text-sm font-bold mb-1 ${
                        app.status === "need_clarification"
                          ? "text-blue-800"
                          : "text-amber-800"
                      }`}
                    >
                      {app.status === "need_clarification"
                        ? "Action Required: Clarification Needed"
                        : "Action Required: Resubmission Needed"}
                    </p>
                    {app.review_notes && (
                      <p
                        className={`text-sm mb-3 ${
                          app.status === "need_clarification"
                            ? "text-blue-700"
                            : "text-amber-700"
                        }`}
                      >
                        {app.review_notes}
                      </p>
                    )}
                    <a
                      href={`/apply/resubmit?ref=${app.reference_number}`}
                      className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold text-white transition-all shadow-sm hover:shadow-md ${
                        app.status === "need_clarification"
                          ? "bg-blue-600 hover:bg-blue-700"
                          : "bg-amber-600 hover:bg-amber-700"
                      }`}
                    >
                      <FileEdit className="h-4 w-4" />
                      Edit & Resubmit Application
                    </a>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Status Timeline */}
          <div className="bg-muted/30 rounded-xl p-5 border">
            <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
              <Clock className="h-4 w-4 text-muted-foreground" />
              Application Timeline
            </h3>
            <Timeline steps={steps} />
          </div>

          {/* Estimated time notice */}
          {(app.status === "pending_review" || app.status === "submitted") && (
            <div className="flex items-center gap-2.5 bg-primary/5 rounded-lg px-4 py-3 border border-primary/10">
              <Clock className="h-4 w-4 text-primary shrink-0" />
              <p className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">
                  Estimated review time:
                </span>{" "}
                Applications are usually reviewed within 1-2 business days.
              </p>
            </div>
          )}

          {/* Details grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            <div className="space-y-1">
              <span className="text-xs text-muted-foreground uppercase tracking-wide">
                Reference Number
              </span>
              <p className="font-medium font-mono">{app.reference_number}</p>
            </div>
            <div className="space-y-1">
              <span className="text-xs text-muted-foreground uppercase tracking-wide">
                Membership Type
              </span>
              <p className="font-medium">
                {membershipTypeLabel(app.membership_type)}
              </p>
            </div>
            <div className="space-y-1">
              <span className="text-xs text-muted-foreground uppercase tracking-wide">
                Application Status
              </span>
              <p className="font-medium">{statusLabel(app.status)}</p>
            </div>
            <div className="space-y-1">
              <span className="text-xs text-muted-foreground uppercase tracking-wide">
                Payment Status
              </span>
              <p className="font-medium">
                <Badge
                  variant={
                    app.payment_status === "paid" ? "success" : "warning"
                  }
                  className="text-xs"
                >
                  {paymentLabel(app.payment_status)}
                </Badge>
              </p>
            </div>
            <div className="space-y-1">
              <span className="text-xs text-muted-foreground uppercase tracking-wide">
                Submitted
              </span>
              <p className="font-medium">{formatDate(app.created_at)}</p>
            </div>
            {app.reviewed_at && (
              <div className="space-y-1">
                <span className="text-xs text-muted-foreground uppercase tracking-wide">
                  Reviewed
                </span>
                <p className="font-medium">{formatDate(app.reviewed_at)}</p>
              </div>
            )}
          </div>

          {/* Review notes (only show separately if not clarification/resubmit since those have their own banner) */}
          {app.review_notes && !needsAction && (
            <div className="border-t pt-4">
              <h3 className="text-sm font-medium text-muted-foreground mb-1">
                Review Notes
              </h3>
              <p className="text-sm">{app.review_notes}</p>
            </div>
          )}
        </CardContent>
      )}
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Main content
// ---------------------------------------------------------------------------

function StatusContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const refParam = searchParams.get("ref") || ""

  const [query, setQuery] = useState(refParam)
  const [searchRef, setSearchRef] = useState(refParam)
  const [applications, setApplications] = useState<ApplicationData[]>([])
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [expandedIndex, setExpandedIndex] = useState(0)

  useEffect(() => {
    if (!searchRef) return

    let cancelled = false
    setIsLoading(true)
    setError(null)
    setApplications([])
    setExpandedIndex(0)

    fetch(
      `/api/applications/status?ref=${encodeURIComponent(searchRef)}&multi=1`
    )
      .then((res) => res.json())
      .then((json) => {
        if (cancelled) return
        if (json.status) {
          const apps = json.applications || (json.data ? [json.data] : [])
          setApplications(apps)
        } else {
          setError(json.message || "Application not found")
        }
      })
      .catch(() => {
        if (!cancelled) setError("Failed to fetch application status")
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [searchRef])

  const handleSearch = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault()
      const trimmed = query.trim()
      if (!trimmed) return
      setSearchRef(trimmed)
      router.replace(`/apply/status?ref=${encodeURIComponent(trimmed)}`)
    },
    [query, router]
  )


  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Header */}
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-primary/10">
            <FileSearch className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              Track Your Application
            </h1>
            <p className="text-muted-foreground text-sm">
              Check your application status using reference number, email, or
              mobile number
            </p>
          </div>
        </div>
      </div>

      {/* Search form */}
      <form onSubmit={handleSearch} className="flex gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Reference number, email, or mobile number"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9 h-11"
          />
        </div>
        <Button type="submit" disabled={isLoading || !query.trim()} className="h-11">
          {isLoading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Checking...
            </>
          ) : (
            "Check Status"
          )}
        </Button>
      </form>

      {/* Error state */}
      {error && searchRef && (
        <Card className="border-dashed">
          <CardContent className="pt-8 pb-8 text-center space-y-3">
            <div className="mx-auto w-14 h-14 rounded-full bg-muted flex items-center justify-center">
              <FileSearch className="h-7 w-7 text-muted-foreground" />
            </div>
            <p className="font-medium text-foreground">{error}</p>
            <p className="text-sm text-muted-foreground">
              Please verify the reference number and try again. You can also
              search by the email or mobile number you used during application.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Results */}
      {applications.length > 0 && (
        <div className="space-y-4">
          {/* Multiple applications header */}
          {applications.length > 1 && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/50 rounded-lg px-4 py-2.5">
              <FileSearch className="h-4 w-4" />
              <span>
                Found <span className="font-semibold text-foreground">{applications.length}</span> applications
                {" "}matching your search (newest first)
              </span>
            </div>
          )}

          {applications.map((app, i) => (
            <ApplicationCard
              key={app.id}
              app={app}
              isExpanded={expandedIndex === i}
              onToggle={() =>
                setExpandedIndex(expandedIndex === i ? -1 : i)
              }
              isOnly={applications.length === 1}
            />
          ))}

          {/* Bookmark hint */}
          <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/30 rounded-lg px-4 py-3 border border-border">
            <Bell className="h-4 w-4 shrink-0" />
            <span>Bookmark this page to check your status anytime.</span>
          </div>
        </div>
      )}

      {/* Empty state */}
      {!searchRef && !isLoading && applications.length === 0 && (
        <div className="text-center py-8 space-y-4">
          <div className="mx-auto w-16 h-16 rounded-2xl bg-muted/60 flex items-center justify-center">
            <FileSearch className="h-8 w-8 text-muted-foreground/60" />
          </div>
          <div>
            <p className="text-sm text-muted-foreground max-w-sm mx-auto">
              Enter your application reference number (e.g. AMASI-20260401-XXXX),
              registered email, or mobile number to check your application status.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

export default function StatusPage() {
  return (
    <>
      <AdminBackLink />
      <Suspense
        fallback={
          <div className="max-w-2xl mx-auto py-16 text-center">
            <Loader2 className="h-8 w-8 animate-spin mx-auto text-muted-foreground" />
            <p className="text-muted-foreground mt-4">Loading...</p>
          </div>
        }
      >
        <StatusContent />
      </Suspense>
    </>
  )
}
