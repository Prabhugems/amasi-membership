// @auth: public — issues a one-time code for MOU application verification.
// Rate-limited per IP here (matching the existing /api/otp/send pattern),
// in addition to sendMouOtp's own per-email rate limit.
import { NextRequest } from "next/server"
import { sendMouOtp } from "@/lib/mou/otp"
import { checkRateLimit } from "@/lib/rate-limit"

export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
  const rl = await checkRateLimit(`mou-otp-send:${ip}`, 5, 15 * 60 * 1000)
  if (!rl.allowed) {
    return Response.json({ status: false, message: "Too many attempts. Please try again later." }, { status: 429 })
  }

  const { email } = await request.json()
  if (!email || typeof email !== "string") {
    return Response.json({ status: false, message: "Email is required" }, { status: 400 })
  }
  const result = await sendMouOtp(email)
  if (!result.ok) return Response.json({ status: false, message: result.message }, { status: 400 })
  return Response.json({ status: true })
}
