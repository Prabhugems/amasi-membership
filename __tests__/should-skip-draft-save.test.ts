/**
 * AMASI-MEMBERSHIP-16 regression tests — shouldSkipDraftSave must:
 *   - let a save through when the ref reads `true` (the fix)
 *   - let a save through when the caller explicitly passes
 *     extraData.email_verified===true (the OTP-verify bypass)
 *   - block + flag a save as "unverified" only when neither is true
 *   - block a save as "no_email" when formData.email is empty,
 *     regardless of verification state
 *
 * The bug was that the page's `saveDraftToServer` closed over
 * `emailVerified` via useCallback; a save fired on the same tick as
 * setEmailVerified(true) saw stale `false` and silently skipped, leaving
 * the applicant's data unsaved ("upload spins, can't go to next step").
 * The fix routes the guard through `emailVerifiedRef.current`, which is
 * synced both at every setEmailVerified call site AND via useEffect.
 *
 * These tests exercise the pure guard logic so the contract is pinned
 * independently of the React render/commit timing.
 */
import { describe, it, expect } from "vitest"
import { shouldSkipDraftSave } from "@/lib/should-skip-draft-save"

describe("shouldSkipDraftSave — AMASI-MEMBERSHIP-16 guard", () => {
  // ─── The fix: ref says verified → save proceeds ───────────────────────────

  it("does NOT skip when ref is true and email is set (the fix's happy path)", () => {
    const r = shouldSkipDraftSave({
      emailVerifiedRefCurrent: true,
      extraData: undefined,
      hasEmail: true,
    })
    expect(r).toEqual({ skip: false })
  })

  it("does NOT skip when ref is true and extraData has other fields", () => {
    const r = shouldSkipDraftSave({
      emailVerifiedRefCurrent: true,
      extraData: { pre_payment_checkpoint: true, payment_order_id: "order_X" },
      hasEmail: true,
    })
    expect(r).toEqual({ skip: false })
  })

  // ─── The OTP-verify bypass ────────────────────────────────────────────────

  it("does NOT skip when ref is false but extraData.email_verified===true (the OTP-verify bypass)", () => {
    // This is the call site at apply/page.tsx that fires immediately
    // after setEmailVerified(true). Even if the ref hasn't been synced
    // yet (e.g., on a future code path where the sync was forgotten),
    // the explicit bypass lets the post-OTP save through.
    const r = shouldSkipDraftSave({
      emailVerifiedRefCurrent: false,
      extraData: { email_verified: true },
      hasEmail: true,
    })
    expect(r).toEqual({ skip: false })
  })

  it("treats extraData.email_verified as STRICTLY true (not just truthy)", () => {
    // Defensive: a caller posting { email_verified: "true" } string OR
    // { email_verified: 1 } would NOT bypass. Only the literal `true`.
    const r1 = shouldSkipDraftSave({
      emailVerifiedRefCurrent: false,
      extraData: { email_verified: "true" } as unknown as Record<string, unknown>,
      hasEmail: true,
    })
    expect(r1).toEqual({ skip: true, reason: "unverified" })

    const r2 = shouldSkipDraftSave({
      emailVerifiedRefCurrent: false,
      extraData: { email_verified: 1 } as unknown as Record<string, unknown>,
      hasEmail: true,
    })
    expect(r2).toEqual({ skip: true, reason: "unverified" })
  })

  // ─── The guard still blocks genuinely-unverified saves ────────────────────

  it("skips with reason=unverified when ref is false, no explicit bypass, has email", () => {
    // This is the "genuine unverified" case — e.g., a call that fires
    // before the user has actually verified. Post-fix this should be
    // rare; the Sentry warning on the caller side still surfaces it.
    const r = shouldSkipDraftSave({
      emailVerifiedRefCurrent: false,
      extraData: undefined,
      hasEmail: true,
    })
    expect(r).toEqual({ skip: true, reason: "unverified" })
  })

  it("skips with reason=unverified when ref is false and extraData has other fields", () => {
    // A caller passes extraData but NOT email_verified — still blocked.
    const r = shouldSkipDraftSave({
      emailVerifiedRefCurrent: false,
      extraData: { uploads: { mci_certificate: null } },
      hasEmail: true,
    })
    expect(r).toEqual({ skip: true, reason: "unverified" })
  })

  // ─── No-email guard takes precedence ──────────────────────────────────────

  it("skips with reason=no_email when formData.email is empty, even if ref is true", () => {
    const r = shouldSkipDraftSave({
      emailVerifiedRefCurrent: true,
      extraData: undefined,
      hasEmail: false,
    })
    expect(r).toEqual({ skip: true, reason: "no_email" })
  })

  it("skips with reason=no_email when email empty AND ref false (no_email takes precedence)", () => {
    // Either reason would skip, but no_email is checked first. This
    // matters for the page's Sentry warning logic — only "unverified"
    // fires the warning, "no_email" doesn't (it's normal pre-verify state).
    const r = shouldSkipDraftSave({
      emailVerifiedRefCurrent: false,
      extraData: undefined,
      hasEmail: false,
    })
    expect(r).toEqual({ skip: true, reason: "no_email" })
  })

  it("skips with reason=no_email even when extraData.email_verified===true", () => {
    // The OTP bypass is for the verification state, not for the
    // missing-email state. If somehow email is empty, we still skip.
    const r = shouldSkipDraftSave({
      emailVerifiedRefCurrent: false,
      extraData: { email_verified: true },
      hasEmail: false,
    })
    expect(r).toEqual({ skip: true, reason: "no_email" })
  })

  // ─── The closure-stale scenario that motivated the fix ───────────────────

  it(
    "scenario test: save fired immediately after verification persists (not skipped) — " +
      "the AMASI-MEMBERSHIP-16 stale-closure case, post-fix",
    () => {
      // Pre-fix: saveDraftToServer's closure-captured emailVerified was
      // still `false` at this point (React hadn't re-rendered yet).
      // Post-fix: emailVerifiedRef.current was synchronously set to true
      // at the setEmailVerified call site, so the ref read here returns
      // true and the save proceeds.
      const refAfterSyncedSetState = true
      const r = shouldSkipDraftSave({
        emailVerifiedRefCurrent: refAfterSyncedSetState,
        extraData: undefined, // a doc-upload save doesn't pass the bypass flag
        hasEmail: true,
      })
      expect(r).toEqual({ skip: false })
    },
  )

  it(
    "scenario test: pre-fix shape — without the synchronous ref sync, a fire-and-forget " +
      "save after setEmailVerified would still skip (this documents what we fixed)",
    () => {
      // This is the BROKEN pre-fix state: setEmailVerified was called but
      // the ref hadn't been synced (would only happen via useEffect after
      // commit). A save in this window saw refCurrent=false and skipped.
      // Post-fix the synchronous update at the setEmailVerified call site
      // prevents this state from being reachable in practice.
      const r = shouldSkipDraftSave({
        emailVerifiedRefCurrent: false,
        extraData: undefined,
        hasEmail: true,
      })
      expect(r).toEqual({ skip: true, reason: "unverified" })
    },
  )

  // ─── Defensive: never-throw guarantee ─────────────────────────────────────

  it("handles null/undefined extraData without throwing", () => {
    expect(shouldSkipDraftSave({
      emailVerifiedRefCurrent: true,
      extraData: undefined,
      hasEmail: true,
    }).skip).toBe(false)
    expect(shouldSkipDraftSave({
      emailVerifiedRefCurrent: true,
      extraData: {},
      hasEmail: true,
    }).skip).toBe(false)
  })
})
