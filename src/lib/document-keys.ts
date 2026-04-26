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

/**
 * Validate that uploads contain all required document types for a membership type
 * AND that each upload has a real file (fileUrl) plus a successful OCR (status='extracted').
 *
 * Returns canonical doc keys (not labels) in `missing` so callers can decide how
 * to render the message; `lookupDocumentLabel` is available for display.
 */
export function validateRequiredDocuments(
  uploads: Record<string, any>,
  requiredDocTypes: string[],
): { valid: true } | { valid: false; reason: "documents_incomplete"; missing: string[] } {
  // Build a normalized-key view of uploads so legacy keys (e.g. pg_certificate) resolve
  const uploadByKey: Record<string, any> = {}
  for (const [k, v] of Object.entries(uploads || {})) {
    uploadByKey[normalizeDocumentKey(k)] = v
  }

  const missing: string[] = []
  for (const docType of requiredDocTypes) {
    const canonical = normalizeDocumentKey(docType)
    // Skip photo — it's required for UI but not for scoring/verification
    if (canonical === "photo") continue
    const entry = uploadByKey[canonical]
    if (!entry) { missing.push(canonical); continue }
    const fileUrl = typeof entry.fileUrl === "string" ? entry.fileUrl.trim() : ""
    if (!fileUrl) { missing.push(canonical); continue }
    if (entry.status !== "extracted") { missing.push(canonical); continue }
  }

  if (missing.length > 0) return { valid: false, reason: "documents_incomplete", missing }
  return { valid: true }
}

/** Resolve a doc key to its human label for user-facing messages. */
export function lookupDocumentLabel(key: string): string {
  const canonical = normalizeDocumentKey(key)
  return DOCUMENT_TYPES[canonical]?.label || canonical
}
