import { SignJWT, jwtVerify } from "jose"
import { cookies } from "next/headers"
import { NextRequest } from "next/server"
import { randomUUID } from "node:crypto"
import { Redis } from "@upstash/redis"
import type { SupabaseClient } from "@supabase/supabase-js"

function getJwtSecret(): Uint8Array {
  const s = process.env.JWT_SECRET?.trim()
  if (!s) throw new Error("JWT_SECRET is required")
  return new TextEncoder().encode(s)
}

const ADMIN_COOKIE = "amasi_admin_token"
const MEMBER_COOKIE = "amasi_member_token"

// --- JWT helpers ---

export async function signToken(payload: Record<string, unknown>, expiresIn = "24h") {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(getJwtSecret())
}

export async function verifyToken(token: string) {
  try {
    const { payload } = await jwtVerify(token, getJwtSecret())
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
  return payload as typeof payload & {
    adminRole?: string
    permissions?: string[]
  }
}

export async function getMemberSession() {
  const token = await getMemberCookie()
  if (!token) return null
  const payload = await verifyToken(token)
  if (!payload || payload.role !== "member") return null
  return payload
}

/**
 * Resolve the current member session to an active members.id, or return
 * { authenticated: false, member_id: null } when there's no session, the
 * session's email doesn't match a member row, or the member is not active.
 *
 * Use this for routes that need to gate behavior on "is the caller a
 * currently-active member" — getMemberSession() alone only proves a valid
 * JWT was issued at some point in the past, not that the holder is still
 * an active member.
 */
export async function getAuthenticatedMember(
  supabase: SupabaseClient
): Promise<{ authenticated: boolean; member_id: string | null }> {
  const session = await getMemberSession()
  const email = session?.email
  if (!email || typeof email !== "string") {
    return { authenticated: false, member_id: null }
  }
  const { data } = await supabase
    .from("members")
    .select("id")
    .eq("email", email.toLowerCase().trim())
    .eq("status", "active")
    .maybeSingle()
  if (!data?.id) return { authenticated: false, member_id: null }
  return { authenticated: true, member_id: data.id }
}

// --- Middleware helper (uses request, not cookies()) ---

export async function verifyTokenFromRequest(request: NextRequest, cookieName: string) {
  const token = request.cookies.get(cookieName)?.value
  if (!token) return null
  return verifyToken(token)
}

export { ADMIN_COOKIE, MEMBER_COOKIE }

// --- Auto-login (magic-link) tokens ---
//
// One-time signed tokens embedded in member-facing emails. Holding a fresh
// token proves the recipient is the same address we mailed it to and lets
// us issue a member session without an OTP round-trip.

const AUTO_LOGIN_SCOPE = "auto-login"

interface AutoLoginPayload {
  sub: string             // member id
  email: string           // member email (lowercased)
  amasi_number: number    // member's AMASI number
  scope: typeof AUTO_LOGIN_SCOPE
  jti: string             // unique id used for single-use enforcement
}

export async function signAutoLoginToken(input: {
  memberId: string
  email: string
  amasiNumber: number
}, expiresIn = "24h"): Promise<string> {
  const payload: AutoLoginPayload = {
    sub: input.memberId,
    email: input.email.toLowerCase(),
    amasi_number: input.amasiNumber,
    scope: AUTO_LOGIN_SCOPE,
    jti: randomUUID(),
  }
  return signToken(payload as unknown as Record<string, unknown>, expiresIn)
}

let _autoLoginRedis: Redis | null = null
function getAutoLoginRedis(): Redis | null {
  if (_autoLoginRedis) return _autoLoginRedis
  const url = (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL)?.trim()
  const token = (process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN)?.trim()
  if (!url || !token) return null
  _autoLoginRedis = new Redis({ url, token })
  return _autoLoginRedis
}

/**
 * Validate a magic-link token and atomically mark its jti as consumed.
 * Returns the payload on success, null on any failure (expired, invalid
 * signature, wrong scope, already consumed).
 *
 * Single-use is enforced via Redis SET NX with a 24h TTL — matches the
 * default token lifetime, so the consumed-jti record outlives the token
 * itself and a replay can never succeed. Without Redis configured we
 * still reject expired tokens (jose handles that) but cannot enforce
 * single-use; we log loudly so this never happens silently in prod.
 */
export async function consumeAutoLoginToken(token: string): Promise<AutoLoginPayload | null> {
  const payload = await verifyToken(token)
  if (!payload) return null
  if ((payload as Record<string, unknown>).scope !== AUTO_LOGIN_SCOPE) return null
  const typed = payload as unknown as AutoLoginPayload
  if (!typed.jti || !typed.email || !typed.sub) return null

  const redis = getAutoLoginRedis()
  if (!redis) {
    console.error("[auth] consumeAutoLoginToken called without Redis configured — single-use cannot be enforced")
    return typed
  }

  // SET key value NX EX 86400 — succeeds only if key doesn't exist.
  // First click claims the token; subsequent clicks see a key already and
  // get null back from the SET, which we treat as a replay.
  const claimed = await redis.set(`consumed_jwt:${typed.jti}`, Date.now(), { nx: true, ex: 60 * 60 * 24 })
  if (claimed !== "OK") return null
  return typed
}
