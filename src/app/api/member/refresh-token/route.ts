import { NextRequest } from "next/server"
import { getMemberSession, signToken, setMemberCookie } from "@/lib/auth"

export async function POST(_request: NextRequest) {
  const session = await getMemberSession()
  if (!session) {
    return Response.json({ status: false, message: "Session expired" }, { status: 401 })
  }

  // Hard cap: refuse to extend sessions older than 24 hours from original issue.
  // Was 4h when base sessions were 1h; bumped alongside the base TTL change for
  // AMASI-MEMBERSHIP-31 (slow /apply OCR uploads exceeding the 1h window).
  //
  // Note: signToken() calls jose's .setIssuedAt() with no args, which overwrites
  // any iat in the payload to "now" — so we cannot rely on iat to survive across
  // refreshes. Carry the initial issue time forward in `original_iat` instead.
  // Graceful migration: tokens minted before this fix have no original_iat, so
  // we capture iat the first time we see them here. Worst case is one extra
  // refresh cycle for an in-flight session.
  const sessionOriginalIat =
    typeof session.original_iat === "number" ? session.original_iat : null
  const sessionIat = typeof session.iat === "number" ? session.iat : Math.floor(Date.now() / 1000)
  const originalIat = sessionOriginalIat ?? sessionIat
  if (Date.now() / 1000 - originalIat > 24 * 3600) {
    return Response.json({ status: false, message: "Session too old. Please re-verify." }, { status: 401 })
  }

  const token = await signToken(
    { sub: session.sub, email: session.email, role: "member", original_iat: originalIat },
    "24h"
  )
  await setMemberCookie(token)
  // Token in body for non-cookie clients (RN mobile). Web app ignores it.
  return Response.json({ status: true, token })
}
