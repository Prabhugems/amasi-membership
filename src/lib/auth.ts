import { SignJWT, jwtVerify } from "jose"
import { cookies } from "next/headers"
import { NextRequest } from "next/server"

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET?.trim() || "fallback-secret-change-me"
)

const ADMIN_COOKIE = "amasi_admin_token"
const MEMBER_COOKIE = "amasi_member_token"

// --- JWT helpers ---

export async function signToken(payload: Record<string, unknown>, expiresIn = "24h") {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(JWT_SECRET)
}

export async function verifyToken(token: string) {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET)
    return payload
  } catch {
    return null
  }
}

// --- Cookie helpers ---

export async function setAdminCookie(token: string) {
  const cookieStore = await cookies()
  cookieStore.set(ADMIN_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24, // 24 hours
  })
}

export async function getAdminCookie() {
  const cookieStore = await cookies()
  return cookieStore.get(ADMIN_COOKIE)?.value || null
}

export async function clearAdminCookie() {
  const cookieStore = await cookies()
  cookieStore.delete(ADMIN_COOKIE)
}

export async function setMemberCookie(token: string) {
  const cookieStore = await cookies()
  cookieStore.set(MEMBER_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60, // 1 hour
  })
}

export async function getMemberCookie() {
  const cookieStore = await cookies()
  return cookieStore.get(MEMBER_COOKIE)?.value || null
}

export async function clearMemberCookie() {
  const cookieStore = await cookies()
  cookieStore.delete(MEMBER_COOKIE)
}

// --- Session validation ---

export async function getAdminSession() {
  const token = await getAdminCookie()
  if (!token) return null
  const payload = await verifyToken(token)
  if (!payload || payload.role !== "admin") return null
  return payload
}

export async function getMemberSession() {
  const token = await getMemberCookie()
  if (!token) return null
  const payload = await verifyToken(token)
  if (!payload || payload.role !== "member") return null
  return payload
}

// --- Middleware helper (uses request, not cookies()) ---

export async function verifyTokenFromRequest(request: NextRequest, cookieName: string) {
  const token = request.cookies.get(cookieName)?.value
  if (!token) return null
  return verifyToken(token)
}

export { ADMIN_COOKIE, MEMBER_COOKIE }
