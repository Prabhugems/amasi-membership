/**
 * One-shot recovery — SANJAY KUMAR (drsanjaypmch@gmail.com, LM).
 *
 * Context (2026-06-28):
 *   Orphan-payment variant of the paid-no-submission pattern.
 *     - 2026-06-28 07:39 UTC the applicant paid ₹4,230 — Razorpay
 *       pay_T6yJmVlg8ybWZb / order_T6yIoWpJNnTeoX. `membership_payments` has the
 *       row with status='paid', application_id=NULL (orphan).
 *     - The applicant's draft (9a714faf-3181-40ec-abb0-6bb190053664) is still
 *       live with a COMPLETE LM doc set (profile, MCI cert, PG degree cert,
 *       ASI member cert — all with fileUrls; MCI/PG/ASI extracted) and email
 *       verified (otp_codes: 1 verified). The draft went status='stuck'
 *       (failure_reason='applicant_idle_step_3') right after payment — they paid
 *       then went idle at the payment step and never submitted.
 *
 * Mirrors /api/applications/submit minus auto-approval: reconstruct from the
 * current draft's formData+uploads, re-verify the orphan payment is paid +
 * unlinked, score, insert as pending_review, link the payment, soft-complete the
 * draft. This is the exact behaviour the new
 * POST /api/admin/orphan-payments/promote endpoint performs from the admin UI —
 * this script handles the case immediately, before that deploy lands.
 *
 * Usage:
 *   npx tsx scripts/recover-orphan-drsanjay-2026-06-28.ts            # dry run
 *   npx tsx scripts/recover-orphan-drsanjay-2026-06-28.ts --commit   # do it
 *
 * Idempotent: aborts at the guards if an application/member already exists or the
 * payment is already linked.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- one-off recovery script reconstructs
   loosely-typed JSON out of draft step_data; mirrors submit/route.ts. */
import path from "node:path"
import { config as loadEnv } from "dotenv"

loadEnv({ path: path.resolve(process.cwd(), ".env.local") })

import { createAdminClient } from "../src/lib/supabase"
import { buildApplicationRow } from "../src/lib/build-application-row"
import { scoreApplication, type ApprovalResult } from "../src/lib/ai-approval"
import { generateRefNumber } from "../src/lib/reference-number"
import { logAdminAction } from "../src/lib/audit-log"

const EMAIL = "drsanjaypmch@gmail.com"
const PAYMENT_ID = "pay_T6yJmVlg8ybWZb"
const EXPECTED_ORDER_ID = "order_T6yIoWpJNnTeoX"
const ADMIN_ACTOR = "payment-recovery-orphan-2026-06-28"

const RECOVERY_NOTE =
  "Payment-recovery (2026-06-28): applicant paid ₹4230 on 2026-06-28 (membership_payments.status='paid', " +
  "pay_T6yJmVlg8ybWZb) but went idle at the payment step (draft 'stuck', applicant_idle_step_3) and never " +
  "submitted. Promoted manually from the current draft's complete LM step_data and linked to the existing " +
  "payment (no second charge). Routed to manual review; verify docs before approving."

function fallbackApproval(): ApprovalResult {
  return {
    totalScore: 0,
    autoApprove: false,
    blockingReasons: ["scoring_skipped"],
    checks: [],
    flags: ["manual_payment_recovery: AI scoring skipped (run with scoring deps to populate)"],
    nmcVerification: null,
    nmcApiStatus: null,
    nmcResponseTimeMs: null,
    bypassedDocs: [],
    lowConfidenceDocs: [],
    mediumConfidenceDocs: [],
  }
}

async function main() {
  const commit = process.argv.includes("--commit")
  console.log(`\n=== Orphan-payment recovery (${EMAIL}) ===`)
  console.log(`Mode: ${commit ? "COMMIT" : "DRY RUN"}\n`)

  const supabase = createAdminClient()

  // --- 1. Load the current draft ---
  const { data: draft, error: draftErr } = await supabase
    .from("draft_applications")
    .select("*")
    .eq("email", EMAIL)
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (draftErr || !draft) {
    console.error("Draft not found:", draftErr)
    process.exit(1)
  }

  const stepData = (draft.step_data || {}) as Record<string, any>
  const formData = stepData.formData as Record<string, any> | undefined
  const uploads = stepData.uploads as Record<string, any> | undefined

  if (!formData || !uploads) {
    console.error("Draft step_data missing formData/uploads — cannot reconstruct.")
    process.exit(1)
  }

  // --- 2. Re-verify the orphan payment is paid, unlinked, and for this email ---
  const { data: pay, error: payErr } = await supabase
    .from("membership_payments")
    .select("id, status, amount, currency, application_id, member_email, gateway_order_id")
    .eq("gateway_payment_id", PAYMENT_ID)
    .maybeSingle()

  if (payErr || !pay) {
    console.error("membership_payments row not found for", PAYMENT_ID, payErr)
    process.exit(1)
  }
  if (pay.status !== "paid") {
    console.error(`Payment status is '${pay.status}', not 'paid'. Aborting.`)
    process.exit(1)
  }
  if (pay.application_id) {
    console.error(`Payment already linked to application_id=${pay.application_id}. Aborting.`)
    process.exit(1)
  }
  if (pay.gateway_order_id !== EXPECTED_ORDER_ID) {
    console.error(`Order id mismatch: ${pay.gateway_order_id} != ${EXPECTED_ORDER_ID}. Aborting.`)
    process.exit(1)
  }
  if ((pay.member_email || "").toLowerCase() !== EMAIL) {
    console.error(`Payment email mismatch: ${pay.member_email} != ${EMAIL}. Aborting.`)
    process.exit(1)
  }

  // --- 2b. Confirm email was verified server-side ---
  const { count: verifiedOtps } = await supabase
    .from("otp_codes")
    .select("id", { count: "exact", head: true })
    .ilike("email", EMAIL)
    .eq("verified", true)
  if (!verifiedOtps) {
    console.error("No verified OTP on record for this email. Aborting — confirm identity first.")
    process.exit(1)
  }
  console.log(`Verified OTPs on record: ${verifiedOtps}`)

  // --- 3. Idempotency: no existing application or member ---
  const { data: existingApp } = await supabase
    .from("membership_applications")
    .select("id, status")
    .or(`email.eq.${EMAIL},payment_id.eq.${PAYMENT_ID}`)
    .limit(1)
    .maybeSingle()
  if (existingApp) {
    console.log(`Application already exists (id=${existingApp.id}, status=${existingApp.status}). Nothing to do.`)
    process.exit(0)
  }
  const { data: existingMember } = await supabase
    .from("members")
    .select("amasi_number")
    .eq("email", EMAIL)
    .limit(1)
    .maybeSingle()
  if (existingMember) {
    console.log(`Member already exists (#${existingMember.amasi_number}). Nothing to do.`)
    process.exit(0)
  }

  // --- 4. Score (faithful reviewer fields); tolerate local scoring failure ---
  let approval: ApprovalResult
  try {
    approval = await scoreApplication(formData, uploads as any, true, supabase)
    console.log(`Scoring ran: totalScore=${approval.totalScore}%, autoApprove=${approval.autoApprove}`)
  } catch (e) {
    console.warn("scoreApplication failed locally — using fallback:", (e as Error).message)
    approval = fallbackApproval()
  }

  const documentsUnreadable = approval.decision === "documents_unreadable"
  const aiConfidence = documentsUnreadable
    ? "documents_unreadable"
    : approval.totalScore >= 80 ? "high" : approval.totalScore >= 50 ? "medium" : "low"
  const applicationStatus = documentsUnreadable ? "documents_unreadable" : "pending_review"

  // Finalize an early pending_payment skeleton in place if one exists; else INSERT.
  const { data: pendingRow } = await supabase
    .from("membership_applications")
    .select("id, reference_number, membership_type")
    .eq("email", EMAIL)
    .eq("status", "pending_payment")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  const ref = pendingRow?.reference_number || generateRefNumber()

  const row = buildApplicationRow({
    referenceNumber: ref,
    formData,
    uploads: uploads as any,
    paymentId: PAYMENT_ID,
    emailVerified: true,
    mobileVerified: false,
    allAiVerified: false,
    documentsUnreadable,
    approval,
    aiConfidence,
    aiFlags: approval.flags,
    hasPendingReview: true,
    manualReviewReason: RECOVERY_NOTE,
    applicationStatus,
  })

  console.log("\nApplication row to persist:")
  console.log(`  mode             : ${pendingRow ? `FINALIZE pending_payment row ${pendingRow.id}` : "INSERT new row"}`)
  console.log(`  reference_number : ${ref}`)
  console.log(`  name             : ${row.name}`)
  console.log(`  membership_type  : ${row.membership_type}`)
  console.log(`  email / phone    : ${row.email} / ${row.mobile_code}${row.phone}`)
  console.log(`  status           : ${row.status}  (needs_manual_review=${row.needs_manual_review})`)
  console.log(`  payment          : ${row.payment_status} ${PAYMENT_ID}  (₹${pay.amount} ${pay.currency})`)
  console.log(`  documents        : ${Object.entries(row.documents).map(([k, v]) => `${k}=${(v as any).fileUrl ? "set" : "null"}`).join(", ")}`)
  console.log(`  ai_confidence    : ${row.ai_confidence}`)
  console.log()

  if (!commit) {
    console.log("(dry run — no writes) Run again with --commit to execute.\n")
    return
  }

  // --- 5. Finalize or insert ---
  let appId: string
  if (pendingRow) {
    const { data: finalized, error: finalizeErr } = await supabase
      .from("membership_applications")
      .update({ ...row, updated_at: new Date().toISOString() })
      .eq("id", pendingRow.id)
      .eq("status", "pending_payment")
      .select("id")
      .maybeSingle()
    if (finalizeErr) {
      console.error("Application finalize failed:", finalizeErr)
      process.exit(1)
    }
    if (!finalized) {
      const { data: cur } = await supabase
        .from("membership_applications")
        .select("id, status")
        .eq("id", pendingRow.id)
        .maybeSingle()
      console.log(`Row ${pendingRow.id} already finalized (status=${cur?.status}). Nothing to do.`)
      process.exit(0)
    }
    appId = finalized.id
    console.log(`✓ Application finalized in place (was pending_payment): ${appId}`)
  } else {
    const { data: inserted, error: insertErr } = await supabase
      .from("membership_applications")
      .insert(row)
      .select("id")
      .single()
    if (insertErr || !inserted) {
      console.error("Application insert failed:", insertErr)
      process.exit(1)
    }
    appId = inserted.id
    console.log(`✓ Application created: ${appId}`)
  }

  // --- 6a. Link the orphan payment ---
  const { error: linkErr } = await supabase
    .from("membership_payments")
    .update({ application_id: appId })
    .eq("gateway_payment_id", PAYMENT_ID)
  if (linkErr) console.error("  WARN: payment link failed:", linkErr.message)
  else console.log("✓ Payment linked to application")

  // --- 6b. Soft-complete the current draft ---
  const { error: draftUpdErr } = await supabase
    .from("draft_applications")
    .update({
      status: "completed",
      failure_reason: null,
      deleted_at: new Date().toISOString(),
      step_data: { ...stepData, payment_id: PAYMENT_ID, recovered_at: new Date().toISOString(), recovered_application_id: appId },
      updated_at: new Date().toISOString(),
    })
    .eq("id", draft.id)
  if (draftUpdErr) console.error("  WARN: draft soft-complete failed:", draftUpdErr.message)
  else console.log("✓ Draft marked completed + soft-deleted")

  // --- 7. Audit log ---
  await logAdminAction({
    adminEmail: ADMIN_ACTOR,
    action: "manual_payment_recovery_create_application",
    entityType: "application",
    entityId: appId,
    entityName: row.name,
    details: {
      reference: ref,
      email: EMAIL,
      membershipType: row.membership_type,
      paymentId: PAYMENT_ID,
      orderId: EXPECTED_ORDER_ID,
      amount: pay.amount,
      draftId: draft.id,
      reason: "orphan_payment_applicant_idle_step_3",
    },
  })

  console.log("\nDone. Application is in /pending for manual review/approval.")
}

main().catch((e) => {
  console.error("Fatal:", e)
  process.exit(1)
})
