/**
 * Stage C e2e — upload three documents, refresh the page WITHOUT
 * triggering an explicit save-draft, resume, assert all three uploads
 * are present on the resumed draft.
 *
 * This is the "critical existence proof" for Stage C: with the OCR
 * route writing uploads to the draft server-side, the client save-draft
 * is no longer load-bearing for upload state. A user who closes the
 * tab between uploads and the next phase transition should still see
 * their uploads when they come back.
 *
 * ─────────────────────────────────────────────────────────────────────
 * CURRENTLY SKIPPED (test.fixme) — requires test-mode auth scaffolding
 * ─────────────────────────────────────────────────────────────────────
 *
 * To unskip, the app needs one of:
 *
 *   (a) A test-only OTP bypass: an env-gated /api/otp/verify code (e.g.
 *       "000000" when NODE_ENV=test) that produces a valid member JWT
 *       cookie without actually sending an OTP. Cleanest; ~10 LOC in
 *       the OTP verify route behind an `if (process.env.OTP_TEST_CODE
 *       && code === process.env.OTP_TEST_CODE)` guard.
 *
 *   (b) A Playwright-side member-session minter that signs a JWT
 *       directly using the test's JWT_SECRET and `context.addCookies`
 *       to set it. Requires reading the cookie name + JWT shape from
 *       src/lib/auth.ts and importing the JWT signing helper.
 *
 *   (c) A /api/test/seed-draft endpoint that creates a draft +
 *       OTP-verified session in one call, env-gated to test mode.
 *
 * Existing tests/auth.setup.ts handles ADMIN auth (env-credential login)
 * but not member OTP — that's a separate flow.
 *
 * Until then, the Stage C contract is proven by:
 *   - __tests__/persist-ocr-upload.test.ts (15 tests: rules, idempotency,
 *     race-retry, no-throw, docKey allowlist)
 *   - __tests__/ocr-route-stage-c.test.ts (14 tests: only-success-writes
 *     gating; persist-failure-doesn't-break-response)
 *
 * Both run on every push. First real applicant on the deployed Stage C
 * release is the empirical existence proof — same as how Stage A's
 * existence proof works today.
 *
 * ─────────────────────────────────────────────────────────────────────
 * Test design (what this WOULD do once unblocked):
 * ─────────────────────────────────────────────────────────────────────
 *
 *   1. Seed a member-verified session for test email
 *      `playwright-stagec@test.amasi.org` (via approach a/b/c above)
 *   2. Navigate to /apply, walk through check + verify phases
 *   3. Pick membership type ALM
 *   4. Upload three documents via the file inputs:
 *        - MCI cert (a fixture JPEG)
 *        - PG cert (a fixture PDF)
 *        - Profile photo (a fixture JPEG)
 *      Each upload waits for the success toast (OCR completes server-side,
 *      Stage C persists to draft).
 *   5. CRUCIAL: do NOT click any "Continue" / "Next" button — those
 *      fire saveDraftToServer which would defeat the test by writing
 *      uploads through the client path.
 *   6. page.reload() — forces a fresh React tree.
 *   7. Land on /apply, expect to see the "Resume application" CTA on
 *      the landing screen.
 *   8. Click Resume.
 *   9. ASSERT: all three upload tiles render as valid (status="extracted"
 *      for the two certs, "uploaded" for profile; each with a real
 *      fileUrl). If Stage C is working, they survived the refresh.
 *  10. ASSERT (negative): the Continue button is enabled — meaning
 *      validateRequiredDocuments + isRequiredSlotValid both pass on the
 *      restored state.
 */

import { test, expect } from "@playwright/test"

test.describe("Stage C — upload-then-refresh survives without explicit save-draft", () => {
  test.fixme(
    "all three uploads survive a refresh (Stage C critical existence proof)",
    async ({ page }) => {
      // ── Block reads here until test-mode auth scaffolding lands.
      //    See the file header for the three options to unblock.
      await page.goto("http://localhost:3000/apply")
      await expect(page.locator("text=/apply/i").first()).toBeVisible()
      // Real assertions go here once the OTP-bypass / session-mint
      // mechanism is in place. The full sequence is documented above.
    },
  )
})
