/**
 * Email format validator + common-domain typo suggester for the /apply
 * verify step. Closes the "user types `gmail.con` and never gets the OTP"
 * class of step-2 abandonment (67% of total apply-flow drop-off, per the
 * 2026-05-30 funnel report).
 *
 * Two exports:
 *   - isValidEmailShape(email): tighter than the pre-existing `includes("@")`
 *     check. Catches missing TLD, embedded whitespace, missing local/domain
 *     part, and double-@. Does NOT verify the MX record — that level of
 *     validation is overkill for this cohort and intentionally avoided to
 *     keep the input-phase guard synchronous and offline.
 *   - suggestEmailCorrection(email): returns a single proposed correction
 *     if the domain is within edit-distance 2 of a common domain. Catches
 *     both substitutions (".con" → ".com") AND adjacent transpositions
 *     ("gmial" → "gmail"). Returns null if the domain is already in the
 *     known list, the email shape is invalid, or no candidate is close
 *     enough. Caller surfaces this as a "Did you mean ...?" hint and
 *     never auto-applies it — the user must tap to accept.
 *
 * Why distance ≤ 2 (and not Damerau-Levenshtein-1): the 7-entry common-
 * domain list is mutually distinct at Levenshtein distance ≥ 3 (smallest
 * pair: yahoo.com ↔ yahoo.co.in at distance 3), so threshold 2 doesn't
 * false-positive between candidates. Distance 2 captures the two-adjacent-
 * substitutions case (gmial ↔ gmail) which a Damerau-1 transposition rule
 * would also catch — but plain Levenshtein-2 is simpler and adequate.
 */

const COMMON_DOMAINS = [
  "gmail.com",
  "yahoo.com",
  "yahoo.co.in",
  "hotmail.com",
  "outlook.com",
  "rediffmail.com",
  "icloud.com",
] as const

// Local + @ + domain (which must contain at least one literal dot).
// Whitespace and stray @ are rejected in both parts.
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function isValidEmailShape(email: string): boolean {
  return EMAIL_SHAPE.test(email.trim())
}

/**
 * Returns a suggested replacement if the email looks like a typo of a
 * common domain. Returns null when the input is already valid, malformed,
 * or no candidate is within distance 2. The caller renders this as a
 * "Did you mean ...?" hint — never auto-applies it.
 *
 * The returned suggestion preserves the user's local part (lowercased) and
 * uses the canonical lowercase domain.
 */
export function suggestEmailCorrection(email: string): string | null {
  const trimmed = email.trim().toLowerCase()
  if (!EMAIL_SHAPE.test(trimmed)) return null

  const at = trimmed.lastIndexOf("@")
  const local = trimmed.slice(0, at)
  const domain = trimmed.slice(at + 1)

  // Domain already in the known-good list — nothing to suggest.
  if ((COMMON_DOMAINS as readonly string[]).includes(domain)) return null

  let bestDomain: string | null = null
  let bestDistance = Infinity
  for (const candidate of COMMON_DOMAINS) {
    const d = levenshtein(domain, candidate, 2)
    if (d <= 2 && d < bestDistance) {
      bestDomain = candidate
      bestDistance = d
    }
  }
  return bestDomain === null ? null : `${local}@${bestDomain}`
}

/**
 * Classic Levenshtein distance with an early-exit ceiling. Returns
 * `ceiling + 1` (a sentinel) the moment the running row minimum exceeds
 * the ceiling — callers treat anything > ceiling as "not a near-match".
 *
 * For our 7-domain list this is overkill (full O(m·n) would be fast), but
 * the ceiling makes the intent explicit and tightens the hot path if the
 * list ever grows.
 */
function levenshtein(a: string, b: string, ceiling: number): number {
  if (a === b) return 0
  const m = a.length
  const n = b.length
  if (Math.abs(m - n) > ceiling) return ceiling + 1

  let prev: number[] = new Array(n + 1)
  let curr: number[] = new Array(n + 1)
  for (let j = 0; j <= n; j++) prev[j] = j

  for (let i = 1; i <= m; i++) {
    curr[0] = i
    let rowMin = curr[0]
    for (let j = 1; j <= n; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1
      const v = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost)
      curr[j] = v
      if (v < rowMin) rowMin = v
    }
    if (rowMin > ceiling) return ceiling + 1
    ;[prev, curr] = [curr, prev]
  }
  return prev[n]
}
