// Complete & Submit — promotes a payment_on_hold draft (applicant paid but
// never finished submitting) into a reviewable application, reusing the
// same reconstruction logic orphan-payments/promote uses. See
// docs/superpowers/specs/2026-08-20-draft-rescue-design.md §2.
import { NextRequest } from "next/server"
import * as Sentry from "@sentry/nextjs"
import { getAdminSession } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase"
import { logAdminAction } from "@/lib/audit-log"
import { promoteDraftToApplication } from "@/lib/promote-draft-to-application"

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: draftId } = await params
  if (!draftId) {
    return Response.json({ error: "draftId is required" }, { status: 400 })
  }

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
  const actorEmail = (session.email as string) || "admin"
  const actorName = (session.name as string) || "AMASI Admin"

  const supabase = createAdminClient()

  // --- 1. Load the draft ---
  const { data: draft, error: draftLoadErr } = await supabase
    .from("draft_applications")
    .select("*")
    .eq("id", draftId)
    .maybeSingle()

  if (draftLoadErr) {
    console.error("[admin/drafts/complete-and-submit] draft lookup error:", draftLoadErr.message)
    return Response.json({ error: "Failed to load draft" }, { status: 500 })
  }
  if (!draft) {
    return Response.json({ error: "Draft not found" }, { status: 404 })
  }

  // --- 2. Status guard ---
  if (draft.status !== "payment_on_hold") {
    return Response.json(
      { error: `This action only applies to drafts with status "payment_on_hold". Current status: "${draft.status}".` },
      { status: 409 },
    )
  }

  const email = (draft.email as string).toLowerCase().trim()

  // --- 3. Find the linked-eligible paid payment. The .is("application_id",
  // null) clause is load-bearing: without it, a payment for this email
  // that's already linked to a different application could win the sort and
  // only get rejected later inside promoteDraftToApplication's own link-step
  // guard — landing in a 500 LINK_FAILED instead of this clean 422. ---
  const { data: payment, error: paymentErr } = await supabase
    .from("membership_payments")
    .select("id, gateway_payment_id, amount, currency")
    .ilike("member_email", email)
    .eq("status", "paid")
    .is("application_id", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (paymentErr) {
    console.error("[admin/drafts/complete-and-submit] payment lookup error:", paymentErr.message)
    return Response.json({ error: "Failed to load payment" }, { status: 500 })
  }
  if (!payment) {
    return Response.json(
      { error: "No unlinked paid payment found for this applicant. Nothing to complete." },
      { status: 422 },
    )
  }

  // --- 4. Idempotency: an application already exists for this email at any
  // status other than pending_payment (finalized inside the lib, not a
  // conflict) or rejected (a legitimately re-applying applicant). ---
  const { data: existingApp } = await supabase
    .from("membership_applications")
    .select("id, reference_number")
    .eq("email", email)
    .neq("status", "pending_payment")
    .neq("status", "rejected")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (existingApp) {
    return Response.json(
      {
        ok: false,
        code: "ALREADY_EXISTS",
        applicationId: existingApp.id,
        referenceNumber: existingApp.reference_number,
        error: `An application already exists for ${email} (${existingApp.reference_number ?? existingApp.id}).`,
      },
      { status: 409 },
    )
  }

  // --- 5. canReconstruct guard ---
  const stepData = (draft.step_data || {}) as Record<string, unknown>
  if (!stepData.formData || !stepData.uploads) {
    return Response.json(
      {
        error:
          "This draft reached payment_on_hold without complete formData/uploads, which shouldn't happen — reconcile manually.",
      },
      { status: 422 },
    )
  }

  const reason =
    `Completed from stuck payment_on_hold draft by ${actorEmail}: applicant paid ` +
    `₹${payment.amount} (${payment.gateway_payment_id}) but never finished submitting. ` +
    "Promoted from their saved draft data. Routed to manual review; verify before approving."

  // --- 6. Promote ---
  let result
  try {
    result = await promoteDraftToApplication(
      {
        draft,
        email,
        paymentId: payment.gateway_payment_id,
        paymentRowId: payment.id,
        actorReason: reason,
        routeTag: "admin/drafts/complete-and-submit",
      },
      supabase,
    )
  } catch (e) {
    Sentry.captureException(e, {
      level: "error",
      tags: { route: "admin/drafts/complete-and-submit", op: "persist_failed" },
      extra: { draftId, paymentRowId: payment.id, email },
    })
    return Response.json({ error: "Failed to create application" }, { status: 500 })
  }

  // --- 7/8. Map the result + audit ---
  if (!result.ok && result.code === "ALREADY_EXISTS_RACE") {
    return Response.json({ ok: false, code: "ALREADY_EXISTS_RACE", error: result.message }, { status: 409 })
  }
  if (!result.ok && result.code === "LINK_FAILED") {
    await logAdminAction({
      adminEmail: actorEmail,
      adminName: actorName,
      action: "draft_complete_and_submit",
      entityType: "application",
      entityId: result.applicationId,
      details: {
        draftId,
        referenceNumber: result.referenceNumber,
        paymentId: payment.gateway_payment_id,
        email,
        linkFailed: true,
        paymentRowId: payment.id,
      },
    })
    return Response.json(
      { ok: false, code: "LINK_FAILED", applicationId: result.applicationId, error: result.message },
      { status: 500 },
    )
  }
  if (!result.ok) {
    Sentry.captureException(new Error("Unhandled promoteDraftToApplication failure code"), {
      level: "error",
      tags: { route: "admin/drafts/complete-and-submit" },
    })
    return Response.json({ error: "Unexpected error" }, { status: 500 })
  }

  await logAdminAction({
    adminEmail: actorEmail,
    adminName: actorName,
    action: "draft_complete_and_submit",
    entityType: "application",
    entityId: result.applicationId,
    details: { draftId, referenceNumber: result.referenceNumber, paymentId: payment.gateway_payment_id, email },
  })

  return Response.json({ ok: true, applicationId: result.applicationId, referenceNumber: result.referenceNumber })
}
