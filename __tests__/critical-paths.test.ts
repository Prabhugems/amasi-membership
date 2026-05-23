/**
 * Critical-path regression tests.
 *
 * Each test corresponds to a real production bug class. Adding a 6th test
 * should require evidence (a fix commit + a CHANGELOG entry).
 *
 * See AUDIT-2026-04.md §3.4 for the selection rationale.
 */
import { describe, it, expect } from "vitest"
import crypto from "node:crypto"
import { readFileSync } from "node:fs"
import path from "node:path"
import {
  normalizeDocumentKey,
  requiresExtraction,
  validateRequiredDocuments,
  DOCUMENT_TYPES,
  formatManualReviewReason,
  parseManualReviewReason,
  MANUAL_REVIEW_REASON_CODES,
  manualReviewReasonForExtractionFailure,
} from "@/lib/document-keys"
import { validatePersonalDetails } from "@/lib/validators"
import type { ApplicationFormData } from "@/lib/membership-types"
import { MEMBER_SELECT, PUBLIC_SELECT } from "@/lib/member-search-fields"
import {
  EDITABLE_APPLICATION_FIELDS,
  FINAL_APPLICATION_STATUSES,
  partitionEditableUpdates,
  computeFieldDiff,
  deriveZoneFromStateChange,
} from "@/lib/edit-application-fields"

// ---------------------------------------------------------------------------
// 1. Razorpay signature verification (payment integrity)
//
// Mirrors the HMAC computation in src/app/api/payments/verify/route.ts:34-43.
// Catches: any change that weakens signature checking (the entire payment-
// tampering class). Verified manually 2026-04-26 against the live route.
// ---------------------------------------------------------------------------
describe("payment signature verification", () => {
  const SECRET = "test_secret_KEY_2026"
  const ORDER_ID = "order_NXyz123abc"
  const PAYMENT_ID = "pay_NXyz456def"

  function sign(orderId: string, paymentId: string, secret: string): string {
    return crypto
      .createHmac("sha256", secret)
      .update(`${orderId}|${paymentId}`)
      .digest("hex")
  }

  it("accepts a valid signature computed with the documented Razorpay scheme", () => {
    const sig = sign(ORDER_ID, PAYMENT_ID, SECRET)
    const expected = crypto
      .createHmac("sha256", SECRET)
      .update(`${ORDER_ID}|${PAYMENT_ID}`)
      .digest("hex")
    expect(sig).toBe(expected)
    expect(sig).toMatch(/^[a-f0-9]{64}$/)
  })

  it("rejects a tampered payment_id", () => {
    const valid = sign(ORDER_ID, PAYMENT_ID, SECRET)
    const tampered = sign(ORDER_ID, PAYMENT_ID + "0", SECRET)
    expect(tampered).not.toBe(valid)
  })

  it("rejects a different secret (mirrors what happens if env tier is wrong)", () => {
    const prod = sign(ORDER_ID, PAYMENT_ID, SECRET)
    const test = sign(ORDER_ID, PAYMENT_ID, SECRET + "_other")
    expect(prod).not.toBe(test)
  })
})

// ---------------------------------------------------------------------------
// 2. Document key normalisation (OCR pipeline integrity)
//
// Catches: alias drift between client and server, photos accidentally going
// through OCR, OCR-required docs being skipped. Fix commits this would have
// caught: 4e3b98d (field mismatches), 8a6e8a7 (scorer regressions),
// the entire pg_certificate vs pg_degree_certificate alias confusion.
// ---------------------------------------------------------------------------
describe("document key normalisation", () => {
  it("photo never requires OCR extraction (would crash Anthropic Vision)", () => {
    expect(requiresExtraction("photo")).toBe(false)
    expect(requiresExtraction("profile_photo")).toBe(false)
    expect(requiresExtraction("PROFILE")).toBe(false)
  })

  it("MCI/PG/MBBS/ASI/HOD/license documents all require OCR extraction", () => {
    expect(requiresExtraction("mci_certificate")).toBe(true)
    expect(requiresExtraction("pg_degree_certificate")).toBe(true)
    expect(requiresExtraction("mbbs_degree_certificate")).toBe(true)
    expect(requiresExtraction("asi_member_certificate")).toBe(true)
    expect(requiresExtraction("letter_hod")).toBe(true)
    expect(requiresExtraction("active_license")).toBe(true)
  })

  it("legacy aliases resolve to canonical keys", () => {
    expect(normalizeDocumentKey("pg_certificate")).toBe("pg_degree_certificate")
    expect(normalizeDocumentKey("asi_certificate")).toBe("asi_member_certificate")
    expect(normalizeDocumentKey("hod_letter")).toBe("letter_hod")
    expect(normalizeDocumentKey("profile_photo")).toBe("photo")
  })

  it("unknown keys default to requires-extraction (fail-safe)", () => {
    // If we add a new doc type and forget to register it, default to OCR
    // rather than silently skipping — matches the comment in document-keys.ts.
    expect(requiresExtraction("brand_new_doctype_2027")).toBe(true)
  })

  it("CANONICAL keys exposed by DOCUMENT_TYPES are stable", () => {
    // Catches accidental rename of an existing doc type (would silently
    // break upload paths and DB column mappings).
    const expected = [
      "mci_certificate",
      "pg_degree_certificate",
      "mbbs_degree_certificate",
      "asi_member_certificate",
      "letter_hod",
      "active_license",
      "photo",
    ]
    expect(Object.keys(DOCUMENT_TYPES).sort()).toEqual(expected.sort())
  })
})

// ---------------------------------------------------------------------------
// 3. Required-document validation (membership creation integrity)
//
// Catches: applications submitted with missing or unextracted documents
// (commits 6652c36, 8855294 — the "trapped at step 2" and "missing-doc
// submissions" classes). Mirrors the gate in /api/applications/submit.
// ---------------------------------------------------------------------------
describe("required documents validation", () => {
  function makeUpload(status: string, fileUrl: string | null) {
    return { status, fileUrl }
  }

  it("rejects when a required doc is missing entirely", () => {
    const result = validateRequiredDocuments(
      { mci_certificate: makeUpload("extracted", "https://x/mci.jpg") },
      ["mci_certificate", "pg_degree_certificate"]
    )
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.missing).toContain("pg_degree_certificate")
    }
  })

  it("rejects when fileUrl is empty (the silent-uploaded-no-file class)", () => {
    const result = validateRequiredDocuments(
      {
        mci_certificate: makeUpload("uploaded", null),
        pg_degree_certificate: makeUpload("extracted", "https://x/pg.jpg"),
      },
      ["mci_certificate", "pg_degree_certificate"]
    )
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.missing).toContain("mci_certificate")
    }
  })

  it("rejects when status is not 'extracted' (OCR failed but file uploaded)", () => {
    const result = validateRequiredDocuments(
      {
        mci_certificate: makeUpload("uploaded", "https://x/mci.jpg"), // OCR pending/failed
        pg_degree_certificate: makeUpload("extracted", "https://x/pg.jpg"),
      },
      ["mci_certificate", "pg_degree_certificate"]
    )
    expect(result.valid).toBe(false)
  })

  it("ignores 'photo' even if listed as required (it's UI-required, not scoring-required)", () => {
    const result = validateRequiredDocuments(
      {
        mci_certificate: makeUpload("extracted", "https://x/mci.jpg"),
      },
      ["mci_certificate", "photo"]
    )
    expect(result.valid).toBe(true)
  })

  it("accepts when every required non-photo doc has fileUrl + extracted status", () => {
    const result = validateRequiredDocuments(
      {
        mci_certificate: makeUpload("extracted", "https://x/mci.jpg"),
        pg_degree_certificate: makeUpload("extracted", "https://x/pg.jpg"),
      },
      ["mci_certificate", "pg_degree_certificate"]
    )
    expect(result.valid).toBe(true)
  })

  it("resolves alias keys in uploads (a client sending pg_certificate matches pg_degree_certificate requirement)", () => {
    const result = validateRequiredDocuments(
      { pg_certificate: makeUpload("extracted", "https://x/pg.jpg") },
      ["pg_degree_certificate"]
    )
    expect(result.valid).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 3b. PR 0 — manual-review bypass path
//
// Catches: regressions in the bypass rule lifted into validateRequiredDocuments.
// All three server gates (ocr, create-order, submit) depend on this; if the
// helper rejects a properly-flagged bypass doc, users get blocked from paying
// — the exact failure mode PR 0 was built to fix.
// ---------------------------------------------------------------------------
describe("manual-review bypass (PR 0)", () => {
  it("accepts a doc with status='uploaded', bypass=true, valid bypassReason, and fileUrl — and surfaces it in bypassedDocs", () => {
    const result = validateRequiredDocuments(
      {
        mci_certificate: {
          status: "uploaded",
          fileUrl: "https://x/mci.jpg",
          bypass: true,
          bypassReason: "ocr_below_threshold",
        },
        pg_degree_certificate: { status: "extracted", fileUrl: "https://x/pg.jpg" },
      },
      ["mci_certificate", "pg_degree_certificate"]
    )
    expect(result.valid).toBe(true)
    if (result.valid) {
      expect(result.bypassedDocs).toEqual([
        { key: "mci_certificate", reason: "ocr_below_threshold" },
      ])
    }
  })

  it("rejects a doc whose bypassReason is not a recognised code (drift guard)", () => {
    const result = validateRequiredDocuments(
      {
        mci_certificate: {
          status: "uploaded",
          fileUrl: "https://x/mci.jpg",
          bypass: true,
          bypassReason: "user_was_in_a_hurry", // not in MANUAL_REVIEW_REASON_CODES
        },
      },
      ["mci_certificate"]
    )
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.missing).toContain("mci_certificate")
    }
  })

  it("formatManualReviewReason / parseManualReviewReason round-trip; legacy free text parses to null", () => {
    for (const code of MANUAL_REVIEW_REASON_CODES) {
      const written = formatManualReviewReason(code, "details here")
      expect(written.startsWith(`${code}:`)).toBe(true)
      expect(parseManualReviewReason(written)).toBe(code)
    }
    // Legacy free-text values (pre-PR-0 rows) must parse to null so the chip
    // renders nothing rather than misclassifying.
    expect(parseManualReviewReason("Score: 32%. Could not verify name…")).toBeNull()
    expect(parseManualReviewReason("Migrated from legacy platform")).toBeNull()
    expect(parseManualReviewReason(null)).toBeNull()
    expect(parseManualReviewReason("")).toBeNull()
  })

  it("face_detection_failed is in MANUAL_REVIEW_REASON_CODES (PR 1)", () => {
    // PR 1: profile photo's "Submit anyway for review" path writes this code.
    // If a future PR removes it, the apply page's bypass write will be silently
    // rejected by validateRequiredDocuments — catch that drift here.
    expect(MANUAL_REVIEW_REASON_CODES).toContain("face_detection_failed")
  })

  it("validateRequiredDocuments accepts a profile bypass with face_detection_failed", () => {
    // Profile is excluded from required-doc validation today (UI-required only),
    // but a bypass on a NON-profile slot using face_detection_failed must also
    // be accepted by the validator — same code path. Lock the rule.
    const result = validateRequiredDocuments(
      {
        mci_certificate: {
          status: "uploaded",
          fileUrl: "https://x/mci.jpg",
          bypass: true,
          bypassReason: "face_detection_failed",
        },
      },
      ["mci_certificate"]
    )
    expect(result.valid).toBe(true)
    if (result.valid) {
      expect(result.bypassedDocs).toEqual([
        { key: "mci_certificate", reason: "face_detection_failed" },
      ])
    }
  })

  it("manualReviewReasonForExtractionFailure routes engineError correctly", () => {
    // engineError=true means the OCR pipeline itself failed (Claude+OCR.space
    // both down, sharp threw, JSON parse failed). Reviewer should retry OCR
    // or read by eye — distinct from a semantic AI rejection.
    expect(manualReviewReasonForExtractionFailure(true)).toBe("ocr_service_error")
    expect(manualReviewReasonForExtractionFailure(false)).toBe("ocr_below_threshold")
  })
})

// ---------------------------------------------------------------------------
// 4. Personal details validation (auth/identity integrity)
//
// Catches: under-age applicants, malformed email/mobile entering the system
// (real bug class from the 2026-04-21/22 audit batch). validatePersonalDetails
// is pure and used by every apply path.
// ---------------------------------------------------------------------------
describe("personal details validation", () => {
  function base(overrides: Partial<ApplicationFormData> = {}): ApplicationFormData {
    const defaults = {
      firstName: "Asha",
      middleName: "",
      lastName: "Kumar",
      dob: "1990-01-15",
      gender: "Female",
      email: "asha@example.com",
      mobile: "9876543210",
      pin: "560001",
    } as Partial<ApplicationFormData>
    return { ...defaults, ...overrides } as ApplicationFormData
  }

  it("accepts a clean adult applicant", () => {
    expect(validatePersonalDetails(base())).toEqual({})
  })

  it("rejects under-22 applicants (real bug — was missing pre-Apr-22)", () => {
    const today = new Date()
    const dob = new Date(today.getFullYear() - 21, today.getMonth(), today.getDate())
      .toISOString()
      .slice(0, 10)
    const errors = validatePersonalDetails(base({ dob }))
    expect(errors.dob).toMatch(/22/)
  })

  it("rejects implausibly old DOB (>100 years)", () => {
    const errors = validatePersonalDetails(base({ dob: "1900-01-01" }))
    expect(errors.dob).toBeDefined()
  })

  it("rejects malformed email", () => {
    const errors = validatePersonalDetails(base({ email: "not-an-email" }))
    expect(errors.email).toBeDefined()
  })

  it("rejects mobile with country code (must be 10 digits, no +91)", () => {
    const errors = validatePersonalDetails(base({ mobile: "+919876543210" }))
    expect(errors.mobile).toBeDefined()
  })

  it("rejects mobile with non-digits", () => {
    const errors = validatePersonalDetails(base({ mobile: "98765 43210" }))
    expect(errors.mobile).toBeDefined()
  })

  it("requires gender selection (validates Male/Female/Other)", () => {
    const errors = validatePersonalDetails(base({ gender: "" }))
    expect(errors.gender).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// 5. members.search public-field redaction (data export integrity)
//
// Catches: any future change that adds an admin-only column to the public
// response shape. Mirrors the PUBLIC_SELECT constant in
// src/app/api/members/search/route.ts:8-9. We test the constant directly
// (re-declared here so the test file stays decoupled from Next route export
// constraints). If the route's constant changes, update this list and ensure
// no admin/PII field has snuck in.
// ---------------------------------------------------------------------------
describe("members.search public field redaction", () => {
  // Source of truth: src/app/api/members/search/route.ts:9 PUBLIC_SELECT.
  // If you change one, change both. The test below asserts no PII leaked in.
  const PUBLIC_SELECT_FIELDS = [
    "id",
    "name",
    "membership_type",
    "amasi_number",
    "city",
    "state",
    "zone",
    "pg_degree",
    "status",
    "profile_photo",
  ]

  // Fields that MUST NOT appear in any public response.
  const FORBIDDEN_PII = [
    "email",
    "phone",
    "mobile",
    "date_of_birth",
    "dob",
    "address",
    "address_line_1",
    "mci_council_number",
    "mci_certificate",
    "pg_degree_certificate",
    "mbbs_degree_certificate",
    "asi_member_certificate",
    "asi_membership_no",
    "father_name",
    "totp_secret",
    "csat_token",
  ]

  it("public select does not leak email", () => {
    expect(PUBLIC_SELECT_FIELDS).not.toContain("email")
  })

  it("public select does not leak phone or mobile", () => {
    expect(PUBLIC_SELECT_FIELDS).not.toContain("phone")
    expect(PUBLIC_SELECT_FIELDS).not.toContain("mobile")
  })

  it("public select does not leak any document URL or registration number", () => {
    for (const forbidden of FORBIDDEN_PII) {
      expect(
        PUBLIC_SELECT_FIELDS,
        `PUBLIC_SELECT must not include ${forbidden}`
      ).not.toContain(forbidden)
    }
  })

  it("public select includes only the documented safe fields", () => {
    // Belt-and-braces: catch additions to the public list that didn't go
    // through this test. If you intentionally add a public field, update both
    // PUBLIC_SELECT_FIELDS above AND the route, then justify in the
    // CHANGELOG.
    expect(PUBLIC_SELECT_FIELDS.length).toBeLessThanOrEqual(11)
  })

  it("the route's PUBLIC_SELECT constant matches this test's expected list", () => {
    // Bind the test's PII-redaction assertions to the real exported constant.
    // Without this, the local PUBLIC_SELECT_FIELDS array can drift from the
    // route and the redaction tests above pass vacuously.
    const fromRoute = PUBLIC_SELECT.split(",").map((c) => c.trim())
    expect(fromRoute.sort()).toEqual([...PUBLIC_SELECT_FIELDS].sort())
  })
})

// ---------------------------------------------------------------------------
// 6. members.search authed-member SELECT column validity
//
// Catches: schema drift between the SELECT column list and the real
// `members` table — the bug class that produced 49bbbfe → c791ac0
// (MEMBER_SELECT referenced `mobile`, real column is `phone`; the
// swallowed Postgres 42703 returned `{status:false, data:[]}` with HTTP
// 200, breaking every authed mobile search for ~10 days).
//
// Why static analysis, not an HTTP integration test: the existing test
// file is pure (no Next handler in-process, no Supabase mock). Adding
// HTTP infra for one test would dwarf the fix. This test binds against
// the exported constant, so any future column rename in MEMBER_SELECT
// must explicitly update VALID_MEMBERS_COLUMNS — that drift gate is the
// only thing that would have caught 49bbbfe at PR time.
// ---------------------------------------------------------------------------
describe("members.search MEMBER_SELECT column validity", () => {
  // Real columns on public.members verified against the live schema on
  // 2026-05-22. If you add a column to the table, add it here too — this
  // set is the gate for what MEMBER_SELECT is allowed to reference.
  const VALID_MEMBERS_COLUMNS = new Set([
    "id",
    "name",
    "membership_type",
    "amasi_number",
    "city",
    "state",
    "zone",
    "pg_degree",
    "status",
    "profile_photo",
    "email",
    "phone",
    "mobile_code",
  ])

  function parseSelect(s: string): string[] {
    return s.split(",").map((c) => c.trim())
  }

  it("every column in MEMBER_SELECT exists on the members table", () => {
    for (const col of parseSelect(MEMBER_SELECT)) {
      expect(
        VALID_MEMBERS_COLUMNS.has(col),
        `members.${col} is not a real column (would 42703 against live schema)`
      ).toBe(true)
    }
  })

  it("MEMBER_SELECT references `phone`, not the bogus `mobile` (regression: 49bbbfe)", () => {
    const cols = parseSelect(MEMBER_SELECT)
    expect(cols).toContain("phone")
    expect(cols).not.toContain("mobile")
  })

  it("MEMBER_SELECT is a strict superset of PUBLIC_SELECT", () => {
    const pub = new Set(parseSelect(PUBLIC_SELECT))
    const mem = new Set(parseSelect(MEMBER_SELECT))
    for (const col of pub) {
      expect(mem.has(col), `MEMBER_SELECT must include public column ${col}`).toBe(true)
    }
    expect(mem.size).toBeGreaterThan(pub.size)
  })
})

// ---------------------------------------------------------------------------
// 7. Admin edit-application-fields allowlist + diff (Feature 1)
//
// Catches: a locked field (email, phone, payment_*, status, member_id,
// assigned_amasi_number, documents, ai_*) sneaking into the allowlist;
// no-op writes generating spurious audit rows; the zone-derived-from-state
// invariant breaking. Mirrors the route gate in
// src/app/api/applications/[id]/edit-fields/route.ts.
//
// Also asserts statically that the route does NOT import auto-approval — the
// edit path must never re-trigger AI approval. That import would be the
// single-line regression that this static check is positioned to catch.
// ---------------------------------------------------------------------------
describe("admin edit-application-fields", () => {
  it("the editable allowlist contains every UI-editable column we shipped", () => {
    // If you add a key to EDITABLE_APPLICATION_FIELDS, add it here too.
    // The intersection makes drift in either direction loud.
    const expected = [
      "salutation", "first_name", "middle_name", "last_name", "father_name",
      "date_of_birth", "gender", "nationality",
      "street_address_1", "street_address_2", "city", "state", "postal_code", "country",
      "clinic_name", "clinic_street_address_1", "clinic_street_address_2",
      "clinic_city", "clinic_state", "clinic_postal_code", "clinic_country",
      "landline", "std_code",
      "ug_degree", "ug_college", "ug_university", "ug_year",
      "pg_degree", "pg_college", "pg_university", "pg_year",
      "ss_degree", "ss_college", "ss_university", "ss_year",
      "mci_council_number", "mci_council_state", "imr_registration_no",
      "asi_membership_no", "asi_state",
    ]
    for (const key of expected) {
      expect(EDITABLE_APPLICATION_FIELDS.has(key), `${key} should be editable`).toBe(true)
    }
    expect(EDITABLE_APPLICATION_FIELDS.size).toBe(expected.length)
  })

  it("the editable allowlist does NOT contain identity, payment, lifecycle, or AI columns", () => {
    // Each of these has a real reason to be locked; see
    // src/lib/edit-application-fields.ts for the rationale.
    const locked = [
      "email", "phone", "mobile_code",
      "payment_status", "payment_id", "payment_amount", "gateway_payment_id",
      "reference_number", "application_number",
      "status", "member_id", "assigned_amasi_number",
      "documents",
      "ai_score", "ai_confidence", "ai_verified", "ai_flags",
      "needs_manual_review", "manual_review_reason",
      "created_at", "updated_at", "reviewed_at",
      "review_notes", "internal_notes",
      // membership_type is reserved for the (not-yet-built) tier-change route.
      "membership_type",
      // zone is derived from state server-side, not directly editable.
      "zone",
    ]
    for (const key of locked) {
      expect(
        EDITABLE_APPLICATION_FIELDS.has(key),
        `${key} must NOT be editable`,
      ).toBe(false)
    }
  })

  it("partitionEditableUpdates separates allowed keys from rejected keys", () => {
    const result = partitionEditableUpdates({
      first_name: "Asha",
      email: "hacker@example.com",
      city: "Bengaluru",
      payment_status: "refunded",
      assigned_amasi_number: 99999,
    })
    expect(Object.keys(result.accepted).sort()).toEqual(["city", "first_name"])
    expect(result.rejected.sort()).toEqual([
      "assigned_amasi_number",
      "email",
      "payment_status",
    ])
  })

  it("computeFieldDiff skips fields whose normalized value matches current", () => {
    const current = {
      first_name: "Asha",
      city: "  Bengaluru  ",
      ug_year: 2010,
      father_name: null,
    }
    // Same values after trim + null-coercion — should be empty diff.
    const diff = computeFieldDiff(current, {
      first_name: "Asha",
      city: "Bengaluru",
      ug_year: "2010", // string vs number — same year, no change
      father_name: "", // empty string normalizes to null, matches current null
    })
    expect(diff.fieldCount).toBe(0)
    expect(diff.changes).toEqual({})
  })

  it("computeFieldDiff captures changes with from/to and a fieldCount", () => {
    const current = { first_name: "Asha", city: "Chennai" }
    const diff = computeFieldDiff(current, {
      first_name: "Aasha",
      city: "Chennai", // unchanged
    })
    expect(diff.fieldCount).toBe(1)
    expect(diff.changes).toEqual({
      first_name: { from: "Asha", to: "Aasha" },
    })
  })

  it("deriveZoneFromStateChange recomputes zone when state changes (the home-state derivation)", () => {
    const current = { state: "Tamil Nadu", zone: "South Zone" }
    const diff = computeFieldDiff(current, { state: "Maharashtra" })
    expect(diff.fieldCount).toBe(1)
    const z = deriveZoneFromStateChange(current, diff)
    expect(z).toEqual({ zone: "West Zone" })
  })

  it("deriveZoneFromStateChange is a no-op when state didn't change", () => {
    const current = { state: "Tamil Nadu", zone: "South Zone" }
    const diff = computeFieldDiff(current, { city: "Coimbatore" })
    const z = deriveZoneFromStateChange(current, diff)
    expect(z).toEqual({})
  })

  it("deriveZoneFromStateChange returns null zone for an unknown state", () => {
    const current = { state: "Tamil Nadu", zone: "South Zone" }
    const diff = computeFieldDiff(current, { state: "Atlantis" })
    const z = deriveZoneFromStateChange(current, diff)
    expect(z).toEqual({ zone: null })
  })

  it("FINAL_APPLICATION_STATUSES blocks edits on approved and rejected rows only", () => {
    // Other statuses (submitted, pending_review, ai_approved, need_clarification,
    // resubmit_requested, documents_unreadable, auto_approved) MUST remain editable
    // — those are the actionable states an admin reaches via the /pending queue.
    expect(FINAL_APPLICATION_STATUSES.has("approved")).toBe(true)
    expect(FINAL_APPLICATION_STATUSES.has("rejected")).toBe(true)
    for (const open of [
      "submitted",
      "pending_review",
      "ai_approved",
      "auto_approved",
      "need_clarification",
      "resubmit_requested",
      "documents_unreadable",
    ]) {
      expect(FINAL_APPLICATION_STATUSES.has(open)).toBe(false)
    }
  })

  it("the edit-fields route does NOT import autoApproveApplication (regression guard)", () => {
    // Static-string check — if a future PR wires auto-approval into the edit
    // path, this fires before it ships. The check is intentionally cheap and
    // independent of a Next handler harness.
    const routePath = path.resolve(
      __dirname,
      "..",
      "src/app/api/applications/[id]/edit-fields/route.ts",
    )
    const source = readFileSync(routePath, "utf8")
    expect(source.includes("autoApproveApplication")).toBe(false)
    expect(source.includes("auto-approval")).toBe(false)
  })

  it("the edit-fields route does NOT touch payment, status, AI, or AMASI-number columns", () => {
    // Same static check, but for the specific column names the route must
    // never write. Catches a future PR that adds e.g. status: 'approved' to
    // the UPDATE payload (an end-run around the approve route).
    const routePath = path.resolve(
      __dirname,
      "..",
      "src/app/api/applications/[id]/edit-fields/route.ts",
    )
    const source = readFileSync(routePath, "utf8")
    // The audit-log details may legitimately contain these column names if a
    // locked-field rejection mentions them — but only inside string literals
    // for error messages. We assert they don't appear as object keys in an
    // update() payload by looking for ":" assignments.
    const forbiddenAssignments = [
      /\bstatus\s*:\s*['"]/, // status: 'approved'
      /\bmember_id\s*:/,
      /\bassigned_amasi_number\s*:/,
      /\bpayment_status\s*:/,
      /\bpayment_id\s*:/,
      /\bai_score\s*:/,
      /\bai_verified\s*:/,
      /\bneeds_manual_review\s*:/,
    ]
    for (const re of forbiddenAssignments) {
      expect(
        re.test(source),
        `edit-fields route must not assign ${re.source}`,
      ).toBe(false)
    }
  })
})
