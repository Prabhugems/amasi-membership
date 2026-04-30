/**
 * CORS allowlist regression tests.
 *
 * Backstop for 2026-04-30 incident: every *.amasi.org subdomain other than
 * membership.amasi.org was silently CORS-blocked from /api/* because
 * next.config.ts pinned Access-Control-Allow-Origin to one value. eventz360
 * users saw "Unable To Fetch Member Info" with no Sentry signal because the
 * server returned 200; the browser dropped the response.
 *
 * If any of these tests fail, browser callers from the failing origin will be
 * blocked again. Do not relax without verifying the partner integration story
 * documented in CONTEXT.md "Fragile areas → CORS".
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { isAllowedCorsOrigin } from "@/lib/cors"

describe("CORS allowlist", () => {
  const ORIGINAL = process.env.CORS_ALLOWED_ORIGINS

  beforeEach(() => {
    delete process.env.CORS_ALLOWED_ORIGINS
  })

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.CORS_ALLOWED_ORIGINS
    else process.env.CORS_ALLOWED_ORIGINS = ORIGINAL
  })

  it("allows the canonical membership domain", () => {
    expect(isAllowedCorsOrigin("https://membership.amasi.org")).toBe(true)
  })

  it("allows AMASI event subdomains (the eventz360 case)", () => {
    expect(isAllowedCorsOrigin("https://eventz360.amasi.org")).toBe(true)
    expect(isAllowedCorsOrigin("https://amasicon.amasi.org")).toBe(true)
  })

  it("allows nested subdomains under amasi.org", () => {
    expect(isAllowedCorsOrigin("https://staging.events.amasi.org")).toBe(true)
  })

  it("allows the bare amasi.org apex", () => {
    expect(isAllowedCorsOrigin("https://amasi.org")).toBe(true)
  })

  it("rejects http (no TLS)", () => {
    expect(isAllowedCorsOrigin("http://eventz360.amasi.org")).toBe(false)
  })

  it("rejects look-alike domains that just contain 'amasi.org'", () => {
    expect(isAllowedCorsOrigin("https://amasi.org.evil.com")).toBe(false)
    expect(isAllowedCorsOrigin("https://notamasi.org")).toBe(false)
    expect(isAllowedCorsOrigin("https://evil.com/amasi.org")).toBe(false)
  })

  it("rejects unrelated origins", () => {
    expect(isAllowedCorsOrigin("https://evil.com")).toBe(false)
    expect(isAllowedCorsOrigin("https://google.com")).toBe(false)
  })

  it("rejects empty/null/undefined origins", () => {
    expect(isAllowedCorsOrigin(null)).toBe(false)
    expect(isAllowedCorsOrigin(undefined)).toBe(false)
    expect(isAllowedCorsOrigin("")).toBe(false)
  })

  it("honors CORS_ALLOWED_ORIGINS env override for non-amasi origins", () => {
    process.env.CORS_ALLOWED_ORIGINS = "https://partner.example.com,https://other.test"
    expect(isAllowedCorsOrigin("https://partner.example.com")).toBe(true)
    expect(isAllowedCorsOrigin("https://other.test")).toBe(true)
    expect(isAllowedCorsOrigin("https://random.example.com")).toBe(false)
  })

  it("trims whitespace in CORS_ALLOWED_ORIGINS entries", () => {
    process.env.CORS_ALLOWED_ORIGINS = "  https://a.example.com  ,https://b.example.com  "
    expect(isAllowedCorsOrigin("https://a.example.com")).toBe(true)
    expect(isAllowedCorsOrigin("https://b.example.com")).toBe(true)
  })

  it("env override does not weaken the *.amasi.org match", () => {
    process.env.CORS_ALLOWED_ORIGINS = "https://partner.example.com"
    expect(isAllowedCorsOrigin("https://eventz360.amasi.org")).toBe(true)
  })
})
