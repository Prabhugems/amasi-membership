// @auth: admin
import { NextRequest } from "next/server"
import * as Sentry from "@sentry/nextjs"
import { getAdminSession } from "@/lib/auth"
import { getApplicationById, getRoleAssignment } from "@/lib/mou/supabase-helpers"
import { getEventTypeConfig } from "@/lib/mou/event-type-config"
import { createApprovalToken } from "@/lib/mou/approval-token"
import { sendSecretaryApprovalRequest } from "@/lib/mou/notify"
import { logAdminAction } from "@/lib/audit-log"

// Re-sends the Hon. Secretary's approval-request email with a fresh magic
// link. The original is only ever sent once, at submission time
// (src/app/api/mou/applications/route.ts) — there was no way to recover
// from it landing in spam or just being missed until this route existed.
// Issuing a new token doesn't invalidate any earlier one; both stay valid
// until their own expiry.
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getAdminSession()
  if (!session) return Response.json({ status: false, message: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const application = await getApplicationById(id)
  if (!application) return Response.json({ status: false, message: "Not found" }, { status: 404 })

  if (application.status !== "submitted" && application.status !== "under_review" && application.status !== "changes_requested") {
    return Response.json(
      { status: false, message: `Cannot resend for a ${application.status} application — there's no pending decision to nudge.` },
      { status: 400 }
    )
  }

  const typeConfig = getEventTypeConfig(application.application_type_id)
  if (!typeConfig) {
    return Response.json({ status: false, message: "Unknown application type" }, { status: 500 })
  }

  const secretary = await getRoleAssignment("hon_secretary")
  if (!secretary) {
    return Response.json({ status: false, message: "No active Hon. Secretary role assignment on file" }, { status: 500 })
  }

  try {
    const token = await createApprovalToken(application.id, "hon_secretary", true)
    const magicLinkUrl = `${process.env.NEXT_PUBLIC_APP_URL || "https://membership.amasi.org"}/mou/review/${token}`
    await sendSecretaryApprovalRequest(application, typeConfig.label, secretary.email, magicLinkUrl)
  } catch (err) {
    console.error(`[mou-applications resend] failed for application ${id}:`, err)
    Sentry.captureException(err, {
      tags: { component: "mou-applications", op: "resend-secretary-request" },
      extra: { applicationId: id },
    })
    return Response.json({ status: false, message: "Failed to resend — see Sentry for details" }, { status: 500 })
  }

  const adminEmail = typeof session.email === "string" ? session.email : "admin@amasi.org"
  await logAdminAction({
    adminEmail,
    adminName: typeof session.name === "string" ? session.name : undefined,
    action: "mou_secretary_request_resent",
    entityType: "academic_event_application",
    entityId: id,
    details: { secretary_email: secretary.email },
  })

  return Response.json({ status: true, sent_to: secretary.email })
}
