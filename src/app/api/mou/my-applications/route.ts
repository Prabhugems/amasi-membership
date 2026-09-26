// @auth: public — requires an OTP-verified-within-2h row for the given
// email (re-checked here, server-side; never trust the client only calls
// this after a real verify). Reuses the existing /api/mou/otp/send +
// /api/mou/otp/verify (both already public) — no new OTP infrastructure.
// Lists an applicant's own applications by email, for the case where they
// no longer have the per-application edit link from their confirmation
// email.
import { NextRequest } from "next/server"
import { createAdminClient } from "@/lib/supabase"
import { checkRateLimit } from "@/lib/rate-limit"

const OTP_WINDOW_MS = 2 * 60 * 60 * 1000 // 2h — matches src/lib/mou/applicant-auth.ts's window

export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
  const rl = await checkRateLimit(`mou-my-applications:${ip}`, 10, 60 * 60 * 1000)
  if (!rl.allowed) {
    return Response.json({ status: false, message: "Too many attempts. Please try again later." }, { status: 429 })
  }

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return Response.json({ status: false, message: "Invalid request" }, { status: 400 })
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : ""
  if (!email) {
    return Response.json({ status: false, message: "Email is required" }, { status: 400 })
  }

  const supabase = createAdminClient()
  const windowStart = new Date(Date.now() - OTP_WINDOW_MS).toISOString()
  const { data: otpCheck } = await supabase
    .from("otp_codes")
    .select("id")
    .eq("email", email)
    .eq("verified", true)
    .gte("created_at", windowStart)
    .limit(1)
    .maybeSingle()

  if (!otpCheck) {
    return Response.json({ status: false, message: "Please verify your email via OTP first." }, { status: 401 })
  }

  const { data: applications, error } = await supabase
    .from("academic_event_applications")
    .select("id, application_type_id, status, event_name, created_at")
    .ilike("email", email)
    .order("created_at", { ascending: false })

  if (error) {
    return Response.json({ status: false, message: "Failed to load your applications." }, { status: 500 })
  }

  return Response.json({ status: true, applications: applications ?? [] })
}
