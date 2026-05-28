import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { jwtVerify } from "jose"
import * as Sentry from "@sentry/nextjs"
import { isAllowedCorsOrigin } from "@/lib/cors"

// Inline token verification — cannot import from @/lib/auth because it uses next/headers
const ADMIN_COOKIE = "amasi_admin_token"

function applyCorsHeaders(response: NextResponse, origin: string | null): NextResponse {
  // Always Vary on Origin so caches/CDNs don't cross-pollute responses.
  response.headers.set("Vary", "Origin")
  if (!origin || !isAllowedCorsOrigin(origin)) return response
  response.headers.set("Access-Control-Allow-Origin", origin)
  response.headers.set(
    "Access-Control-Allow-Methods",
    "GET, POST, PUT, PATCH, DELETE, OPTIONS"
  )
  response.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization")
  response.headers.set("Access-Control-Max-Age", "86400")
  return response
}

let cachedSecret: Uint8Array | null = null
function getJwtSecret(): Uint8Array {
  if (cachedSecret) return cachedSecret
  const s = process.env.JWT_SECRET?.trim()
  if (!s) throw new Error("JWT_SECRET is required")
  cachedSecret = new TextEncoder().encode(s)
  return cachedSecret
}

async function verifyToken(token: string) {
  try {
    const { payload } = await jwtVerify(token, getJwtSecret())
    return payload
  } catch {
    return null
  }
}

// Routes that don't need any auth
const PUBLIC_ROUTES = [
  "/login",
  "/apply",
  "/m",
  "/member",
  "/membership",
  "/verify",
  "/v",
  "/support",
  "/card",
  "/profile",
  "/directory",
  // Provisional Electoral Roll (masked PII) + objection form. The roll API
  // (/api/electoral-roll/*) is allowlisted below; the admin triage page lives
  // under /admin/electoral-roll which is auth-gated by default.
  "/electoral-roll",
  // Sentry SDK tunnel (next.config.ts: tunnelRoute). Client error reports POST
  // here; without this allowlist the middleware redirected to /login (307) and
  // the POST followed into a 405, silently dropping every client-side Sentry
  // event.
  "/monitoring",
]

const PUBLIC_API_ROUTES = [
  "/api/auth/login",
  "/api/applications/submit",
  "/api/applications/status",
  "/api/applications/check-duplicate",
  // WS-C: applicant creates a pending_payment app row after OTP verify, before
  // payment. Gated behind WSC_EARLY_APPLICATION_ENABLED; flag OFF → 404.
  // Handler does its own OTP-window gate.
  "/api/applications/create-pending",
  "/api/applications/resubmit",
  // save-draft handles its own member-JWT check via verifyMemberSession;
  // without this line, middleware blocked every client-side draft save
  // with a generic 401 since 2026-04-04.
  "/api/applications/save-draft",
  // resume-from-token is the public endpoint the emailed resume link calls;
  // it authenticates via the signed JWT in the request body, not via cookie.
  "/api/applications/draft/resume-from-token",
  "/api/otp/",
  "/api/payments/",
  "/api/pincode",
  "/api/ocr",
  "/api/card",
  "/api/certificate",
  "/api/credential",
  "/api/events",
  "/api/courses",
  // External partner API (Bearer api-key auth enforced inside route via verifyApiKey).
  // Without this, /api/v1/* 401s at middleware before the key check runs.
  "/api/v1/",
  "/api/members/search",
  "/api/directory",
  // Public electoral roll (masked email/phone) + objection submission.
  // Admin surface lives under /api/admin/electoral-roll/* (auth-gated).
  "/api/electoral-roll",
  "/api/members/upload",
  "/api/nmc",
  "/api/webhooks/",
  "/api/zoho/callback",
  "/api/member/refresh-token",
  // Member profile endpoint — auth chain (getMemberSession + active-member
  // check) is inside the handler. See route.ts comment.
  "/api/member/me",
  // Expo push-token registration. Route does its own getMemberSession +
  // active-member check. Exact path only — future /api/push/* endpoints
  // each get their own line.
  "/api/push/register",
  // Bulk member sync for amasi-mobile offline cache. Route does its own
  // getMemberSession + active-member check + per-member Upstash rate
  // limit (10 req/min). Exact path only.
  "/api/members/sync",
  // Member-facing announcements. Anonymous read; handler does its own
  // IP rate limit (60 req/15min) and only returns published+public rows.
  "/api/announcements",
  "/api/sentry-test",
  // Unload-safe relay for client-side Sentry events. Public because callers
  // POST via navigator.sendBeacon during tab close, before any user gesture
  // is possible. The handler does its own input sanitization, rate-limits
  // per IP, and returns 204 with no body (never echoes input).
  "/api/client-log",
  "/api/verify/",
  // Sidebar badge counts polled every 60s by admin UI. Handler does its
  // own getAdminSession() check and returns zeros (not 401) for
  // unauthenticated callers, so it's safe at the middleware layer.
  "/api/badges",
  // Polled by sidebar / profile / members / admin-back-link on every
  // admin page load to determine the current admin's role. Handler does
  // its own getAdminSession() check and returns {authenticated: false}
  // for unauthenticated callers, so it's safe at the middleware layer.
  "/api/auth/me",
  // Cron endpoints — Bearer CRON_SECRET enforced inside each route handler.
  // Allowlist required because Vercel cron requests carry no admin cookie;
  // without this, every scheduled invocation 401s at middleware before
  // reaching the route's own auth gate.
  "/api/cron/",
  // Legacy mobile shim (2026-05-27 cutover). The Flutter v1.0.4+2 binary on
  // the stores calls these Laravel-style paths against membership.amasi.org/api/
  // since application.amasi.org went dark. Each route lives at
  // src/app/api/<name>/route.ts; some are P0 implementations, others are
  // stubs returning a "feature updating" envelope. See migration/SHIM_README.md.
  "/api/settings",
  "/api/device_token_update",
  "/api/check_user_data",
  "/api/check_common_login",
  "/api/common_member_send_otp",
  "/api/common_member_resend_otp",
  "/api/common_member_otp_verify",
  "/api/memberforgotpassword",
  "/api/mobile_notification_list",
  "/api/mobile_notification_all_read",
  "/api/mobile_notification_status_update",
  "/api/enquiry_form",
  "/api/know_membership",
  "/api/send_details_toMail",
  "/api/member_info",
  "/api/track_application",
  "/api/get_member_activity",
  "/api/get_country",
  "/api/get_state",
  "/api/get_application",
  "/api/send_otp",
  "/api/otp_verify",
  "/api/resend_otp",
  "/api/check_application_status",
  "/api/delete_clinic",
  "/api/delete_work_exp",
  "/api/delete_old_member_application",
  "/api/member_two",
  "/api/member_three",
  "/api/create_order",
  "/api/final_step",
  "/api/application_data",
  "/api/member_conversion",
  // Legacy cron target. An external HTTP cron provider still fires
  // GET /incomplete_application daily (Frankfurt + Mumbai AWS IPs, curl UA);
  // the route returns the legacy "nothing to do" envelope. Our own reminder
  // job runs at /api/cron/bulk-draft-reminders.
  "/api/incomplete_application",
]

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  const origin = request.headers.get("origin")
  const isApi = pathname.startsWith("/api/")

  // Same-origin POSTs still carry an Origin header but aren't a CORS concern —
  // the browser doesn't enforce ACAO on the response. Skip Sentry logging in
  // that case so preview deploys and local dev don't generate noise per host.
  const isCrossOrigin = !!origin && origin !== request.nextUrl.origin

  // CORS preflight: short-circuit before any auth logic so OPTIONS never
  // reaches a route handler. Allowlisted origins get the full CORS headers;
  // unrecognized origins get a bare 204 (browser blocks the actual call).
  if (isApi && request.method === "OPTIONS") {
    if (isCrossOrigin && !isAllowedCorsOrigin(origin)) {
      Sentry.captureMessage("CORS origin rejected (preflight)", {
        level: "warning",
        fingerprint: ["cors-origin-rejected", origin],
        tags: { component: "middleware", reason: "cors_origin_not_allowed" },
        extra: { origin, path: pathname, method: request.method },
      })
    }
    return applyCorsHeaders(new NextResponse(null, { status: 204 }), origin)
  }

  // Surface unrecognized origins on real /api/* requests so partner-integration
  // failures show up in Sentry instead of being blamed on us. Fingerprint by
  // origin so Sentry groups one issue per misconfigured caller.
  if (isApi && isCrossOrigin && !isAllowedCorsOrigin(origin)) {
    Sentry.captureMessage("CORS origin rejected", {
      level: "warning",
      fingerprint: ["cors-origin-rejected", origin],
      tags: { component: "middleware", reason: "cors_origin_not_allowed" },
      extra: { origin, path: pathname, method: request.method },
    })
  }

  const response = await handleRequest(request)
  return isApi ? applyCorsHeaders(response, origin) : response
}

async function handleRequest(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl

  // Allow public pages (exact match or subpaths like /member/certificate, NOT /members)
  if (PUBLIC_ROUTES.some((r) => pathname === r || pathname.startsWith(r + "/"))) {
    return NextResponse.next()
  }

  // Allow public API routes
  if (PUBLIC_API_ROUTES.some((r) => pathname.startsWith(r))) {
    return NextResponse.next()
  }

  // Allow ticket creation (POST) and member ticket lookup (GET with email/phone)
  if (pathname === "/api/tickets") {
    if (request.method === "POST") return NextResponse.next()
    if (request.method === "GET" && !request.nextUrl.searchParams.has("all")) {
      return NextResponse.next()
    }
  }

  // Allow CSAT rating from email links (token-based auth in handler)
  if (pathname === "/api/tickets/csat") {
    return NextResponse.next()
  }

  // Allow ticket detail view and member replies — only for UUID or ticket-number patterns,
  // NOT for named sub-routes like /upload, /analytics, /merge
  if (pathname.match(/^\/api\/tickets\/(TKT-[\w-]+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(\/reply)?$/i)) {
    return NextResponse.next()
  }

  // Allow ticket lookup by ticket number (ownership-checked in handler)
  if (pathname.match(/^\/api\/tickets\/by-number\/TKT-[\w-]+$/)) {
    return NextResponse.next()
  }

  // Allow member update API (needs member auth, not admin)
  if (pathname.match(/^\/api\/members\/[^/]+\/update$/)) {
    return NextResponse.next()
  }

  // Allow member clinic + experience APIs — same shape as /update: dynamic
  // member-id segment, in-handler getMemberSession() + verifyMemberOwnership
  // IDOR check. Without these, /profile silently renders empty clinic/work
  // experience cards for non-admin members (the fetches .catch and swallow).
  if (pathname.match(/^\/api\/members\/[^/]+\/(clinic|experience)$/)) {
    return NextResponse.next()
  }

  // Allow member upgrade API (route does its own admin-or-member auth check)
  if (pathname === "/api/members/upgrade") {
    return NextResponse.next()
  }

  // Allow static files, _next, favicon, icon
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/icon") ||
    pathname === "/favicon.ico"
  ) {
    return NextResponse.next()
  }

  // Everything else needs admin auth
  const token = request.cookies.get(ADMIN_COOKIE)?.value
  const payload = token ? await verifyToken(token) : null

  if (!payload || payload.role !== "admin") {
    // API routes return 401
    if (pathname.startsWith("/api/")) {
      // Surface in Sentry so missing-allowlist regressions (the recurring
      // "every new public endpoint ships 401-blocked" pattern) become visible
      // immediately instead of needing a user report. Path goes in `extra`,
      // not `tags`, to keep tag cardinality bounded.
      //
      // Only fire when the cookie is truly absent — that's the
      // missing-allowlist signal. A present-but-invalid cookie means a
      // routine session expiry (admin tab still polling /api/dashboard,
      // /api/badges, etc. after JWT TTL elapsed) and is not a regression.
      // Pre-2026-05-05 we logged both cases and AMASI-MEMBERSHIP-7
      // accumulated 58 false positives in a week.
      if (!token) {
        // Mobile-app traffic (Flutter v1.0.4+2 sets X-Source: mobile-app on
        // every request) gets its own Sentry fingerprint + tag so we can
        // separate legacy-shim regressions from admin/cron auth misses. The
        // observability gap surfaced during the 2026-05-27 cutover when a
        // Sentry query for `http.status_code:401 mobile-app` returned zero
        // events even though the legacy backend was already dark — the
        // existing capture didn't carry the X-Source tag.
        const xSource = request.headers.get("x-source")
        const isMobileApp = xSource === "mobile-app"
        Sentry.captureMessage(
          isMobileApp
            ? "Mobile-app request rejected at middleware"
            : "Middleware rejected /api/* request",
          {
            level: "warning",
            fingerprint: isMobileApp
              ? ["mobile-app-middleware-reject", pathname]
              : ["middleware-reject"],
            tags: {
              component: "middleware",
              reason: isMobileApp ? "mobile_app_not_allowlisted" : "no_admin_cookie",
              ...(xSource ? { x_source: xSource } : {}),
            },
            extra: {
              path: pathname,
              method: request.method,
              ip:
                request.headers.get("x-forwarded-for") ??
                request.headers.get("x-real-ip") ??
                "unknown",
              user_agent: request.headers.get("user-agent") ?? "unknown",
            },
          }
        )
      }
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    // Root path → redirect to /apply (public landing) instead of login
    if (pathname === "/") {
      return NextResponse.redirect(new URL("/apply", request.url))
    }
    // Other admin pages redirect to login
    const loginUrl = new URL("/login", request.url)
    const fullPath = pathname + (request.nextUrl.search || "")
    loginUrl.searchParams.set("redirect", fullPath)
    return NextResponse.redirect(loginUrl)
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon.svg|certificates|public).*)",
  ],
}
