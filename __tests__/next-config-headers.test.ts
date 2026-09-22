import { describe, it, expect } from "vitest"
import { headerRules } from "../next.config"

/**
 * 2026-09-22 incident: next.config.ts's catch-all `X-Frame-Options: DENY`
 * (every route) silently blocked the admin /pending lightbox's <iframe> from
 * framing the same-origin document proxy at
 * /api/applications/[id]/document/[key] — DENY forbids ALL framing,
 * same-origin included. Every PDF preview failed with "membership.amasi.org
 * refused to connect." tsc, eslint and `next build` all stayed green through
 * the commit that introduced the proxy route, because none of them exercise
 * the actual response headers — only a live header check (or loading the
 * page) surfaces this class of bug. This test is that check, run in CI
 * instead of by a reviewer clicking through the admin dashboard.
 *
 * A minimal matcher for Next's `:param` segment syntax — good enough for the
 * simple, wildcard-free patterns used in next.config.ts today. Not a
 * replacement for Next's real router; if a pattern here ever needs `*` or
 * regex groups, upgrade this alongside it.
 */
function matches(source: string, pathname: string): boolean {
  const pattern = "^" + source.replace(/:[^/]+/g, "[^/]+") + "$"
  return new RegExp(pattern).test(pathname)
}

describe("next.config.ts headerRules()", () => {
  it("denies framing by default on an arbitrary route", async () => {
    const rules = await headerRules()
    const catchAll = rules.find((r) => r.source === "/(.*)")
    expect(catchAll).toBeDefined()
    expect(matches(catchAll!.source, "/pending")).toBe(true)
    expect(catchAll!.headers).toContainEqual({ key: "X-Frame-Options", value: "DENY" })
  })

  it("carries the full security header set on the catch-all, not just X-Frame-Options", async () => {
    const rules = await headerRules()
    const catchAll = rules.find((r) => r.source === "/(.*)")!
    const keys = catchAll.headers.map((h) => h.key)
    expect(keys).toEqual(
      expect.arrayContaining([
        "X-Frame-Options",
        "X-Content-Type-Options",
        "Referrer-Policy",
        "X-DNS-Prefetch-Control",
        "Strict-Transport-Security",
        "Permissions-Policy",
      ]),
    )
  })

  it("overrides X-Frame-Options to SAMEORIGIN for the document proxy, ordered after the catch-all", async () => {
    const rules = await headerRules()
    const catchAllIndex = rules.findIndex((r) => r.source === "/(.*)")
    // "/(.*)" matches every path too, so scanning for "the rule that matches
    // this URL" would just find the catch-all again — look for the specific
    // override rule instead.
    const proxyIndex = rules.findIndex(
      (r) =>
        r.source !== "/(.*)" &&
        matches(r.source, "/api/applications/31918323-bcd4-4331-82bf-4c70d334d5d8/document/mci_certificate"),
    )

    expect(proxyIndex).toBeGreaterThan(-1)
    // Next applies "last matching rule for a given key wins" — the override
    // is meaningless if it isn't listed after the rule it overrides.
    expect(proxyIndex).toBeGreaterThan(catchAllIndex)

    const proxyRule = rules[proxyIndex]
    expect(proxyRule.headers).toContainEqual({ key: "X-Frame-Options", value: "SAMEORIGIN" })
  })

  it("does not accidentally widen the document-proxy override to sibling routes", async () => {
    const rules = await headerRules()
    const proxyRule = rules.find((r) => r.source !== "/(.*)")!

    // Same /api/applications/* namespace, but not the (id)/document/(key)
    // shape — must stay on DENY via the catch-all, not inherit SAMEORIGIN.
    expect(matches(proxyRule.source, "/api/applications/list")).toBe(false)
    expect(matches(proxyRule.source, "/api/applications/31918323-bcd4-4331-82bf-4c70d334d5d8")).toBe(false)
    expect(matches(proxyRule.source, "/pending")).toBe(false)
  })
})
