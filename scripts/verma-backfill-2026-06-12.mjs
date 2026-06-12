// Admin-assisted recovery for shivprakash.verma123@gmail.com (Dr. Shiv Prakash Verma)
//
// Context:
//   - Indian general surgeon, ALM tier ₹4230. Paid via Razorpay through the
//     normal /apply flow on 2026-06-11 06:26:33Z.
//   - Payment captured (pay_T0Dysai46ctjmE / order_T0DyPIniANKdSA, ₹4230,
//     INR, status=paid). Draft has payment_verified=true,
//     pre_payment_checkpoint=true, paid_pending_submission=true, AND
//     submit_failed=true at 06:27:16Z (43s after capture).
//   - Wrinkle vs Choudhary/Dwivedy: step_data.email_verified_at is
//     2026-06-11T06:41:01.443Z — fourteen minutes AFTER submit_failed. So at
//     submit time the email_verified gate in /api/applications/submit was
//     still false server-side; the gate rejected the post-payment submit; the
//     user later completed OTP but never re-attempted submit. Draft frozen at
//     status=payment_on_hold, current_step=4, with no membership_applications
//     row and the membership_payments row (5ec68969-…) holding
//     application_id=NULL.
//   - Confirmed no prior membership_applications or members row exists for
//     this email or phone (7509839039).
//   - This is the verify-route paid-orphan queue case — same fragile area as
//     scripts/choudhary-backfill-2026-05-25.mjs and
//     scripts/dwivedy-backfill-2026-06-11.mjs.
//
// Like Dwivedy, Verma went through the normal /apply flow end-to-end. The two
// scored docs (mci_certificate, pg_degree_certificate) have status:"extracted"
// with real OCR data from his own session. The third required doc, profile,
// has status:"uploaded" with empty extracted{} — that's normal: photo is
// excluded from validateRequiredDocuments (document-keys.ts:215-216) so it
// doesn't need bypass markers. Gate passes cleanly without any bypass flags.
//
// This script:
//   1. Inserts membership_applications row (status=pending_review,
//      membership_type=ALM, needs_manual_review=true) using form data + uploads
//      verbatim from the draft's step_data.
//   2. Links the existing membership_payments row
//      (5ec68969-1036-41c4-a68f-d79206cbfbbe, status=paid) to the new app.
//   3. Marks the draft completed.
//   4. Writes audit log entry.
//
// After this lands, admin clicks Approve at /admin/applications/<id>. That
// triggers the canonical /api/applications/approve handler: assigns next AMASI
// number via sequence, inserts members row, fires Resend welcome email and
// WhatsApp approval, and Zoho list subscribe.
//
// Idempotency: aborts if a membership_applications row already exists for
// this email.

import { createClient } from "@supabase/supabase-js"
import { randomBytes } from "node:crypto"
import { readFileSync } from "fs"

const env = readFileSync("/Users/prabhubalasubramaniam/amasi-membership/.env.local", "utf8")
const getEnv = (k) => { const m = env.match(new RegExp(k + '=["\']?([^"\'\\n]+)')); return m?.[1]?.trim() }
const SUPABASE_URL = getEnv("NEXT_PUBLIC_SUPABASE_URL")
const supabase = createClient(SUPABASE_URL, getEnv("SUPABASE_SERVICE_ROLE_KEY"))

const EMAIL = "shivprakash.verma123@gmail.com"
const DRAFT_ID = "a0e58d72-2cc6-4bbe-8bf3-a3db8cbfb108"
const RZP_PAY_ID = "pay_T0Dysai46ctjmE"
const RZP_ORDER_ID = "order_T0DyPIniANKdSA"
const MEMBERSHIP_PAYMENT_ID = "5ec68969-1036-41c4-a68f-d79206cbfbbe"

const REF = `AMASI-2026-${randomBytes(5).toString("hex").toUpperCase()}`

const MANUAL_REASON =
  `submit_failed_recovery: Applicant completed /apply flow; payment captured ${RZP_PAY_ID} at ` +
  "2026-06-11 06:26:33Z, but POST /api/applications/submit failed 43s later (step_data: " +
  "submit_failed=true, submit_failed_at=2026-06-11T06:27:16.779Z). step_data.email_verified_at " +
  "is 2026-06-11T06:41:01.443Z — server-side email_verified flag was still false at submit " +
  "time, so the submit gate rejected the post-payment submit. User completed OTP ~14min later " +
  `but never retried submit, leaving draft ${DRAFT_ID} in payment_on_hold with no application ` +
  "row. Draft retained full form data and OCR-extracted docs (mci_certificate, " +
  "pg_degree_certificate both status:extracted; profile status:uploaded — photo is excluded " +
  "from validateRequiredDocuments). Reused verbatim here. Admin: verify MCI 123173 (Delhi " +
  "Medical Council) and DNB General Surgery provisional cert, then approve."

async function main() {
  console.log("\n========== BACKFILL Dr. Shiv Prakash Verma ==========\n")

  // --- Idempotency
  const { data: byEmail } = await supabase
    .from("membership_applications")
    .select("id, reference_number, email, status")
    .eq("email", EMAIL)
    .maybeSingle()
  if (byEmail) {
    console.log(`Application already exists for ${EMAIL}:`, byEmail)
    process.exit(2)
  }

  // --- pull live draft state (single source of truth)
  const { data: draft, error: draftErr } = await supabase
    .from("draft_applications")
    .select("step_data, membership_type, phone, email")
    .eq("id", DRAFT_ID)
    .single()
  if (draftErr || !draft) throw new Error(`Draft fetch failed: ${draftErr?.message}`)

  const formData = draft.step_data.formData
  const uploads = draft.step_data.uploads

  // --- documents map: preserve status/extracted/message/fileUrl from draft.
  // Mirrors buildApplicationRow's shape; no bypass markers (real OCR ran on
  // mci+pg; profile is photo-class and excluded from the validation gate).
  const documents = Object.fromEntries(
    Object.entries(uploads).map(([k, v]) => [k, {
      status: v.status,
      extracted: v.extracted,
      message: v.message,
      fileUrl: v.fileUrl || null,
    }])
  )
  const ocrData = Object.fromEntries(
    Object.entries(uploads)
      .filter(([, v]) => v.extracted && Object.keys(v.extracted).length > 0)
      .map(([k, v]) => [k, v.extracted])
  )

  // --- application row
  console.log("--- Inserting membership_applications ---")
  const fullName = [formData.firstName, formData.middleName, formData.lastName].filter(Boolean).join(" ")
  const { data: app, error: appErr } = await supabase
    .from("membership_applications")
    .insert({
      reference_number: REF,
      salutation: formData.salutation,
      first_name: formData.firstName,
      middle_name: formData.middleName,
      last_name: formData.lastName,
      name: fullName,
      email: formData.email,
      phone: formData.mobile,
      mobile_code: formData.mobileCode || "+91",
      date_of_birth: formData.dob || null,
      gender: formData.gender,
      father_name: formData.fatherName,
      nationality: formData.nationality || "Indian",
      membership_type: formData.membershipType,
      street_address_1: formData.streetLine1,
      street_address_2: formData.streetLine2,
      city: formData.city,
      state: formData.state,
      country: formData.country || "India",
      postal_code: formData.pin,
      zone: formData.zone,
      ug_degree: formData.eduUndergradDegree,
      ug_college: formData.eduUndergradCollege,
      ug_university: formData.eduUndergradUniversity,
      ug_year: formData.eduUndergradYear,
      pg_degree: formData.eduPostgradDegree,
      pg_college: formData.eduPostgradCollege,
      pg_university: formData.eduPostgradUniversity,
      pg_year: formData.eduPostgradYear,
      ss_degree: formData.eduSuperspecialtyDegree,
      ss_college: formData.eduSuperspecialtyCollege,
      ss_university: formData.eduSuperspecialtyUniversity,
      ss_year: formData.eduSuperspecialtyYear,
      mci_council_number: formData.mciCouncilNumber,
      mci_council_state: formData.mciCouncilState,
      imr_registration_no: formData.imrRegNo,
      asi_membership_no: formData.asiMembershipNo,
      asi_state: formData.asiState,
      clinic_name: formData.clinicName,
      clinic_city: formData.clinicCity,
      clinic_state: formData.clinicState,
      intl_org_sages: formData.intlOrgSAGES,
      intl_org_elsa: formData.intlOrgELSA,
      intl_org_other: formData.intlOrgOther,
      payment_status: "paid",
      payment_id: RZP_PAY_ID,
      email_verified: true,
      mobile_verified: false,
      ai_verified: false,
      ai_confidence: "manual_admin_backfill",
      ai_flags: [
        "Admin-assisted recovery from submit_failed (paid-before-submit, OTP-timing variant).",
        "Docs OCR-extracted in original /apply session; reused verbatim.",
        "Profile photo: status=uploaded with empty extracted{} — photo is excluded from validateRequiredDocuments.",
      ],
      needs_manual_review: true,
      manual_review_reason: MANUAL_REASON,
      ocr_score: null,
      documents,
      ocr_data: ocrData,
      status: "pending_review",
    })
    .select("id")
    .single()
  if (appErr) throw new Error(`App insert failed: ${appErr.message}`)
  const applicationId = app.id
  console.log(`  ✓ application id=${applicationId}`)
  console.log(`  ✓ reference_number=${REF}`)

  // --- link payment → application
  console.log("\n--- Linking payment ---")
  const { error: linkErr } = await supabase
    .from("membership_payments")
    .update({ application_id: applicationId, updated_at: new Date().toISOString() })
    .eq("id", MEMBERSHIP_PAYMENT_ID)
  if (linkErr) throw new Error(`Link failed: ${linkErr.message}`)
  console.log(`  ✓ payment ${MEMBERSHIP_PAYMENT_ID} -> application ${applicationId}`)

  // --- close draft
  console.log("\n--- Closing draft ---")
  const { error: dErr } = await supabase
    .from("draft_applications")
    .update({
      status: "completed",
      payment_id: RZP_PAY_ID,
      payment_order_id: RZP_ORDER_ID,
      has_verified_payment: true,
      updated_at: new Date().toISOString(),
    })
    .eq("id", DRAFT_ID)
  if (dErr) console.error(`  ⚠ draft update failed (non-blocking): ${dErr.message}`)
  else console.log(`  ✓ draft ${DRAFT_ID} -> completed`)

  // --- audit log
  console.log("\n--- Audit log ---")
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
        membership_payment_row: MEMBERSHIP_PAYMENT_ID,
        applicant_email: EMAIL,
        applicant_country: "India",
        mci_council_number: formData.mciCouncilNumber,
        mci_council_state: formData.mciCouncilState,
        membership_type: "ALM",
        amount_inr: 4230,
        recovered_from_draft: DRAFT_ID,
        recovery_reason: "submit_failed_after_payment_capture_otp_timing",
        backfilled_at: new Date().toISOString(),
      },
    })
  if (auditErr) console.error(`  ⚠ audit log failed (non-blocking): ${auditErr.message}`)
  else console.log(`  ✓ audit log written`)

  console.log("\n========== DONE ==========")
  console.log(`Application id: ${applicationId}`)
  console.log(`Reference:      ${REF}`)
  console.log(`Status:         pending_review (needs_manual_review=true)`)
  console.log(`Admin: review and approve at /admin/applications/${applicationId}`)
}

main().catch(err => { console.error("\n!!! FAILED:", err.message); process.exit(1) })
