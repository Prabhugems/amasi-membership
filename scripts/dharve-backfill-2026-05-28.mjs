// Admin-assisted backfill for Dr. Kavita Dharve (kavitadharve1011@gmail.com).
//
// Context:
//   - ALM applicant, draft b08d5d8f-0941-4b4c-a2e2-67ceff95fa44.
//   - Paid ₹4230 via Razorpay on 2026-05-24 02:06:08 UTC
//     (order_St1w2kVnr5xLUB / pay_St1wD0b8aUcG9d, status=paid).
//   - membership_payments row 75815528-2a1b-4843-a40f-0f4e20a6b880 was written
//     with application_id=NULL (Choudhary-class paid-orphan: verify ran but
//     the draft was never submitted, so no app row existed to link to).
//   - cleanup-drafts cron then soft-deleted the draft on 2026-05-26 03:35 UTC
//     as "Application inactive — user did not proceed past step Payment".
//
// This script:
//   1. Revives the expired draft (clears deleted_at, status='completed')
//   2. Builds membership_applications row from formData + uploads (pending_review)
//   3. Updates the existing orphan payment row to point at the new application
//   4. Writes audit log entry
//
// It deliberately does NOT call autoApproveApplication() — it mirrors the
// Karmakar/Punam pattern: admin reviews and clicks Approve at
// /admin/applications/<id>. The approve handler will see payment_status=paid
// and run the standard sequence/member/email flow.
//
// Idempotency: re-checks for existing app by reference_number AND verifies
// the payment row isn't already linked before doing anything.

import { createClient } from "@supabase/supabase-js"
import { readFileSync } from "fs"
import { randomBytes } from "node:crypto"

const env = readFileSync("/Users/prabhubalasubramaniam/amasi-membership/.env.local", "utf8")
const getEnv = (k) => { const m = env.match(new RegExp(k + '=["\']?([^"\'\\n]+)')); return m?.[1]?.trim() }
const supabase = createClient(getEnv("NEXT_PUBLIC_SUPABASE_URL"), getEnv("SUPABASE_SERVICE_ROLE_KEY"))

const EMAIL = "kavitadharve1011@gmail.com"
const DRAFT_ID = "b08d5d8f-0941-4b4c-a2e2-67ceff95fa44"
const PAYMENT_ROW_ID = "75815528-2a1b-4843-a40f-0f4e20a6b880"
const RZP_PAY_ID = "pay_St1wD0b8aUcG9d"
const RZP_ORDER_ID = "order_St1w2kVnr5xLUB"
const AMOUNT = 4230
const REF = "AMASI-2026-" + randomBytes(5).toString("hex").toUpperCase()

const MANUAL_REASON =
  "paid_orphan_recovery: applicant paid ₹4230 on 2026-05-24 02:06:08 UTC (pay_St1wD0b8aUcG9d) " +
  "but the post-payment submit never fired — the verify route wrote membership_payments " +
  "with application_id=NULL, then cleanup-drafts soft-deleted the draft on 2026-05-26. " +
  "Draft revived and application row built from preserved formData + uploads."

async function main() {
  console.log("\n========== BACKFILL Dr. Kavita Dharve ==========\n")

  // Load draft (expired, deleted_at set — lookup by id)
  const { data: draft, error: dErr } = await supabase
    .from("draft_applications").select("*").eq("id", DRAFT_ID).maybeSingle()
  if (dErr) throw new Error(`Draft lookup: ${dErr.message}`)
  if (!draft) throw new Error("Draft not found")
  console.log(`Loaded draft ${draft.id}: status=${draft.status}, deleted_at=${draft.deleted_at}`)

  const fd = draft.step_data?.formData
  if (!fd) throw new Error("Draft has no formData")
  const uploads = draft.step_data?.uploads || {}
  console.log(`  applicant: ${fd.firstName} ${fd.lastName}, type=${fd.membershipType}, mobile=${fd.mobileCode}${fd.mobile}`)
  console.log(`  uploads:   ${Object.keys(uploads).join(", ")}`)

  // Idempotency: any prior app for this email?
  const { data: existingApp } = await supabase
    .from("membership_applications").select("id, status, reference_number")
    .eq("email", EMAIL).maybeSingle()
  if (existingApp) {
    console.log(`! Application already exists: ${existingApp.id} (ref=${existingApp.reference_number}, status=${existingApp.status})`)
    process.exit(2)
  }

  // Verify orphan payment is still orphaned
  const { data: payRow, error: payErr } = await supabase
    .from("membership_payments").select("*").eq("id", PAYMENT_ROW_ID).maybeSingle()
  if (payErr || !payRow) throw new Error(`Payment row lookup failed: ${payErr?.message || "not found"}`)
  if (payRow.application_id) {
    console.log(`! Payment ${PAYMENT_ROW_ID} already linked to application ${payRow.application_id} — aborting`)
    process.exit(2)
  }
  console.log(`  payment:   ₹${payRow.amount} ${payRow.currency}, status=${payRow.status}, app_id=NULL ✓`)

  // Build documents map, preserving status + extraction (no bypass markers
  // needed — these are user-uploaded with OCR run; profile is exempt from
  // the required-docs gate per document-keys.ts:215-216).
  const documents = {}
  for (const [k, v] of Object.entries(uploads)) {
    documents[k] = {
      status: v.status || "uploaded",
      fileUrl: v.fileUrl || null,
      extracted: v.extracted || {},
      message: v.message || null,
      ...(v.bypass === true ? { bypass: true, bypassReason: v.bypassReason } : {}),
    }
  }

  // 1) Revive the draft
  console.log("\n--- Reviving draft ---")
  const { error: reviveErr } = await supabase
    .from("draft_applications")
    .update({
      status: "completed",
      deleted_at: null,
      failure_reason: null,
      payment_id: RZP_PAY_ID,
      payment_order_id: RZP_ORDER_ID,
      has_verified_payment: true,
      updated_at: new Date().toISOString(),
    })
    .eq("id", DRAFT_ID)
  if (reviveErr) throw new Error(`Draft revive: ${reviveErr.message}`)
  console.log(`  ✓ draft ${DRAFT_ID} -> completed, deleted_at=null`)

  // 2) Insert membership_applications
  console.log("\n--- Inserting membership_applications ---")
  const { data: app, error: appErr } = await supabase
    .from("membership_applications")
    .insert({
      reference_number: REF,
      salutation: fd.salutation || "Dr.",
      first_name: fd.firstName,
      middle_name: fd.middleName || "",
      last_name: fd.lastName,
      name: [fd.firstName, fd.middleName, fd.lastName].filter(Boolean).join(" "),
      email: EMAIL,
      phone: fd.mobile,
      mobile_code: fd.mobileCode || "+91",
      date_of_birth: fd.dob || null,
      gender: fd.gender,
      father_name: fd.fatherName,
      nationality: fd.nationality || "Indian",
      membership_type: fd.membershipType,
      street_address_1: fd.streetLine1,
      street_address_2: fd.streetLine2,
      city: fd.city,
      state: fd.state,
      country: fd.country || "India",
      postal_code: fd.pin || null,
      zone: fd.zone,
      ug_degree: fd.eduUndergradDegree,
      ug_college: fd.eduUndergradCollege,
      ug_university: fd.eduUndergradUniversity,
      ug_year: fd.eduUndergradYear,
      pg_degree: fd.eduPostgradDegree,
      pg_college: fd.eduPostgradCollege,
      pg_university: fd.eduPostgradUniversity,
      pg_year: fd.eduPostgradYear,
      ss_degree: fd.eduSuperspecialtyDegree,
      ss_college: fd.eduSuperspecialtyCollege,
      ss_university: fd.eduSuperspecialtyUniversity,
      ss_year: fd.eduSuperspecialtyYear,
      mci_council_number: fd.mciCouncilNumber,
      mci_council_state: fd.mciCouncilState,
      imr_registration_no: fd.imrRegNo,
      asi_membership_no: fd.asiMembershipNo,
      asi_state: fd.asiState,
      clinic_name: fd.clinicName,
      clinic_city: fd.clinicCity,
      clinic_state: fd.clinicState,
      intl_org_sages: fd.intlOrgSAGES || false,
      intl_org_elsa: fd.intlOrgELSA || false,
      intl_org_other: fd.intlOrgOther || "",
      payment_status: "paid",
      payment_id: RZP_PAY_ID,
      email_verified: true,
      mobile_verified: false,
      ai_verified: false,
      ai_confidence: "manual_admin_backfill",
      ai_flags: ["Paid-orphan recovery 2026-05-28; no AI scoring re-run."],
      needs_manual_review: true,
      manual_review_reason: MANUAL_REASON,
      ocr_score: null,
      documents,
      ocr_data: {},
      status: "pending_review",
    })
    .select("id")
    .single()
  if (appErr) throw new Error(`App insert: ${appErr.message}`)
  const applicationId = app.id
  console.log(`  ✓ application id=${applicationId}, ref=${REF}`)

  // 3) Link the orphan payment row
  console.log("\n--- Linking payment ---")
  const { error: linkErr } = await supabase
    .from("membership_payments")
    .update({ application_id: applicationId, updated_at: new Date().toISOString() })
    .eq("id", PAYMENT_ROW_ID)
  if (linkErr) throw new Error(`Link: ${linkErr.message}`)
  console.log(`  ✓ payment ${PAYMENT_ROW_ID} -> app ${applicationId}`)

  // 4) Audit log
  const { error: auditErr } = await supabase
    .from("membership_audit_log")
    .insert({
      action: "admin_backfill_application",
      entity_type: "membership_application",
      entity_id: applicationId,
      performed_by: "admin (Prabhu via Claude Code)",
      new_data: {
        reference_number: REF,
        razorpay_payment_id: RZP_PAY_ID,
        razorpay_order_id: RZP_ORDER_ID,
        applicant_email: EMAIL,
        amount_inr: AMOUNT,
        revived_draft_id: DRAFT_ID,
        reason: MANUAL_REASON,
        backfilled_at: new Date().toISOString(),
      },
    })
  if (auditErr) console.error(`  ⚠ audit log non-blocking: ${auditErr.message}`)
  else console.log(`  ✓ audit log written`)

  console.log("\n========== DONE ==========")
  console.log(`Application id: ${applicationId}`)
  console.log(`Reference:      ${REF}`)
  console.log(`Status:         pending_review`)
  console.log(`\nNext: review and click Approve at /admin/applications/${applicationId}`)
  console.log(`The approve handler will see payment_status=paid and run the standard sequence + member + email flow.`)
}

main().catch(err => { console.error("\n!!! FAILED:", err.message); process.exit(1) })
