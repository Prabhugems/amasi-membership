// @auth: admin — Accept or Return a submitted post-event report (Part B
// item 8). Accept closes the application (status → completed, if not
// already). Return requires a note and emails the organiser a resubmit
// link; the report route (POST /api/mou/applications/[id]/report) allows
// a fresh submission once report_status is 'returned'.
import { NextRequest } from "next/server"
import * as Sentry from "@sentry/nextjs"
import { getAdminSession } from "@/lib/auth"
import { getApplicationById, updateApplicationStatus } from "@/lib/mou/supabase-helpers"
import { getEventTypeConfig } from "@/lib/mou/event-type-config"
import { sendReportReturnedEmail } from "@/lib/mou/notify"
import { createAdminClient } from "@/lib/supabase"
import { logAdminAction } from "@/lib/audit-log"

const VALID_ACTIONS = new Set(["accept", "return"])
const MAX_NOTE_LENGTH = 2000

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getAdminSession()
  if (!session) return Response.json({ status: false, message: "Unauthorized" }, { status: 401 })

  const { id } = await params

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return Response.json({ status: false, message: "Invalid request" }, { status: 400 })
  }
  if (typeof body.action !== "string" || !VALID_ACTIONS.has(body.action)) {
    return Response.json({ status: false, message: "action must be 'accept' or 'return'" }, { status: 400 })
  }
  const action = body.action as "accept" | "return"

  const note = typeof body.note === "string" ? body.note.trim().slice(0, MAX_NOTE_LENGTH) : ""
  if (action === "return" && !note) {
    return Response.json({ status: false, message: "A note is required to return a report" }, { status: 400 })
  }

  const application = await getApplicationById(id)
  if (!application) return Response.json({ status: false, message: "Not found" }, { status: 404 })
  if (application.report_status !== "submitted") {
    return Response.json({ status: false, message: "This application has no report awaiting review." }, { status: 400 })
  }

  const adminEmail = typeof session.email === "string" ? session.email : "admin@amasi.org"
  const adminName = typeof session.name === "string" ? session.name : undefined
  const nowISO = new Date().toISOString()
  const supabase = createAdminClient()

  const { error: updateError } = await supabase
    .from("academic_event_applications")
    .update({
      report_status: action === "accept" ? "accepted" : "returned",
      report_reviewed_by: adminEmail,
      report_reviewed_at: nowISO,
      report_return_note: action === "return" ? note : null,
      updated_at: nowISO,
    })
    .eq("id", id)

  if (updateError) {
    console.error(`[mou-report-review] update failed for application ${id}:`, updateError.message)
    Sentry.captureException(new Error(updateError.message), {
      tags: { component: "mou-report-review", op: action },
      extra: { applicationId: id },
    })
    return Response.json({ status: false, message: "Failed to save" }, { status: 500 })
  }

  if (action === "accept" && application.status !== "completed") {
    await updateApplicationStatus(id, "completed")
  }

  if (action === "return") {
    const typeLabel = getEventTypeConfig(application.application_type_id)?.label ?? application.application_type_id
    try {
      await sendReportReturnedEmail(application, typeLabel, note)
    } catch (err) {
      console.error(`[mou-report-review] return email failed for application ${id}:`, err)
      Sentry.captureException(err, { tags: { component: "mou-report-review", op: "return-email" }, extra: { applicationId: id } })
      // Not fatal — the review decision is already persisted; the admin
      // can see the note in the UI even if the email didn't go out.
    }
  }

  await logAdminAction({
    adminEmail,
    adminName,
    action: "mou_report_reviewed",
    entityType: "academic_event_application",
    entityId: id,
    details: {
      changes: { report_status: { from: "submitted", to: action === "accept" ? "accepted" : "returned" } },
      fieldCount: 1,
      note: action === "return" ? note : undefined,
    },
  })

  return Response.json({ status: true, reportStatus: action === "accept" ? "accepted" : "returned" })
}
