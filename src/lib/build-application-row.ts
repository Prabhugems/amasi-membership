// Builds the membership_applications row inserted by /api/applications/submit.
//
// Extracted in 2026-05 as the first step toward closing the "Application →
// member field copy" fragile area called out in CONTEXT.md. The current
// callers are:
//   - src/app/api/applications/submit/route.ts (the canonical submit handler)
//   - one-shot recovery scripts under scripts/ that post-date this helper
//     (pre-extraction scripts — Karki, Karmakar, Sharanya, Smita — still
//     carry their own inline column lists; recoveries that need to mirror
//     submit's row should import this helper instead)
//
// This helper is a PURE mapping: it does no I/O, no scoring, no validation,
// no audit logging. Every value either comes straight from `args` or is
// composed from arg values the way submit/route.ts has always composed them.
// Adding a new column belongs here AND in api/applications/approve/route.ts
// + lib/auto-approval.ts (the two remaining inline call sites for the
// parallel member-row construction).
import type { ApprovalResult } from "@/lib/ai-approval"
import { normalizeMiddleName, buildFullName } from "@/lib/normalize-name"

// Shape of an entry in the `uploads` map posted by the /apply submit handler.
// Mirrors the client payload built at apply/page.tsx:1366-1377. All optional —
// the server's validateRequiredDocuments + scoring logic handles missing
// fields. `bypass` markers come from the manual-review path; preserved on
// persist (commit 2f45802).
export interface UploadEntry {
  status?: string
  extracted?: Record<string, unknown>
  message?: string
  fileUrl?: string | null
  bypass?: boolean
  bypassReason?: string
}

export interface BuildApplicationRowArgs {
  referenceNumber: string
  // `formData` arrives via `await request.json()` in submit/route.ts (implicit
  // any). We keep the loose `any` here to preserve byte-for-byte access shape
  // — every property access in this helper mirrors what submit already does.
  // Tightening this to a typed interface is a separate refactor.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  formData: Record<string, any>
  uploads: Record<string, UploadEntry> | null | undefined
  paymentId: string
  emailVerified: boolean
  mobileVerified: boolean
  allAiVerified: boolean
  documentsUnreadable: boolean
  approval: ApprovalResult
  aiConfidence: string
  aiFlags: string[]
  hasPendingReview: boolean
  manualReviewReason: string | null
  applicationStatus: string
}

export function buildApplicationRow(args: BuildApplicationRowArgs) {
  const {
    referenceNumber,
    formData,
    uploads,
    paymentId,
    emailVerified,
    mobileVerified,
    allAiVerified,
    documentsUnreadable,
    approval,
    aiConfidence,
    aiFlags,
    hasPendingReview,
    manualReviewReason,
    applicationStatus,
  } = args

  return {
    reference_number: referenceNumber,
    salutation: formData.salutation,
    first_name: formData.firstName,
    middle_name: normalizeMiddleName(formData.firstName, formData.middleName),
    last_name: formData.lastName,
    name: buildFullName(formData.firstName, formData.middleName, formData.lastName),
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
    payment_id: paymentId,
    email_verified: emailVerified,
    mobile_verified: mobileVerified,
    ai_verified: allAiVerified,
    ai_confidence: documentsUnreadable ? "documents_unreadable" : `${approval.totalScore}% — ${aiConfidence}`,
    ai_flags: [...aiFlags, ...approval.checks.map(c => `${c.check}: ${c.score}% ${c.passed ? "✓" : "✗"} — ${c.detail}`)],
    nmc_verification: approval.nmcVerification,
    needs_manual_review: hasPendingReview,
    manual_review_reason: manualReviewReason,
    // PR 0: numeric AI confidence so the reviewer queue can sort/filter.
    // Null for documents_unreadable (no per-check scoring ran).
    ocr_score: documentsUnreadable ? null : approval.totalScore,
    documents: Object.fromEntries(
      Object.entries((uploads || {}) as Record<string, UploadEntry>).map(([k, v]) => [k, {
        status: v.status,
        extracted: v.extracted,
        message: v.message,
        fileUrl: v.fileUrl || null,
        // Preserve bypass markers — without them, validateRequiredDocuments
        // rule #4 fails at admin-approve time and the row needs a manual
        // patch (see Barman 2026-05-23 case). Mirrors the shape the client
        // sends in the submit payload (apply/page.tsx).
        ...(v.bypass === true ? { bypass: true, bypassReason: v.bypassReason } : {}),
      }])
    ),
    ocr_data: Object.fromEntries(
      Object.entries((uploads || {}) as Record<string, UploadEntry>).filter(([, v]) => v.extracted).map(([k, v]) => [k, v.extracted])
    ),
    status: applicationStatus,
  }
}
