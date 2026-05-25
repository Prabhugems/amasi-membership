import { NextRequest } from "next/server"
import { checkDuplicateApplication } from "@/lib/application-utils"
import { checkRateLimit } from "@/lib/rate-limit"
import { getMemberSession } from "@/lib/auth"

// Two Supabase queries on apply hot path; cushion against cold-start spikes.
export const maxDuration = 15

export async function POST(request: NextRequest) {
  try {
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
    const rl = await checkRateLimit(`dup-check:${ip}`, 10, 60 * 1000)
    if (!rl.allowed) {
      return Response.json({ status: false, message: "Too many requests" }, { status: 429 })
    }

    const { email, mobile, mciCouncilNumber, mciCouncilState } = await request.json()
    if (!email && !mobile) {
      return Response.json({ status: false, message: "Email or mobile required" }, { status: 400 })
    }

    const result = await checkDuplicateApplication(email || "", mobile || "", mciCouncilNumber, mciCouncilState)

    // PII gate: `existingMember` echoes name/email/membership_type/amasi_number,
    // which would leak member identity on any email/phone lookup. Only echo it
    // when the caller has a verified member session whose email matches the
    // lookup email (i.e. the member is checking against themselves). The apply
    // page's EXISTING_MEMBER routing UX does NOT depend on this echo — it
    // triggers via the 409 path from /api/applications/save-draft instead.
    if (result.existingMember) {
      const session = await getMemberSession()
      const sessionEmail = typeof session?.email === "string" ? session.email.toLowerCase() : null
      const lookupEmail = typeof email === "string" ? email.toLowerCase() : null
      const callerOwnsLookup = !!sessionEmail && !!lookupEmail && sessionEmail === lookupEmail
      if (!callerOwnsLookup) {
        const { existingMember: _stripped, ...redacted } = result
        return Response.json({ status: true, ...redacted })
      }
    }

    return Response.json({ status: true, ...result })
  } catch (error) {
    console.error("Duplicate check error:", error)
    return Response.json({ status: false, isDuplicate: false }, { status: 500 })
  }
}
