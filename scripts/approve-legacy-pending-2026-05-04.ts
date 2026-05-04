/**
 * Approve the 8 legacy-imported pending applications by calling the
 * shared autoApproveApplication helper. The 6 with pre-assigned
 * `assigned_amasi_number` will land on the gap numbers (18260, 18261,
 * 18278–18281); the other 2 (Shikha Bharti, Debasmita Mondal) draw from
 * the sequence.
 *
 * Usage:
 *   --only=<email-or-ref>    approve a single record (smoke test)
 *   no flag                  approve all 8 in order
 *
 * Idempotent: autoApproveApplication short-circuits on retries (already
 * approved → returns existing number; member exists for email → links).
 *
 * Audit logging: this is a script, not an admin click. Each approval is
 * recorded with adminEmail="legacy-import-2026-05-04" for traceability.
 */

import { createAdminClient } from "../src/lib/supabase"
import { autoApproveApplication } from "../src/lib/auto-approval"
import { logAdminAction } from "../src/lib/audit-log"

async function main() {
  const onlyArg = process.argv.find(a => a.startsWith("--only="))?.split("=")[1]?.toLowerCase()

  const supabase = createAdminClient()

  const { data: rows, error } = await supabase
    .from("membership_applications")
    .select("*")
    .ilike("manual_review_reason", "legacy_import:%")
    .in("status", ["submitted", "pending_review"])
    .order("created_at", { ascending: true })

  if (error) {
    console.error("Fetch error:", error)
    process.exit(1)
  }

  const targets = (rows || []).filter(r => {
    if (!onlyArg) return true
    return r.email?.toLowerCase() === onlyArg || r.reference_number?.toLowerCase() === onlyArg
  })

  if (targets.length === 0) {
    console.error(`No matching pending legacy imports${onlyArg ? ` for ${onlyArg}` : ""}.`)
    process.exit(1)
  }

  console.log(`Approving ${targets.length} application(s):\n`)
  for (const app of targets) {
    const tag = app.assigned_amasi_number ? `pre-assigned #${app.assigned_amasi_number}` : "from sequence"
    console.log(`  ${app.reference_number}  ${app.name}  (${tag})`)
  }
  console.log()

  let ok = 0, fail = 0
  for (const app of targets) {
  console.log(`--- ${app.reference_number}  ${app.name} ---`)
  const result = await autoApproveApplication(supabase, {
    applicationId: app.id,
    referenceNumber: app.reference_number,
    salutation: app.salutation,
    firstName: app.first_name,
    middleName: app.middle_name,
    lastName: app.last_name,
    fatherName: app.father_name,
    dateOfBirth: app.date_of_birth,
    gender: app.gender,
    nationality: app.nationality,
    email: app.email,
    phone: app.phone,
    mobileCode: app.mobile_code,
    membershipType: app.membership_type,
    streetAddress1: app.street_address_1,
    streetAddress2: app.street_address_2,
    city: app.city,
    state: app.state,
    country: app.country,
    postalCode: app.postal_code,
    zone: app.zone,
    ugDegree: app.ug_degree,
    ugCollege: app.ug_college,
    ugUniversity: app.ug_university,
    ugYear: app.ug_year,
    pgDegree: app.pg_degree,
    pgCollege: app.pg_college,
    pgUniversity: app.pg_university,
    pgYear: app.pg_year,
    ssDegree: app.ss_degree,
    mciCouncilNumber: app.mci_council_number,
    mciCouncilState: app.mci_council_state,
    imrRegistrationNo: app.imr_registration_no,
    asiMembershipNo: app.asi_membership_no,
    asiState: app.asi_state,
    profilePhoto: app.profile_photo_url || (app.documents as Record<string, { fileUrl?: string }>)?.photo?.fileUrl || null,
    mciCertificateUrl: (app.documents as Record<string, { fileUrl?: string }>)?.mci_certificate?.fileUrl ?? null,
    pgDegreeCertificateUrl: (app.documents as Record<string, { fileUrl?: string }>)?.pg_degree_certificate?.fileUrl ?? null,
    asiMemberCertificateUrl: (app.documents as Record<string, { fileUrl?: string }>)?.asi_member_certificate?.fileUrl ?? null,
    mbbsDegreeCertificateUrl: (app.documents as Record<string, { fileUrl?: string }>)?.mbbs_degree_certificate?.fileUrl ?? null,
    letterHodUrl: (app.documents as Record<string, { fileUrl?: string }>)?.letter_hod?.fileUrl ?? null,
    activeLicenseUrl: (app.documents as Record<string, { fileUrl?: string }>)?.active_license?.fileUrl ?? null,
    reviewNotes: `Approved via legacy-import script 2026-05-04. Original app: ${app.manual_review_reason}`,
  })

  if (!result.success) {
    console.error(`  FAIL  stage=${result.stage}  reason=${result.reason}`)
    fail++
    continue
  }

  await logAdminAction({
    adminEmail: "legacy-import-2026-05-04",
    adminName: "Legacy Import Script",
    action: "approve_application",
    entityType: "application",
    entityId: app.id,
    entityName: app.name,
    details: { amasiNumber: result.amasiNumber, membershipType: app.membership_type, source: "legacy_import_2026-05-04" },
  }).catch(err => console.error("audit log error:", err))

    console.log(`  OK    #${result.amasiNumber} assigned`)
    ok++
  }

  console.log(`\nDone. approved=${ok}, failed=${fail}`)
}

main().catch(err => { console.error(err); process.exit(1) })
