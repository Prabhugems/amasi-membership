// Admin-assisted backfill for dr.hemlataparashar@gmail.com (Dr. Hemlata Parashar)
//
// Context:
//   - Indian Obs&Gyn applicant, ALM tier ₹4230. Paid via Razorpay payment link
//     plink_SzpcPwMgTEXg7I (ref AMASI-2026-PARASHAR-381D6277, created 2026-06-10
//     by Claude Code on Prabhu's behalf).
//   - Reused her own draft's uploaded documents (cert images already in
//     uploads/ from her /apply session). No new file upload.
//   - Married name Parashar on the certificate (maiden Batham on PG degree;
//     MCI cert is the name-change additional registration that documents the
//     Batham → Parashar transition).
//
// BEFORE RUNNING: set RZP_PAY_ID below to the captured pay_xxx from Razorpay
// dashboard or webhook. Without it the script aborts.
//
// This script:
//   1. Inserts membership_payments row (status=paid, idempotent by gateway_payment_id)
//   2. Inserts membership_applications row (status=pending_review,
//      membership_type=ALM, needs_manual_review=true) — reusing the draft's
//      file URLs for documents
//   3. Links membership_payments.application_id to the new app
//   4. Marks her draft (c18b4393-0d77-4641-b353-a68b63a1626f) completed
//   5. Writes audit log entry
//
// Bypass markers: per the admin-attach-docs precedent (punam/zuka), both cert
// slots carry bypass:true + bypassReason:"user_bypass" so the admin approve
// gate doesn't reject. Without these, validateRequiredDocuments fails because
// the doc URLs come from an admin-mediated flow rather than a fresh OCR pass.
//
// Idempotency: aborts if a membership_applications row already exists for the
// reference_number OR for this email.

import { createClient } from "@supabase/supabase-js"
import { readFileSync } from "fs"

const env = readFileSync("/Users/prabhubalasubramaniam/amasi-membership/.env.local", "utf8")
const getEnv = (k) => { const m = env.match(new RegExp(k + '=["\']?([^"\'\\n]+)')); return m?.[1]?.trim() }
const SUPABASE_URL = getEnv("NEXT_PUBLIC_SUPABASE_URL")
const supabase = createClient(SUPABASE_URL, getEnv("SUPABASE_SERVICE_ROLE_KEY"))

const EMAIL = "dr.hemlataparashar@gmail.com"
const REF = "AMASI-2026-PARASHAR-381D6277"
const RZP_PAY_ID = "pay_Szpr8QaKRDrIQt"
const RZP_LINK_ID = "plink_SzpcPwMgTEXg7I"
const AMOUNT = 4230
const DRAFT_ID = "c18b4393-0d77-4641-b353-a68b63a1626f"

if (RZP_PAY_ID.startsWith("REPLACE_")) {
  console.error("Set RZP_PAY_ID at the top of this file to the captured pay_xxx id before running.")
  process.exit(1)
}

// File URLs from her draft's step_data.uploads — same images she uploaded
// during her own /apply session. Stored as public URLs in uploads/ bucket.
const PROFILE_URL = "https://jmdwxymbgxwdsmcwbahp.supabase.co/storage/v1/object/public/uploads/photo/1780394431129-suxyqt.jpg"
const MCI_URL     = "https://jmdwxymbgxwdsmcwbahp.supabase.co/storage/v1/object/public/uploads/mci_certificate/1780394364808-lk8jxh.jpg"
const PG_URL      = "https://jmdwxymbgxwdsmcwbahp.supabase.co/storage/v1/object/public/uploads/pg_degree_certificate/1780394382025-6ye9h0.jpg"

const MANUAL_REASON =
  "user_bypass: Admin-assisted recovery. Applicant idle at /apply step 4 (applicant_idle_step_4) " +
  `since 2026-06-05 on draft ${DRAFT_ID}. Admin sent Razorpay link ${RZP_LINK_ID} on 2026-06-10; ` +
  `payment captured as ${RZP_PAY_ID}. Documents reused from her own /apply OCR run (MCI 11991 MP, ` +
  "PG MS Obs&Gyn Jiwaji 1996, profile photo). Name decision: married name PARASHAR on certificate " +
  "to match registered email; MCI cert is the name-change additional registration " +
  "(maiden Batham → Parashar). Admin verify name + PG degree match before approve."

async function main() {
  console.log("\n========== BACKFILL Dr. Hemlata Parashar ==========\n")

  // --- Idempotency
  const { data: byRef } = await supabase
    .from("membership_applications")
    .select("id, reference_number, email, status")
    .eq("reference_number", REF)
    .maybeSingle()
  if (byRef) {
    console.log(`Application already exists by reference_number ${REF}:`, byRef)
    process.exit(2)
  }
  const { data: byEmail } = await supabase
    .from("membership_applications")
    .select("id, reference_number, email, status")
    .eq("email", EMAIL)
    .maybeSingle()
  if (byEmail) {
    console.log(`Application already exists by email ${EMAIL}:`, byEmail)
    process.exit(2)
  }

  // --- documents map (URLs from her draft + bypass on cert slots)
  const documents = {
    profile: {
      status: "uploaded",
      fileUrl: PROFILE_URL,
      message: "Reused from applicant's own /apply upload (draft c18b4393, 2026-06-02). Profile photo.",
      extracted: {},
    },
    mci_certificate: {
      status: "uploaded",
      fileUrl: MCI_URL,
      message: "Reused from applicant's own /apply upload (draft c18b4393). MCI 11991, Madhya Pradesh Medical Council. NOTE: cert is the name-change additional registration documenting Batham → Parashar.",
      extracted: {
        registration_number: "11991",
        council_name: "Madhya Pradesh Medical Council",
        state: "Madhya Pradesh",
        full_name: "Hemlata Parashar",
        date_of_registration: "1992-12-30",
      },
      bypass: true,
      bypassReason: "user_bypass",
    },
    pg_degree_certificate: {
      status: "uploaded",
      fileUrl: PG_URL,
      message: "Reused from applicant's own /apply upload (draft c18b4393). M.S. Obstetrics & Gynaecology, Jiwaji University Gwalior, 1996. Issued in maiden name Hemlata Batham.",
      extracted: {
        full_name: "Hemlata Batham",
        degree_name: "M.S.",
        specialisation: "Obstetrics & Gynaecology",
        university_name: "Jiwaji University, Gwalior",
        institution_name: "Gajra Raja Medical College, Gwalior",
        year_of_passing: "1996",
        document_type: "original",
      },
      bypass: true,
      bypassReason: "user_bypass",
    },
  }

  // --- payment row
  console.log("--- Inserting membership_payments ---")
  const { data: existingPay } = await supabase
    .from("membership_payments")
    .select("id")
    .eq("gateway_payment_id", RZP_PAY_ID)
    .maybeSingle()
  let paymentId
  if (existingPay) {
    paymentId = existingPay.id
    console.log(`  payment row already exists (id=${paymentId}) — reusing`)
  } else {
    const { data: insertedPay, error: payErr } = await supabase
      .from("membership_payments")
      .insert({
        member_email: EMAIL,
        gateway_order_id: null,
        gateway_payment_id: RZP_PAY_ID,
        payment_gateway: "razorpay",
        status: "paid",
        amount: AMOUNT,
        currency: "INR",
      })
      .select("id")
      .single()
    if (payErr) throw new Error(`Payment insert failed: ${payErr.message}`)
    paymentId = insertedPay.id
    console.log(`  ✓ payment row id=${paymentId}`)
  }

  // --- application row
  console.log("\n--- Inserting membership_applications ---")
  const { data: app, error: appErr } = await supabase
    .from("membership_applications")
    .insert({
      reference_number: REF,
      salutation: "Dr.",
      first_name: "Hemlata",
      middle_name: "",
      last_name: "Parashar",
      name: "Hemlata Parashar",
      email: EMAIL,
      phone: "7987284712",
      mobile_code: "+91",
      gender: "Female",
      nationality: "Indian",
      membership_type: "ALM",
      street_address_1: "",
      street_address_2: "",
      city: "Bhopal",
      state: "Madhya Pradesh",
      country: "India",
      postal_code: "",
      zone: "West Zone",
      ug_degree: "",
      ug_college: "",
      ug_university: "",
      ug_year: "",
      pg_degree: "M.S. (Obstetrics & Gynaecology)",
      pg_college: "Gajra Raja Medical College, Gwalior",
      pg_university: "Jiwaji University, Gwalior",
      pg_year: "1996",
      ss_degree: "",
      ss_college: "",
      ss_university: "",
      ss_year: "",
      mci_council_number: "11991",
      mci_council_state: "Madhya Pradesh",
      imr_registration_no: "",
      asi_membership_no: "",
      asi_state: "",
      clinic_name: "",
      clinic_city: "",
      clinic_state: "",
      intl_org_sages: false,
      intl_org_elsa: false,
      intl_org_other: "",
      payment_status: "paid",
      payment_id: RZP_PAY_ID,
      email_verified: true,
      mobile_verified: false,
      ai_verified: false,
      ai_confidence: "manual_admin_backfill",
      ai_flags: ["Admin-assisted recovery from stuck draft (applicant_idle_step_4); paid via off-band Razorpay link; no AI scoring."],
      needs_manual_review: true,
      manual_review_reason: MANUAL_REASON,
      ocr_score: null,
      documents,
      ocr_data: {},
      status: "pending_review",
    })
    .select("id")
    .single()
  if (appErr) throw new Error(`App insert failed: ${appErr.message}`)
  const applicationId = app.id
  console.log(`  ✓ application id=${applicationId}`)

  // --- link payment → application
  console.log("\n--- Linking payment ---")
  const { error: linkErr } = await supabase
    .from("membership_payments")
    .update({ application_id: applicationId, member_email: EMAIL, updated_at: new Date().toISOString() })
    .eq("id", paymentId)
  if (linkErr) throw new Error(`Link failed: ${linkErr.message}`)
  console.log(`  ✓ payment ${paymentId} -> application ${applicationId}`)

  // --- close draft
  console.log("\n--- Closing draft ---")
  const { error: draftErr } = await supabase
    .from("draft_applications")
    .update({
      status: "completed",
      payment_id: RZP_PAY_ID,
      has_verified_payment: true,
      updated_at: new Date().toISOString(),
    })
    .eq("id", DRAFT_ID)
  if (draftErr) console.error(`  ⚠ draft update failed (non-blocking): ${draftErr.message}`)
  else console.log(`  ✓ draft ${DRAFT_ID} -> completed`)

  // --- audit log
  // Note: schema uses old_data/new_data jsonb columns, NOT details. The
  // karki-backfill / karmakar-backfill scripts shipped with `details` and would
  // have silently failed if anyone actually inspected the audit table — verified
  // missing column on 2026-06-10. Use new_data for forward state.
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
        razorpay_payment_link_id: RZP_LINK_ID,
        applicant_email: EMAIL,
        applicant_country: "India",
        mci_council_number: "11991",
        mci_council_state: "Madhya Pradesh",
        membership_type: "ALM",
        amount_inr: AMOUNT,
        reason: MANUAL_REASON,
        reused_docs: { profile: PROFILE_URL, mci_certificate: MCI_URL, pg_degree_certificate: PG_URL },
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
