// Admin-assisted recovery for 4 paid-before-submit orphans (2026-06-28 batch).
//
// Cohort (all ₹4230 INR; draft.step_data: submit_failed=true,
// paid_pending_submission=true, payment_verified=true; no matching
// membership_applications or members row; membership_payments.application_id=NULL):
//
//   1. kavitachavda1281998@gmail.com  LM   pay_T5WTbseciTp76A  order_T5WTArukNcFXL1
//   2. drhosannassrc@gmail.com        LM   pay_T5hLgtS7BywIAf  order_T5hHI9y0dg2l8o
//   3. akhilmudgal516@gmail.com       ALM  pay_T6cLy4GjWAS4KA  order_T6cLP5ApoyP0sF
//   4. dr.vardankrsingh@gmail.com     ALM  pay_T6eRmU2JbiY4jK  order_T6eRKGK14DaJzQ
//
// Pattern matches scripts/orphan-batch-backfill-2026-06-18.mjs — verify-route
// paid-orphan queue. Each draft holds the full applicant payload from their
// own /apply session.
//
// Per-applicant wrinkles flagged in manual_review_reason:
//   - akhilmudgal516: pg_degree_certificate is status="uploaded" (NOT
//     "extracted") with empty extracted{}. OCR did not run or did not return
//     fields. Admin should re-OCR or manually verify the PG cert image
//     before approve.
//   - kavitachavda1281998: MCI number is "PG/G-41090" (Gujarat
//     postgraduate-registration prefix) and ASI number is "AL 2781024"
//     (with prefix/space). Both verbatim from formData. Admin should
//     confirm these resolve cleanly during verify-cross-check.
//   - drhosannassrc: name parts come through as first="Hosanna",
//     middle="Singh", last="Sati Raju". Written verbatim; admin to
//     confirm display name before approve.
//
// Each backfill:
//   1. Inserts membership_applications row (status=pending_review,
//      needs_manual_review=true) from draft.step_data verbatim.
//   2. Links the existing membership_payments row to the new app.
//   3. Marks the draft completed.
//   4. Writes audit log entry.
//
// Idempotent per-email. Per-applicant try/catch so one failure doesn't
// block the rest. Run order: oldest payment first.
//
// Run with:
//   node scripts/orphan-batch-backfill-2026-06-28.mjs
// or dry-run:
//   DRY_RUN=1 node scripts/orphan-batch-backfill-2026-06-28.mjs

import { createClient } from "@supabase/supabase-js"
import { randomBytes } from "node:crypto"
import { readFileSync } from "fs"

const env = readFileSync("/Users/prabhubalasubramaniam/amasi-membership/.env.local", "utf8")
const getEnv = (k) => {
  const m = env.match(new RegExp(k + '=["\']?([^"\'\\n]+)'))
  return m?.[1]?.trim()
}
const SUPABASE_URL = getEnv("NEXT_PUBLIC_SUPABASE_URL")
const supabase = createClient(SUPABASE_URL, getEnv("SUPABASE_SERVICE_ROLE_KEY"))

const DRY_RUN = process.env.DRY_RUN === "1"

const COHORT = [
  {
    email: "kavitachavda1281998@gmail.com",
    draftId: "16fe8097-f97f-44b2-aaa9-9cc6c0cae496",
    payId: "pay_T5WTbseciTp76A",
    orderId: "order_T5WTArukNcFXL1",
    manualReviewNote:
      "LM tier (Gujarat). MCI number is 'PG/G-41090' (Gujarat PG-registration " +
      "prefix); ASI number is 'AL 2781024' (with 'AL ' prefix). Both verbatim " +
      "from formData — admin: confirm these resolve correctly during ASI " +
      "verification before approve. asi_member_certificate present + " +
      "extracted.",
  },
  {
    email: "drhosannassrc@gmail.com",
    draftId: "f2c7b351-f529-409c-bc6c-c3e831a08ab3",
    payId: "pay_T5hLgtS7BywIAf",
    orderId: "order_T5hHI9y0dg2l8o",
    manualReviewNote:
      "LM tier (Andhra Pradesh, ASI 39363). Name parts in formData: " +
      "first='Hosanna', middle='Singh', last='Sati Raju'. Written verbatim — " +
      "admin to confirm display name (full name composes as 'Hosanna Singh " +
      "Sati Raju') before approve. asi_member_certificate present + " +
      "extracted.",
  },
  {
    email: "akhilmudgal516@gmail.com",
    draftId: "8b67a5c1-44ab-4227-8d89-182652b19a83",
    payId: "pay_T6cLy4GjWAS4KA",
    orderId: "order_T6cLP5ApoyP0sF",
    manualReviewNote:
      "ALM tier (Maharashtra, Raigarh). PG_DEGREE_CERTIFICATE is " +
      "status='uploaded' (NOT 'extracted') with empty extracted{} — OCR " +
      "did not run or did not return fields for this doc. fileUrl is " +
      "present. Admin: re-OCR or manually verify the PG cert image " +
      "before approve. MCI cert extracted high-confidence.",
  },
  {
    email: "dr.vardankrsingh@gmail.com",
    draftId: "342b1da8-7b5c-4e62-9fb9-6b8c2f6d2eee",
    payId: "pay_T6eRmU2JbiY4jK",
    orderId: "order_T6eRKGK14DaJzQ",
    manualReviewNote:
      "ALM tier (Maharashtra, Raigarh). Clean draft; both MCI 2024/12/9567 " +
      "and PG cert OCR-extracted high-confidence. Standard paid-before-submit " +
      "recovery.",
  },
]

function buildName(formData) {
  return [formData.firstName, formData.middleName, formData.lastName]
    .map((p) => (p || "").trim())
    .filter(Boolean)
    .join(" ")
}

function buildDocumentsMap(uploads) {
  return Object.fromEntries(
    Object.entries(uploads).map(([k, v]) => [
      k,
      {
        status: v.status,
        extracted: v.extracted,
        message: v.message,
        fileUrl: v.fileUrl || null,
      },
    ])
  )
}

function buildOcrData(uploads) {
  return Object.fromEntries(
    Object.entries(uploads)
      .filter(([, v]) => v.extracted && Object.keys(v.extracted).length > 0)
      .map(([k, v]) => [k, v.extracted])
  )
}

async function recoverOne({ email, draftId, payId, orderId, manualReviewNote }) {
  console.log(`\n--- ${email} ---`)

  const { data: byEmail } = await supabase
    .from("membership_applications")
    .select("id, reference_number, status")
    .eq("email", email)
    .maybeSingle()
  if (byEmail) {
    console.log(`  ⊘ application already exists (${byEmail.reference_number}, ${byEmail.status}) — skipping`)
    return { email, skipped: true, reason: "exists", existing: byEmail }
  }

  const { data: draft, error: draftErr } = await supabase
    .from("draft_applications")
    .select("step_data, membership_type, phone, email")
    .eq("id", draftId)
    .single()
  if (draftErr || !draft) {
    throw new Error(`Draft fetch failed: ${draftErr?.message}`)
  }

  const formData = draft.step_data.formData
  const uploads = draft.step_data.uploads || {}
  const documents = buildDocumentsMap(uploads)
  const ocrData = buildOcrData(uploads)

  const { data: pay, error: payErr } = await supabase
    .from("membership_payments")
    .select("id, application_id, status, amount, currency")
    .eq("gateway_order_id", orderId)
    .maybeSingle()
  if (payErr || !pay) {
    throw new Error(`Payment row not found for order ${orderId}: ${payErr?.message ?? "no row"}`)
  }
  if (pay.application_id) {
    console.log(`  ⊘ payment already linked to application ${pay.application_id} — skipping`)
    return { email, skipped: true, reason: "payment_linked" }
  }
  console.log(`  payment row ${pay.id} (${pay.amount} ${pay.currency}, ${pay.status})`)

  const reference = `AMASI-2026-${randomBytes(5).toString("hex").toUpperCase()}`
  const fullName = buildName(formData)

  const manualReviewReason =
    `submit_failed_recovery (batch 2026-06-28): Applicant completed /apply flow; ` +
    `payment captured ${payId} / ${orderId} ₹${pay.amount} ${pay.currency}. ` +
    `Draft ${draftId}.step_data: submit_failed=true, paid_pending_submission=true, ` +
    `payment_verified=true. No prior membership_applications or members row for this ` +
    `email. Doc fileUrls + OCR data reused verbatim from draft. ${manualReviewNote}`

  const appRow = {
    reference_number: reference,
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
    profile_photo_url: uploads.profile?.fileUrl || null,
    payment_status: "paid",
    payment_id: payId,
    payment_amount: pay.amount,
    fee_type: formData.membershipType,
    email_verified: true,
    mobile_verified: false,
    ai_verified: false,
    ai_confidence: "manual_admin_backfill",
    ai_flags: [
      "Admin-assisted recovery from submit_failed (paid-before-submit).",
      "Docs OCR-extracted in original /apply session; reused verbatim.",
      "Profile photo: empty extracted{} — photo is excluded from validateRequiredDocuments.",
    ],
    needs_manual_review: true,
    manual_review_reason: manualReviewReason,
    ocr_score: null,
    documents,
    ocr_data: ocrData,
    status: "pending_review",
  }

  if (DRY_RUN) {
    console.log(`  [DRY] would insert app with reference=${reference}, name="${fullName}"`)
    console.log(`  [DRY] would link payment ${pay.id} -> <new app>`)
    console.log(`  [DRY] would close draft ${draftId}`)
    return { email, dryRun: true, reference, fullName }
  }

  const { data: app, error: appErr } = await supabase
    .from("membership_applications")
    .insert(appRow)
    .select("id")
    .single()
  if (appErr) throw new Error(`App insert failed: ${appErr.message}`)
  const applicationId = app.id
  console.log(`  ✓ application ${applicationId} (${reference})`)

  const { error: linkErr } = await supabase
    .from("membership_payments")
    .update({ application_id: applicationId, updated_at: new Date().toISOString() })
    .eq("id", pay.id)
  if (linkErr) throw new Error(`Payment link failed: ${linkErr.message}`)
  console.log(`  ✓ payment ${pay.id} -> application ${applicationId}`)

  const { error: dErr } = await supabase
    .from("draft_applications")
    .update({
      status: "completed",
      payment_id: payId,
      payment_order_id: orderId,
      has_verified_payment: true,
      updated_at: new Date().toISOString(),
    })
    .eq("id", draftId)
  if (dErr) console.error(`  ⚠ draft update non-blocking: ${dErr.message}`)
  else console.log(`  ✓ draft ${draftId} -> completed`)

  const { error: auditErr } = await supabase.from("membership_audit_log").insert({
    action: "admin_backfill_application",
    entity_type: "membership_application",
    entity_id: applicationId,
    performed_by: "admin (Prabhu via Claude Code)",
    new_data: {
      reference_number: reference,
      razorpay_payment_id: payId,
      razorpay_order_id: orderId,
      membership_payment_row: pay.id,
      applicant_email: email,
      membership_type: formData.membershipType,
      amount: pay.amount,
      currency: pay.currency,
      recovered_from_draft: draftId,
      recovery_reason: "submit_failed_after_payment_capture (batch 2026-06-28)",
      backfilled_at: new Date().toISOString(),
    },
  })
  if (auditErr) console.error(`  ⚠ audit non-blocking: ${auditErr.message}`)
  else console.log(`  ✓ audit log written`)

  return { email, applicationId, reference, fullName }
}

async function main() {
  console.log(`\n========== ORPHAN BATCH BACKFILL 2026-06-28 ${DRY_RUN ? "(DRY RUN)" : ""} ==========`)
  console.log(`Cohort size: ${COHORT.length}`)

  const results = []
  for (const target of COHORT) {
    try {
      results.push(await recoverOne(target))
    } catch (err) {
      console.error(`  !!! FAILED for ${target.email}: ${err.message}`)
      results.push({ email: target.email, error: err.message })
    }
  }

  console.log("\n========== SUMMARY ==========")
  for (const r of results) {
    if (r.error) console.log(`  ✗ ${r.email}: ${r.error}`)
    else if (r.skipped) console.log(`  ⊘ ${r.email}: skipped (${r.reason})`)
    else if (r.dryRun) console.log(`  [DRY] ${r.email}: ${r.reference} ${r.fullName}`)
    else console.log(`  ✓ ${r.email}: ${r.applicationId} (${r.reference}) ${r.fullName}`)
  }
  console.log("\nNext: review at /admin (orphan-payments badge should drop by 4).")
  console.log("Admin: open each app under /admin/applications/<id> and approve.")
}

main().catch((err) => {
  console.error("\n!!! FATAL:", err.message)
  process.exit(1)
})
