/**
 * email-typo regression tests.
 *
 * Backstop for the step-2 OTP-friction fix (2026-05-30): the
 * pre-existing `email.includes("@")` validation on both client
 * (apply/page.tsx) and server (otp/send/route.ts) was letting through
 * obvious typos like `gmail.con` / `gmial.com` / `yaho.com`. The user
 * never received the OTP, abandoned at step 2 (67% of total drop-off),
 * and we had no Sentry signal because the server-side send to Resend
 * succeeded against the dead address.
 *
 * Two contracts:
 *   1. isValidEmailShape rejects clear structural failures and accepts
 *      reasonable real-world addresses. Used by both client (pre-send)
 *      and server (re-validation).
 *   2. suggestEmailCorrection returns a *single* suggestion for likely-
 *      typo'd domains within edit-distance 2 of a common Indian/global
 *      domain, and null for everything else.
 *
 * If these tests fail, the step-2 abandonment regression is likely back.
 */
import { describe, it, expect } from "vitest"
import { isValidEmailShape, suggestEmailCorrection } from "@/lib/email-typo"

describe("isValidEmailShape", () => {
  it("accepts ordinary valid shapes", () => {
    expect(isValidEmailShape("alice@example.com")).toBe(true)
    expect(isValidEmailShape("a@b.co")).toBe(true)
    expect(isValidEmailShape("first.last+tag@sub.domain.example")).toBe(true)
    expect(isValidEmailShape("prabhu3693gems@gmail.com")).toBe(true)
  })

  it("trims surrounding whitespace before checking", () => {
    expect(isValidEmailShape("  alice@example.com  ")).toBe(true)
  })

  it("rejects missing TLD (no dot after @)", () => {
    expect(isValidEmailShape("alice@example")).toBe(false)
    expect(isValidEmailShape("alice@localhost")).toBe(false)
  })

  it("rejects missing @", () => {
    expect(isValidEmailShape("aliceexample.com")).toBe(false)
    expect(isValidEmailShape("alice.example.com")).toBe(false)
  })

  it("rejects missing local part or domain", () => {
    expect(isValidEmailShape("@example.com")).toBe(false)
    expect(isValidEmailShape("alice@")).toBe(false)
    expect(isValidEmailShape("alice@.com")).toBe(false)
    expect(isValidEmailShape("alice@example.")).toBe(false)
  })

  it("rejects embedded whitespace", () => {
    expect(isValidEmailShape("ali ce@example.com")).toBe(false)
    expect(isValidEmailShape("alice@exa mple.com")).toBe(false)
    expect(isValidEmailShape("alice@example .com")).toBe(false)
  })

  it("rejects double @", () => {
    expect(isValidEmailShape("alice@@example.com")).toBe(false)
    expect(isValidEmailShape("a@b@example.com")).toBe(false)
  })

  it("rejects empty / whitespace-only", () => {
    expect(isValidEmailShape("")).toBe(false)
    expect(isValidEmailShape("   ")).toBe(false)
  })
})

describe("suggestEmailCorrection", () => {
  it("returns null for already-valid common domains", () => {
    expect(suggestEmailCorrection("alice@gmail.com")).toBe(null)
    expect(suggestEmailCorrection("alice@yahoo.co.in")).toBe(null)
    expect(suggestEmailCorrection("alice@icloud.com")).toBe(null)
    expect(suggestEmailCorrection("alice@rediffmail.com")).toBe(null)
  })

  it("catches single-substitution typos (.con → .com, hotmial → hotmail)", () => {
    expect(suggestEmailCorrection("alice@gmail.con")).toBe("alice@gmail.com")
    expect(suggestEmailCorrection("alice@hotmial.com")).toBe("alice@hotmail.com")
    expect(suggestEmailCorrection("alice@outlok.com")).toBe("alice@outlook.com")
  })

  it("catches adjacent-transposition typos via distance-2 (gmial → gmail)", () => {
    // gmial.com vs gmail.com is Levenshtein distance 2 (two adjacent subs),
    // not Damerau distance 1 — this test guards the threshold-2 choice.
    expect(suggestEmailCorrection("alice@gmial.com")).toBe("alice@gmail.com")
  })

  it("catches single-character deletions (yaho → yahoo)", () => {
    expect(suggestEmailCorrection("alice@yaho.com")).toBe("alice@yahoo.com")
  })

  it("returns null for domains that aren't close to any common one", () => {
    expect(suggestEmailCorrection("alice@example.com")).toBe(null)
    expect(suggestEmailCorrection("alice@employer.co")).toBe(null)
    expect(suggestEmailCorrection("alice@somehospital.in")).toBe(null)
  })

  it("returns null when input is malformed rather than guessing", () => {
    expect(suggestEmailCorrection("alice@@gmail.com")).toBe(null)
    expect(suggestEmailCorrection("not-an-email")).toBe(null)
    expect(suggestEmailCorrection("")).toBe(null)
    expect(suggestEmailCorrection("alice@")).toBe(null)
  })

  it("preserves the local part (lowercased) and uses canonical lowercase domain", () => {
    expect(suggestEmailCorrection("Prabhu+test@gmail.con")).toBe("prabhu+test@gmail.com")
    expect(suggestEmailCorrection("alice@GMAIL.CON")).toBe("alice@gmail.com")
  })
})
