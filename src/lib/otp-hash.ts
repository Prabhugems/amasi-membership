import crypto from "crypto"

/**
 * One-time codes are stored hashed, never in clear.
 *
 * Until 2026-08-17 `otp_codes.code` held the six digits verbatim, so read
 * access to that table was sign-in as any member for the code's lifetime.
 * The table was purged (3,018 expired rows), locked to service_role, and the
 * column renamed to `code_hash` so its contents are unambiguous.
 *
 * A code is low-entropy (10^6) and short-lived, so a salted KDF buys little
 * here — the defence is that the table is unreadable and the value expires in
 * minutes. SHA-256 makes a leaked row useless without adding a per-row secret
 * that would itself need managing.
 */

export function hashOtp(code: string): string {
  return crypto.createHash("sha256").update(code.trim()).digest("hex")
}

/**
 * Compare a submitted code against a stored hash in constant time.
 *
 * Callers must pass the stored hash — never fetch the code column and compare
 * it directly. There is no way to recover a code from what is stored, which is
 * the point.
 */
export function otpMatches(submitted: string, storedHash: string | null | undefined): boolean {
  if (!storedHash) return false
  const a = Buffer.from(hashOtp(submitted), "hex")
  const b = Buffer.from(storedHash, "hex")
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

/**
 * The single message returned for every failed verification — wrong code,
 * expired, already used, or too many attempts.
 *
 * Distinguishing them tells a guesser which part to change, and the old
 * "N attempts remaining" wording additionally confirmed that a live code
 * existed for that address.
 */
export const OTP_FAILURE_MESSAGE =
  "That code is not valid. Please request a new one."
