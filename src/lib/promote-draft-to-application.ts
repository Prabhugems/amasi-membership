// Extracted from src/app/api/admin/orphan-payments/promote/route.ts's
// draft-mode branch (2026-08-20) so the Complete & Submit action on
// payment_on_hold drafts (src/app/api/admin/drafts/[id]/complete-and-submit)
// can reuse the exact same reconstruction logic instead of a second
// implementation. See docs/superpowers/specs/2026-08-20-draft-rescue-design.md §1.
//
// PURE RELOCATION: every branch below matches orphan-payments/promote's live
// behavior line-for-line as of the extraction. Do not "clean up" or
// restructure this without re-reading that route's own comments first —
// several odd-looking choices (e.g. finalizing a pending_payment skeleton in
// place instead of inserting fresh) are load-bearing for other flows.
/* eslint-disable @typescript-eslint/no-explicit-any -- mirrors the loose
   `any` the source route uses for step_data.formData/uploads. */
import * as Sentry from "@sentry/nextjs"
import type { SupabaseClient } from "@supabase/supabase-js"
import { buildApplicationRow } from "@/lib/build-application-row"
import { scoreApplication, type ApprovalResult } from "@/lib/ai-approval"
import { generateRefNumber } from "@/lib/reference-number"
import type { DraftApplicationRow } from "@/types/database.types"

export type PromoteDraftResult =
  | { ok: true; applicationId: string; referenceNumber: string }
  | { ok: false; code: "ALREADY_EXISTS_RACE"; message: string }
  | { ok: false; code: "LINK_FAILED"; applicationId: string; referenceNumber: string; message: string }

export interface PromoteDraftInput {
  draft: DraftApplicationRow
  email: string // lowercased, trimmed
  paymentId: string // gateway_payment_id (pay_...)
  paymentRowId: string // membership_payments.id — used for the link update
  actorReason: string // human-readable reason string, stored on the row
  // Distinguishes call sites in Sentry tags for the three non-fatal-warning
  // captures below (scoring_failed, link_failed, draft_soft_complete_failed),
  // none of which have a corresponding failure code in PromoteDraftResult —
  // the caller can't re-tag them after the fact, so the tag has to come in.
  routeTag: string
}

function fallbackApproval(): ApprovalResult {
  return {
    totalScore: 0,
    autoApprove: false,
    blockingReasons: ["scoring_skipped"],
    checks: [],
    flags: ["promote_draft: AI scoring skipped"],
    nmcVerification: null,
    nmcApiStatus: null,
    nmcResponseTimeMs: null,
    bypassedDocs: [],
    lowConfidenceDocs: [],
    mediumConfidenceDocs: [],
  }
}

export async function promoteDraftToApplication(
  input: PromoteDraftInput,
  supabase: SupabaseClient,
): Promise<PromoteDraftResult> {
  const { draft, email, paymentId, paymentRowId, actorReason, routeTag } = input
  const stepData = (draft.step_data || {}) as Record<string, any>
  const formData = stepData.formData as Record<string, any>
  const uploads = stepData.uploads as Record<string, any>

  let approval: ApprovalResult
  try {
    approval = await scoreApplication(formData, uploads, true, supabase)
  } catch (e) {
    Sentry.captureException(e, {
      level: "warning",
      tags: { route: routeTag, op: "scoring_failed" },
    })
    approval = fallbackApproval()
  }

  const documentsUnreadable = approval.decision === "documents_unreadable"
  const aiConfidence = documentsUnreadable
    ? "documents_unreadable"
    : approval.totalScore >= 80
      ? "high"
      : approval.totalScore >= 50
        ? "medium"
        : "low"
  const applicationStatus = documentsUnreadable ? "documents_unreadable" : "pending_review"

  // Finalize an early pending_payment skeleton in place if one exists; else INSERT.
  const { data: pendingRow } = await supabase
    .from("membership_applications")
    .select("id, reference_number")
    .eq("email", email)
    .eq("status", "pending_payment")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  const referenceNumber: string = pendingRow?.reference_number || generateRefNumber()

  const row = buildApplicationRow({
    referenceNumber,
    formData,
    uploads,
    paymentId,
    emailVerified: true,
    mobileVerified: false,
    allAiVerified: false,
    documentsUnreadable,
    approval,
    aiConfidence,
    aiFlags: approval.flags,
    hasPendingReview: true,
    manualReviewReason: actorReason,
    applicationStatus,
  })

  let appId: string

  try {
    if (pendingRow) {
      const { data: finalized, error: finalizeErr } = await supabase
        .from("membership_applications")
        .update({ ...row, updated_at: new Date().toISOString() })
        .eq("id", pendingRow.id)
        .eq("status", "pending_payment")
        .select("id")
        .maybeSingle()
      if (finalizeErr) throw finalizeErr
      if (!finalized) {
        // Lost a race — already finalized by another path.
        return { ok: false, code: "ALREADY_EXISTS_RACE", message: "Application was just finalized elsewhere." }
      }
      appId = finalized.id
    } else {
      const { data: inserted, error: insertErr } = await supabase
        .from("membership_applications")
        .insert(row)
        .select("id")
        .single()
      if (insertErr) throw insertErr
      appId = inserted!.id
    }
  } catch (e: any) {
    if (e?.code === "23505") {
      return {
        ok: false,
        code: "ALREADY_EXISTS_RACE",
        message: "An active application already exists for this applicant.",
      }
    }
    throw e
  }

  // Link the payment — guarded so a race can't double-link.
  const { error: linkErr } = await supabase
    .from("membership_payments")
    .update({ application_id: appId })
    .eq("id", paymentRowId)
    .is("application_id", null)
  if (linkErr) {
    Sentry.captureException(linkErr, {
      level: "error",
      tags: { route: routeTag, op: "link_failed" },
      extra: { appId, paymentRowId },
    })
    // Do NOT soft-complete the draft below — it stays visible at
    // payment_on_hold so an admin can see and retry from it, rather than
    // disappearing into an unlinked, unreachable state.
    return {
      ok: false,
      code: "LINK_FAILED",
      applicationId: appId,
      referenceNumber,
      message: "Application created but payment link failed. Please retry.",
    }
  }

  // Soft-complete the source draft so it leaves the incomplete pile.
  const { error: draftErr } = await supabase
    .from("draft_applications")
    .update({
      status: "completed",
      failure_reason: null,
      deleted_at: new Date().toISOString(),
      step_data: {
        ...stepData,
        payment_id: paymentId,
        recovered_at: new Date().toISOString(),
        recovered_application_id: appId,
      },
      updated_at: new Date().toISOString(),
    })
    .eq("id", draft.id)
  if (draftErr) {
    // Non-fatal: the application + payment are already correct.
    Sentry.captureException(draftErr, {
      level: "warning",
      tags: { route: routeTag, op: "draft_soft_complete_failed" },
      extra: { draftId: draft.id, appId },
    })
  }

  return { ok: true, applicationId: appId, referenceNumber }
}
