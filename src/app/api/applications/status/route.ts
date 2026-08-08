import { NextRequest } from "next/server"
import { createAdminClient } from "@/lib/supabase"
import { checkRateLimit } from "@/lib/rate-limit"
import { getMemberSession } from "@/lib/auth"
import { signDocumentsAcrossRows } from "@/lib/storage-url"

// Return all fields needed for status display AND resubmit form
const SELECT_FIELDS = "id, reference_number, name, first_name, middle_name, last_name, salutation, email, phone, mobile_code, membership_type, status, payment_status, ai_confidence, ai_verified, needs_manual_review, review_notes, assigned_amasi_number, created_at, reviewed_at, date_of_birth, gender, father_name, nationality, street_address_1, street_address_2, city, state, country, postal_code, zone, pg_degree, pg_college, pg_university, pg_year, ug_college, mci_council_number, mci_council_state, asi_membership_no, documents"

// Fields safe to return to anonymous callers (status display only — see
// /apply/status page). The DOB, address, education, MCI/council numbers,
// uploaded documents, and father_name are stripped unless the caller proves
// they own the row. `email` and `phone` stay in the public response: the
// resubmit flow's OTP step (ProfileOtp) needs the email to send the code,
// and the public response was already echoing whatever the caller searched
// for (an email/phone lookup necessarily reveals the matching email/phone).
const PUBLIC_STATUS_FIELDS = new Set([
  "id",
  "reference_number",
  "name",
  "first_name",
  "middle_name",
  "last_name",
  "salutation",
  "email",
  "phone",
  "mobile_code",
  "membership_type",
  "status",
  "payment_status",
  "ai_confidence",
  "ai_verified",
  "needs_manual_review",
  "review_notes",
  "assigned_amasi_number",
  "created_at",
  "reviewed_at",
])

function redactRow<T extends Record<string, unknown> | null | undefined>(row: T): T {
  if (!row || typeof row !== "object") return row
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(row)) {
    if (PUBLIC_STATUS_FIELDS.has(key)) out[key] = (row as Record<string, unknown>)[key]
  }
  return out as T
}

/**
 * Caller may see the full row when either:
 *   - they have a verified member session whose email matches the row's email
 *     (an approved member checking their own historic application), OR
 *   - they completed an OTP for this email within the last 2 hours
 *     (same gate the /api/applications/resubmit handler uses).
 * Otherwise we redact PII and return only fields needed to display a status
 * pill and timeline.
 */
async function callerOwnsRow(
  supabase: ReturnType<typeof createAdminClient>,
  rowEmail: string | null | undefined,
): Promise<boolean> {
  if (!rowEmail || typeof rowEmail !== "string") return false
  const lowered = rowEmail.toLowerCase()

  // Member session match
  const session = await getMemberSession()
  if (typeof session?.email === "string" && session.email.toLowerCase() === lowered) {
    return true
  }

  // Recently verified OTP for this email
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
  const { data: otpCheck } = await supabase
    .from("otp_codes")
    .select("id")
    .eq("email", lowered)
    .eq("verified", true)
    .gte("created_at", twoHoursAgo)
    .limit(1)
    .maybeSingle()

  return !!otpCheck
}

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("ref") || request.nextUrl.searchParams.get("q")
  const multi = request.nextUrl.searchParams.get("multi") === "1"

  if (!query || !query.trim()) {
    return Response.json(
      { status: false, message: "Please enter your reference number, email, or mobile number" },
      { status: 400 }
    )
  }

  // Rate limit: 15 requests per 15 minutes per IP
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
  const rl = await checkRateLimit(`appstatus:${ip}`, 15, 15 * 60 * 1000)
  if (!rl.allowed) {
    return Response.json({ status: false, message: "Too many requests" }, { status: 429 })
  }

  try {
    const supabase = createAdminClient()
    const q = query.trim()
    let data = null
    let dataList: unknown[] | null = null

    // Search by reference number first
    if (q.startsWith("AMASI-")) {
      const { data: result } = await supabase
        .from("membership_applications")
        .select(SELECT_FIELDS)
        .eq("reference_number", q)
        .single()
      data = result
    }

    // Search by email
    if (!data && q.includes("@")) {
      if (multi) {
        const { data: results } = await supabase
          .from("membership_applications")
          .select(SELECT_FIELDS)
          .ilike("email", q)
          .order("created_at", { ascending: false })
          .limit(10)
        dataList = results
        data = results?.[0] || null
      } else {
        const { data: result } = await supabase
          .from("membership_applications")
          .select(SELECT_FIELDS)
          .ilike("email", q)
          .order("created_at", { ascending: false })
          .limit(1)
          .single()
        data = result
      }
    }

    // Search by phone
    if (!data && /^\d{10}$/.test(q)) {
      if (multi) {
        const { data: results } = await supabase
          .from("membership_applications")
          .select(SELECT_FIELDS)
          .eq("phone", q)
          .order("created_at", { ascending: false })
          .limit(10)
        dataList = results
        data = results?.[0] || null
      } else {
        const { data: result } = await supabase
          .from("membership_applications")
          .select(SELECT_FIELDS)
          .eq("phone", q)
          .order("created_at", { ascending: false })
          .limit(1)
          .single()
        data = result
      }
    }

    // Fallback: try as reference number without prefix
    if (!data) {
      const { data: result } = await supabase
        .from("membership_applications")
        .select(SELECT_FIELDS)
        .eq("reference_number", q)
        .single()
      data = result
    }

    if (!data) {
      return Response.json(
        { status: false, message: "No application found. Please check your reference number, email, or mobile number." },
        { status: 404 }
      )
    }

    // Gate full row on ownership; otherwise redact PII. The /apply/status page
    // only consumes PUBLIC_STATUS_FIELDS, so list responses always come back
    // redacted (rows in a multi-result list may have differing emails — gating
    // per-row would be O(N) OTP queries with little benefit). The /apply/resubmit
    // page pre-fills the full form via the single-row code path; resubmit's
    // documented UX has the user complete an email OTP, after which the OTP gate
    // here fires and the full row is returned.
    if (multi && dataList && dataList.length > 0) {
      const safeList = dataList.map((r) => redactRow(r as Record<string, unknown>))
      return Response.json({ status: true, data: safeList[0], applications: safeList })
    }

    const rowEmail = (data as Record<string, unknown>)?.email as string | undefined
    const canSeeFullRow = await callerOwnsRow(supabase, rowEmail)
    // The full row (returned only to the owning caller) carries `documents`
    // with fileUrl values that are bare storage paths since Phase B — sign
    // them so /apply/resubmit's "currently uploaded" preview link resolves.
    const safeData = canSeeFullRow
      ? (await signDocumentsAcrossRows([data as Record<string, unknown> & { documents?: unknown }]))[0]
      : redactRow(data as Record<string, unknown>)
    return Response.json({ status: true, data: safeData, applications: [safeData] })
  } catch (error: unknown) {
    console.error("Status lookup error:", error)
    return Response.json({ status: false, message: "Unable to check application status. Please try again." }, { status: 500 })
  }
}
