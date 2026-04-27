"use client"

import * as Sentry from "@sentry/nextjs"
import { Suspense, useState, useCallback, useRef } from "react"
import { useSearchParams } from "next/navigation"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  Loader2,
  MapPin,
  CheckCircle,
  Clock,
  XCircle,
  CreditCard,
  Eye,
  ShieldCheck,
  AlertTriangle,
  Award,
  FileEdit,
  ArrowRight,
  Mail,
  RotateCcw,
  UserCheck,
  Sparkles,
  FileSearch,
  HeartHandshake,
} from "lucide-react"
import { formatDate } from "@/lib/utils"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function maskEmail(email: string): string {
  const [local, domain] = email.split("@")
  const visible = local.slice(0, 2)
  return `${visible}***@${domain}`
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
    case "documents_unreadable":
      return "warning" as const
    default:
      return "secondary" as const
  }
}

function statusLabel(status: string) {
  switch (status) {
    case "approved":
      return "Approved"
    case "ai_approved":
      return "Approved"
    case "rejected":
      return "Rejected"
    case "pending_review":
      return "Under Review"
    case "submitted":
      return "Under Review"
    case "need_clarification":
      return "Clarification Needed"
    case "resubmit_requested":
      return "Resubmit Requested"
    case "documents_unreadable":
      return "Documents Unreadable"
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
// Timeline — 7 stages mapped from the v5 applicant flow
// ---------------------------------------------------------------------------

interface TimelineStep {
  id: string
  label: string
  description: string
  date?: string
  status: "completed" | "current" | "waiting" | "upcoming" | "error"
  icon: React.ReactNode
}

function buildTimeline(app: ApplicationData): TimelineStep[] {
  const isApproved = app.status === "approved" || app.status === "ai_approved"
  const isRejected = app.status === "rejected"
  const isAiApproved = app.status === "ai_approved"
  const needsClarification =
    app.status === "need_clarification" ||
    app.status === "resubmit_requested" ||
    app.status === "documents_unreadable"
  const paymentPaid = app.payment_status === "paid"
  const paymentFailed = app.payment_status === "failed"
  const underReview = app.status === "pending_review" || app.status === "submitted"
  const pastReview = isApproved || isRejected

  const steps: TimelineStep[] = []

  // 1. Application submitted
  steps.push({
    id: "submitted",
    label: "Application Received",
    description: "Your application has been received by AMASI.",
    date: app.created_at,
    status: "completed",
    icon: <CheckCircle className="h-4 w-4" />,
  })

  // 2. Payment
  steps.push({
    id: "payment",
    label: "Payment",
    description: paymentPaid
      ? "Membership fee received."
      : paymentFailed
        ? "Payment failed — please retry from your application."
        : "Awaiting payment confirmation.",
    status: paymentFailed ? "error" : paymentPaid ? "completed" : "current",
    icon: paymentPaid ? (
      <CheckCircle className="h-4 w-4" />
    ) : paymentFailed ? (
      <XCircle className="h-4 w-4" />
    ) : (
      <CreditCard className="h-4 w-4" />
    ),
  })

  // 3. Documents verified (OCR / extraction step)
  // All submitted apps have passed document checks at submit time
  steps.push({
    id: "documents",
    label: "Documents Verified",
    description:
      app.status === "documents_unreadable"
        ? "Some documents could not be read clearly. Please reupload."
        : "Your submitted documents have been processed.",
    status: app.status === "documents_unreadable" ? "error" : "completed",
    icon:
      app.status === "documents_unreadable" ? (
        <AlertTriangle className="h-4 w-4" />
      ) : (
        <CheckCircle className="h-4 w-4" />
      ),
  })

  // 4. AI screening
  steps.push({
    id: "ai",
    label: "AI Screening",
    description: isAiApproved
      ? `Auto-approved${app.ai_confidence ? ` (confidence: ${app.ai_confidence})` : ""}.`
      : app.ai_verified
        ? `Screened${app.ai_confidence ? ` — confidence: ${app.ai_confidence}` : ""}. Referred for manual review.`
        : needsClarification || underReview
          ? "AI screening complete."
          : pastReview
            ? "AI screening complete."
            : "Queued for AI screening.",
    status:
      isAiApproved || app.ai_verified || underReview || needsClarification || pastReview
        ? "completed"
        : "upcoming",
    icon: <Sparkles className="h-4 w-4" />,
  })

  // 5. Manual review
  if (!isAiApproved) {
    steps.push({
      id: "review",
      label: "Manual Review",
      description: pastReview
        ? "Review completed."
        : needsClarification
          ? "Reviewer flagged your application — action required."
          : underReview
            ? "Your application is being reviewed by the AMASI team."
            : "Pending manual review.",
      status: pastReview
        ? "completed"
        : needsClarification
          ? "error"
          : underReview
            ? "current"
            : "upcoming",
      date: app.reviewed_at && needsClarification ? app.reviewed_at : undefined,
      icon: pastReview ? (
        <CheckCircle className="h-4 w-4" />
      ) : needsClarification ? (
        <AlertTriangle className="h-4 w-4" />
      ) : (
        <Eye className="h-4 w-4" />
      ),
    })

    // 6. Clarification (only shown when active)
    if (needsClarification) {
      steps.push({
        id: "clarification",
        label:
          app.status === "resubmit_requested"
            ? "Resubmission Required"
            : app.status === "documents_unreadable"
              ? "Documents Need Reupload"
              : "Clarification Required",
        description:
          app.review_notes ||
          "The reviewer has flagged your application. Please check the action below.",
        status: "waiting",
        icon: <UserCheck className="h-4 w-4" />,
      })
    }
  }

  // 7. Decision
  steps.push({
    id: "decision",
    label: isApproved ? "Approved" : isRejected ? "Rejected" : "Decision",
    description: isApproved
      ? "Congratulations — your membership has been approved!"
      : isRejected
        ? "Your application was not approved."
        : "Awaiting final decision.",
    date: isApproved || isRejected ? app.reviewed_at || undefined : undefined,
    status: isApproved ? "completed" : isRejected ? "error" : "upcoming",
    icon: isApproved ? (
      <ShieldCheck className="h-4 w-4" />
    ) : isRejected ? (
      <XCircle className="h-4 w-4" />
    ) : (
      <Clock className="h-4 w-4" />
    ),
  })

  return steps
}

// ---------------------------------------------------------------------------
// Timeline renderer
// ---------------------------------------------------------------------------

function Timeline({ steps }: { steps: TimelineStep[] }) {
  const colorMap: Record<TimelineStep["status"], string> = {
    completed: "text-green-600 bg-green-50 border-green-200",
    current: "text-primary bg-primary/10 border-primary/30",
    waiting: "text-amber-600 bg-amber-50 border-amber-200",
    upcoming: "text-muted-foreground bg-muted/50 border-border",
    error: "text-red-500 bg-red-50 border-red-200",
  }
  const lineColor: Record<TimelineStep["status"], string> = {
    completed: "bg-green-300",
    current: "bg-primary/40",
    waiting: "bg-amber-200",
    upcoming: "bg-border",
    error: "bg-red-200",
  }

  return (
    <div className="relative">
      {steps.map((step, i) => {
        const isLast = i === steps.length - 1
        return (
          <div key={step.id} className="flex gap-4">
            <div className="flex flex-col items-center">
              <div
                className={`w-9 h-9 rounded-full border-2 flex items-center justify-center shrink-0 ${colorMap[step.status]}`}
              >
                {step.icon}
              </div>
              {!isLast && (
                <div className={`w-0.5 flex-1 min-h-7 ${lineColor[step.status]}`} />
              )}
            </div>
            <div className={`pb-5 ${isLast ? "pb-0" : ""}`}>
              <div className="flex items-center gap-2">
                <p
                  className={`font-semibold text-sm ${
                    step.status === "upcoming"
                      ? "text-muted-foreground"
                      : step.status === "error"
                        ? "text-red-700"
                        : step.status === "waiting"
                          ? "text-amber-700"
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
                {step.status === "waiting" && (
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-500 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500" />
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">{step.description}</p>
              {step.date && (
                <p className="text-xs text-muted-foreground/60 mt-0.5">{formatDate(step.date)}</p>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// "What's next" CTA card
// ---------------------------------------------------------------------------

function NextStepCard({ app }: { app: ApplicationData }) {
  const isApproved = app.status === "approved" || app.status === "ai_approved"
  const isRejected = app.status === "rejected"
  const needsClarification =
    app.status === "need_clarification" ||
    app.status === "resubmit_requested" ||
    app.status === "documents_unreadable"
  const underReview = app.status === "pending_review" || app.status === "submitted"

  if (isApproved) {
    return (
      <div className="rounded-xl bg-green-50 border border-green-200 p-5">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-full bg-green-100 flex items-center justify-center shrink-0">
            <HeartHandshake className="h-5 w-5 text-green-600" />
          </div>
          <div className="flex-1">
            <p className="font-semibold text-green-800 text-sm mb-1">
              Welcome to AMASI!
            </p>
            {app.assigned_amasi_number && (
              <p className="text-sm text-green-700 mb-3">
                Your membership number is{" "}
                <span className="font-bold font-mono">{app.assigned_amasi_number}</span>.
              </p>
            )}
            <a
              href="/member"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-green-600 text-white text-sm font-semibold hover:bg-green-700 transition-colors"
            >
              Access Member Portal
              <ArrowRight className="h-4 w-4" />
            </a>
          </div>
        </div>
      </div>
    )
  }

  if (isRejected) {
    return (
      <div className="rounded-xl bg-red-50 border border-red-200 p-5">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-full bg-red-100 flex items-center justify-center shrink-0">
            <XCircle className="h-5 w-5 text-red-500" />
          </div>
          <div className="flex-1">
            <p className="font-semibold text-red-800 text-sm mb-1">
              Application Not Approved
            </p>
            {app.review_notes && (
              <p className="text-sm text-red-700 mb-3">{app.review_notes}</p>
            )}
            <p className="text-xs text-red-600/80 mb-3">
              If you believe this is an error, please contact the AMASI membership team.
            </p>
            <Link
              href="/support"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-semibold hover:bg-red-700 transition-colors"
            >
              Contact Support
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </div>
    )
  }

  if (needsClarification) {
    const isResubmit =
      app.status === "resubmit_requested" || app.status === "documents_unreadable"
    return (
      <div className="relative overflow-hidden rounded-xl">
        <div className="absolute inset-0 border-2 border-amber-400 rounded-xl animate-pulse pointer-events-none" />
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-5">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-full bg-amber-100 flex items-center justify-center shrink-0">
              <AlertTriangle className="h-5 w-5 text-amber-600" />
            </div>
            <div className="flex-1">
              <p className="font-semibold text-amber-800 text-sm mb-1">
                Action Required — Your Response Needed
              </p>
              {app.review_notes && (
                <p className="text-sm text-amber-700 mb-3">{app.review_notes}</p>
              )}
              <a
                href={`/apply/resubmit?ref=${app.reference_number}`}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-600 text-white text-sm font-semibold hover:bg-amber-700 transition-colors"
              >
                <FileEdit className="h-4 w-4" />
                {isResubmit ? "Reupload Documents" : "Update & Resubmit"}
              </a>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (underReview) {
    return (
      <div className="rounded-xl bg-primary/5 border border-primary/10 p-5">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
            <Clock className="h-5 w-5 text-primary" />
          </div>
          <div>
            <p className="font-semibold text-foreground text-sm mb-1">
              Under Review — No Action Needed
            </p>
            <p className="text-sm text-muted-foreground">
              The AMASI team reviews applications within <span className="font-medium text-foreground">1–2 business days</span>.
              You&apos;ll receive an email once a decision is made.
            </p>
          </div>
        </div>
      </div>
    )
  }

  // Payment failed
  if (app.payment_status === "failed") {
    return (
      <div className="rounded-xl bg-red-50 border border-red-200 p-5">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-full bg-red-100 flex items-center justify-center shrink-0">
            <CreditCard className="h-5 w-5 text-red-500" />
          </div>
          <div className="flex-1">
            <p className="font-semibold text-red-800 text-sm mb-1">Payment Required</p>
            <p className="text-sm text-red-700 mb-3">
              Your payment did not go through. Please retry to complete your application.
            </p>
            <a
              href="/apply"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-semibold hover:bg-red-700 transition-colors"
            >
              <CreditCard className="h-4 w-4" />
              Retry Payment
            </a>
          </div>
        </div>
      </div>
    )
  }

  return null
}

// ---------------------------------------------------------------------------
// Application result card
// ---------------------------------------------------------------------------

function ApplicationResult({ app }: { app: ApplicationData }) {
  const isApproved = app.status === "approved" || app.status === "ai_approved"
  const needsClarification =
    app.status === "need_clarification" ||
    app.status === "resubmit_requested" ||
    app.status === "documents_unreadable"

  const displayName = [app.salutation, app.first_name, app.middle_name, app.last_name]
    .filter(Boolean)
    .join(" ") || app.name

  const timeline = buildTimeline(app)

  return (
    <Card
      className={`${needsClarification ? "border-amber-300 shadow-amber-100/50 shadow-md" : ""} ${isApproved ? "border-green-200" : ""}`}
    >
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <div
              className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 text-sm font-bold ${
                isApproved
                  ? "bg-green-50 text-green-700 border border-green-200"
                  : needsClarification
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
          <Badge
            variant={statusBadgeVariant(app.status)}
            className={needsClarification ? "animate-pulse" : ""}
          >
            {statusLabel(app.status)}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-5 pt-0">
        {/* AMASI number for approved */}
        {isApproved && app.assigned_amasi_number && (
          <div className="bg-green-50 border border-green-200 rounded-xl p-5 text-center">
            <div className="mx-auto w-11 h-11 rounded-full bg-green-100 flex items-center justify-center mb-3">
              <Award className="h-5 w-5 text-green-600" />
            </div>
            <p className="text-xs text-muted-foreground mb-1">Your AMASI Membership Number</p>
            <p className="text-4xl font-bold font-mono text-green-700 tracking-wider">
              {app.assigned_amasi_number}
            </p>
            <p className="text-xs text-muted-foreground mt-2">
              {membershipTypeLabel(app.membership_type)}
            </p>
          </div>
        )}

        {/* What's next CTA */}
        <NextStepCard app={app} />

        {/* Timeline */}
        <div className="bg-muted/30 rounded-xl p-5 border">
          <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
            <MapPin className="h-4 w-4 text-muted-foreground" />
            Application Timeline
          </h3>
          <Timeline steps={timeline} />
        </div>

        {/* Details grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <div>
            <span className="text-xs text-muted-foreground uppercase tracking-wide">
              Reference
            </span>
            <p className="font-medium font-mono mt-0.5">{app.reference_number}</p>
          </div>
          <div>
            <span className="text-xs text-muted-foreground uppercase tracking-wide">
              Membership Type
            </span>
            <p className="font-medium mt-0.5">{membershipTypeLabel(app.membership_type)}</p>
          </div>
          <div>
            <span className="text-xs text-muted-foreground uppercase tracking-wide">
              Submitted
            </span>
            <p className="font-medium mt-0.5">{formatDate(app.created_at)}</p>
          </div>
          <div>
            <span className="text-xs text-muted-foreground uppercase tracking-wide">
              Payment
            </span>
            <div className="mt-0.5">
              <Badge
                variant={app.payment_status === "paid" ? "success" : "warning"}
                className="text-xs"
              >
                {app.payment_status === "paid"
                  ? "Paid"
                  : app.payment_status === "failed"
                    ? "Failed"
                    : "Pending"}
              </Badge>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Phase: identify — email or reference number input
// ---------------------------------------------------------------------------

function IdentifyPhase({
  onOtpSent,
}: {
  onOtpSent: (email: string, referenceNumber: string, maskedDisplay: string) => void
}) {
  const searchParams = useSearchParams()
  const initialRef = searchParams.get("ref") || ""

  const [input, setInput] = useState(initialRef)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      const value = input.trim()
      if (!value) return

      setIsLoading(true)
      setError(null)

      try {
        const isEmail = value.includes("@")
        const body = isEmail
          ? { email: value }
          : { referenceNumber: value }

        const res = await fetch("/api/track/send-otp", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        })
        const data = await res.json()

        if (data.ok) {
          // Server no longer returns email/maskedEmail (oracle fix).
          // Mask client-side for email input; ref-number path uses generic display.
          const masked = isEmail ? maskEmail(value) : ""
          onOtpSent(isEmail ? value : "", isEmail ? "" : value, masked)
        } else {
          setError(data.message || "Something went wrong.")
        }
      } catch {
        setError("Network error. Please try again.")
      } finally {
        setIsLoading(false)
      }
    },
    [input, onOtpSent]
  )

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">Track Your Application</h1>
        <p className="text-muted-foreground text-sm">
          Enter your registered email address or application reference number. We&apos;ll send
          a one-time code to verify it&apos;s you.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="space-y-1.5">
          <label htmlFor="track-input" className="text-sm font-medium">
            Email or Reference Number
          </label>
          <Input
            id="track-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="e.g. doctor@example.com or AMASI-2026-1234"
            className="h-11"
            disabled={isLoading}
            autoFocus
          />
        </div>

        {error && (
          <p className="text-sm text-red-600 flex items-center gap-1.5">
            <XCircle className="h-4 w-4 shrink-0" />
            {error}
          </p>
        )}

        <Button type="submit" className="w-full h-11" disabled={isLoading || !input.trim()}>
          {isLoading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Sending code…
            </>
          ) : (
            <>
              Send Verification Code
              <ArrowRight className="ml-2 h-4 w-4" />
            </>
          )}
        </Button>
      </form>

      <p className="text-xs text-muted-foreground text-center">
        We&apos;ll send a 6-digit code to the email address on your application.
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Phase: OTP entry
// ---------------------------------------------------------------------------

function OtpPhase({
  email,
  referenceNumber,
  maskedEmail,
  onVerified,
  onBack,
}: {
  email: string
  referenceNumber: string
  maskedEmail: string
  onVerified: (applications: ApplicationData[]) => void
  onBack: () => void
}) {
  if (!email && !referenceNumber) {
    console.error("TrackPage: OtpPhase rendered without email or referenceNumber — impossible state")
    Sentry.captureException(new Error("TrackPage: OtpPhase without email or referenceNumber"))
    return null
  }

  const [code, setCode] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [isResending, setIsResending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resendMsg, setResendMsg] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleVerify = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      const trimmed = code.trim()
      if (trimmed.length !== 6) return

      setIsLoading(true)
      setError(null)

      try {
        const verifyBody: Record<string, string> = { code: trimmed }
        if (email) verifyBody.email = email
        else verifyBody.referenceNumber = referenceNumber

        const res = await fetch("/api/track/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(verifyBody),
        })
        const data = await res.json()

        if (data.status) {
          onVerified(data.applications)
        } else {
          setError(data.message || "Incorrect code.")
        }
      } catch {
        setError("Network error. Please try again.")
      } finally {
        setIsLoading(false)
      }
    },
    [code, email, onVerified]
  )

  const handleResend = useCallback(async () => {
    setIsResending(true)
    setResendMsg(null)
    setError(null)

    try {
      const resendBody: Record<string, string> = {}
      if (email) resendBody.email = email
      else resendBody.referenceNumber = referenceNumber

      const res = await fetch("/api/track/send-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(resendBody),
      })
      const data = await res.json()
      if (data.ok) {
        setResendMsg("New code sent — check your inbox.")
        setCode("")
        inputRef.current?.focus()
      } else {
        setError(data.message || "Could not resend code.")
      }
    } catch {
      setError("Network error. Please try again.")
    } finally {
      setIsResending(false)
    }
  }, [email])

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">Enter Verification Code</h1>
        <p className="text-muted-foreground text-sm">
          We sent a 6-digit code to{" "}
          <span className="font-medium text-foreground">
            {maskedEmail || "the email address on your application"}
          </span>.
          Enter it below to view your application status.
        </p>
      </div>

      <form onSubmit={handleVerify} className="space-y-3">
        <div className="space-y-1.5">
          <label htmlFor="otp-code" className="text-sm font-medium">
            6-Digit Code
          </label>
          <Input
            id="otp-code"
            ref={inputRef}
            value={code}
            onChange={(e) => {
              const v = e.target.value.replace(/\D/g, "").slice(0, 6)
              setCode(v)
            }}
            placeholder="123456"
            inputMode="numeric"
            className="h-11 text-center font-mono text-lg tracking-widest"
            disabled={isLoading}
            autoFocus
          />
        </div>

        {error && (
          <p className="text-sm text-red-600 flex items-center gap-1.5">
            <XCircle className="h-4 w-4 shrink-0" />
            {error}
          </p>
        )}

        {resendMsg && (
          <p className="text-sm text-green-700 flex items-center gap-1.5">
            <CheckCircle className="h-4 w-4 shrink-0" />
            {resendMsg}
          </p>
        )}

        <Button
          type="submit"
          className="w-full h-11"
          disabled={isLoading || code.trim().length !== 6}
        >
          {isLoading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Verifying…
            </>
          ) : (
            <>
              View My Application Status
              <ArrowRight className="ml-2 h-4 w-4" />
            </>
          )}
        </Button>
      </form>

      <div className="flex items-center justify-between text-sm">
        <button
          type="button"
          onClick={onBack}
          className="text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1.5"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Change email / ref
        </button>
        <button
          type="button"
          onClick={handleResend}
          disabled={isResending}
          className="text-primary hover:underline transition-colors flex items-center gap-1.5 disabled:opacity-50"
        >
          {isResending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Mail className="h-3.5 w-3.5" />
          )}
          Resend code
        </button>
      </div>

      <p className="text-xs text-muted-foreground text-center">
        Code expires in 10 minutes. Check your spam folder if you don&apos;t see it.
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Phase: result — show timeline(s)
// ---------------------------------------------------------------------------

function ResultPhase({
  applications,
  onReset,
}: {
  applications: ApplicationData[]
  onReset: () => void
}) {
  if (!applications || applications.length === 0) {
    console.error("TrackPage: ResultPhase rendered with empty applications — impossible state")
    Sentry.captureException(new Error("TrackPage: ResultPhase with empty applications"))
    return null
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Your Application Status</h1>
          {applications.length > 1 && (
            <p className="text-xs text-muted-foreground mt-0.5">
              {applications.length} applications found — newest first
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onReset}
          className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1.5 transition-colors"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Check another
        </button>
      </div>

      {applications.map((app) => (
        <ApplicationResult key={app.id} app={app} />
      ))}

      <p className="text-xs text-center text-muted-foreground">
        Bookmark this page to check your status anytime — just re-enter your email or reference number.
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Root inner component — uses useSearchParams so must be inside <Suspense>
// ---------------------------------------------------------------------------

function TrackContent() {
  type Phase = "identify" | "otp" | "result"
  const [phase, setPhase] = useState<Phase>("identify")
  const [email, setEmail] = useState("")
  const [referenceNumber, setReferenceNumber] = useState("")
  const [maskedEmail, setMaskedEmail] = useState("")
  const [applications, setApplications] = useState<ApplicationData[]>([])

  const handleOtpSent = useCallback(
    (resolvedEmail: string, refNum: string, masked: string) => {
      setEmail(resolvedEmail)
      setReferenceNumber(refNum)
      setMaskedEmail(masked)
      setPhase("otp")
    },
    []
  )

  const handleVerified = useCallback(
    (apps: ApplicationData[]) => {
      setApplications(apps)
      setPhase("result")
    },
    []
  )

  const handleReset = useCallback(() => {
    setPhase("identify")
    setEmail("")
    setReferenceNumber("")
    setMaskedEmail("")
    setApplications([])
  }, [])

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-xl mx-auto px-4 py-12 sm:py-16">
        {/* Brand header */}
        <div className="flex items-center gap-2 mb-8">
          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
            <FileSearch className="h-4 w-4 text-primary" />
          </div>
          <span className="text-sm font-semibold text-muted-foreground tracking-wide uppercase">
            AMASI Membership
          </span>
        </div>

        {phase === "identify" && <IdentifyPhase onOtpSent={handleOtpSent} />}

        {phase === "otp" && (
          <OtpPhase
            email={email}
            referenceNumber={referenceNumber}
            maskedEmail={maskedEmail}
            onVerified={handleVerified}
            onBack={handleReset}
          />
        )}

        {phase === "result" && (
          <ResultPhase applications={applications} onReset={handleReset} />
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page export — wraps TrackContent in Suspense per AGENTS.md requirement
// ---------------------------------------------------------------------------

export default function TrackPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <TrackContent />
    </Suspense>
  )
}
