import { NextRequest } from "next/server"
import { createAdminClient } from "@/lib/supabase"
import { checkRateLimit } from "@/lib/rate-limit"

// Only public-safe fields — no email, phone, DOB, MCI number
const PUBLIC_SELECT =
  "name, salutation, amasi_number, membership_type, pg_degree, city, state, zone, profile_photo"

export async function GET(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
  const rl = await checkRateLimit(`directory:${ip}`, 20, 15 * 60 * 1000)
  if (!rl.allowed) {
    return Response.json(
      { status: false, message: "Too many requests. Please try again later.", data: [], count: 0 },
      { status: 429 }
    )
  }

  const searchParams = request.nextUrl.searchParams
  const q = searchParams.get("q")?.trim() || ""
  const state = searchParams.get("state")?.trim() || ""
  const zone = searchParams.get("zone")?.trim() || ""
  const type = searchParams.get("type")?.trim() || ""
  const page = Math.max(1, parseInt(searchParams.get("page") || "1") || 1)
  const limit = Math.min(50, Math.max(1, parseInt(searchParams.get("limit") || "20") || 20))
  const offset = (page - 1) * limit

  try {
    const supabase = createAdminClient()

    let query = supabase
      .from("members")
      .select(PUBLIC_SELECT, { count: "exact" })
      .eq("status", "active")

    // Text search across name, pg_degree, city
    if (q) {
      query = query.or(`name.ilike.%${q}%,pg_degree.ilike.%${q}%,city.ilike.%${q}%`)
    }

    if (state) {
      query = query.ilike("state", state)
    }

    if (zone) {
      query = query.ilike("zone", zone)
    }

    if (type) {
      query = query.eq("membership_type", type)
    }

    query = query.order("name", { ascending: true }).range(offset, offset + limit - 1)

    const { data, count, error } = await query

    if (error) {
      console.error("Directory query error:", error)
      return Response.json(
        { status: false, message: "Search failed", data: [], count: 0 },
        { status: 500 }
      )
    }

    return Response.json({
      status: true,
      data: (data || []).map((m: any) => ({
        name: m.name,
        salutation: m.salutation || "Dr.",
        amasi_number: m.amasi_number,
        membership_type: m.membership_type,
        pg_degree: m.pg_degree,
        city: m.city,
        state: m.state,
        zone: m.zone,
        profile_photo: m.profile_photo,
      })),
      count: count || 0,
      page,
      limit,
      totalPages: Math.ceil((count || 0) / limit),
    })
  } catch (error: any) {
    console.error("Directory error:", error)
    return Response.json(
      { status: false, message: "Search failed", data: [], count: 0 },
      { status: 500 }
    )
  }
}
