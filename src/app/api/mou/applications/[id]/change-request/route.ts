// @auth: public but credential-gated — same edit-token/OTP-window
// resolver as .../edit (see src/lib/mou/applicant-auth.ts). For
// approved/completed applications, which are otherwise read-only to the
// applicant: ask for a date/venue/faculty change instead of silently
// editing a live application.
import { NextRequest } from "next/server"
import * as Sentry from "@sentry/nextjs"
import { createAdminClient } from "@/lib/supabase"
import { checkRateLimit } from "@/lib/rate-limit"
import { resolveApplicantCredential } from "@/lib/mou/applicant-auth"
import { getEventTypeConfig } from "@/lib/mou/event-type-config"
import { getRoleAssignment } from "@/lib/mou/supabase-helpers"
import { sendChangeRequestNotice } from "@/lib/mou/notify"

const MAX_NOTE_LENGTH = 1000

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
  const rl = await checkRateLimit(`mou-change-request:${ip}`, 10, 60 * 60 * 1000)
  if (!rl.allowed) {
    return Response.json({ status: false, message: "Too many attempts. Please try again later." }, { status: 429 })
  }

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return Response.json({ status: false, message: "Invalid request" }, { status: 400 })
  }

  const editToken = typeof body.editToken === "string" ? body.editToken : undefined
  const email = typeof body.email === "string" ? body.email : undefined

  const credential = await resolveApplicantCredential(id, { editToken, email })
  if (!credential.ok) {
    return Response.json({ status: false, message: credential.message }, { status: credential.status })
  }
  const application = credential.application

  if (application.status !== "approved" && application.status !== "completed") {
    return Response.json(
      { status: false, message: "Change requests are only available for approved or completed applications." },
      { status: 400 }
    )
  }

  const requestedDate = typeof body.requestedDate === "string" && body.requestedDate ? body.requestedDate : null
  const requestedVenue = typeof body.requestedVenue === "object" && body.requestedVenue !== null ? body.requestedVenue : null
  const requestedFaculty = Array.isArray(body.requestedFaculty) ? body.requestedFaculty : null
  const note = typeof body.note === "string" ? body.note.trim().slice(0, MAX_NOTE_LENGTH) : null

  if (!requestedDate && !requestedVenue && !requestedFaculty) {
    return Response.json({ status: false, message: "Nothing to request — provide a date, venue, or faculty change." }, { status: 400 })
  }

  const supabase = createAdminClient()

  // Check-then-insert for a clean error message rather than surfacing a
  // raw 23505 unique-violation from the partial index (sql/056) — matches
  // report/route.ts's own "already submitted" style.
  const { data: existingPending } = await supabase
    .from("academic_event_change_requests")
    .select("id")
    .eq("application_id", id)
    .eq("status", "pending")
    .maybeSingle()
  if (existingPending) {
    return Response.json({ status: false, message: "A change request is already pending for this application." }, { status: 400 })
  }

  const { error: insertError } = await supabase.from("academic_event_change_requests").insert({
    application_id: id,
    requested_date: requestedDate,
    requested_venue: requestedVenue,
    requested_faculty: requestedFaculty,
    note,
    status: "pending",
  })
  if (insertError) {
    console.error(`[mou-change-request] insert failed for application ${id}:`, insertError.message)
    Sentry.captureException(new Error(insertError.message), {
      tags: { component: "mou-change-request", op: "insert" },
      extra: { applicationId: id },
    })
    return Response.json({ status: false, message: "Failed to submit your request. Please try again." }, { status: 500 })
  }

  const typeConfig = getEventTypeConfig(application.application_type_id)
  const typeLabel = typeConfig?.label ?? application.application_type_id
  try {
    const secretary = await getRoleAssignment("hon_secretary")
    if (secretary) {
      // No per-application admin detail route exists — src/app/admin/mou-applications/page.tsx
      // is a single list page with a client-side modal (DetailDialog), not
      // a deep-linkable URL. Link to the list, same as sendMouWeeklyDigestEmail's CTA.
      const viewUrl = `${process.env.NEXT_PUBLIC_APP_URL || "https://membership.amasi.org"}/admin/mou-applications`
      await sendChangeRequestNotice(application, typeLabel, secretary.email, viewUrl, { requestedDate, note })
    }
  } catch (err) {
    console.error(`[mou-change-request] Secretary notification failed for application ${id}:`, err)
    Sentry.captureException(err, {
      tags: { component: "mou-change-request", op: "notify-secretary" },
      extra: { applicationId: id },
    })
  }

  return Response.json({ status: true })
}
