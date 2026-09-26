// @auth: public but credential-gated — an edit-token bearer or an
// OTP-verified-within-window email, cross-checked against this application
// id (see src/lib/mou/applicant-auth.ts). GET returns the full editable
// row for src/app/mou/edit/[id]/page.tsx; PATCH applies an edit.
//
// This is a NEW, separate endpoint from GET /api/mou/applications/[id] —
// not a mode flag on that shared handler. That route deliberately returns
// a narrow projection (no email/phone/venue/faculty) because a bare
// application-UUID link is genuinely public and gets shared/forwarded; a
// bug in this route's credential check must never be able to regress that
// already-shipped public status page.
import { NextRequest } from "next/server"
import * as Sentry from "@sentry/nextjs"
import { createAdminClient } from "@/lib/supabase"
import { checkRateLimit } from "@/lib/rate-limit"
import { resolveApplicantCredential } from "@/lib/mou/applicant-auth"
import { partitionMouEditableUpdates, EDITABLE_MOU_APPLICATION_FIELDS } from "@/lib/mou/edit-application-fields"
import { computeFieldDiff } from "@/lib/edit-application-fields"
import { getEventTypeConfig, isMouEventTypeConfig } from "@/lib/mou/event-type-config"
import { validateTypeSpecificFields } from "@/lib/mou/type-specific-validation"
import { createApprovalToken } from "@/lib/mou/approval-token"
import { getRoleAssignment, signApplicationStorage } from "@/lib/mou/supabase-helpers"
import { sendApplicationUpdatedNotice, sendResubmissionNotice } from "@/lib/mou/notify"
import { logMembershipAuditEvent } from "@/lib/audit-log"

// Editable pre-decision only. approved/completed route to the "Request a
// change" flow instead (POST .../change-request); rejected is terminal.
const EDITABLE_STATUSES = new Set(["submitted", "under_review", "changes_requested"])

// "" is what a blanked-out <input type="number"> writes back — Supabase/
// PostgREST resolves it through the numeric column input function and
// throws 22P02 invalid input syntax, not a validation error, exactly the
// bug src/app/api/mou/applications/route.ts's own numOrUndefined already
// guards against at create time. The edit path needs the same guard.
const NUMERIC_EDITABLE_FIELDS = ["expected_participants", "proposed_registration_fee", "amasi_year_of_joining"] as const

function coerceNumericFields(accepted: Record<string, unknown>): Record<string, unknown> {
  const out = { ...accepted }
  for (const key of NUMERIC_EDITABLE_FIELDS) {
    if (!(key in out)) continue
    const v = out[key]
    if (v === "" || v === null || v === undefined) {
      out[key] = null
      continue
    }
    const n = Number(v)
    out[key] = Number.isNaN(n) ? null : n
  }
  return out
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  // This endpoint returns more than GET /api/mou/applications/[id] (venue,
  // faculty, and other fields the narrow status projection never exposes)
  // — rate-limit token/OTP-guessing attempts here even though that sibling
  // endpoint doesn't, since it never had this much to leak.
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
  const rl = await checkRateLimit(`mou-edit-get:${ip}`, 20, 60 * 60 * 1000)
  if (!rl.allowed) {
    return Response.json({ status: false, message: "Too many attempts. Please try again later." }, { status: 429 })
  }

  const { searchParams } = new URL(request.url)
  const editToken = searchParams.get("token") ?? undefined
  const email = searchParams.get("email") ?? undefined

  const credential = await resolveApplicantCredential(id, { editToken, email })
  if (!credential.ok) {
    return Response.json({ status: false, message: credential.message }, { status: credential.status })
  }
  const application = credential.application
  const typeConfig = getEventTypeConfig(application.application_type_id)
  const signed = await signApplicationStorage(application)

  const editableFields: Record<string, unknown> = {}
  for (const key of EDITABLE_MOU_APPLICATION_FIELDS) {
    editableFields[key] = (signed as unknown as Record<string, unknown>)[key] ?? (application as unknown as Record<string, unknown>)[key]
  }

  return Response.json({
    status: true,
    application: {
      id: application.id,
      application_type_id: application.application_type_id,
      typeLabel: typeConfig?.label ?? application.application_type_id,
      status: application.status,
      rejection_reason: application.rejection_reason,
      editable: EDITABLE_STATUSES.has(application.status),
      ...editableFields,
    },
  })
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
  const rl = await checkRateLimit(`mou-edit:${ip}`, 10, 60 * 60 * 1000)
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
  const rawUpdates = typeof body.updates === "object" && body.updates !== null ? (body.updates as Record<string, unknown>) : {}

  const credential = await resolveApplicantCredential(id, { editToken, email })
  if (!credential.ok) {
    return Response.json({ status: false, message: credential.message }, { status: credential.status })
  }
  const application = credential.application

  if (!EDITABLE_STATUSES.has(application.status)) {
    return Response.json(
      { status: false, message: "This application can no longer be edited directly. Use 'Request a change' instead." },
      { status: 400 }
    )
  }

  const { accepted: acceptedRaw, rejected } = partitionMouEditableUpdates(rawUpdates)
  if (rejected.length > 0) {
    return Response.json(
      { status: false, message: `These fields cannot be edited: ${rejected.join(", ")}` },
      { status: 400 }
    )
  }
  const accepted = coerceNumericFields(acceptedRaw)

  // Re-run the same type-specific validation the create path runs
  // (src/app/api/mou/applications/route.ts), against the EFFECTIVE
  // post-edit values (current row + this edit's accepted fields) — an edit
  // can otherwise put the row into a state the create-time validation
  // would have rejected (e.g. dropping faculty below the required minimum).
  const typeConfig = getEventTypeConfig(application.application_type_id)
  if (typeConfig && isMouEventTypeConfig(typeConfig)) {
    const effective = { ...application, ...accepted }
    const validationError = validateTypeSpecificFields(typeConfig, effective)
    if (validationError) {
      return Response.json({ status: false, message: validationError }, { status: 400 })
    }
  }

  const diff = computeFieldDiff(application as unknown as Record<string, unknown>, accepted)
  if (diff.fieldCount === 0) {
    return Response.json({ status: true, changed: false, fieldCount: 0 })
  }

  const supabase = createAdminClient()
  const wasChangesRequested = application.status === "changes_requested"
  const nextStatus = wasChangesRequested ? "submitted" : application.status

  const { error: updateError } = await supabase
    .from("academic_event_applications")
    .update({ ...accepted, status: nextStatus, updated_at: new Date().toISOString() })
    .eq("id", id)

  if (updateError) {
    console.error(`[mou-edit] update failed for application ${id}:`, updateError.message)
    Sentry.captureException(new Error(updateError.message), {
      tags: { component: "mou-edit", op: "update" },
      extra: { applicationId: id },
    })
    return Response.json({ status: false, message: "Failed to save your changes. Please try again." }, { status: 500 })
  }

  const { error: revisionError } = await supabase.from("academic_event_application_revisions").insert({
    application_id: id,
    snapshot: application,
    changed_fields: diff.changes,
    changed_by: application.email,
    change_source: wasChangesRequested ? "applicant_resubmit" : "applicant_edit",
  })
  if (revisionError) {
    // Don't fail the request over a history-write failure — the actual
    // edit already succeeded. Capture so a silently-broken revision log is
    // still detectable, same posture as markTokenUsed in approval-token.ts.
    Sentry.captureException(new Error(revisionError.message), {
      tags: { component: "mou-edit", op: "insert-revision" },
      extra: { applicationId: id },
    })
  }

  const typeLabel = typeConfig?.label ?? application.application_type_id
  try {
    const secretary = await getRoleAssignment("hon_secretary")
    if (secretary) {
      if (wasChangesRequested) {
        // The Secretary's original can_decide token was burned the moment
        // they set changes_requested — markTokenUsed fires unconditionally
        // for every decide action (see decide/route.ts). A fresh one is
        // required, not optional, or their link would be dead.
        const freshToken = await createApprovalToken(id, "hon_secretary", true)
        const magicLinkUrl = `${process.env.NEXT_PUBLIC_APP_URL || "https://membership.amasi.org"}/mou/review/${freshToken}`
        await sendResubmissionNotice({ ...application, ...accepted, status: nextStatus }, typeLabel, secretary.email, magicLinkUrl, diff.changes)
      } else {
        await sendApplicationUpdatedNotice({ ...application, ...accepted, status: nextStatus }, typeLabel, secretary.email, diff.changes)
      }
    }
  } catch (err) {
    console.error(`[mou-edit] Secretary notification failed for application ${id}:`, err)
    Sentry.captureException(err, {
      tags: { component: "mou-edit", op: "notify-secretary" },
      extra: { applicationId: id },
    })
  }

  await logMembershipAuditEvent({
    action: "mou_application_edited",
    entityType: "academic_event_application",
    entityId: id,
    newData: { changes: diff.changes, fieldCount: diff.fieldCount, authMethod: credential.via, resubmitted: wasChangesRequested },
  })

  return Response.json({ status: true, changed: true, fieldCount: diff.fieldCount, resubmitted: wasChangesRequested })
}
