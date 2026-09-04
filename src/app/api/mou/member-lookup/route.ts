// @auth: public — looks up an AMASI member by membership number or email
// to pre-fill the MOU application form. Returns only display-safe fields.
//
// Rate-limited per IP (added beyond the brief's literal code, matching the
// anonymous-tier cap on the closely analogous /api/members/search route —
// see src/lib/member-search-fields.ts). This endpoint returns email/phone
// to an unauthenticated caller who supplies a bare membership number or
// email, unlike /api/members/search's anonymous tier, which deliberately
// excludes those fields. amasi_number is a small sequential integer, so
// without a rate limit this endpoint would let anyone scrape email/phone
// for the whole member list by walking the number range.
import { NextRequest } from "next/server"
import { lookupMemberByNumberOrEmail } from "@/lib/mou/supabase-helpers"
import { checkRateLimit } from "@/lib/rate-limit"

export async function GET(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
  const rl = await checkRateLimit(`mou-member-lookup:${ip}`, 30, 15 * 60 * 1000)
  if (!rl.allowed) {
    return Response.json({ status: false, message: "Too many requests. Please try again later." }, { status: 429 })
  }

  const q = request.nextUrl.searchParams.get("q")
  if (!q || q.trim().length < 3) {
    return Response.json({ status: false, message: "Enter a membership number or email" }, { status: 400 })
  }
  const member = await lookupMemberByNumberOrEmail(q)
  if (!member) return Response.json({ status: true, member: null })
  return Response.json({
    status: true,
    member: {
      id: member.id,
      name: member.name,
      amasi_number: member.amasi_number,
      email: member.email,
      phone: member.phone,
      pg_degree: member.pg_degree,
      state: member.state,
    },
  })
}
