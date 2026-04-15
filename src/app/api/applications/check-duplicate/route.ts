import { NextRequest } from "next/server"
import { checkDuplicateApplication } from "@/lib/application-utils"

export async function POST(request: NextRequest) {
  try {
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
