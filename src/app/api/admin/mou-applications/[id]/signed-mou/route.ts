// POST /api/admin/mou-applications/[id]/signed-mou — HQ records the
// counter-signed MOU (PDF). Admin cookie enforced by middleware and here.
//
// Stored at mou/signed/<application id>/<uuid>.pdf; the row keeps the bare
// path and readers sign it. If the application is already approved or the
// MOU was sent, receiving the signed copy moves it straight to "mou_signed"
// (sanctioned) so the admin doesn't need a second click.
import { NextRequest } from "next/server"
import { randomUUID } from "node:crypto"
import * as Sentry from "@sentry/nextjs"
import { getAdminSession } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase"
import { logAdminAction } from "@/lib/audit-log"
import { UPLOADS_BUCKET } from "@/lib/storage-url"
import { sendMouStatusEmail } from "@/lib/mou-emails"
import type { MouEventType } from "@/lib/mou-events"

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_BYTES = 20 * 1024 * 1024

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getAdminSession()
  if (!session) return Response.json({ status: false, message: "Unauthorized" }, { status: 401 })
  const { id } = await params
  if (!UUID_RE.test(id)) return Response.json({ status: false, message: "Not found" }, { status: 404 })

  try {
    const formData = await request.formData()
    const file = formData.get("file")
    if (!(file instanceof File) || file.size === 0) {
      return Response.json({ status: false, message: "No file provided" }, { status: 400 })
    }
    if (file.size > MAX_BYTES) {
      return Response.json({ status: false, message: "File exceeds the 20 MB limit" }, { status: 400 })
    }
    const buffer = new Uint8Array(await file.arrayBuffer())
    const isPdf = buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46
    if (!isPdf) {
      return Response.json({ status: false, message: "The signed MOU must be a PDF" }, { status: 400 })
    }

    const supabase = createAdminClient()
    const { data: row, error: loadErr } = await supabase
      .from("mou_applications")
      .select("id, reference_number, status, event_type, applicant_name, applicant_email, place, proposed_date, proposed_year, decision_reason")
      .eq("id", id)
      .maybeSingle()
    if (loadErr) throw loadErr
    if (!row) return Response.json({ status: false, message: "Not found" }, { status: 404 })

    const path = `mou/signed/${id}/${randomUUID()}.pdf`
    const { error: uploadErr } = await supabase.storage
      .from(UPLOADS_BUCKET)
      .upload(path, buffer, { contentType: "application/pdf", upsert: false })
    if (uploadErr) throw uploadErr

    const now = new Date().toISOString()
    const promote = row.status === "approved" || row.status === "mou_sent"
    const update: Record<string, unknown> = { signed_mou_path: path, signed_mou_at: now, updated_at: now }
    if (promote) {
      update.status = "mou_signed"
      update.reviewed_by = session.email ?? null
      update.reviewed_at = now
    }
    const { error: updErr } = await supabase.from("mou_applications").update(update).eq("id", id)
    if (updErr) throw updErr

    await logAdminAction({
      adminEmail: String(session.email ?? ""),
      adminName: typeof session.name === "string" ? session.name : undefined,
      action: promote ? "mou_application_mou_signed" : "mou_application_signed_mou_uploaded",
      entityType: "mou_application",
      entityId: id,
      entityName: row.reference_number,
      details: { from: row.status, to: promote ? "mou_signed" : row.status, path },
      ipAddress: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim(),
    })

    if (promote) {
      await sendMouStatusEmail(
        {
          id,
          reference_number: row.reference_number,
          event_type: row.event_type as MouEventType,
          applicant_name: row.applicant_name,
          applicant_email: row.applicant_email,
          place: row.place,
          proposed_date: row.proposed_date,
          proposed_year: row.proposed_year,
        },
        "mou_signed",
        null
      )
    }

    return Response.json({ status: true, status_now: promote ? "mou_signed" : row.status })
  } catch (err) {
    Sentry.captureException(err, { tags: { route: "api/admin/mou-applications/[id]/signed-mou" } })
    return Response.json({ status: false, message: "Failed to store the signed MOU" }, { status: 500 })
  }
}
