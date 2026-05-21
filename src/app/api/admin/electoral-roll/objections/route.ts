import { NextRequest } from "next/server"
import { createAdminClient } from "@/lib/supabase"
import { getAdminSession } from "@/lib/auth"

export async function GET(request: NextRequest) {
  const session = await getAdminSession()
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const searchParams = request.nextUrl.searchParams
  const status = searchParams.get("status")?.trim() || ""
  const page = Math.max(1, parseInt(searchParams.get("page") || "1") || 1)
  const pageSize = Math.min(200, Math.max(1, parseInt(searchParams.get("pageSize") || "50") || 50))
  const offset = (page - 1) * pageSize

  const supabase = createAdminClient()

  let query = supabase
    .from("electoral_objections")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })

  if (status && ["open", "in_review", "resolved", "dismissed"].includes(status)) {
    query = query.eq("status", status)
  }

  query = query.range(offset, offset + pageSize - 1)

  const { data, count, error } = await query

  if (error) {
    console.error("List electoral_objections error:", error)
    return Response.json({ error: "Failed to load objections" }, { status: 500 })
  }

  return Response.json({
    status: true,
    data: data || [],
    count: count || 0,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil((count || 0) / pageSize)),
  })
}
