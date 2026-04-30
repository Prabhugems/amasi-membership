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
]

const PUBLIC_API_ROUTES = [
  "/api/auth/login",
  "/api/applications/submit",
  "/api/applications/status",
  "/api/applications/check-duplicate",
  "/api/applications/resubmit",
  // save-draft handles its own member-JWT check via verifyMemberSession;
  // without this line, middleware blocked every client-side draft save
  // with a generic 401 since 2026-04-04.
  "/api/applications/save-draft",
  // resume-from-token is the public endpoint the emailed resume link calls;
  // it authenticates via the signed JWT in the request body, not via cookie.
  "/api/applications/draft/resume-from-token",
  // short-link redirect that expands /r/<code> to the full /apply?resume=... url
  "/api/r/",
  "/api/otp/",
  "/api/payments/",
  "/api/pincode",
  "/api/ocr",
  "/api/card",
  "/api/certificate",
  "/api/credential",
  // External partner API (Bearer api-key auth enforced inside route via verifyApiKey).
  // Without this, /api/v1/* 401s at middleware before the key check runs.
  "/api/v1/",
  "/api/members/search",
  "/api/directory",
  "/api/members/upload",
  "/api/nmc",
  "/api/webhooks/",
  "/api/zoho/callback",
  "/api/member/refresh-token",
  "/api/sentry-test",
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
]

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  const origin = request.headers.get("origin")
  const isApi = pathname.startsWith("/api/")

  // CORS preflight: short-circuit before any auth logic so OPTIONS never
  // reaches a route handler. Allowlisted origins get the full CORS headers;
  // unrecognized origins get a bare 204 (browser blocks the actual call).
  if (isApi && request.method === "OPTIONS") {
    if (origin && !isAllowedCorsOrigin(origin)) {
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
  if (isApi && origin && !isAllowedCorsOrigin(origin)) {
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
      Sentry.captureMessage("Middleware rejected /api/* request", {
        level: "warning",
        tags: { component: "middleware", reason: "no_admin_cookie" },
        extra: {
          path: pathname,
          method: request.method,
          ip:
            request.headers.get("x-forwarded-for") ??
            request.headers.get("x-real-ip") ??
            "unknown",
          user_agent: request.headers.get("user-agent") ?? "unknown",
        },
      })
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
