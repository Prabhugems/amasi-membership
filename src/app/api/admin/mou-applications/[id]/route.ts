// /api/admin/mou-applications/[id] — admin detail + review actions.
// Admin cookie enforced by middleware (not in PUBLIC_API_ROUTES) and again here.
import { NextRequest } from "next/server"
import * as Sentry from "@sentry/nextjs"
import { getAdminSession } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase"
import { logAdminAction } from "@/lib/audit-log"
import { signStorageValues } from "@/lib/storage-url"
import { sendMouStatusEmail } from "@/lib/mou-emails"
import { isMouStatus, type MouEventType, type MouStatus } from "@/lib/mou-events"
import type { MouAttachment } from "@/lib/mou-applications"

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const NOTES_MAX = 4000

/** Admin-settable transitions. Keys are the current status. */
const ALLOWED_TRANSITIONS: Record<MouStatus, readonly MouStatus[]> = {
  submitted: ["under_review", "approved", "rejected", "withdrawn"],
  under_review: ["approved", "rejected", "withdrawn", "submitted"],
  approved: ["mou_sent", "mou_signed", "rejected", "under_review"],
  mou_sent: ["mou_signed", "approved", "rejected"],
  mou_signed: ["mou_sent"],
  rejected: ["under_review"],
  withdrawn: ["under_review"],
}

/** Statuses whose change is emailed to the applicant. */
const NOTIFY_ON: readonly MouStatus[] = ["approved", "rejected", "mou_sent", "mou_signed"]

type Params = { params: Promise<{ id: string }> }

async function loadRow(id: string) {
  const supabase = createAdminClient()
  const { data, error } = await supabase.from("mou_applications").select("*").eq("id", id).maybeSingle()
  if (error) throw error
  return data
}

export async function GET(_request: NextRequest, { params }: Params) {
  const session = await getAdminSession()
  if (!session) return Response.json({ status: false, message: "Unauthorized" }, { status: 401 })
  const { id } = await params
  if (!UUID_RE.test(id)) return Response.json({ status: false, message: "Not found" }, { status: 404 })

  try {
    const row = await loadRow(id)
    if (!row) return Response.json({ status: false, message: "Not found" }, { status: 404 })

    const attachments = (row.attachments as MouAttachment[]) ?? []
    const values = attachments.map((a) => a.path)
    if (row.signed_mou_path) values.push(row.signed_mou_path)
    const signed = values.length ? await signStorageValues(values) : new Map<string, string | null>()

    return Response.json({
      status: true,
      application: {
        ...row,
        attachments: attachments.map((a) => ({ ...a, url: signed.get(a.path) ?? null })),
        signed_mou_url: row.signed_mou_path ? signed.get(row.signed_mou_path) ?? null : null,
      },
    })
  } catch (err) {
    Sentry.captureException(err, { tags: { route: "api/admin/mou-applications/[id]", op: "get" } })
    return Response.json({ status: false, message: "Failed to load application" }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const session = await getAdminSession()
  if (!session) return Response.json({ status: false, message: "Unauthorized" }, { status: 401 })
  const { id } = await params
  if (!UUID_RE.test(id)) return Response.json({ status: false, message: "Not found" }, { status: 404 })

  let body: Record<string, unknown>
  try {
    const parsed = await request.json()
    body = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {}
  } catch {
    return Response.json({ status: false, message: "Invalid request body" }, { status: 400 })
  }

  // Explicit allowlist — nothing else from the body reaches the update.
  const nextStatus = body.status
  const adminNotes = typeof body.admin_notes === "string" ? body.admin_notes.trim().slice(0, NOTES_MAX) : undefined
  const decisionReason =
    typeof body.decision_reason === "string" ? body.decision_reason.trim().slice(0, NOTES_MAX) : undefined
  const notify = body.notify !== false

  if (nextStatus !== undefined && !isMouStatus(nextStatus)) {
    return Response.json({ status: false, message: "Invalid status" }, { status: 400 })
  }
  if (nextStatus === undefined && adminNotes === undefined && decisionReason === undefined) {
    return Response.json({ status: false, message: "Nothing to update" }, { status: 400 })
  }

  try {
    const row = await loadRow(id)
    if (!row) return Response.json({ status: false, message: "Not found" }, { status: 404 })
    const current = row.status as MouStatus

    const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (adminNotes !== undefined) update.admin_notes = adminNotes || null
    if (decisionReason !== undefined) update.decision_reason = decisionReason || null

    if (nextStatus !== undefined && nextStatus !== current) {
      if (!ALLOWED_TRANSITIONS[current].includes(nextStatus)) {
        return Response.json(
          { status: false, message: `Cannot move from "${current}" to "${nextStatus}"` },
          { status: 400 }
        )
      }
      if (nextStatus === "mou_signed" && !row.signed_mou_path) {
        return Response.json(
          { status: false, message: "Upload the signed MOU before marking the event sanctioned" },
          { status: 400 }
        )
      }
      if (nextStatus === "rejected" && !(decisionReason ?? row.decision_reason)) {
        return Response.json(
          { status: false, message: "Give the applicant a reason before rejecting" },
          { status: 400 }
        )
      }
      update.status = nextStatus
      update.reviewed_by = session.email ?? null
      update.reviewed_at = new Date().toISOString()
    }

    const supabase = createAdminClient()
    const { data: updated, error } = await supabase
      .from("mou_applications")
      .update(update)
      .eq("id", id)
      .select("*")
      .single()
    if (error) throw error

    const statusChanged = nextStatus !== undefined && nextStatus !== current
    await logAdminAction({
      adminEmail: String(session.email ?? ""),
      adminName: typeof session.name === "string" ? session.name : undefined,
      action: statusChanged ? `mou_application_${nextStatus}` : "mou_application_notes_updated",
      entityType: "mou_application",
      entityId: id,
      entityName: row.reference_number,
      details: {
        from: current,
        to: statusChanged ? nextStatus : current,
        event_type: row.event_type,
        notes_updated: adminNotes !== undefined,
        reason_updated: decisionReason !== undefined,
      },
      ipAddress: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim(),
    })

    if (statusChanged && notify && NOTIFY_ON.includes(nextStatus as MouStatus)) {
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
        nextStatus as MouStatus,
        (updated.decision_reason as string | null) ?? null
      )
    }

    return Response.json({ status: true, application: updated })
  } catch (err) {
    Sentry.captureException(err, { tags: { route: "api/admin/mou-applications/[id]", op: "patch" } })
    return Response.json({ status: false, message: "Failed to update application" }, { status: 500 })
  }
}
