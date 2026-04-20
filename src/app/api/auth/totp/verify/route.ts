import { NextRequest } from "next/server"
import { getAdminSession } from "@/lib/auth"
import { verifyTOTP } from "@/lib/totp"
import { createAdminClient } from "@/lib/supabase"

export async function POST(request: NextRequest) {
  try {
    const session = await getAdminSession()
    if (!session) {
      return Response.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { secret, code } = (await request.json()) as {
      secret?: string
      code?: string
    }

    if (!secret || !code) {
      return Response.json(
        { error: "Secret and code are required" },
        { status: 400 }
      )
    }

    // Verify the code matches the secret before saving
    if (!verifyTOTP(secret, code)) {
      return Response.json(
        { error: "Invalid code. Please try again." },
        { status: 400 }
      )
    }

    // Save totp_secret to admin_users
    const adminId = session.sub as string

    // The env-admin (super admin bypass) is not stored in admin_users,
    // so we cannot persist TOTP for it.
    if (adminId === "admin-1") {
      return Response.json(
        {
          error:
            "The environment super admin cannot enable 2FA. Create a DB admin account instead.",
        },
        { status: 400 }
      )
    }

    const supabase = createAdminClient()
    const { error } = await supabase
      .from("admin_users")
      .update({ totp_secret: secret })
      .eq("id", adminId)

    if (error) {
      console.error("Save totp_secret error:", error)
      return Response.json(
        { error: "Failed to save 2FA secret" },
        { status: 500 }
      )
    }

    return Response.json({ status: true, message: "2FA enabled successfully" })
  } catch (error) {
    console.error("TOTP verify error:", error)
    return Response.json({ error: "Failed to verify TOTP" }, { status: 500 })
  }
}

/**
 * DELETE — disable 2FA for the current admin user.
 */
export async function DELETE() {
  try {
    const session = await getAdminSession()
    if (!session) {
      return Response.json({ error: "Unauthorized" }, { status: 401 })
    }

    const adminId = session.sub as string
    if (adminId === "admin-1") {
      return Response.json(
        { error: "The environment super admin does not have 2FA to disable." },
        { status: 400 }
      )
    }

    const supabase = createAdminClient()
    const { error } = await supabase
      .from("admin_users")
      .update({ totp_secret: null })
      .eq("id", adminId)

    if (error) {
      console.error("Disable 2FA error:", error)
      return Response.json(
        { error: "Failed to disable 2FA" },
        { status: 500 }
      )
    }

    return Response.json({ status: true, message: "2FA disabled" })
  } catch (error) {
    console.error("TOTP delete error:", error)
    return Response.json({ error: "Failed to disable 2FA" }, { status: 500 })
  }
}
