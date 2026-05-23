/**
 * Guard decision for saveDraftToServer in apply/page.tsx.
 *
 * Two reasons to skip a save:
 *   (1) "no_email" — formData.email is empty; nothing to save against
 *       (the route is keyed by email). Caller treats this as ok:true.
 *   (2) "unverified" — the applicant hasn't completed OTP verification.
 *       Save would 401 at the server anyway; the guard prevents wasteful
 *       round-trips. Caller treats this as ok:true but also fires a
 *       Sentry warning for diagnostics — this branch is what AMASI-
 *       MEMBERSHIP-16 was surfacing pre-fix.
 *
 * Why this helper exists separately (instead of inline in apply/page.tsx):
 *   The original guard read `emailVerified` from a `useCallback` closure.
 *   On slow connections (mobile), a save could fire on the same tick as
 *   `setEmailVerified(true)` — the closure saw stale `false`, skipped
 *   silently, and the applicant's data didn't persist. Sentry issue
 *   AMASI-MEMBERSHIP-16 firing for 6+ real users surfaced the pattern.
 *
 *   The page-side fix uses a useRef shadow of emailVerified that is
 *   updated both synchronously at each setEmailVerified call site AND
 *   via a useEffect after commit. This helper takes the ref's current
 *   value directly — so the test surface is "does the guard logic
 *   correctly handle (refCurrent, extraData, hasEmail) inputs" without
 *   needing to simulate React's render/commit cycle.
 *
 *   The `isInitialPostVerifySave` bypass (extraData.email_verified ===
 *   true) is retained as a defense-in-depth signal from the OTP-verify
 *   call site that *knows* it just verified — it works even if a future
 *   change forgets to sync the ref.
 */

export interface ShouldSkipDraftSaveInput {
  /**
   * The CURRENT value of the emailVerified ref. Callers pass
   * `emailVerifiedRef.current`, NOT the captured-state value.
   */
  emailVerifiedRefCurrent: boolean
  /**
   * extraData object passed by the caller. Only `email_verified === true`
   * is meaningful here (post-OTP-verify bypass).
   */
  extraData: Record<string, unknown> | undefined
  /** True iff formData.email is a non-empty string. */
  hasEmail: boolean
}

export type ShouldSkipDraftSaveResult =
  | { skip: false }
  | { skip: true; reason: "no_email" | "unverified" }

export function shouldSkipDraftSave(
  input: ShouldSkipDraftSaveInput,
): ShouldSkipDraftSaveResult {
  if (!input.hasEmail) {
    return { skip: true, reason: "no_email" }
  }
  const isInitialPostVerifySave = input.extraData?.email_verified === true
  if (!isInitialPostVerifySave && !input.emailVerifiedRefCurrent) {
    return { skip: true, reason: "unverified" }
  }
  return { skip: false }
}
