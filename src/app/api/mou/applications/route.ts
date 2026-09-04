// @auth: public — creates a new academic-event MOU application. The
// applicant must already have a verified otp_codes row for their email
// (checked here, not re-verified — verifyMouOtp already marked it
// `verified: true` when they completed the OTP step in the form).
import { NextRequest } from "next/server"
import { createAdminClient } from "@/lib/supabase"
import { createApplication, getRoleAssignment } from "@/lib/mou/supabase-helpers"
import { createApprovalToken } from "@/lib/mou/approval-token"
import { sendApplicantConfirmation, sendSecretaryApprovalRequest, sendFyiNotification } from "@/lib/mou/notify"
import { getEventTypeConfig } from "@/lib/mou/event-type-config"
import { checkRateLimit } from "@/lib/rate-limit"
import type { NewApplicationInput } from "@/lib/mou/types"

const REQUIRED_FIELDS = [
  "application_type_id", "organizer_name", "email", "phone_number",
  "primary_institution", "preferred_date_1",
] as const

// Explicit allowlist of client-settable fields. The request body is
// untrusted JSON, not a validated NewApplicationInput — casting it and
// passing it straight to createApplication would let a caller smuggle
// extra keys (status, reviewed_by, reviewed_at, admin_notes, id,
// mou_generated_url, ...) straight into the insert, since createApplication
// spreads its input directly into the row. Picking fields here, rather than
// trusting the raw payload, is the fix.
//
// applicant_member_id is deliberately NOT in this allowlist. It's a FK into
// `members`, and GET /api/mou/member-lookup is public/unauthenticated — a
// caller can look up ANY member's real members.id by their public
// amasi_number, then (having only proven control of an email address via
// OTP, not any link to that member record) POST that id here to permanently
// link a submission to a victim's real member account. There is no
// legitimate need for the client to send this field: Task 11's frontend
// only prefills display fields (name/institution) from the lookup, never
// round-trips member.id back into the POST body. If member-linking is
// wanted later it must be derived server-side (e.g. looking up the
// OTP-verified body.email against members), never trusted from the client.
//
// applicant_amasi_number stays in the allowlist — unlike applicant_member_id
// it is a free-text string column (see src/lib/mou/types.ts), not a FK, and
// nothing downstream (mou-pdf.tsx, notify.ts) treats it as a verified
// membership claim; it's purely a self-declared field the applicant already
// controls via any legitimate form field, so allowing it here adds no new
// trust boundary.
function pickApplicationInput(raw: Record<string, unknown>): NewApplicationInput {
  return {
    application_type_id: raw.application_type_id,
    organizer_name: raw.organizer_name,
    email: raw.email,
    phone_number: raw.phone_number,
    applicant_amasi_number: raw.applicant_amasi_number,
    primary_institution: raw.primary_institution,
    event_name: raw.event_name,
    expected_participants: raw.expected_participants,
    live_surgery_demo: raw.live_surgery_demo,
    preferred_date_1: raw.preferred_date_1,
    preferred_date_2: raw.preferred_date_2,
    venue_type: raw.venue_type,
    venue_name: raw.venue_name,
    venue_address: raw.venue_address,
    venue_city: raw.venue_city,
    venue_state: raw.venue_state,
    venue_zip: raw.venue_zip,
    venue_country: raw.venue_country,
    zone: raw.zone,
    auditorium_hall_a: raw.auditorium_hall_a,
    auditorium_hall_b: raw.auditorium_hall_b,
    av_equipment: raw.av_equipment,
    endotrainers: raw.endotrainers,
    high_speed_internet: raw.high_speed_internet,
    agree_terms: raw.agree_terms,
    certify_accurate: raw.certify_accurate,
    authority_confirm: raw.authority_confirm,
    committee_member_photo_url: raw.committee_member_photo_url,
    institution_photo_url: raw.institution_photo_url,
  } as NewApplicationInput
}

export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
  const rl = await checkRateLimit(`mou-application:${ip}`, 10, 60 * 60 * 1000)
  if (!rl.allowed) return Response.json({ status: false, message: "Too many submissions. Please try later." }, { status: 429 })

  const rawBody = (await request.json()) as Record<string, unknown>
  const body = pickApplicationInput(rawBody)
  for (const field of REQUIRED_FIELDS) {
    if (!body[field]) return Response.json({ status: false, message: `${field} is required` }, { status: 400 })
  }
  if (!body.agree_terms || !body.certify_accurate || !body.authority_confirm) {
    return Response.json({ status: false, message: "All three agreement checkboxes are required" }, { status: 400 })
  }
  const typeConfig = getEventTypeConfig(body.application_type_id)
  if (!typeConfig) return Response.json({ status: false, message: "Unknown application type" }, { status: 400 })
  if (typeConfig.fields.includes("zone") && !body.zone) {
    return Response.json({ status: false, message: "Zone is required for this event type" }, { status: 400 })
  }

  // Confirm this email completed OTP verification (verifyMouOtp sets
  // otp_codes.verified=true; we require a verified row within the last
  // hour so a stale verification from an unrelated form can't be replayed).
  const supabase = createAdminClient()
  const { data: verifiedOtp } = await supabase
    .from("otp_codes")
    .select("id")
    .eq("email", body.email.toLowerCase())
    .eq("verified", true)
    .gte("created_at", new Date(Date.now() - 60 * 60 * 1000).toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!verifiedOtp) {
    return Response.json({ status: false, message: "Please verify your email with the code first" }, { status: 400 })
  }

  const application = await createApplication(body)

  await sendApplicantConfirmation(application)

  const secretary = await getRoleAssignment("hon_secretary")
  if (secretary) {
    const token = await createApprovalToken(application.id, "hon_secretary", true)
    const magicLinkUrl = `${process.env.NEXT_PUBLIC_APP_URL || "https://membership.amasi.org"}/mou/review/${token}`
    await sendSecretaryApprovalRequest(application, typeConfig.label, secretary.email, magicLinkUrl)
  }

  const president = await getRoleAssignment("president")
  if (president) {
    const { createApprovalToken: mkToken } = await import("@/lib/mou/approval-token")
    const token = await mkToken(application.id, "president", false)
    const viewUrl = `${process.env.NEXT_PUBLIC_APP_URL || "https://membership.amasi.org"}/mou/review/${token}`
    await sendFyiNotification(application, typeConfig.label, president.email, "president", viewUrl)
  }

  if (typeConfig.fields.includes("zone") && body.zone) {
    const zoneRole = `zone_chair_${body.zone.toLowerCase()}`
    const zoneChair = await getRoleAssignment(zoneRole)
    if (zoneChair) {
      const { createApprovalToken: mkToken } = await import("@/lib/mou/approval-token")
      const token = await mkToken(application.id, zoneRole, false)
      const viewUrl = `${process.env.NEXT_PUBLIC_APP_URL || "https://membership.amasi.org"}/mou/review/${token}`
      await sendFyiNotification(application, typeConfig.label, zoneChair.email, zoneRole, viewUrl)
    }
  }

  return Response.json({ status: true, applicationId: application.id })
}
