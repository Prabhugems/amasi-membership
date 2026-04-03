import { NextRequest } from "next/server"
import { createAdminClient } from "@/lib/supabase"

export async function GET(request: NextRequest) {
  const search = request.nextUrl.searchParams.get("q") || ""
  const limit = parseInt(request.nextUrl.searchParams.get("limit") || "50")
  const offset = parseInt(request.nextUrl.searchParams.get("offset") || "0")
  const type = request.nextUrl.searchParams.get("type") || ""

  try {
    const supabase = createAdminClient()

    let query = supabase
      .from("members")
      .select("amasi_number, name, email, phone, membership_type, status, state, zone, pg_degree, application_no, joining_date, profile_photo", { count: "exact" })
      .order("amasi_number", { ascending: false })
      .range(offset, offset + limit - 1)

    // Search — case-insensitive, strip "dr." from search
    if (search) {
      const cleanSearch = search.replace(/^dr\.?\s*/i, "").trim()
      if (cleanSearch.includes("@")) {
        query = query.ilike("email", `%${cleanSearch}%`)
      } else if (/^\d{10}$/.test(cleanSearch)) {
        query = query.eq("phone", parseInt(cleanSearch))
      } else if (/^\d+$/.test(cleanSearch)) {
        query = query.eq("amasi_number", parseInt(cleanSearch))
      } else {
        query = query.ilike("name", `%${cleanSearch}%`)
      }
    }

    // Filter by type
    if (type) {
      query = query.eq("membership_type", type)
    }

    const { data, error, count } = await query

    if (error) {
      return Response.json({ status: false, message: error.message }, { status: 500 })
    }

    return Response.json({ status: true, data: data || [], total: count || 0 })
  } catch (error: any) {
    return Response.json({ status: false, message: error.message }, { status: 500 })
  }
}
