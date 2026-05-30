/**
 * scanner-probes regression tests.
 *
 * Two contracts the middleware depends on:
 *
 *   1. isScannerProbe returns TRUE for the wordlist patterns scanners
 *      actually probe — guards against AMASI-MEMBERSHIP-2V re-regressing
 *      every time a new probe variant hits the site.
 *
 *   2. isScannerProbe returns FALSE for every legitimate /api/* path in
 *      this codebase. A false positive here would silence real allowlist-
 *      regression alerts — the exact signal the original Sentry capture
 *      exists to surface.
 *
 * The negative test cases exhaustively enumerate the public-API surface
 * found by `find src/app/api -name route.ts` on 2026-05-30. If a new
 * endpoint is added that this test doesn't cover and the helper happens
 * to flag it as a scanner probe, the legitimate 401 will go undetected.
 */
import { describe, it, expect } from "vitest"
import { isScannerProbe } from "@/lib/scanner-probes"

describe("isScannerProbe — positive cases (real scanner patterns)", () => {
  it("flags dotfile probes under /api/", () => {
    // The Sentry event that motivated this fix:
    expect(isScannerProbe("/api/.env")).toBe(true)
    // Common variants:
    expect(isScannerProbe("/api/.env.local")).toBe(true)
    expect(isScannerProbe("/api/.env.production")).toBe(true)
    expect(isScannerProbe("/api/.git/config")).toBe(true)
    expect(isScannerProbe("/api/.git/HEAD")).toBe(true)
    expect(isScannerProbe("/api/.aws/credentials")).toBe(true)
    expect(isScannerProbe("/api/.ssh/id_rsa")).toBe(true)
    expect(isScannerProbe("/api/.htaccess")).toBe(true)
    expect(isScannerProbe("/api/.dockerenv")).toBe(true)
  })

  it("flags PHP/ASP/JSP/CGI/CFM extensions", () => {
    expect(isScannerProbe("/api/admin.php")).toBe(true)
    expect(isScannerProbe("/api/index.php")).toBe(true)
    expect(isScannerProbe("/api/index.php?cmd=ls")).toBe(true)
    expect(isScannerProbe("/api/login.asp")).toBe(true)
    expect(isScannerProbe("/api/upload.aspx")).toBe(true)
    expect(isScannerProbe("/api/test.jsp")).toBe(true)
    expect(isScannerProbe("/api/something.cfm")).toBe(true)
    expect(isScannerProbe("/api/test.cgi")).toBe(true)
    expect(isScannerProbe("/api/script.pl")).toBe(true)
    expect(isScannerProbe("/api/shell.sh")).toBe(true)
  })

  it("flags WordPress wordlist probes", () => {
    expect(isScannerProbe("/api/wp-login.php")).toBe(true)
    expect(isScannerProbe("/api/wp-admin/")).toBe(true)
    expect(isScannerProbe("/api/wp-admin/setup-config.php")).toBe(true)
    expect(isScannerProbe("/api/wp-content/uploads/")).toBe(true)
    expect(isScannerProbe("/api/wp-includes/wlwmanifest.xml")).toBe(true)
    expect(isScannerProbe("/api/wp-config.php")).toBe(true)
  })

  it("flags phpmyadmin / xmlrpc / cgi-bin / server-status / adminer", () => {
    expect(isScannerProbe("/api/phpmyadmin/")).toBe(true)
    expect(isScannerProbe("/api/phpmyadmin/index.php")).toBe(true)
    expect(isScannerProbe("/api/xmlrpc.php")).toBe(true)
    expect(isScannerProbe("/api/cgi-bin/test")).toBe(true)
    expect(isScannerProbe("/api/server-status")).toBe(true)
    expect(isScannerProbe("/api/adminer/")).toBe(true)
  })

  it("flags nested-marker probes (scanner appended to a fake prefix)", () => {
    // Scanners sometimes prepend a legitimate-looking prefix before the
    // wordlist marker; the marker check is path-internal.
    expect(isScannerProbe("/api/v1/wp-login.php")).toBe(true)
    expect(isScannerProbe("/api/v2/phpmyadmin/")).toBe(true)
  })
})

describe("isScannerProbe — negative cases (every real /api/* route)", () => {
  // Enumerated from `find src/app/api -name route.ts` as of 2026-05-30.
  // Update this list if you add a new public API route. If a new route's
  // name happens to match one of the scanner patterns, the test will fail
  // here — that's the correct signal to choose a different route name.
  const REAL_ROUTES = [
    "/api/applications/submit",
    "/api/applications/resubmit",
    "/api/applications/save-draft",
    "/api/applications/status",
    "/api/applications/check-duplicate",
    "/api/applications/create-pending",
    "/api/applications/draft/resume-from-token",
    "/api/applications/incomplete",
    "/api/applications/approve",
    "/api/applications/upgrade-tier",
    "/api/payments/create-order",
    "/api/payments/verify",
    "/api/payments/check-existing",
    "/api/payments/lookup",
    "/api/payments/receipt",
    "/api/otp/send",
    "/api/otp/verify",
    "/api/ocr",
    "/api/pincode",
    "/api/card",
    "/api/certificate",
    "/api/credential",
    "/api/check_application_status",
    "/api/track_application",
    "/api/check_common_login",
    "/api/send_otp",
    "/api/application_data",
    "/api/final_step",
    "/api/create_order",
    "/api/getMemberInfo",
    "/api/getApplicationData",
    "/api/checkout",
    "/api/electoral-roll",
    "/api/electoral-roll/objection",
    "/api/members/search",
    "/api/members/upload",
    "/api/members/upgrade",
    "/api/members/sync",
    "/api/members/abc123/clinic",
    "/api/members/abc123/experience",
    "/api/directory",
    "/api/events",
    "/api/events/list",
    "/api/courses",
    "/api/announcements",
    "/api/badges",
    "/api/dashboard",
    "/api/sentry-test",
    "/api/client-log",
    "/api/verify/credential",
    "/api/auth/login",
    "/api/auth/me",
    "/api/auth/logout",
    "/api/v1/members/18263",
    "/api/v1/members/test@example.com",
    "/api/member/me",
    "/api/member/refresh-token",
    "/api/push/register",
    "/api/zoho",
    "/api/zoho/callback",
    "/api/nmc",
    "/api/webhooks/razorpay",
    "/api/tickets",
    "/api/tickets/analytics",
    "/api/tickets/csat",
    "/api/tickets/upload",
    "/api/tickets/by-number/T-123",
    "/api/whatsapp-templates",
    "/api/sync-documents",
    "/api/cron/reconcile-payments",
    "/api/cron/cleanup-drafts",
    "/api/cron/sla-breach",
    "/api/cron/sync-members",
    "/api/cron/weekly-digest",
    "/api/cron/bulk-draft-reminders",
    // /api/admin/* paths — the OTHER carve-out handles them, but they
    // must still not be mis-flagged as scanner probes.
    "/api/admin/orphan-payments",
    "/api/admin/pending",
    "/api/admin/bulk-draft-reminders",
    "/api/admin/electoral-roll",
  ]

  for (const route of REAL_ROUTES) {
    it(`does NOT flag ${route}`, () => {
      expect(isScannerProbe(route)).toBe(false)
    })
  }
})

describe("isScannerProbe — non-/api/ paths return false", () => {
  // The middleware only invokes the Sentry-capture branch for /api/* paths,
  // so non-/api/ probes are out of scope. Explicit assertion so a future
  // re-org doesn't silently widen the helper's blast radius.
  it("returns false for root-level paths even if they match scanner markers", () => {
    expect(isScannerProbe("/.env")).toBe(false)
    expect(isScannerProbe("/wp-login.php")).toBe(false)
    expect(isScannerProbe("/apply")).toBe(false)
    expect(isScannerProbe("/admin")).toBe(false)
    expect(isScannerProbe("/")).toBe(false)
  })
})
