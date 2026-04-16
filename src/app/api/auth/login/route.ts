import { NextRequest } from "next/server"
import { signToken, setAdminCookie } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase"
import { logAdminAction } from "@/lib/audit-log"
import { checkRateLimit } from "@/lib/rate-limit"

function getRequestIp(req: NextRequest): string | undefined {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    req.headers.get("x-real-ip") ||
    undefined
  )
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const { email, password } = body as { email?: string; password?: string }

    // Rate limit per IP + email to mitigate brute-force attacks
    const ip = getRequestIp(request) || "unknown"
    const rateLimitKey = `login:${ip}:${(email || "").trim().toLowerCase()}`
    const rl = checkRateLimit(rateLimitKey, 5, 15 * 60 * 1000)
    if (!rl.allowed) {
      const retryAfter = Math.ceil((rl.resetAt - Date.now()) / 1000)
      return Response.json(
        { error: "Too many login attempts. Please try again later." },
        { status: 429, headers: { "Retry-After": String(retryAfter) } }
      )
    }

    if (!email || !password) {
      return Response.json(
        { error: "Email and password required" },
        { status: 400 }
      )
    }

    const inputEmail = email.trim().toLowerCase()

    // 1. Check env var first (super admin bypass)
    const envAdminEmail = process.env.ADMIN_DEFAULT_EMAIL?.trim().toLowerCase()
    const envAdminPassword = process.env.ADMIN_DEFAULT_PASSWORD?.trim()

    if (
      envAdminEmail &&
      envAdminPassword &&
      inputEmail === envAdminEmail &&
      password === envAdminPassword
    ) {
      const token = await signToken({
        sub: "admin-1",
        email: envAdminEmail,
        name: "AMASI Admin",
        role: "admin",
        adminRole: "super_admin",
        permissions: ["all"],
      })

      await setAdminCookie(token)

      await logAdminAction({
        adminEmail: envAdminEmail,
        adminName: "AMASI Admin",
        action: "login",
        entityType: "session",
        details: {
          source: "env_admin",
          userAgent: request.headers.get("user-agent") || undefined,
        },
        ipAddress: getRequestIp(request),
      })

      return Response.json({
        status: true,
        user: { email: envAdminEmail, name: "AMASI Admin", role: "admin", adminRole: "super_admin" },
      })
    }

    // 2. Check DB admin users
    const supabase = createAdminClient()
    const { data: dbAdmins, error } = await supabase.rpc("verify_admin_password", {
      p_email: inputEmail,
      p_password: password,
    })

    if (error) {
      console.error("DB admin login error:", error)
      return Response.json(
        { error: "Invalid email or password" },
        { status: 401 }
      )
    }

    if (dbAdmins && dbAdmins.length > 0) {
      const admin = dbAdmins[0]

      // Update last_login timestamp
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
        permissions: admin.permissions || ["all"],
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
    }

    // No match
    return Response.json(
      { error: "Invalid email or password" },
      { status: 401 }
    )
  } catch (error) {
    console.error("Login error:", error)
    return Response.json({ error: "Login failed" }, { status: 500 })
  }
}
