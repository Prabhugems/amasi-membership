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
        adminRole: session.adminRole || "super_admin",
      },
    })
  } catch (error) {
    // Was 401 { authenticated: false } — indistinguishable from a genuine
    // "no session" response, so the client's retry logic (which only
    // retries network-level failures) treated a transient server-side
    // hiccup here as a final, authoritative "not an admin" and never
    // retried. That's the likely actual cause of the sidebar-not-loading
    // report this route's own logs never surfaced (a caught error only
    // ever reached console.error, not a distinguishable response). 500
    // lets src/hooks/use-admin-role.ts's fetchWithRetry() correctly retry
    // this case instead of caching it as final.
    console.error("Session check error:", error)
    return Response.json({ error: "Session check failed" }, { status: 500 })
  }
}
