import { NextRequest } from "next/server"
import { createAdminClient } from "@/lib/supabase"

export async function GET(request: NextRequest) {
  const status = request.nextUrl.searchParams.get("status") || "all"
  const limit = parseInt(request.nextUrl.searchParams.get("limit") || "50")
  const offset = parseInt(request.nextUrl.searchParams.get("offset") || "0")

  try {
    const supabase = createAdminClient()

    let query = supabase
      .from("membership_applications")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1)

    if (status === "pending") {
      query = query.in("status", ["submitted", "pending_review"])
    } else if (status === "ai_approved") {
      query = query.eq("status", "ai_approved")
    } else if (status === "approved") {
      query = query.eq("status", "approved")
    } else if (status === "rejected") {
      query = query.eq("status", "rejected")
    }

    const { data, error, count } = await query

    if (error) {
      console.error("List applications error:", error)
      return Response.json({ status: false, message: "Failed to fetch applications" }, { status: 500 })
    }

    return Response.json({ status: true, data: data || [], total: count || 0 })
  } catch (error: any) {
    return Response.json({ status: false, message: error.message }, { status: 500 })
  }
}
