// @auth: admin — gated by middleware (/api/admin/*) AND getAdminSession() below.
//
// Self-service version of the one-shot orphan-payment recovery scripts under
// scripts/ (see recover-jahnavi-orphan-payment-2026-06-21.ts). Promotes a
// captured-but-unlinked Razorpay payment into a reviewable application so it
// lands in the "Pending Actions" queue (/pending). Admins click "Move to
// pending action" on the Orphan Payments page instead of asking for a bespoke
// recovery script every time.
//
// Two modes, chosen automatically:
//   - "draft"    — the payer's draft still carries a complete formData+uploads
//                  set. Reconstruct the full application exactly like
//                  /api/applications/submit (minus auto-approval): score,
//                  insert/finalize as pending_review, link payment, soft-complete
//                  the draft. This is the common case (applicant paid then went
//                  idle at the payment step).
//   - "skeleton" — no usable draft. Insert a minimal pending_review row flagged
//                  for manual review so an admin can chase the applicant for
//                  details/documents. Used when the draft was hard-deleted.
//
// Always routes to pending_review (never auto-approves) — a human still decides.
// Idempotent: aborts if an application already exists for this payment or email,
// or if the payment is already linked.
/* eslint-disable @typescript-eslint/no-explicit-any -- reconstructs loosely-typed
   JSON out of draft step_data; mirrors submit/route.ts and the recovery scripts. */
import { NextRequest } from "next/server"
import * as Sentry from "@sentry/nextjs"
import { getAdminSession } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase"
import { generateRefNumber } from "@/lib/reference-number"
import { logAdminAction } from "@/lib/audit-log"
import { promoteDraftToApplication } from "@/lib/promote-draft-to-application"

function isPlaceholderEmail(e: string | null | undefined): boolean {
  return !e || e.endsWith("@razorpay-webhook.invalid")
}

export async function POST(request: NextRequest) {
  const session = await getAdminSession()
  if (!session) {
    return Response.json({ status: false, message: "Unauthorized" }, { status: 401 })
  }
  const actorEmail = (session.email as string) || "admin"
  const actorName = (session.name as string) || "AMASI Admin"

  let body: { id?: string } = {}
  try {
    body = await request.json()
  } catch {
    body = {}
  }
  const paymentRowId = (body.id || "").trim()
  if (!paymentRowId) {
    return Response.json({ status: false, message: "Payment id is required" }, { status: 400 })
  }

  const supabase = createAdminClient()

  // --- 1. Load + re-verify the payment is paid and unlinked ---
  const { data: pay, error: payErr } = await supabase
    .from("membership_payments")
    .select(
      "id, status, amount, currency, application_id, member_email, gateway_payment_id, gateway_order_id"
    )
    .eq("id", paymentRowId)
    .maybeSingle()

  if (payErr) {
    console.error("[orphan-payments/promote] payment lookup error:", payErr)
    return Response.json({ status: false, message: "Failed to load payment" }, { status: 500 })
  }
  if (!pay) {
    return Response.json({ status: false, message: "Payment not found" }, { status: 404 })
  }
  if (pay.status !== "paid") {
    return Response.json(
      { status: false, message: `Payment status is '${pay.status}', not 'paid'.` },
      { status: 409 }
    )
  }
  if (pay.application_id) {
    return Response.json(
      { status: false, code: "ALREADY_LINKED", message: "Payment is already linked to an application." },
      { status: 409 }
    )
  }

  const paymentId = pay.gateway_payment_id // pay_...
  const email = isPlaceholderEmail(pay.member_email)
    ? null
    : pay.member_email!.toLowerCase().trim()

  // --- 2. Idempotency: bail if an application already exists for this payment ---
  if (paymentId) {
    const { data: byPayment } = await supabase
      .from("membership_applications")
      .select("id, status, reference_number")
      .eq("payment_id", paymentId)
      .limit(1)
      .maybeSingle()
    if (byPayment) {
      return Response.json(
        {
          status: false,
          code: "ALREADY_EXISTS",
          applicationId: byPayment.id,
          referenceNumber: byPayment.reference_number,
          message: `An application already exists for this payment (${byPayment.reference_number ?? byPayment.id}).`,
        },
        { status: 409 }
      )
    }
  }

  // ...or for this email at any status other than the pre-payment skeleton
  // (a pending_payment row IS finalized below, not treated as a conflict).
  if (email) {
    const { data: byEmail } = await supabase
      .from("membership_applications")
      .select("id, status, reference_number")
      .eq("email", email)
      .neq("status", "pending_payment")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
    if (byEmail) {
      return Response.json(
        {
          status: false,
          code: "ALREADY_EXISTS",
          applicationId: byEmail.id,
          referenceNumber: byEmail.reference_number,
          message: `An application already exists for ${email} (${byEmail.reference_number ?? byEmail.id}, ${byEmail.status}).`,
        },
        { status: 409 }
      )
    }
  }

  // --- 3. Find the payer's most recent live draft (if any) ---
  const { data: draft } = email
    ? await supabase
        .from("draft_applications")
        .select("*")
        .eq("email", email)
        .is("deleted_at", null)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle()
    : { data: null }

  const stepData = (draft?.step_data || {}) as Record<string, any>
  const formData = stepData.formData as Record<string, any> | undefined
  const uploads = stepData.uploads as Record<string, any> | undefined
  const canReconstruct = Boolean(draft && formData && uploads)

  // A webhook-only payment with no email and no draft has no identity to attach
  // — refuse rather than mint a junk row. Reconcile these by hand.
  if (!email && !canReconstruct) {
    return Response.json(
      {
        status: false,
        code: "NO_IDENTITY",
        message:
          "This payment has no payer email and no draft to reconstruct from. Reconcile it manually.",
      },
      { status: 422 }
    )
  }

  const reason =
    `Orphan-payment recovery (${actorEmail}): applicant paid ₹${pay.amount} ` +
    `(${paymentId}) but no application was created. ` +
    (canReconstruct
      ? "Promoted from the payer's draft (formData + uploads) and linked to the existing payment (no second charge). "
      : "No draft data available — collect applicant details and documents before approving. ") +
    "Routed to manual review; verify before approving."

  let appId: string
  let referenceNumber: string
  let mode: "draft" | "skeleton"

  try {
    if (canReconstruct) {
      // --- 4a. DRAFT MODE: reconstruct the full application (mirrors submit) ---
      mode = "draft"
      // Delegates to the shared reconstruction function — extracted 2026-08-20
      // so the Complete & Submit action on payment_on_hold drafts can reuse
      // this exact logic. See src/lib/promote-draft-to-application.ts and
      // docs/superpowers/specs/2026-08-20-draft-rescue-design.md §1.
      const result = await promoteDraftToApplication(
        {
          draft: draft!,
          email: email!,
          paymentId: paymentId!,
          paymentRowId: pay.id,
          actorReason: reason,
          routeTag: "admin/orphan-payments/promote",
        },
        supabase,
      )
      if (!result.ok && result.code === "ALREADY_EXISTS_RACE") {
        return Response.json(
          { status: false, code: "ALREADY_EXISTS", message: result.message },
          { status: 409 }
        )
      }
      if (!result.ok && result.code === "LINK_FAILED") {
        return Response.json(
          { status: false, code: "LINK_FAILED", applicationId: result.applicationId, message: result.message },
          { status: 500 }
        )
      }
      if (!result.ok) {
        throw new Error("Unhandled promoteDraftToApplication failure code")
      }
      appId = result.applicationId
      referenceNumber = result.referenceNumber
    } else {
      // --- 4b. SKELETON MODE: minimal flagged row for manual completion ---
      mode = "skeleton"
      referenceNumber = generateRefNumber()
      const fallbackName =
        [formData?.firstName, formData?.lastName].filter(Boolean).join(" ").trim() ||
        (email ? email.split("@")[0] : "Applicant")

      const { data: inserted, error: insertErr } = await supabase
        .from("membership_applications")
        .insert({
          reference_number: referenceNumber,
          name: fallbackName,
          email: email!, // guaranteed non-null here (NO_IDENTITY guard above)
          membership_type: draft?.membership_type ?? null,
          status: "pending_review",
          payment_status: "paid",
          payment_id: paymentId,
          email_verified: true,
          needs_manual_review: true,
          manual_review_reason: reason,
          ai_confidence: "manual_payment_recovery",
        })
        .select("id")
        .single()
      if (insertErr) throw insertErr
      appId = inserted!.id
    }
  } catch (e: any) {
    // Active-application partial unique index (idx_unique_active_application)
    // rejected the insert — another active app for (email, membership_type)
    // exists. Surface as a conflict, not a 500.
    if (e?.code === "23505") {
      return Response.json(
        {
          status: false,
          code: "ALREADY_EXISTS",
          message: "An active application already exists for this applicant.",
        },
        { status: 409 }
      )
    }
    Sentry.captureException(e, {
      level: "error",
      tags: { route: "admin/orphan-payments/promote", op: "persist_failed" },
      extra: { paymentRowId, paymentId, email },
    })
    return Response.json({ status: false, message: "Failed to create application" }, { status: 500 })
  }

  // Skeleton mode only — draft mode already linked the payment and
  // soft-completed the draft inside promoteDraftToApplication() above.
  if (mode === "skeleton") {
    // --- 5. Link the orphan payment to the new application ---
    const { error: linkErr } = await supabase
      .from("membership_payments")
      .update({ application_id: appId })
      .eq("id", pay.id)
      .is("application_id", null)
    if (linkErr) {
      Sentry.captureException(linkErr, {
        level: "error",
        tags: { route: "admin/orphan-payments/promote", op: "link_failed" },
        extra: { appId, paymentRowId },
      })
      // The application exists but the payment didn't link — surface loudly so it
      // doesn't silently re-appear as an orphan. Admin can retry safely
      // (idempotency now resolves to the just-created application).
      return Response.json(
        {
          status: false,
          code: "LINK_FAILED",
          applicationId: appId,
          message: "Application created but payment link failed. Please retry.",
        },
        { status: 500 }
      )
    }

    // --- 6. Soft-complete the draft so it leaves the incomplete pile ---
    if (draft) {
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
        // Non-fatal: the application + payment are already correct. Log and move on.
        Sentry.captureException(draftErr, {
          level: "warning",
          tags: { route: "admin/orphan-payments/promote", op: "draft_soft_complete_failed" },
          extra: { draftId: draft.id, appId },
        })
      }
    }
  }

  // --- 7. Audit ---
  await logAdminAction({
    adminEmail: actorEmail,
    adminName: actorName,
    action: "orphan_payment_promote_to_pending",
    entityType: "application",
    entityId: appId,
    entityName: email ?? paymentId ?? appId,
    details: {
      mode,
      referenceNumber,
      paymentRowId,
      paymentId,
      orderId: pay.gateway_order_id,
      amount: pay.amount,
      currency: pay.currency,
      email,
      draftId: draft?.id ?? null,
    },
  })

  return Response.json({
    status: true,
    applicationId: appId,
    referenceNumber,
    mode,
    message:
      mode === "draft"
        ? "Application reconstructed from draft and moved to Pending Actions."
        : "Skeleton application created and moved to Pending Actions for manual completion.",
  })
}
