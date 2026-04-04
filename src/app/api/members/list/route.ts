import { NextRequest } from "next/server"
import { createAdminClient } from "@/lib/supabase"

export async function GET(request: NextRequest) {
  const search = request.nextUrl.searchParams.get("q") || ""
  const limit = parseInt(request.nextUrl.searchParams.get("limit") || "50")
  const offset = parseInt(request.nextUrl.searchParams.get("offset") || "0")
  const type = request.nextUrl.searchParams.get("type") || ""
  const state = request.nextUrl.searchParams.get("state") || ""
  const zone = request.nextUrl.searchParams.get("zone") || ""
  const status = request.nextUrl.searchParams.get("status") || ""
  const sortBy = request.nextUrl.searchParams.get("sort") || "amasi_number"
  const sortDir = request.nextUrl.searchParams.get("dir") || "desc"

  try {
    const supabase = createAdminClient()

    const allowedSortCols = ["amasi_number", "name", "membership_type", "state", "zone", "status", "joining_date"]
    const col = allowedSortCols.includes(sortBy) ? sortBy : "amasi_number"
    const ascending = sortDir === "asc"

    let query = supabase
      .from("members")
      .select("amasi_number, name, email, phone, membership_type, status, state, zone, pg_degree, application_no, joining_date, profile_photo", { count: "exact" })
      .order(col, { ascending })
      .range(offset, offset + limit - 1)

    // Search — case-insensitive, strip "dr." from search
    if (search) {
      const cleanSearch = search.replace(/^dr\.?\s*/i, "").trim()
      if (cleanSearch.includes("@")) {
        query = query.ilike("email", `%${cleanSearch}%`)
      } else if (/^\d{10}$/.test(cleanSearch)) {
        query = query.eq("phone", cleanSearch)
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

    // Filter by state
    if (state) {
      query = query.eq("state", state)
    }

    // Filter by zone
    if (zone) {
      query = query.eq("zone", zone)
    }

    // Filter by status
    if (status) {
      query = query.eq("status", status)
    }

    const { data, error, count } = await query

    if (error) {
      console.error("Members list error:", error.message, error.details, error.hint)
      return Response.json({ status: false, message: error.message || "Unable to load members.", hint: error.hint || null }, { status: 500 })
    }

    return Response.json({ status: true, data: data || [], total: count || 0 })
  } catch (error: any) {
    console.error("Members list error:", error.message)
    return Response.json({ status: false, message: "Unable to load members. Please try again." }, { status: 500 })
  }
}
