import { NextRequest } from "next/server"
import { signToken, setAdminCookie } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase"

export async function POST(request: NextRequest) {
  try {
    const { email, password } = await request.json()
    if (!email || !password) {
      return Response.json(
        { error: "Email and password required" },
        { status: 400 }
      )
    }

    const inputEmail = email.trim().toLowerCase()

    // 1. Check env var first (super admin bypass)
    const adminEmail = (
      process.env.ADMIN_DEFAULT_EMAIL || "admin@amasi.org"
    )
      .trim()
      .toLowerCase()
    const adminPassword = (process.env.ADMIN_DEFAULT_PASSWORD || "Amasi@2026").trim()

    if (inputEmail === adminEmail && password === adminPassword) {
      const token = await signToken({
        sub: "admin-1",
        email: adminEmail,
        name: "AMASI Admin",
        role: "admin",
        adminRole: "super_admin",
        permissions: ["all"],
      })

      await setAdminCookie(token)

      return Response.json({
        status: true,
        user: { email: adminEmail, name: "AMASI Admin", role: "admin", adminRole: "super_admin" },
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
