import { NextRequest } from "next/server"
import * as Sentry from "@sentry/nextjs"
import { createAdminClient } from "@/lib/supabase"
import { checkRateLimit } from "@/lib/rate-limit"

// Security: constant-time response to prevent timing-based enumeration oracle.
// The found+correct-code path runs: OTP read + 2 updates + application fetch +
// step-events fetch (~250ms at the 95th percentile). The not-found path must be
// padded to the same budget so latency does not reveal whether a valid OTP exists.
// Jitter (±JITTER_MS) defeats statistical aggregation over repeated samples.
const TIMING_BUDGET_MS = 400
const TIMING_JITTER_MS = 75

function timingDelay(): Promise<void> {
  const jitter = Math.floor(Math.random() * TIMING_JITTER_MS * 2) - TIMING_JITTER_MS
  return new Promise(r => setTimeout(r, TIMING_BUDGET_MS + jitter))
}

export async function POST(request: NextRequest) {
  try {
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
    const rl = await checkRateLimit(`track-verify:${ip}`, 10, 15 * 60 * 1000)
    if (!rl.allowed) {
      return Response.json(
        { status: false, message: "Too many attempts. Please try again later." },
        { status: 429 }
      )
    }

    const { email: emailInput, referenceNumber, code } = await request.json()

    if (!code) {
      return Response.json({ status: false, message: "Code is required." }, { status: 400 })
    }
    if (!emailInput && !referenceNumber) {
      return Response.json({ status: false, message: "Email or reference number is required." }, { status: 400 })
    }

    const supabase = createAdminClient()

    // Look up the most recent unexpired OTP scoped to the identifier used at send-otp time.
    // Reference-number path: match on reference_number column (written by send-otp).
    // Email path: match on email column.
    let otpQuery = supabase
      .from("otp_codes")
      .select("*")
      .eq("verified", false)
      .gte("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(1)

    if (referenceNumber?.trim()) {
      otpQuery = otpQuery.eq("reference_number", referenceNumber.trim().toUpperCase())
    } else {
      otpQuery = otpQuery.eq("email", emailInput.toLowerCase().trim())
    }

    const { data: otpRecord, error: otpError } = await otpQuery.single()

    if (otpError || !otpRecord) {
      // timingDelay() equalises latency with the found path (constant-time oracle fix).
      await timingDelay()
      return Response.json(
        { status: false, message: "No valid OTP found. Please request a new one." },
        { status: 400 }
      )
    }

    if (otpRecord.attempts >= 5) {
      return Response.json(
        { status: false, message: "Too many incorrect attempts. Please request a new OTP." },
        { status: 429 }
      )
    }

    await supabase
      .from("otp_codes")
      .update({ attempts: otpRecord.attempts + 1 })
      .eq("id", otpRecord.id)

    if (otpRecord.code !== code.trim()) {
      const remaining = 5 - (otpRecord.attempts + 1)
      return Response.json(
        {
          status: false,
          message: `Incorrect code. ${remaining} attempt${remaining !== 1 ? "s" : ""} remaining.`,
        },
        { status: 400 }
      )
    }

    await supabase.from("otp_codes").update({ verified: true }).eq("id", otpRecord.id)

    // Scope the application fetch to exactly the reference_number recorded in the OTP row.
    // This prevents a single known reference_number from unlocking the full application
    // history for an email that has multiple applications.
    // If reference_number is null (email-path OTP), fall back to all applications for that email.
    let applications
    let appsError

    if (otpRecord.reference_number) {
      const result = await supabase
        .from("membership_applications")
        .select(
          `id, reference_number, name, first_name, middle_name, last_name, salutation,
           membership_type, status, payment_status, ai_confidence, ai_verified,
           needs_manual_review, review_notes, assigned_amasi_number,
           created_at, reviewed_at`
        )
        .eq("reference_number", otpRecord.reference_number)
        .maybeSingle()

      applications = result.data ? [result.data] : []
      appsError = result.error
    } else {
      const emailKey = otpRecord.email
      const result = await supabase
        .from("membership_applications")
        .select(
          `id, reference_number, name, first_name, middle_name, last_name, salutation,
           membership_type, status, payment_status, ai_confidence, ai_verified,
           needs_manual_review, review_notes, assigned_amasi_number,
           created_at, reviewed_at`
        )
        .eq("email", emailKey)
        .order("created_at", { ascending: false })

      applications = result.data
      appsError = result.error
    }

    if (appsError) {
      console.error("[track/verify] apps fetch error:", appsError)
      return Response.json({ status: false, message: "Failed to fetch application data." }, { status: 500 })
    }

    if (!applications || applications.length === 0) {
      return Response.json(
        { status: false, message: "No applications found." },
        { status: 404 }
      )
    }

    // Fetch step events scoped to the application(s) returned above.
    const applicationIds = applications.map((a: { id: string }) => a.id)
    const { data: stepEvents } = await supabase
      .from("application_step_events")
      .select("application_id, event_type, step, status, metadata, created_at")
      .in("application_id", applicationIds)
      .order("created_at", { ascending: true })

    return Response.json({
      status: true,
      applications,
      stepEvents: stepEvents || [],
    })
  } catch (error: unknown) {
    console.error("[track/verify] unexpected error:", error)
    Sentry.captureException(error)
    return Response.json({ status: false, message: "Verification failed. Please try again." }, { status: 500 })
  }
}
