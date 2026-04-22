import { NextRequest } from "next/server"
import { getMemberSession, signToken, setMemberCookie } from "@/lib/auth"

export async function POST(_request: NextRequest) {
  const session = await getMemberSession()
  if (!session) {
    return Response.json({ status: false, message: "Session expired" }, { status: 401 })
  }

  // Hard cap: refuse to extend sessions older than 4 hours from original issue
  const iat = typeof session.iat === "number" ? session.iat : 0
  if (Date.now() / 1000 - iat > 4 * 3600) {
    return Response.json({ status: false, message: "Session too old. Please re-verify." }, { status: 401 })
  }

  const token = await signToken(
    { sub: session.sub, email: session.email, role: "member", iat },
    "1h"
  )
  await setMemberCookie(token)
  return Response.json({ status: true })
}
