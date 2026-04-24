import { NextRequest } from "next/server"
import { createAdminClient } from "@/lib/supabase"
import { getAdminSession } from "@/lib/auth"

const STEP_LABELS: Record<number, string> = {
  1: "Select membership type",
  2: "Email verification",
  3: "Document upload",
  4: "Review details",
  5: "Payment",
  6: "Submission",
}

/**
 * Funnel analytics over application_step_events. Returns:
 *   - distinct emails that reached each step in the window
 *   - doc-upload success/failure breakdown
 *   - payment captures
 *   - submissions and their outcome (auto_approved vs pending_review)
 *   - drop-off: `reached_step_N` minus `reached_step_N+1`
 *
 * Window default: last 30 days. Override with ?days=7 (etc).
 */
export async function GET(request: NextRequest) {
  const session = await getAdminSession()
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const days = Math.max(1, Math.min(365, parseInt(request.nextUrl.searchParams.get("days") || "30")))
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()

  const supabase = createAdminClient()

  const { data: events, error } = await supabase
    .from("application_step_events")
    .select("email, event_type, step, status, created_at")
    .gte("created_at", since)
    .limit(50000)

  if (error) {
    console.error("[funnel] fetch error:", error)
    return Response.json({ error: error.message }, { status: 500 })
  }

  const rows = events || []
  const stepCohort = new Map<number, Set<string>>()
  const docOutcome: Record<string, number> = { extracted: 0, rejected: 0, uploaded: 0 }
  let paymentsCaptured = 0
  let submissionsAutoApproved = 0
  let submissionsPendingReview = 0
  const uniqueByEvent: Record<string, Set<string>> = {
    step_entered: new Set(),
    doc_upload: new Set(),
    payment: new Set(),
    submit: new Set(),
  }

  for (const e of rows) {
    if (e.event_type === "step_entered" && typeof e.step === "number") {
      if (!stepCohort.has(e.step)) stepCohort.set(e.step, new Set())
      stepCohort.get(e.step)!.add(e.email)
      uniqueByEvent.step_entered.add(e.email)
    } else if (e.event_type === "doc_upload") {
      const s = (e.status || "unknown") as keyof typeof docOutcome
      if (s in docOutcome) docOutcome[s]++
      uniqueByEvent.doc_upload.add(e.email)
    } else if (e.event_type === "payment" && e.status === "captured") {
      paymentsCaptured++
      uniqueByEvent.payment.add(e.email)
    } else if (e.event_type === "submit") {
      if (e.status === "auto_approved") submissionsAutoApproved++
      else submissionsPendingReview++
      uniqueByEvent.submit.add(e.email)
    }
  }

  const funnel = [1, 2, 3, 4, 5, 6].map((step) => {
    const cohort = stepCohort.get(step)?.size ?? 0
    const next = stepCohort.get(step + 1)?.size ?? 0
    const dropoff = step <= 5 ? cohort - next : null
    return {
      step,
      label: STEP_LABELS[step],
      cohort,
      next_step_cohort: step <= 5 ? next : null,
      dropoff,
      conversion_pct: cohort > 0 && step <= 5 ? Math.round((next / cohort) * 100) : null,
    }
  })

  return Response.json({
    window_days: days,
    since,
    total_events: rows.length,
    funnel,
    doc_upload: {
      extracted: docOutcome.extracted,
      rejected: docOutcome.rejected,
      uploaded: docOutcome.uploaded,
      success_pct: docOutcome.extracted + docOutcome.rejected > 0
        ? Math.round((docOutcome.extracted / (docOutcome.extracted + docOutcome.rejected)) * 100)
        : null,
    },
    payment: { captured: paymentsCaptured },
    submit: {
      auto_approved: submissionsAutoApproved,
      pending_review: submissionsPendingReview,
      total: submissionsAutoApproved + submissionsPendingReview,
    },
    unique_users_by_event: Object.fromEntries(
      Object.entries(uniqueByEvent).map(([k, v]) => [k, v.size])
    ),
  })
}
