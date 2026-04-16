import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { jwtVerify } from "jose"

// Inline token verification — cannot import from @/lib/auth because it uses next/headers
const ADMIN_COOKIE = "amasi_admin_token"

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
  "/member",
  "/verify",
  "/support",
  "/card",
]

const PUBLIC_API_ROUTES = [
  "/api/auth/login",
  "/api/applications/submit",
  "/api/applications/status",
  "/api/applications/check-duplicate",
  "/api/applications/resubmit",
  "/api/otp/",
  "/api/payments/",
  "/api/pincode",
  "/api/ocr",
  "/api/card",
  "/api/certificate",
  "/api/members/search",
  "/api/members/upload",
  "/api/nmc",
  "/api/webhooks/",
]

export async function middleware(request: NextRequest) {
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

  // Allow ticket detail view and member replies (GET/POST to /api/tickets/[id] and /api/tickets/[id]/reply)
  if (pathname.match(/^\/api\/tickets\/[^/]+(\/reply)?$/)) {
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
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    // Pages redirect to login
    const loginUrl = new URL("/login", request.url)
    loginUrl.searchParams.set("redirect", pathname)
    return NextResponse.redirect(loginUrl)
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon.svg|certificates|public).*)",
  ],
}
