// Admin "Unexpire" recovery action — Phase 1 of admin recovery tooling.
// Restores a draft that the cleanup-drafts cron soft-deleted (status='expired'
// + deleted_at set) back to a resumable state. The applicant can then log
// back into /apply, OTP-verify, and resume from where they left off.
//
// Walking skeleton for Phases 2 (complete-from-draft) and 3 (link-to-member);
// they'll inherit this file's auth pattern, audit shape, and response shape.
//
// Why these six fields are written together (see investigation 2026-05-25):
//   - status='in_progress'  : the resumable target (cron Step 1 will re-flag
//                              to 'stuck' after 2h idle, normal lifecycle)
//   - deleted_at=NULL       : the load-bearing soft-delete signal
//   - updated_at=now()      : resets the 48h cron expiry clock for at least
//                              one full normal cycle
//   - reminder_sent_at=NULL : prevents the cron's ≥6h-reminder fast-lane
//                              from re-expiring on the first inactivity
//                              recurrence; re-enters the normal nudge cycle
//   - failure_reason=NULL   : matches resume-from-token's clear semantics
//   - stale_since=NULL      : matches resume-from-token's clear semantics
//
// Refusals:
//   - 422 if step_data.formData is null/missing (Step 3a silent-expiry
//     victims; reviving them just gets them re-expired regardless of cron
//     timing because Step 3a doesn't require reminder_sent_at)
//   - 409 if status is not 'expired' (this action only recovers expired
//     drafts; it must not stomp a healthy or paid draft)
//   - 404 if draft not found
//   - 401 if not authenticated; 403 if not super_admin

import { NextRequest } from "next/server"
import { createAdminClient } from "@/lib/supabase"
import { getAdminSession } from "@/lib/auth"
import { logMembershipAuditEvent } from "@/lib/audit-log"

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: draftId } = await params
  if (!draftId) {
    return Response.json({ error: "draftId is required" }, { status: 400 })
  }

  // Auth — same pattern as cleanup-drafts cron's manual-run gate
  // (cron/cleanup-drafts/route.ts:99-103). Default middleware already
  // requires the admin cookie; we additionally require super_admin here.
  const session = await getAdminSession()
  if (!session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }
  if (session.adminRole !== "super_admin") {
    return Response.json(
      { error: "This action requires super_admin. Please contact the AMASI admin team." },
      { status: 403 },
    )
  }

  const supabase = createAdminClient()

  // Load draft for precondition checks. We need step_data.formData visible
  // and the current status; selecting * keeps it simple and the row is tiny.
  const { data: draft, error: fetchError } = await supabase
    .from("draft_applications")
    .select("id, email, status, deleted_at, step_data")
    .eq("id", draftId)
    .maybeSingle()

  if (fetchError) {
    console.error("[admin/drafts/unexpire] fetch error:", fetchError.message)
    return Response.json({ error: "Failed to load draft" }, { status: 500 })
  }
  if (!draft) {
    return Response.json({ error: "Draft not found" }, { status: 404 })
  }

  // Status guard: this button only recovers expired drafts. Anything else
  // (in_progress, stuck, payment_on_hold, refund_initiated) is either
  // healthy or in a different recovery flow; refuse to stomp it.
  if (draft.status !== "expired") {
    return Response.json(
      {
        error: `Cannot unexpire a draft with status "${draft.status}". This action only recovers drafts the cleanup cron expired.`,
      },
      { status: 409 },
    )
  }

  // formData guard: silent-expiry victims (cleanup-drafts Step 3a) had no
  // formData and would just get re-expired silently. Refuse.
  const stepData = draft.step_data as { formData?: unknown } | null
  if (!stepData || stepData.formData == null) {
    return Response.json(
      {
        error:
          "This draft has no applicant data (no formData was ever saved). It was silently cleaned up because the applicant verified an email but never filled the form. Recovery is not possible — they would need to start a new application.",
      },
      { status: 422 },
    )
  }

  const previousStatus = draft.status
  const previousDeletedAt = draft.deleted_at

  // Atomic unexpire. The .eq("status", "expired") clause makes this a safe
  // compare-and-swap — if another writer changed state between the SELECT
  // above and this UPDATE, this write affects 0 rows and we abort.
  const { data: updated, error: updateError } = await supabase
    .from("draft_applications")
    .update({
      status: "in_progress",
      deleted_at: null,
      updated_at: new Date().toISOString(),
      reminder_sent_at: null,
      failure_reason: null,
      stale_since: null,
    })
    .eq("id", draftId)
    .eq("status", "expired")
    .select("id")
    .maybeSingle()

  if (updateError) {
    console.error("[admin/drafts/unexpire] update error:", updateError.message)
    return Response.json({ error: "Failed to unexpire draft" }, { status: 500 })
  }
  if (!updated) {
    return Response.json(
      { error: "Draft state changed during update; please refresh and try again." },
      { status: 409 },
    )
  }

  // Audit. Mirror the cleanup-drafts cron's draft_expired entries so the
  // draft has one coherent timeline (expired by cron → unexpired by admin
  // → next state transition). entity_type uses the cron's singular
  // "draft_application" convention. Applicant email is auto-masked by the
  // helper's PII scrub.
  await logMembershipAuditEvent(
    {
      action: "draft_unexpired",
      entityType: "draft_application",
      entityId: draftId,
      performedBy: (session as { email?: string }).email || "admin (super_admin)",
      newData: {
        applicant_email: draft.email,
        previous_status: previousStatus,
        previous_deleted_at: previousDeletedAt,
        restored_to_status: "in_progress",
        reason:
          "Admin unexpire — cleanup-drafts cron had soft-deleted the draft for inactivity. Applicant can now resume from where they left off.",
      },
    },
    supabase,
  )

  return Response.json({ ok: true, draftId })
}
