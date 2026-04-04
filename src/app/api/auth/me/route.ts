import { NextRequest } from "next/server"
import { getAdminSession } from "@/lib/auth"

export async function GET(_request: NextRequest) {
  try {
    const session = await getAdminSession()

    if (!session) {
      return Response.json({ authenticated: false }, { status: 401 })
    }

    return Response.json({
      authenticated: true,
      user: {
        email: session.email,
        name: session.name,
        role: session.role,
      },
    })
  } catch (error) {
    console.error("Session check error:", error)
    return Response.json({ authenticated: false }, { status: 401 })
  }
}
