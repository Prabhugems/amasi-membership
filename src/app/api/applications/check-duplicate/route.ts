import { NextRequest } from "next/server"
import { checkDuplicateApplication } from "@/lib/application-utils"
import { checkRateLimit } from "@/lib/rate-limit"

export async function POST(request: NextRequest) {
  try {
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
    const rl = await checkRateLimit(`dup-check:${ip}`, 10, 60 * 1000)
    if (!rl.allowed) {
      return Response.json({ status: false, message: "Too many requests" }, { status: 429 })
    }

    const { email, mobile, mciCouncilNumber } = await request.json()
    if (!email && !mobile) {
      return Response.json({ status: false, message: "Email or mobile required" }, { status: 400 })
    }

    const result = await checkDuplicateApplication(email || "", mobile || "", mciCouncilNumber)
    return Response.json({ status: true, ...result })
  } catch (error: any) {
    console.error("Duplicate check error:", error)
    return Response.json({ status: false, isDuplicate: false }, { status: 500 })
  }
}
