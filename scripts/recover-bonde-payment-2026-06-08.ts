/**
 * One-shot recovery — Dr. Bonde Pavan Namdeo (pnbonde143@gmail.com, ALM).
 *
 * Context (2026-06-08):
 *   The applicant completed the entire /apply flow on 2026-06-07:
 *     - uploaded + OCR-extracted all ALM docs (profile, MCI cert, PG degree cert)
 *     - verified email (otp_codes + draft.step_data.email_verified = true)
 *     - PAID ₹4,230 — Razorpay pay_Syg7PEiNIMw0XR / order_Syg7AIpadJ77yv.
 *       `membership_payments` row exists with status='paid', application_id=NULL.
 *   But the final `/api/applications/submit` step never created the
 *   membership_applications row. The draft is left as
 *   draft_applications.status='stuck' (failure_reason 'applicant_idle_step_3',
 *   a STALE tag from before the applicant returned and paid). It surfaces in
 *   the /incomplete list and the applicant has paid with nothing to show.
 *
 * Why a script (and not just replaying the live endpoint):
 *   `/api/applications/submit` gate 2 requires an OTP verified within the last
 *   120 min. The OTP was verified ~24h ago, so a live replay would 401. This
 *   script reuses the SAME shared helper the endpoint uses (buildApplicationRow)
 *   so the row is byte-for-byte what submit would have written — no field drift.
 *
 * What it does (mirrors /api/applications/submit, minus auto-approval):
 *   1. Loads the draft by email and reconstructs the submit payload from
 *      step_data (formData + uploads + payment_id).
 *   2. Re-verifies the payment is `paid` and unlinked (application_id IS NULL).
 *   3. Idempotency guards: aborts if an application or member already exists.
 *   4. Runs scoreApplication() for honest reviewer-facing AI fields (falls back
 *      to a "scoring skipped" result if scoring can't run locally).
 *   5. Inserts the membership_applications row via buildApplicationRow(),
 *      FORCED to status='pending_review' / needs_manual_review=true regardless
 *      of the AI score — a human approves this off-path recovery via /pending.
 *   6. Links the payment row (application_id) and soft-completes the draft.
 *   7. Writes an admin audit-log entry.
 *
 * Usage:
 *   pnpm tsx scripts/recover-bonde-payment-2026-06-08.ts            # dry run
 *   pnpm tsx scripts/recover-bonde-payment-2026-06-08.ts --commit   # do it
 *
 * Idempotent: re-running after a successful commit aborts at the guards
 * (application now exists) — it will not create a second application, burn a
 * sequence number, or re-touch the payment.
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- one-off recovery script reconstructs
   loosely-typed JSON out of draft step_data; mirrors the implicit-any shape submit/route.ts uses. */
import path from "node:path"
import { config as loadEnv } from "dotenv"

// Load .env.local explicitly (Next.js convention; tsx doesn't auto-load).
loadEnv({ path: path.resolve(process.cwd(), ".env.local") })

import { createAdminClient } from "../src/lib/supabase"
import { buildApplicationRow } from "../src/lib/build-application-row"
import { scoreApplication, type ApprovalResult } from "../src/lib/ai-approval"
import { generateRefNumber } from "../src/lib/reference-number"
import { logAdminAction } from "../src/lib/audit-log"

// Email is the first non-flag CLI arg; defaults to the original Bonde case.
//   pnpm tsx scripts/recover-bonde-payment-2026-06-08.ts <email> [--commit]
const EMAIL = (process.argv.slice(2).find((a) => !a.startsWith("--")) || "pnbonde143@gmail.com").toLowerCase()
// Optional belt-and-suspenders: only the original case pins an expected
// payment id. For any other email we trust the draft's step_data.payment_id
// after re-verifying it against a `paid` membership_payments row.
const EXPECTED_PAYMENT_ID =
  EMAIL === "pnbonde143@gmail.com" ? "pay_Syg7PEiNIMw0XR" : null
const ADMIN_ACTOR = "payment-recovery-paid-no-submission-2026-06-08"

const RECOVERY_NOTE =
  "Payment-recovery (2026-06-08): applicant paid ₹4230 (membership_payments.status='paid') " +
  "but /api/applications/submit never created the application — draft left status='stuck'. " +
  "Promoted manually from draft step_data. Routed to manual review; verify docs before approving."

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
  console.log(`\n=== Payment recovery — paid-but-no-application (${EMAIL}) ===`)
  console.log(`Mode: ${commit ? "COMMIT" : "DRY RUN"}\n`)

  const supabase = createAdminClient()

  // --- 1. Load the draft ---
  const { data: draft, error: draftErr } = await supabase
    .from("draft_applications")
    .select("*")
    .eq("email", EMAIL)
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
  const paymentId = stepData.payment_id as string | undefined

  if (!formData || !uploads || !paymentId) {
    console.error("Draft step_data missing formData/uploads/payment_id — cannot reconstruct.")
    console.error(`  formData=${!!formData} uploads=${!!uploads} payment_id=${paymentId ?? "null"}`)
    process.exit(1)
  }
  if (EXPECTED_PAYMENT_ID && paymentId !== EXPECTED_PAYMENT_ID) {
    console.error(`Payment id mismatch: draft has ${paymentId}, expected ${EXPECTED_PAYMENT_ID}. Aborting.`)
    process.exit(1)
  }

  // --- Optional membership-type override (e.g. LM -> ALM when the applicant is
  //     missing an LM-only doc but qualifies for ALM at the same ₹4230 fee;
  //     mirrors the Soham case). The fee is identical, so the paid amount still
  //     matches. The downgraded type drives both scoring (required-doc set) and
  //     the application row. --type=ALM
  const typeOverride = process.argv.slice(2).find((a) => a.startsWith("--type="))?.split("=")[1]?.trim()
  const originalType: string = formData.membershipType
  let downgradeNote = ""
  if (typeOverride && typeOverride !== originalType) {
    formData.membershipType = typeOverride
    downgradeNote = ` Membership type changed ${originalType}→${typeOverride} at recovery (same ₹4230 fee; ${typeOverride} does not require the ${originalType}-only document the applicant was missing). Applicant may request an upgrade later.`
    console.log(`Membership type override: ${originalType} -> ${typeOverride}\n`)
  }

  // --- 2. Re-verify payment is paid and unlinked ---
  const { data: pay, error: payErr } = await supabase
    .from("membership_payments")
    .select("id, status, amount, currency, application_id, member_email")
    .eq("gateway_payment_id", paymentId)
    .maybeSingle()

  if (payErr || !pay) {
    console.error("membership_payments row not found for", paymentId, payErr)
    process.exit(1)
  }
  if (pay.status !== "paid") {
    console.error(`Payment status is '${pay.status}', not 'paid'. Aborting — confirm in Razorpay first.`)
    process.exit(1)
  }
  if (pay.application_id) {
    console.error(`Payment already linked to application_id=${pay.application_id}. Recovery already done? Aborting.`)
    process.exit(1)
  }

  // --- 3. Idempotency: no existing application or member for this person ---
  const { data: existingApp } = await supabase
    .from("membership_applications")
    .select("id, status")
    .or(`email.eq.${EMAIL},payment_id.eq.${paymentId}`)
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
    console.log(`Scoring ran: totalScore=${approval.totalScore}%, autoApprove=${approval.autoApprove}, decision=${approval.decision ?? "(derived)"}`)
  } catch (e) {
    console.warn("scoreApplication failed locally — using fallback 'scoring skipped' result:", (e as Error).message)
    approval = fallbackApproval()
  }

  const documentsUnreadable = approval.decision === "documents_unreadable"
  const aiConfidence = documentsUnreadable
    ? "documents_unreadable"
    : approval.totalScore >= 80 ? "high" : approval.totalScore >= 50 ? "medium" : "low"

  // FORCE manual review regardless of score — this is an off-path recovery.
  const applicationStatus = documentsUnreadable ? "documents_unreadable" : "pending_review"

  // WS-C finalize-or-insert: with WSC_EARLY_APPLICATION_ENABLED on, a skeleton
  // row at status='pending_payment' was created BEFORE payment (create-pending),
  // keyed to this email. A plain INSERT would then violate the partial unique
  // index idx_unique_active_application (one active app per email+type). Mirror
  // submit/route.ts: finalize that row in place if present, else INSERT. When we
  // finalize we KEEP the early row's reference_number (the value the applicant's
  // tracking email + the linked payment already carry). Lookup is by email only
  // (most recent pending_payment) so the type-downgrade path still finds it.
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
    paymentId,
    emailVerified: true, // confirmed: otp_codes verified + draft.step_data.email_verified
    mobileVerified: false,
    allAiVerified: false, // never auto-approve from this script
    documentsUnreadable,
    approval,
    aiConfidence,
    aiFlags: approval.flags,
    hasPendingReview: true,
    manualReviewReason: RECOVERY_NOTE + downgradeNote,
    applicationStatus,
  })

  console.log("\nApplication row to persist:")
  console.log(`  mode             : ${pendingRow ? `FINALIZE pending_payment row ${pendingRow.id} (WS-C)` : "INSERT new row"}`)
  console.log(`  reference_number : ${ref}`)
  console.log(`  name             : ${row.name}`)
  console.log(`  membership_type  : ${row.membership_type}`)
  console.log(`  email / phone    : ${row.email} / ${row.mobile_code}${row.phone}`)
  console.log(`  status           : ${row.status}  (needs_manual_review=${row.needs_manual_review})`)
  console.log(`  payment          : ${row.payment_status} ${paymentId}  (₹${pay.amount} ${pay.currency})`)
  console.log(`  documents        : ${Object.entries(row.documents).map(([k, v]) => `${k}=${(v as any).fileUrl ? "set" : "null"}`).join(", ")}`)
  console.log(`  ai_confidence    : ${row.ai_confidence}`)
  console.log()

  if (!commit) {
    console.log("(dry run — no writes) Run again with --commit to execute.\n")
    return
  }

  // --- 5. Finalize (WS-C) or insert ---
  let appId: string
  if (pendingRow) {
    // Finalize the early pending_payment row in place. The status guard makes
    // this idempotent against a concurrent finalize / Razorpay-driven submit.
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
      // Lost the race — another path already promoted this row out of
      // pending_payment. Nothing to recover; don't re-run.
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

  // --- 6a. Link payment ---
  const { error: linkErr } = await supabase
    .from("membership_payments")
    .update({ application_id: appId })
    .eq("gateway_payment_id", paymentId)
  if (linkErr) console.error("  WARN: payment link failed:", linkErr.message)
  else console.log("✓ Payment linked to application")

  // --- 6b. Soft-complete the draft so it leaves the /incomplete list ---
  const { error: draftUpdErr } = await supabase
    .from("draft_applications")
    .update({
      status: "completed",
      failure_reason: null,
      deleted_at: new Date().toISOString(),
      step_data: { ...stepData, recovered_at: new Date().toISOString(), recovered_application_id: appId },
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
      paymentId,
      amount: pay.amount,
      draftId: draft.id,
      reason: "paid_but_submit_never_created_application",
    },
  })

  console.log("\nDone. Application is in /pending for manual review/approval.")
  console.log("Next: approve via the admin /pending UI (copies docs → member, assigns AMASI #).")
}

main().catch((e) => {
  console.error("Fatal:", e)
  process.exit(1)
})
