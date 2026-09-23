// @auth: public — capability is the application id (a UUID), same model
// as GET /api/mou/applications/[id]. Submits the post-event report the
// MOU's REPORTING AND COMPLIANCE §1 clause requires ("a comprehensive
// report with photographs within 15 days").
import { NextRequest } from "next/server"
import * as Sentry from "@sentry/nextjs"
import { createAdminClient } from "@/lib/supabase"
import { checkRateLimit } from "@/lib/rate-limit"
import { getApplicationById } from "@/lib/mou/supabase-helpers"
import { toStoragePath } from "@/lib/storage-url"

const MAX_NOTES_LENGTH = 2000
const MAX_DOCUMENTS = 20

// Must match the storage path POST .../report/upload actually writes
// (src/app/api/mou/applications/[id]/report/upload/route.ts:
// `mou-reports/${id}/...`) — scoped to THIS application's own id, not just
// the shared `mou-reports/` folder, so a caller can't attach a file that
// was uploaded under a different approved application's report. Rejecting
// anything else here, not just at read time, is defense in depth against
// the same confused-deputy path src/lib/mou/supabase-helpers.ts guards on
// read (a client could otherwise reference another application's already-
// uploaded file, even though signing would later null out anything truly
// outside mou-reports/ entirely).
function isOwnedReportPath(value: unknown, applicationId: string): value is string {
  if (typeof value !== "string" || !value) return false
  const path = toStoragePath(value)
  return !!path && path.startsWith(`mou-reports/${applicationId}/`)
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
  const rl = await checkRateLimit(`mou-report-submit:${ip}`, 10, 60 * 60 * 1000)
  if (!rl.allowed) {
    return Response.json({ status: false, message: "Too many attempts. Please try again later." }, { status: 429 })
  }

  const application = await getApplicationById(id)
  if (!application) return Response.json({ status: false, message: "Not found" }, { status: 404 })
  if (application.status !== "approved" && application.status !== "completed") {
    return Response.json({ status: false, message: "This application isn't approved — there's no event to report on." }, { status: 400 })
  }

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return Response.json({ status: false, message: "Invalid request" }, { status: 400 })
  }

  const rawDocuments = Array.isArray(body.documents) ? body.documents : []
  if (rawDocuments.length === 0) {
    return Response.json({ status: false, message: "At least one document or photo is required" }, { status: 400 })
  }
  if (rawDocuments.length > MAX_DOCUMENTS) {
    return Response.json({ status: false, message: `Too many files — maximum ${MAX_DOCUMENTS}` }, { status: 400 })
  }

  const documents: { name: string; fileUrl: string }[] = []
  for (const raw of rawDocuments) {
    if (typeof raw !== "object" || raw === null) {
      return Response.json({ status: false, message: "Invalid document entry" }, { status: 400 })
    }
    const entry = raw as Record<string, unknown>
    if (!isOwnedReportPath(entry.fileUrl, id)) {
      return Response.json({ status: false, message: "One of the uploaded files is invalid — please re-upload it." }, { status: 400 })
    }
    const name = typeof entry.name === "string" && entry.name.trim() ? entry.name.trim().slice(0, 200) : "Untitled"
    documents.push({ name, fileUrl: entry.fileUrl })
  }

  const notes = typeof body.notes === "string" ? body.notes.trim().slice(0, MAX_NOTES_LENGTH) : null

  const supabase = createAdminClient()
  const { error } = await supabase
    .from("academic_event_applications")
    .update({
      report_documents: documents,
      report_notes: notes,
      report_submitted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)

  if (error) {
    console.error(`[mou-report] submit failed for application ${id}:`, error.message)
    Sentry.captureException(new Error(error.message), {
      tags: { component: "mou-report", op: "submit" },
      extra: { applicationId: id },
    })
    return Response.json({ status: false, message: "Failed to save your report. Please try again." }, { status: 500 })
  }

  return Response.json({ status: true })
}
