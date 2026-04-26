/**
 * Test / internal email-address patterns that should never receive an
 * automated user-facing email (reminders, expiry notices, refund updates).
 *
 * Single source of truth — imported by both `cleanup-drafts` cron and
 * `bulk-draft-reminders` lib so the rules can't drift between them.
 */
export const EMAIL_EXCLUDE_PATTERNS: readonly RegExp[] = [
  /@test\./i,
  /^test@/i,
  /^collegeofamasi@/i,
  /^admin@/i,
  /^noreply@/i,
] as const

export function isExcludedEmail(email: string | null | undefined): boolean {
  if (!email) return true
  return EMAIL_EXCLUDE_PATTERNS.some((p) => p.test(email))
}
