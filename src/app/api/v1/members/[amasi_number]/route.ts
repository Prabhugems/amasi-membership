import { NextRequest } from "next/server"
import { createAdminClient } from "@/lib/supabase"
import { verifyApiKey } from "@/lib/api-key-auth"
import { checkRateLimit } from "@/lib/rate-limit"

function formatMobile(phone: number | string | null, code: string | null): string | null {
  if (!phone) return null
  const digits = String(phone).replace(/\D/g, "")
  if (!digits) return null
  const cc = (code || "").replace(/\D/g, "")
  return cc ? `+${cc}${digits}` : digits
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ amasi_number: string }> }
) {
  const { amasi_number: amasiParam } = await params

  const apiKey = await verifyApiKey(request)
  if (!apiKey) {
    return Response.json(
      { status: false, message: "Invalid or missing API key" },
      { status: 401 }
    )
  }

  const rl = await checkRateLimit(`apikey:${apiKey.id}`, 60, 60 * 1000)
  if (!rl.allowed) {
    return Response.json(
      { status: false, message: "Rate limit exceeded. Try again later." },
      { status: 429, headers: { "X-RateLimit-Reset": String(rl.resetAt) } }
    )
  }

  // Identifier can be AMASI number, email, or 10-digit phone. Partners (e.g.
  // eventz360) forward whatever the user typed in their form to this route,
  // so accepting all three avoids forcing every partner to triage the input
  // type before the call. Path folder remains `[amasi_number]` for URL
  // backwards compatibility with existing API-key callers.
  const identifier = decodeURIComponent(amasiParam).trim()
  const isEmail = identifier.includes("@")
  const isPhone = /^\d{10}$/.test(identifier)
  const asNum = Number(identifier)
  const isAmasiNumber = !isEmail && !isPhone && Number.isFinite(asNum) && asNum > 0

  if (!isEmail && !isPhone && !isAmasiNumber) {
    return Response.json(
      { status: false, message: "Invalid identifier — expected AMASI number, email, or 10-digit phone" },
      { status: 400 }
    )
  }

  const supabase = createAdminClient()
  const baseQuery = supabase
    .from("members")
    .select("amasi_number, name, first_name, last_name, email, phone, mobile_code, city, state")
    .eq("status", "active")
    .limit(1)

  const query = isEmail
    ? baseQuery.ilike("email", identifier)
    : isPhone
    ? baseQuery.eq("phone", Number(identifier))
    : baseQuery.eq("amasi_number", asNum)

  const { data: member, error } = await query.maybeSingle()

  if (error || !member) {
    return Response.json(
      { status: false, message: "Member not found" },
      { status: 404 }
    )
  }

  return Response.json({
    status: true,
    data: {
      amasi_number: member.amasi_number,
      name: member.name,
      first_name: member.first_name,
      last_name: member.last_name,
      email: member.email,
      mobile: formatMobile(member.phone, member.mobile_code),
      city: member.city,
      state: member.state,
    },
  })
}
