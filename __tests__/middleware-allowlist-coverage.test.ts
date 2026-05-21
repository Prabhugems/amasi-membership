/**
 * Middleware allowlist coverage — regression test for AMASI-MEMBERSHIP-7.
 *
 * Context: 13+ commits over four months have all been variants of "added a
 * new /api/* route, forgot to allowlist it in src/middleware.ts, production
 * 401'd silently for an unknown number of hours." See CONTEXT.md →
 * "Fragile areas → middleware.ts". The companion Sentry alert
 * ("Middleware rejected /api/* request") is a runtime backstop; this is the
 * static backstop.
 *
 * What this test does:
 *   1. Walks every src/app/api/.../route.ts file.
 *   2. Infers the auth posture from imports + string signals (getAdminSession,
 *      getMemberSession, verifyApiKey, CRON_SECRET, jwtVerify, Razorpay HMAC).
 *   3. Cross-references with PUBLIC_API_ROUTES parsed from middleware.ts.
 *   4. Fails if any non-admin route is missing from PUBLIC_API_ROUTES (would
 *      401 legitimate traffic) OR if a route has no detectable auth signal
 *      and lacks an explicit "// @auth: public" header (security gap risk).
 *
 * What it doesn't do:
 *   - Detect runtime auth bugs (use Sentry middleware alert).
 *   - Validate the actual content of `// @auth: public` reasons.
 *   - Validate non-/api/* routes (PUBLIC_ROUTES is small and visually checked).
 *
 * If this test fails, the error message tells you exactly which route, what
 * auth signal was found (or not), and what to change.
 */
import { describe, expect, it } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import path from "node:path"

const REPO_ROOT = process.cwd()
const API_ROOT = path.join(REPO_ROOT, "src/app/api")
const MIDDLEWARE_PATH = path.join(REPO_ROOT, "src/middleware.ts")

/**
 * Routes with handler-side member/admin auth that are currently NOT in
 * PUBLIC_API_ROUTES. Middleware 401s every member call before the handler's
 * own check runs, so the member code path in these handlers is unreachable.
 * They function as admin-only via middleware's default gate.
 *
 * This is a real bug discovered when this test was first introduced — see the
 * audit notes in this PR's description. Fix is intentionally out of scope for
 * this PR (per the user's "no middleware changes in this change" constraint)
 * and will land in a follow-up that adds these to PUBLIC_API_ROUTES.
 *
 * REMOVE EACH ENTRY HERE the moment the follow-up adds it to the allowlist —
 * if this set goes stale, the test stops catching real regressions on these
 * paths.
 */
const KNOWN_AUTH_GAPS: ReadonlySet<string> = new Set([
  // /api/members/signed-url has no callers in src/ today — verdict pending on
  // whether amasi-mobile or another external client uses it. Until that's
  // confirmed, we don't know whether the right fix is allowlist + handler
  // auth (real bug) or deletion (dead code).
  "/api/members/signed-url",
])

/**
 * Inline branch matchers from middleware.ts.
 *
 * IMPORTANT: this list MUST stay in sync with the `if (pathname === ...)` /
 * regex branches in src/middleware.ts (currently lines ~176-207). The match
 * is exact on the normalized route path (file path with [seg] segments
 * preserved as-is).
 *
 * A follow-up PR will lift these into an exported const on middleware.ts so
 * the test can import them directly. Until then, regressions in either side
 * require a manual sync — that's intentional, to keep this PR's blast radius
 * small.
 */
const BRANCH_PUBLIC_API_PATTERNS: readonly string[] = [
  "/api/tickets", // POST + GET-without-?all (admin-or-member, all=1 gated in handler)
  "/api/tickets/csat", // token-in-body auth in handler
  "/api/tickets/[id]", // UUID/TKT- regex, ownership-checked
  "/api/tickets/[id]/reply", // UUID/TKT- regex, ownership-checked
  "/api/tickets/by-number/[number]", // ownership-checked in handler
  "/api/members/[id]/update", // admin-or-member, verifyMemberOwnership in handler
  "/api/members/[id]/clinic", // admin-or-member, verifyMemberOwnership in handler
  "/api/members/[id]/experience", // admin-or-member, verifyMemberOwnership in handler
  "/api/members/upgrade", // admin-or-member
]

function parsePublicApiRoutes(): string[] {
  const src = readFileSync(MIDDLEWARE_PATH, "utf8")
  const match = src.match(/const PUBLIC_API_ROUTES\s*=\s*\[([\s\S]*?)\]/)
  if (!match) {
    throw new Error(
      "Could not locate `const PUBLIC_API_ROUTES = [ ... ]` in middleware.ts — " +
        "the literal shape may have changed. Update parsePublicApiRoutes()."
    )
  }
  return [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1])
}

function walkRoutes(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) {
      walkRoutes(full, out)
    } else if (/^route\.(ts|tsx|js)$/.test(entry)) {
      out.push(full)
    }
  }
  return out
}

function fileToRoutePath(file: string): string {
  const rel = path.relative(path.join(REPO_ROOT, "src/app"), file)
  return "/" + rel.replace(/\/route\.(ts|tsx|js)$/, "")
}

type AuthMode =
  | "admin"
  | "member"
  | "admin-or-member"
  | "api-key"
  | "cron"
  | "webhook"
  | "signed-token"
  | "public" // explicit `// @auth: public` header
  | "unannotated" // no signal — fail

interface DetectedAuth {
  mode: AuthMode
  signals: string[]
}

function detectAuth(src: string): DetectedAuth {
  const signals: string[] = []
  // Header must be on its own line, may be inside a JSDoc block too — relax
  // the leading-whitespace requirement so both styles work.
  const hasPublicHeader = /\/\/\s*@auth:\s*public\b/.test(src) || /@auth:\s*public\b/.test(src)
  const hasAdmin = /\bgetAdminSession\s*\(/.test(src)
  const hasMember = /\bgetMemberSession\s*\(/.test(src)
  const hasApiKey = /\bverifyApiKey\s*\(/.test(src)
  const hasCron = /process\.env\.CRON_SECRET\b/.test(src)
  const hasWebhookSig =
    /x-razorpay-signature/i.test(src) || /RAZORPAY_WEBHOOK_SECRET/.test(src)
  const hasJwt = /\bjwtVerify\s*\(/.test(src)

  if (hasAdmin) signals.push("getAdminSession")
  if (hasMember) signals.push("getMemberSession")
  if (hasApiKey) signals.push("verifyApiKey")
  if (hasCron) signals.push("CRON_SECRET")
  if (hasWebhookSig) signals.push("webhook-signature")
  if (hasJwt) signals.push("jwtVerify")
  if (hasPublicHeader) signals.push("@auth:public")

  // An in-handler auth call wins over the @auth:public header. The header is
  // only meaningful for routes that would otherwise classify as `unannotated`.
  if (hasApiKey) return { mode: "api-key", signals }
  if (hasCron) return { mode: "cron", signals }
  if (hasWebhookSig) return { mode: "webhook", signals }
  if (hasJwt) return { mode: "signed-token", signals }
  if (hasAdmin && hasMember) return { mode: "admin-or-member", signals }
  if (hasAdmin) return { mode: "admin", signals }
  if (hasMember) return { mode: "member", signals }
  if (hasPublicHeader) return { mode: "public", signals }
  return { mode: "unannotated", signals }
}

/**
 * Mirrors middleware's `PUBLIC_API_ROUTES.some(r => pathname.startsWith(r))`
 * but with a stricter boundary check (so `/api/credential` doesn't quietly
 * cover `/api/credentials/foo`). Middleware's looser check is a latent bug,
 * separate scope.
 */
function isInAllowlist(routePath: string, allowlist: readonly string[]): boolean {
  return allowlist.some((entry) => {
    if (entry.endsWith("/")) return routePath.startsWith(entry)
    return routePath === entry || routePath.startsWith(entry + "/")
  })
}

function isInBranchList(routePath: string): boolean {
  return BRANCH_PUBLIC_API_PATTERNS.includes(routePath)
}

interface Verdict {
  routePath: string
  file: string
  mode: AuthMode
  signals: string[]
  inAllowlist: boolean
  inBranchList: boolean
  ok: boolean
  fix?: string
}

function verdictFor(
  file: string,
  routePath: string,
  detected: DetectedAuth,
  allowlist: readonly string[]
): Verdict {
  const inAllowlist = isInAllowlist(routePath, allowlist)
  const inBranchList = isInBranchList(routePath)
  const reachable = inAllowlist || inBranchList
  const base = {
    routePath,
    file,
    mode: detected.mode,
    signals: detected.signals,
    inAllowlist,
    inBranchList,
  }

  if (detected.mode === "unannotated") {
    // Unannotated + middleware-gated is the common case for admin-only routes:
    // the handler doesn't import getAdminSession because it trusts middleware
    // did the admin-cookie check. That's fine — leave it alone.
    if (!reachable) return { ...base, ok: true }
    // Unannotated + middleware-bypassed is the dangerous case: middleware lets
    // anyone through and the handler does nothing. Either add an in-handler
    // auth call or declare intent with "// @auth: public".
    return {
      ...base,
      ok: false,
      fix:
        `Route is in PUBLIC_API_ROUTES (middleware bypassed) but the handler ` +
        `has no detected auth signal. Either (a) add an in-handler auth call ` +
        `(getAdminSession/getMemberSession/verifyApiKey/etc), or (b) declare ` +
        `it intentionally public with a "// @auth: public — <one-line reason>" ` +
        `header near the top of the file.`,
    }
  }

  // Admin-only is the default protected mode (covered by middleware). Both
  // in-allowlist and not-in-allowlist are acceptable: in-allowlist routes
  // (e.g. /api/badges, /api/auth/me) opt out of middleware to control their
  // own unauth response shape; not-in-allowlist routes get middleware's
  // standard 401.
  if (detected.mode === "admin") {
    return { ...base, ok: true }
  }

  if (!reachable) {
    if (KNOWN_AUTH_GAPS.has(routePath)) {
      // Loud surface in test output without breaking the build. Removing the
      // route from KNOWN_AUTH_GAPS once it's fixed in middleware is part of
      // the follow-up PR.
      // eslint-disable-next-line no-console
      console.warn(
        `[middleware-allowlist-coverage] known gap: ${routePath} (member ` +
          `code path unreachable; awaiting middleware allowlist fix)`
      )
      return { ...base, ok: true }
    }
    const signal = detected.signals[0] ?? "unknown"
    return {
      ...base,
      ok: false,
      fix:
        `Handler performs its own auth (${signal}) but middleware will 401 ` +
        `before that runs. Add "${routePath}" to PUBLIC_API_ROUTES in ` +
        `src/middleware.ts (or, if the route is dynamic/regex-only, to the ` +
        `inline branches and update BRANCH_PUBLIC_API_PATTERNS in this test).`,
    }
  }

  return { ...base, ok: true }
}

describe("middleware allowlist coverage", () => {
  it("every /api/* route has a coherent auth posture", () => {
    const allowlist = parsePublicApiRoutes()
    const files = walkRoutes(API_ROOT).sort()
    const verdicts: Verdict[] = []

    for (const file of files) {
      const src = readFileSync(file, "utf8")
      const routePath = fileToRoutePath(file)
      verdicts.push(verdictFor(file, routePath, detectAuth(src), allowlist))
    }

    const failures = verdicts.filter((v) => !v.ok)

    if (failures.length > 0) {
      const lines = failures.map(
        (v) =>
          `\n  ${v.routePath}\n` +
          `    file:           ${path.relative(REPO_ROOT, v.file)}\n` +
          `    detected mode:  ${v.mode}\n` +
          `    signals:        ${v.signals.join(", ") || "(none)"}\n` +
          `    in allowlist:   ${v.inAllowlist}\n` +
          `    in branch list: ${v.inBranchList}\n` +
          `    fix:            ${v.fix}`
      )
      throw new Error(
        `middleware allowlist coverage: ${failures.length} route(s) mismatched\n` +
          lines.join("\n") +
          "\n"
      )
    }

    // Defence against the test silently no-op'ing if the walker breaks.
    expect(verdicts.length).toBeGreaterThan(50)
  })

  it("PUBLIC_API_ROUTES has no orphan entries", () => {
    const allowlist = parsePublicApiRoutes()
    const files = walkRoutes(API_ROOT)
    const routePaths = files.map(fileToRoutePath)

    const orphans = allowlist.filter((entry) => {
      const isPrefix = entry.endsWith("/")
      for (const rp of routePaths) {
        if (isPrefix) {
          if (rp.startsWith(entry)) return false
        } else {
          if (rp === entry || rp.startsWith(entry + "/")) return false
        }
      }
      return true
    })

    if (orphans.length > 0) {
      throw new Error(
        `PUBLIC_API_ROUTES contains entries with no matching route file:\n  ` +
          orphans.join("\n  ") +
          `\nThese were likely renamed or deleted; remove them from middleware.ts.`
      )
    }
  })
})
