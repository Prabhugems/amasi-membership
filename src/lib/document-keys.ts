/**
 * Canonical document type definitions.
 * Single source of truth for document keys, aliases, and OCR requirements.
 */

export interface DocumentTypeConfig {
  canonical: string
  aliases: string[]
  requires_extraction: boolean
}

export const DOCUMENT_TYPES: Record<string, DocumentTypeConfig> = {
  mci_certificate: {
    canonical: "mci_certificate",
    aliases: [],
    requires_extraction: true,
  },
  pg_degree_certificate: {
    canonical: "pg_degree_certificate",
    aliases: ["pg_certificate"],
    requires_extraction: true,
  },
  mbbs_degree_certificate: {
    canonical: "mbbs_degree_certificate",
    aliases: [],
    requires_extraction: true,
  },
  asi_member_certificate: {
    canonical: "asi_member_certificate",
    aliases: ["asi_certificate"],
    requires_extraction: true,
  },
  letter_hod: {
    canonical: "letter_hod",
    aliases: ["hod_letter"],
    requires_extraction: true,
  },
  active_license: {
    canonical: "active_license",
    aliases: [],
    requires_extraction: true,
  },
  photo: {
    canonical: "photo",
    aliases: ["profile", "profile_photo", "applicant_photo"],
    requires_extraction: false,
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
