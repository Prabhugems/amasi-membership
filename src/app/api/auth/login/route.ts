import { NextRequest } from "next/server"
import { signToken, setAdminCookie } from "@/lib/auth"

export async function POST(request: NextRequest) {
  try {
    const { email, password } = await request.json()
    if (!email || !password) {
      return Response.json(
        { error: "Email and password required" },
        { status: 400 }
      )
    }

    // Verify against env vars
    const adminEmail = (
      process.env.ADMIN_DEFAULT_EMAIL || "admin@amasi.org"
    )
      .trim()
      .toLowerCase()
    const adminPassword = (process.env.ADMIN_DEFAULT_PASSWORD || "Amasi@2026").trim()

    if (
      email.trim().toLowerCase() !== adminEmail ||
      password !== adminPassword
    ) {
      return Response.json(
        { error: "Invalid email or password" },
        { status: 401 }
      )
    }

    const token = await signToken({
      sub: "admin-1",
      email: adminEmail,
      name: "AMASI Admin",
      role: "admin",
    })

    await setAdminCookie(token)

    return Response.json({
      status: true,
      user: { email: adminEmail, name: "AMASI Admin", role: "admin" },
    })
  } catch (error) {
    console.error("Login error:", error)
    return Response.json({ error: "Login failed" }, { status: 500 })
  }
}
