import { NextRequest } from "next/server"
import { verifyTOTP } from "@/lib/totp"
import { createAdminClient } from "@/lib/supabase"
import { signToken, setAdminCookie } from "@/lib/auth"
import { logAdminAction } from "@/lib/audit-log"
import { checkRateLimit } from "@/lib/rate-limit"

function getRequestIp(req: NextRequest): string | undefined {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    req.headers.get("x-real-ip") ||
    undefined
  )
}

/**
 * Called during login when 2FA is required.
 * Validates the TOTP code, and on success sets the admin session cookie.
 */
export async function POST(request: NextRequest) {
  try {
    const { email, code } = (await request.json().catch(() => ({}))) as {
      email?: string
      code?: string
    }

    if (!email || !code) {
      return Response.json(
        { error: "Email and code are required" },
        { status: 400 }
      )
    }

    const inputEmail = email.trim().toLowerCase()

    // Rate limit per IP + email
    const ip = getRequestIp(request) || "unknown"
    const rlKey = `totp:${ip}:${inputEmail}`
    const rl = await checkRateLimit(rlKey, 5, 15 * 60 * 1000)
    if (!rl.allowed) {
      const retryAfter = Math.ceil((rl.resetAt - Date.now()) / 1000)
      return Response.json(
        { error: "Too many attempts. Please try again later." },
        { status: 429, headers: { "Retry-After": String(retryAfter) } }
      )
    }

    const supabase = createAdminClient()
    const { data: rows, error } = await supabase
      .from("admin_users")
      .select("id, email, name, role, totp_secret")
      .eq("email", inputEmail)
      .eq("is_active", true)
      .limit(1)

    if (error || !rows || rows.length === 0) {
      return Response.json(
        { error: "Invalid email or code" },
        { status: 401 }
      )
    }

    const admin = rows[0]

    if (!admin.totp_secret) {
      return Response.json(
        { error: "2FA is not enabled for this account" },
        { status: 400 }
      )
    }

    if (!verifyTOTP(admin.totp_secret, code)) {
      return Response.json(
        { error: "Invalid code. Please try again." },
        { status: 401 }
      )
    }

    // Code is valid — issue the session
    await supabase
      .from("admin_users")
      .update({ last_login: new Date().toISOString() })
      .eq("id", admin.id)

    const token = await signToken({
      sub: admin.id,
      email: admin.email,
      name: admin.name,
      role: "admin",
      adminRole: admin.role,
      permissions: ["all"],
    })

    await setAdminCookie(token)

    await logAdminAction({
      adminEmail: admin.email,
      adminName: admin.name,
      action: "login",
      entityType: "session",
      entityId: admin.id,
      details: {
        source: "db_admin",
        role: admin.role,
        twoFactor: true,
        userAgent: request.headers.get("user-agent") || undefined,
      },
      ipAddress: getRequestIp(request),
    })

    return Response.json({
      status: true,
      user: {
        email: admin.email,
        name: admin.name,
        role: "admin",
        adminRole: admin.role,
      },
    })
  } catch (error) {
    console.error("TOTP validate error:", error)
    return Response.json({ error: "Validation failed" }, { status: 500 })
  }
}
