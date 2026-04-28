/**
 * Canonical document type definitions.
 * Single source of truth for document keys, aliases, and OCR requirements.
 */

export interface DocumentTypeConfig {
  canonical: string
  aliases: string[]
  requires_extraction: boolean
  label: string
}

export const DOCUMENT_TYPES: Record<string, DocumentTypeConfig> = {
  mci_certificate: {
    canonical: "mci_certificate",
    aliases: [],
    requires_extraction: true,
    label: "MCI/SMC Certificate",
  },
  pg_degree_certificate: {
    canonical: "pg_degree_certificate",
    aliases: ["pg_certificate"],
    requires_extraction: true,
    label: "PG Degree Certificate",
  },
  mbbs_degree_certificate: {
    canonical: "mbbs_degree_certificate",
    aliases: [],
    requires_extraction: true,
    label: "MBBS Degree Certificate",
  },
  asi_member_certificate: {
    canonical: "asi_member_certificate",
    aliases: ["asi_certificate"],
    requires_extraction: true,
    label: "ASI Membership Certificate",
  },
  letter_hod: {
    canonical: "letter_hod",
    aliases: ["hod_letter"],
    requires_extraction: true,
    label: "HOD Letter",
  },
  active_license: {
    canonical: "active_license",
    aliases: [],
    requires_extraction: true,
    label: "Active Medical License",
  },
  photo: {
    canonical: "photo",
    aliases: ["profile", "profile_photo", "applicant_photo"],
    requires_extraction: false,
    label: "Profile Photo",
  },
}

/** All canonical document type keys */
export const CANONICAL_KEYS = Object.keys(DOCUMENT_TYPES)

/** All keys that require OCR extraction */
export const EXTRACTION_REQUIRED_KEYS = Object.entries(DOCUMENT_TYPES)
  .filter(([, v]) => v.requires_extraction)
  .map(([k]) => k)

/** All keys that skip OCR (photos, etc.) */
export const EXTRACTION_SKIPPED_KEYS = Object.entries(DOCUMENT_TYPES)
  .filter(([, v]) => !v.requires_extraction)
  .map(([k]) => k)

// Build reverse lookup: alias -> canonical
const ALIAS_MAP = new Map<string, string>()
for (const [, config] of Object.entries(DOCUMENT_TYPES)) {
  for (const alias of config.aliases) {
    ALIAS_MAP.set(alias.toLowerCase(), config.canonical)
  }
}

/**
 * Normalize a document key to its canonical form.
 * Handles aliases (pg_certificate -> pg_degree_certificate) and case variations.
 * Unknown keys are returned as-is (lowercased).
 */
export function normalizeDocumentKey(key: string): string {
  const lower = key.toLowerCase()
  // Direct canonical match
  if (DOCUMENT_TYPES[lower]) return lower
  // Alias match
  const mapped = ALIAS_MAP.get(lower)
  if (mapped) return mapped
  // Unknown key -- return lowercased
  return lower
}

/**
 * Check if a document type requires OCR extraction.
 * Normalizes the key first, then checks. Unknown types default to true (safer).
 */
export function requiresExtraction(key: string): boolean {
  const canonical = normalizeDocumentKey(key)
  const config = DOCUMENT_TYPES[canonical]
  return config ? config.requires_extraction : true
}

// ---------------------------------------------------------------------------
// Manual-review reason codes
// ---------------------------------------------------------------------------
//
// Single source of truth for the structured `manual_review_reason` prefix
// written into membership_applications. Format on disk:
//     "<code>: <free-text detail>"
// Writers MUST go through formatManualReviewReason; readers (the queue chip)
// MUST go through parseManualReviewReason. Anything else is drift.

export const MANUAL_REVIEW_REASON_CODES = [
  "ocr_below_threshold",
  "ocr_service_error",
  "user_bypass",
  // PR 1: profile photo passed face-detection bypass after 2 failed retries.
  // Distinct from ocr_service_error so reviewer triage isn't misled.
  "face_detection_failed",
] as const
export type ManualReviewReasonCode = typeof MANUAL_REVIEW_REASON_CODES[number]

export function formatManualReviewReason(
  code: ManualReviewReasonCode,
  detail: string,
): string {
  return `${code}: ${detail}`
}

export function parseManualReviewReason(
  value: string | null | undefined,
): ManualReviewReasonCode | null {
  if (!value) return null
  const prefix = value.split(":")[0]?.trim().toLowerCase()
  return (MANUAL_REVIEW_REASON_CODES as readonly string[]).includes(prefix)
    ? (prefix as ManualReviewReasonCode)
    : null
}

/**
 * Pick the structured reason for a manual-review case driven by an
 * extractDocument failure. Two terminal cases:
 *   engineError=true  -> "ocr_service_error" (pipeline itself failed;
 *                         re-running may succeed; reviewer should retry
 *                         OCR or read the cert by eye)
 *   engineError=false -> "ocr_below_threshold" (engine ran fine and
 *                         judged the doc invalid; reviewer's call)
 *
 * Used by /api/ocr/route.ts. Kept here so the rule is colocated with
 * the reason-code constants and unit-testable as a pure function.
 */
export function manualReviewReasonForExtractionFailure(
  engineError: boolean,
): Extract<ManualReviewReasonCode, "ocr_service_error" | "ocr_below_threshold"> {
  return engineError ? "ocr_service_error" : "ocr_below_threshold"
}

// ---------------------------------------------------------------------------
// Required-document validator
// ---------------------------------------------------------------------------

/** A required doc that passed via the bypass path (file stored, OCR routed to manual review). */
export interface DocBypass {
  key: string
  reason: ManualReviewReasonCode
}

export type ValidateRequiredDocumentsResult =
  | { valid: true; bypassedDocs: DocBypass[] }
  | { valid: false; reason: "documents_incomplete"; missing: string[] }

/**
 * Validate that uploads contain all required document types for a membership type.
 *
 * Per-doc rule (in order):
 *   1. No upload entry for the required key                     -> missing
 *   2. fileUrl empty                                            -> missing
 *   3. status === "extracted"                                   -> pass
 *   4. status === "uploaded" AND bypass===true AND
 *      bypassReason in MANUAL_REVIEW_REASON_CODES                -> pass + record bypass
 *   5. anything else (rejected, blocked, processing, plain
 *      "uploaded" without a bypass marker)                       -> missing
 *
 * `valid: true; bypassedDocs.length > 0` means the gate passed but the caller
 * MUST flag the application for manual review (do NOT auto-approve).
 *
 * THREE call sites depend on this helper. If you add a fourth, route it
 * through here too -- DO NOT duplicate the rule:
 *
 *   1. src/app/api/payments/create-order/route.ts  (Razorpay order gate)
 *   2. src/app/api/applications/submit/route.ts    (final submit gate)
 *   3. src/lib/ai-approval.ts                      (scorer pre-flight gate)
 *
 * The gates drifted in the past: commit d3e4011 added the order-creation gate
 * months after the submit gate, and the scorer pre-flight diverged from both.
 * One helper, three callers, zero drift.
 */
export function validateRequiredDocuments(
  uploads: Record<string, any>,
  requiredDocTypes: string[],
): ValidateRequiredDocumentsResult {
  // Build a normalized-key view of uploads so legacy keys (e.g. pg_certificate) resolve
  const uploadByKey: Record<string, any> = {}
  for (const [k, v] of Object.entries(uploads || {})) {
    uploadByKey[normalizeDocumentKey(k)] = v
  }

  const missing: string[] = []
  const bypassedDocs: DocBypass[] = []

  for (const docType of requiredDocTypes) {
    const canonical = normalizeDocumentKey(docType)
    // Skip photo — required for UI but not for scoring/verification
    if (canonical === "photo") continue
    const entry = uploadByKey[canonical]
    if (!entry) { missing.push(canonical); continue }
    const fileUrl = typeof entry.fileUrl === "string" ? entry.fileUrl.trim() : ""
    if (!fileUrl) { missing.push(canonical); continue }

    if (entry.status === "extracted") continue // happy path

    if (
      entry.status === "uploaded" &&
      entry.bypass === true &&
      typeof entry.bypassReason === "string" &&
      (MANUAL_REVIEW_REASON_CODES as readonly string[]).includes(entry.bypassReason)
    ) {
      bypassedDocs.push({ key: canonical, reason: entry.bypassReason as ManualReviewReasonCode })
      continue
    }

    missing.push(canonical)
  }

  if (missing.length > 0) return { valid: false, reason: "documents_incomplete", missing }
  return { valid: true, bypassedDocs }
}

/** Resolve a doc key to its human label for user-facing messages. */
export function lookupDocumentLabel(key: string): string {
  const canonical = normalizeDocumentKey(key)
  return DOCUMENT_TYPES[canonical]?.label || canonical
}
