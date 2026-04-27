import { NextRequest } from "next/server"
import { createAdminClient } from "@/lib/supabase"
import { checkRateLimit } from "@/lib/rate-limit"

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

    const { email, code } = await request.json()

    if (!email || !code) {
      return Response.json({ status: false, message: "Email and code are required." }, { status: 400 })
    }

    const supabase = createAdminClient()
    const emailKey = email.toLowerCase().trim()

    const { data: otpRecord, error: otpError } = await supabase
      .from("otp_codes")
      .select("*")
      .eq("email", emailKey)
      .eq("verified", false)
      .gte("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .single()

    if (otpError || !otpRecord) {
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

    // Fetch all applications for this email, newest first
    const { data: applications, error: appsError } = await supabase
      .from("membership_applications")
      .select(
        `id, reference_number, name, first_name, middle_name, last_name, salutation,
         membership_type, status, payment_status, ai_confidence, ai_verified,
         needs_manual_review, review_notes, assigned_amasi_number,
         created_at, reviewed_at`
      )
      .eq("email", emailKey)
      .order("created_at", { ascending: false })

    if (appsError) {
      console.error("[track/verify] apps fetch error:", appsError)
      return Response.json({ status: false, message: "Failed to fetch application data." }, { status: 500 })
    }

    if (!applications || applications.length === 0) {
      return Response.json(
        { status: false, message: "No applications found for this email." },
        { status: 404 }
      )
    }

    // Fetch step events for this email (for the activity log)
    const { data: stepEvents } = await supabase
      .from("application_step_events")
      .select("application_id, event_type, step, status, metadata, created_at")
      .eq("email", emailKey)
      .order("created_at", { ascending: true })

    return Response.json({
      status: true,
      applications,
      stepEvents: stepEvents || [],
    })
  } catch (error: unknown) {
    console.error("[track/verify] unexpected error:", error)
    return Response.json({ status: false, message: "Verification failed. Please try again." }, { status: 500 })
  }
}
