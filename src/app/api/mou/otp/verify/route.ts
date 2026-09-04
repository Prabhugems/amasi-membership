// @auth: public — verifies a one-time code for MOU application submission.
// Rate-limited per IP here (matching the existing /api/otp/verify pattern),
// in addition to verifyMouOtp's own per-email attempt cap.
import { NextRequest } from "next/server"
import { verifyMouOtp } from "@/lib/mou/otp"
import { checkRateLimit } from "@/lib/rate-limit"

export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
  const rl = await checkRateLimit(`mou-otp-verify:${ip}`, 10, 15 * 60 * 1000)
  if (!rl.allowed) {
    return Response.json({ status: false, message: "Too many attempts. Please try again later." }, { status: 429 })
  }

  const { email, code } = await request.json()
  if (!email || !code) {
    return Response.json({ status: false, message: "Email and code are required" }, { status: 400 })
  }
  const result = await verifyMouOtp(email, code)
  if (!result.ok) return Response.json({ status: false, message: result.message }, { status: 400 })
  return Response.json({ status: true })
}
