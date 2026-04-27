import { randomBytes } from "node:crypto"

/**
 * Generate a unique application reference number: AMASI-YYYY-XXXXXXXXXX
 *
 * Format: AMASI-{year}-{10 uppercase hex chars}
 * Entropy: 5 bytes = 16^10 ≈ 1.1 trillion values per year — collision-safe
 * for expected application volumes.
 *
 * This is the canonical generator used end-to-end: OTP verify issues it,
 * drafts carry it, payments reference it, and the submitted application
 * stores it as membership_applications.reference_number.
 */
export function generateRefNumber(): string {
  const year = new Date().getFullYear()
  const random = randomBytes(5).toString("hex").toUpperCase()
  return `AMASI-${year}-${random}`
}
