import { NextRequest } from "next/server"
import { clearAdminCookie, clearMemberCookie } from "@/lib/auth"

export async function POST(_request: NextRequest) {
  try {
    await clearAdminCookie()
    await clearMemberCookie()
    return Response.json({ status: true, message: "Logged out" })
  } catch (error) {
    console.error("Logout error:", error)
    return Response.json({ error: "Logout failed" }, { status: 500 })
  }
}
