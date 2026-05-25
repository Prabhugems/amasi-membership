// Admin-assisted backfill for Dr Arpit Choudhary (choudharyarpit17@gmail.com), ALM.
//
// Context:
//   - Razorpay payment pay_St8QrJY7uuy8Ci captured 2026-05-24 08:27:10 UTC,
//     ₹4230 via UPI (GPay), order_St8P0smweqxnir, bank RRN 614465503338,
//     reference AMASI-2026-5DEB4CC4B7 (set by /api/payments/create-order).
//   - Webhook DID land and inserted the membership_payments row, but with
//     application_id=NULL because his draft never converted to a
//     membership_applications row. He reached step 5 (payment), paid, but
//     /api/payments/verify was never successfully called from his client
//     (no `payment` event_type in application_step_events for his email —
//     verify writes that event at route.ts:363-376). Without verify,
//     submit was never reached, so no application row was created.
//   - This is the "paid before submit / draft never converted" pattern
//     called out as a known orphan in /api/payments/verify:348-360.
//   - He has since revisited the apply flow (draft updated_at 2026-05-25
//     04:04 UTC, email re-verified at 03:58 UTC) and minted a second
//     order order_StI5uMTquCXvTm that did not capture. We are recovering
//     the FIRST order's captured payment.
//
// This script (mirrors scripts/karmakar-backfill-2026-05-19.mjs +
// scripts/sharanya-backfill-2026-05-23.mjs structure, but imports the
// shared buildApplicationRow helper introduced in PR-1 — commit 0cb06de —
// rather than reinlining the column list):
//   1. Validates 13 preconditions (draft intact, payment orphan, no
//      existing application). Refuses on any mismatch.
//   2. Builds the membership_applications row via buildApplicationRow,
//      passing the draft's formData + uploads. AI fields are synthesized
//      to land the row in pending_review (no auto-approval — admin reviews
//      manually, scoring is bypassed entirely for this recovery).
//   3. Inserts the application.
//   4. Links the orphan payment (UPDATE membership_payments SET
//      application_id WHERE gateway_payment_id AND application_id IS NULL).
//   5. Marks the draft has_verified_payment=true, status='completed',
//      payment_id and payment_order_id set, so cleanup-drafts (which only
//      touches in_progress/stuck) leaves it for audit. Matches the
//      Karki/Karmakar/Sharanya/Smita precedent.
//   6. Writes a membership_audit_log entry tying the new app to the
//      script, the payment, the draft, and the reason.
//
// Idempotency: if a membership_applications row already exists for the
// reference number or email, the script refuses cleanly. If the orphan
// payment is already linked, same. Safe to re-run.
//
// Auto-approval: explicitly OFF. Status lands as pending_review with
// needs_manual_review=true and manual_review_reason="user_bypass: ..."
// so admin reviews + approves through the normal /pending UI, which
// triggers /api/applications/approve and creates the member record there.
//
// Run command:
//   npx tsx scripts/choudhary-backfill-2026-05-25.mjs [--dry-run]
// (tsx is required — the script imports the .ts buildApplicationRow helper.)

import { readFileSync } from "node:fs"
import { createClient } from "@supabase/supabase-js"
import { buildApplicationRow } from "../src/lib/build-application-row.ts"

// ───── env ─────
const env = readFileSync("/Users/prabhubalasubramaniam/amasi-membership/.env.local", "utf8")
const getEnv = (k) => {
  const m = env.match(new RegExp(k + '=["\']?([^"\'\\n]+)'))
  return m?.[1]?.trim()
}
const supabase = createClient(
  getEnv("NEXT_PUBLIC_SUPABASE_URL"),
  getEnv("SUPABASE_SERVICE_ROLE_KEY")
)

// ───── constants ─────
const SCRIPT_NAME = "choudhary-backfill-2026-05-25"
const DRAFT_ID = "05f19cd1-028f-4813-8f37-654cc41143c6"
const EMAIL = "choudharyarpit17@gmail.com"
const PHONE = "9888262460"
const REF = "AMASI-2026-5DEB4CC4B7"
const RZP_PAY_ID = "pay_St8QrJY7uuy8Ci"
const RZP_ORDER_ID = "order_St8P0smweqxnir"
const AMOUNT = 4230
const MEMBERSHIP_TYPE = "ALM"
const REQUIRED_UPLOADS = ["mci_certificate", "pg_degree_certificate", "profile"]

const MANUAL_REVIEW_REASON =
  "user_bypass: Manual recovery — paid before submit. Razorpay captured " +
  `${RZP_PAY_ID} on 2026-05-24 08:27 UTC (RRN 614465503338, ₹${AMOUNT}, ` +
  `order ${RZP_ORDER_ID}) but the client's /api/payments/verify call never ` +
  "completed, so the application row was never created. Backfill script: " +
  SCRIPT_NAME + ". Admin: review the draft data + uploads and approve normally."

// ───── CLI ─────
const dryRun = process.argv.includes("--dry-run")

// ───── helpers ─────
const die = (msg) => { console.error(`\n✗ ABORT: ${msg}`); process.exit(1) }
const ok = (msg) => console.log(`  ✓ ${msg}`)
const info = (msg) => console.log(`  · ${msg}`)
const banner = (msg) => console.log(`\n── ${msg} ──`)

// Minimal ApprovalResult-shaped stub. buildApplicationRow reads
// approval.totalScore, approval.checks, approval.nmcVerification.
// We DON'T run real scoreApplication: this is a manual recovery, the
// row is going to pending_review either way, and admin reviews the
// docs directly. Real scoring would also trigger an external NMC call
// which is undesirable for a single-record backfill.
const APPROVAL_STUB = Object.freeze({
  totalScore: 0,
  autoApprove: false,
  blockingReasons: [],
  checks: [],
  flags: [],
  nmcVerification: null,
  decision: "manual_review",
})

async function main() {
  console.log("\n========== Choudhary recovery (paid before submit) ==========")
  console.log(`Mode: ${dryRun ? "DRY RUN (no writes)" : "LIVE"}`)
  console.log(`Draft:    ${DRAFT_ID}`)
  console.log(`Payment:  ${RZP_PAY_ID} (₹${AMOUNT}, order ${RZP_ORDER_ID})`)
  console.log(`Ref:      ${REF}`)
  console.log(`Email:    ${EMAIL}`)
  console.log("")

  // ============================================================
  // STAGE 1 — PRECONDITIONS (read-only)
  // ============================================================
  banner("Preconditions")

  // 1. Draft exists with the expected shape
  const { data: draft, error: draftErr } = await supabase
    .from("draft_applications")
    .select("id, email, phone, membership_type, status, has_verified_payment, payment_id, step_data, deleted_at")
    .eq("id", DRAFT_ID)
    .maybeSingle()
  if (draftErr) die(`draft lookup failed: ${draftErr.message}`)
  if (!draft) die(`draft ${DRAFT_ID} not found`)
  if (draft.deleted_at) die(`draft is soft-deleted at ${draft.deleted_at}`)
  if ((draft.email || "").toLowerCase() !== EMAIL.toLowerCase())
    die(`draft email mismatch: got "${draft.email}", expected "${EMAIL}"`)
  if (draft.phone !== PHONE) die(`draft phone mismatch: got "${draft.phone}", expected "${PHONE}"`)
  if (draft.membership_type !== MEMBERSHIP_TYPE)
    die(`draft membership_type mismatch: got "${draft.membership_type}", expected "${MEMBERSHIP_TYPE}"`)
  if (draft.status !== "in_progress")
    die(`draft status mismatch: got "${draft.status}", expected "in_progress"`)
  if (draft.has_verified_payment === true)
    die(`draft already marked has_verified_payment=true — likely already recovered`)
  ok(`draft ${DRAFT_ID} matches expected shape (status=in_progress, ALM, has_verified_payment=false)`)

  // 2. step_data.formData and uploads are present + complete
  const sd = draft.step_data
  if (!sd) die("draft.step_data is null")
  const formData = sd.formData
  if (!formData) die("draft.step_data.formData is null")
  if (!formData.firstName || !formData.lastName) die("draft.step_data.formData missing firstName/lastName")
  if ((formData.email || "").toLowerCase() !== EMAIL.toLowerCase())
    die(`step_data.formData.email mismatch: got "${formData.email}", expected "${EMAIL}"`)
  if (formData.mobile !== PHONE)
    die(`step_data.formData.mobile mismatch: got "${formData.mobile}", expected "${PHONE}"`)
  ok(`formData populated: ${formData.salutation || ""} ${formData.firstName} ${formData.lastName}, MCI ${formData.mciCouncilNumber}, PG ${formData.eduPostgradDegree}`)

  const uploads = sd.uploads || {}
  for (const slot of REQUIRED_UPLOADS) {
    const u = uploads[slot]
    if (!u) die(`draft.step_data.uploads.${slot} missing`)
    if (!u.fileUrl) die(`draft.step_data.uploads.${slot}.fileUrl is null/empty`)
    if (slot !== "profile" && u.status !== "extracted")
      die(`draft.step_data.uploads.${slot}.status is "${u.status}", expected "extracted"`)
  }
  ok(`all 3 required uploads present with fileUrl (${REQUIRED_UPLOADS.join(", ")})`)

  // 3. email_verified flag on step_data
  if (sd.email_verified !== true) die("step_data.email_verified is not true")
  ok(`step_data.email_verified=true (verified at ${sd.email_verified_at || "unknown"})`)

  // 4. Payment row exists, is paid, and is orphan
  const { data: payment, error: payErr } = await supabase
    .from("membership_payments")
    .select("id, gateway_payment_id, gateway_order_id, application_id, status, amount, currency, member_email")
    .eq("gateway_payment_id", RZP_PAY_ID)
    .maybeSingle()
  if (payErr) die(`payment lookup failed: ${payErr.message}`)
  if (!payment) die(`membership_payments row for ${RZP_PAY_ID} not found`)
  if (payment.status !== "paid") die(`payment.status="${payment.status}", expected "paid"`)
  if (payment.application_id) die(`payment already linked to application_id=${payment.application_id} — likely already recovered`)
  if (Number(payment.amount) !== AMOUNT)
    die(`payment.amount=${payment.amount}, expected ${AMOUNT}`)
  if (payment.gateway_order_id !== RZP_ORDER_ID)
    die(`payment.gateway_order_id="${payment.gateway_order_id}", expected "${RZP_ORDER_ID}"`)
  ok(`payment ${RZP_PAY_ID} verified: status=paid, application_id=NULL, ₹${payment.amount}`)

  // 5. No existing application for ref or email (full idempotency check)
  const { data: byRef } = await supabase
    .from("membership_applications")
    .select("id, status, payment_status, created_at")
    .eq("reference_number", REF)
    .maybeSingle()
  if (byRef) die(`membership_applications already exists for ref ${REF} (id=${byRef.id}, status=${byRef.status}) — already recovered`)
  ok(`no application exists with reference_number ${REF}`)

  const { data: byEmail } = await supabase
    .from("membership_applications")
    .select("id, reference_number, status, payment_status, created_at")
    .ilike("email", EMAIL)
  if (byEmail && byEmail.length > 0)
    die(`membership_applications row(s) exist for email ${EMAIL}: ${JSON.stringify(byEmail)} — investigate before re-running`)
  ok(`no application exists for email ${EMAIL}`)

  // ============================================================
  // STAGE 2 — BUILD THE APPLICATION ROW
  // ============================================================
  banner("Building application row via buildApplicationRow()")

  const row = buildApplicationRow({
    referenceNumber: REF,
    formData,
    uploads,
    paymentId: RZP_PAY_ID,
    emailVerified: true,
    mobileVerified: false,
    // AI fields synthesized to force pending_review. Real scoring is
    // bypassed for this recovery — admin reviews the docs directly.
    allAiVerified: false,
    documentsUnreadable: false,
    approval: APPROVAL_STUB,
    aiConfidence: "manual_recovery",
    aiFlags: [`manual_recovery: ${SCRIPT_NAME}`],
    hasPendingReview: true,
    manualReviewReason: MANUAL_REVIEW_REASON,
    applicationStatus: "pending_review",
  })

  info(`name:               ${row.name}`)
  info(`email:              ${row.email}`)
  info(`phone:              ${row.mobile_code} ${row.phone}`)
  info(`membership_type:    ${row.membership_type}`)
  info(`reference_number:   ${row.reference_number}`)
  info(`payment_status:     ${row.payment_status}`)
  info(`payment_id:         ${row.payment_id}`)
  info(`status:             ${row.status}`)
  info(`needs_manual_review: ${row.needs_manual_review}`)
  info(`ai_verified:        ${row.ai_verified}`)
  info(`ai_confidence:      ${row.ai_confidence}`)
  info(`ai_flags:           ${JSON.stringify(row.ai_flags)}`)
  info(`ocr_score:          ${row.ocr_score}`)
  info(`documents (keys):   ${Object.keys(row.documents).join(", ")}`)
  info(`ocr_data (keys):    ${Object.keys(row.ocr_data).join(", ")}`)
  info(`manual_review_reason: ${row.manual_review_reason}`)

  if (dryRun) {
    banner("DRY RUN — planned writes (NOT executing)")
    console.log("1. INSERT into membership_applications:")
    console.log(JSON.stringify(row, null, 2))
    console.log("\n2. UPDATE membership_payments")
    console.log(`     SET application_id = <new app id>, updated_at = now()`)
    console.log(`     WHERE gateway_payment_id = "${RZP_PAY_ID}" AND application_id IS NULL`)
    console.log("\n3. UPDATE draft_applications")
    console.log(`     SET has_verified_payment = true,`)
    console.log(`         status = "completed",`)
    console.log(`         payment_id = "${RZP_PAY_ID}",`)
    console.log(`         payment_order_id = "${RZP_ORDER_ID}",`)
    console.log(`         updated_at = now()`)
    console.log(`     WHERE id = "${DRAFT_ID}"`)
    console.log("\n4. INSERT into membership_audit_log:")
    console.log(JSON.stringify(buildAuditEntry("<placeholder application id>"), null, 2))
    console.log("\n========== DRY RUN COMPLETE ==========")
    console.log("Re-run WITHOUT --dry-run to execute.")
    return
  }

  // ============================================================
  // STAGE 3 — WRITES (live mode only)
  // ============================================================
  banner("Executing writes (LIVE)")

  // 3a. Insert application
  const { data: inserted, error: insertErr } = await supabase
    .from("membership_applications")
    .insert(row)
    .select("id")
    .single()
  if (insertErr) die(`application insert failed: ${insertErr.message}`)
  const applicationId = inserted.id
  ok(`application inserted: ${applicationId}`)

  // 3b. Link orphan payment (guarded by `IS NULL` to refuse if a concurrent
  // process already linked it)
  const { data: linked, error: linkErr } = await supabase
    .from("membership_payments")
    .update({ application_id: applicationId, updated_at: new Date().toISOString() })
    .eq("gateway_payment_id", RZP_PAY_ID)
    .is("application_id", null)
    .select("id")
  if (linkErr) {
    console.error(`\n✗ payment link failed: ${linkErr.message}`)
    console.error(`  application ${applicationId} was created but the payment row is not linked.`)
    console.error(`  Resolve manually: UPDATE membership_payments SET application_id='${applicationId}'`)
    console.error(`  WHERE gateway_payment_id='${RZP_PAY_ID}';`)
    process.exit(2)
  }
  if (!linked || linked.length === 0) {
    console.error(`\n✗ payment link affected 0 rows — payment may have been linked concurrently.`)
    console.error(`  application ${applicationId} was created; investigate membership_payments state.`)
    process.exit(2)
  }
  ok(`payment ${RZP_PAY_ID} linked to application ${applicationId}`)

  // 3c. Mark draft as completed
  const { error: draftUpdateErr } = await supabase
    .from("draft_applications")
    .update({
      has_verified_payment: true,
      status: "completed",
      payment_id: RZP_PAY_ID,
      payment_order_id: RZP_ORDER_ID,
      updated_at: new Date().toISOString(),
    })
    .eq("id", DRAFT_ID)
  if (draftUpdateErr) {
    console.error(`  ⚠ draft update non-blocking failure: ${draftUpdateErr.message}`)
  } else {
    ok(`draft ${DRAFT_ID} marked completed, has_verified_payment=true`)
  }

  // 3d. Audit log
  const auditEntry = buildAuditEntry(applicationId)
  const { error: auditErr } = await supabase
    .from("membership_audit_log")
    .insert(auditEntry)
  if (auditErr) console.error(`  ⚠ audit log non-blocking failure: ${auditErr.message}`)
  else ok("audit log entry written")

  banner("Done")
  console.log(`Application id:    ${applicationId}`)
  console.log(`Reference:         ${REF}`)
  console.log(`Status:            pending_review (needs_manual_review=true)`)
  console.log(`Admin review at:   /pending or /admin/applications/${applicationId}`)
  console.log("")
}

function buildAuditEntry(applicationId) {
  return {
    entity_type: "membership_application",
    entity_id: applicationId,
    action: "admin_backfill_application",
    performed_by: `admin (manual recovery via ${SCRIPT_NAME})`,
    old_data: null,
    new_data: {
      script: SCRIPT_NAME,
      pr1_helper_commit: "0cb06de", // PR-1, the buildApplicationRow extraction
      reference_number: REF,
      razorpay_payment_id: RZP_PAY_ID,
      razorpay_order_id: RZP_ORDER_ID,
      applicant_email: EMAIL,
      applicant_phone: PHONE,
      amount_inr: AMOUNT,
      draft_id: DRAFT_ID,
      reason:
        "paid_before_submit: Webhook recorded membership_payments orphan on " +
        "2026-05-24 08:27 UTC; /api/payments/verify was never called from the " +
        "client (no `payment` event in application_step_events), so submit " +
        "never ran and the application row was never created. This backfill " +
        "creates the application from the draft's step_data and links the " +
        "orphan payment.",
      backfilled_at: new Date().toISOString(),
    },
  }
}

main().catch((err) => {
  console.error("\n!!! UNCAUGHT ERROR:", err)
  process.exit(1)
})
