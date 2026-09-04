// @auth: public — creates a new academic-event MOU application. The
// applicant must already have a verified otp_codes row for their email
// (checked here, not re-verified — verifyMouOtp already marked it
// `verified: true` when they completed the OTP step in the form).
import { NextRequest } from "next/server"
import * as Sentry from "@sentry/nextjs"
import { createAdminClient } from "@/lib/supabase"
import { createApplication, getRoleAssignment } from "@/lib/mou/supabase-helpers"
import { createApprovalToken } from "@/lib/mou/approval-token"
import { sendApplicantConfirmation, sendSecretaryApprovalRequest, sendFyiNotification } from "@/lib/mou/notify"
import { getEventTypeConfig, isMouEventTypeConfig, SHARED_TYPE_SPECIFIC_COLUMN_KEYS } from "@/lib/mou/event-type-config"
import { validateTypeSpecificFields } from "@/lib/mou/type-specific-validation"
import { computeMouHash, createMouSignature } from "@/lib/mou/mou-signature"
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
    amasi_year_of_joining: raw.amasi_year_of_joining,
    designation: raw.designation,
    proposed_registration_fee: raw.proposed_registration_fee,
    programme_outline: raw.programme_outline,
    institution_type: raw.institution_type,
    joint_programme: raw.joint_programme,
    partner_associations: raw.partner_associations,
    consent_guest_institution_url: raw.consent_guest_institution_url,
    brief_institution_url: raw.brief_institution_url,
    faculty: raw.faculty,
    agreements: raw.agreements,
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

  if (isMouEventTypeConfig(typeConfig)) {
    const validationError = validateTypeSpecificFields(typeConfig, rawBody)
    if (validationError) return Response.json({ status: false, message: validationError }, { status: 400 })
  }

  if (isMouEventTypeConfig(typeConfig)) {
    const typeSpecificData: Record<string, unknown> = { _v: 1 }
    for (const field of typeConfig.typeSpecificFields) {
      if (field.kind === "faculty-rows" || field.kind === "association-rows" || field.kind === "conditional-upload") continue
      if (SHARED_TYPE_SPECIFIC_COLUMN_KEYS.has(field.key)) continue
      typeSpecificData[field.key] = rawBody[field.key]
    }
    body.type_specific_data = typeSpecificData
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

  if (isMouEventTypeConfig(typeConfig)) {
    const sigIp = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
    const userAgent = request.headers.get("user-agent")
    try {
      await createMouSignature({
        applicationId: application.id,
        mouVersion: typeConfig.mouVersion,
        mouSha256: computeMouHash(typeConfig.mouClauses, typeConfig.mouVersion),
        signatoryName: application.organizer_name,
        signatoryEmail: application.email,
        signatoryAmasiNumber: application.applicant_amasi_number,
        otpVerifiedAt: application.otp_verified_at ?? new Date().toISOString(),
        ipAddress: sigIp,
        userAgent,
      })
    } catch (err) {
      console.error(`[mou-applications] signature record failed for application ${application.id}:`, err)
      Sentry.captureException(err, {
        tags: { component: "mou-applications", op: "create-mou-signature" },
        extra: { applicationId: application.id },
      })
      return Response.json(
        { status: false, message: "Your application could not be recorded. Please try submitting again." },
        { status: 500 }
      )
    }
  }

  // The application row is committed at this point — everything below is
  // notification/magic-link delivery, a secondary concern. A missing
  // RESEND_API_KEY, a Resend network blip, or a failed token insert must
  // never turn a genuinely-created application into a 500 for the applicant
  // (who would then likely resubmit, or just give up, while a real orphaned
  // row sits in the DB that nobody was told about). Each step below is
  // isolated in its own try/catch so one failure (e.g. the secretary email)
  // doesn't also skip independent ones (e.g. the president FYI) — failures
  // are captured to Sentry for follow-up, matching the same failure-isolation
  // principle already used for the auto-create-event step in decide/route.ts.
  try {
    await sendApplicantConfirmation(application, isMouEventTypeConfig(typeConfig) ? typeConfig.confirmationNote : undefined)
  } catch (err) {
    console.error(`[mou-applications] applicant confirmation email failed for application ${application.id}:`, err)
    Sentry.captureException(err, {
      tags: { component: "mou-applications", op: "send-applicant-confirmation" },
      extra: { applicationId: application.id },
    })
  }

  try {
    const secretary = await getRoleAssignment("hon_secretary")
    if (secretary) {
      const token = await createApprovalToken(application.id, "hon_secretary", true)
      const magicLinkUrl = `${process.env.NEXT_PUBLIC_APP_URL || "https://membership.amasi.org"}/mou/review/${token}`
      await sendSecretaryApprovalRequest(application, typeConfig.label, secretary.email, magicLinkUrl)
    }
  } catch (err) {
    console.error(`[mou-applications] Hon. Secretary notification failed for application ${application.id}:`, err)
    Sentry.captureException(err, {
      tags: { component: "mou-applications", op: "notify-secretary" },
      extra: { applicationId: application.id },
    })
  }

  try {
    const president = await getRoleAssignment("president")
    if (president) {
      const token = await createApprovalToken(application.id, "president", false)
      const viewUrl = `${process.env.NEXT_PUBLIC_APP_URL || "https://membership.amasi.org"}/mou/review/${token}`
      await sendFyiNotification(application, typeConfig.label, president.email, "president", viewUrl)
    }
  } catch (err) {
    console.error(`[mou-applications] President FYI notification failed for application ${application.id}:`, err)
    Sentry.captureException(err, {
      tags: { component: "mou-applications", op: "notify-president" },
      extra: { applicationId: application.id },
    })
  }

  if (typeConfig.fields.includes("zone") && body.zone) {
    try {
      const zoneRole = `zone_chair_${body.zone.toLowerCase()}`
      const zoneChair = await getRoleAssignment(zoneRole)
      if (zoneChair) {
        const token = await createApprovalToken(application.id, zoneRole, false)
        const viewUrl = `${process.env.NEXT_PUBLIC_APP_URL || "https://membership.amasi.org"}/mou/review/${token}`
        await sendFyiNotification(application, typeConfig.label, zoneChair.email, zoneRole, viewUrl)
      }
    } catch (err) {
      console.error(`[mou-applications] zone chair FYI notification failed for application ${application.id}:`, err)
      Sentry.captureException(err, {
        tags: { component: "mou-applications", op: "notify-zone-chair" },
        extra: { applicationId: application.id, zone: body.zone },
      })
    }
  }

  return Response.json({ status: true, applicationId: application.id })
}
