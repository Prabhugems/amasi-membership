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

  const amasiNumber = Number(amasiParam)
  if (!Number.isFinite(amasiNumber) || amasiNumber <= 0) {
    return Response.json(
      { status: false, message: "Invalid AMASI number" },
      { status: 400 }
    )
  }

  const supabase = createAdminClient()
  const { data: member, error } = await supabase
    .from("members")
    .select("amasi_number, name, email, phone, mobile_code, city, state")
    .eq("amasi_number", amasiNumber)
    .eq("status", "active")
    .limit(1)
    .maybeSingle()

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
      email: member.email,
      mobile: formatMobile(member.phone, member.mobile_code),
      city: member.city,
      state: member.state,
    },
  })
}
