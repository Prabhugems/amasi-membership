import { NextRequest } from "next/server"
import { createAdminClient } from "@/lib/supabase"
import { getAdminSession } from "@/lib/auth"

export async function GET(request: NextRequest) {
  const session = await getAdminSession()
  if (!session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const limit = Math.min(Number(searchParams.get("limit")) || 50, 200)
  const offset = Number(searchParams.get("offset")) || 0
  const action = searchParams.get("action")
  const entityType = searchParams.get("entityType")
  const adminEmail = searchParams.get("adminEmail")?.trim().toLowerCase()
  const since = searchParams.get("since")
  const summary = searchParams.get("summary") === "true"

  const supabase = createAdminClient()

  // Summary mode — return aggregated counts per action
  if (summary) {
    let sumQuery = supabase.from("admin_audit_log").select("action").limit(5000)
    if (adminEmail) sumQuery = sumQuery.eq("admin_email", adminEmail)
    if (since) sumQuery = sumQuery.gte("created_at", since)
    if (action) sumQuery = sumQuery.eq("action", action)
    if (entityType) sumQuery = sumQuery.eq("entity_type", entityType)

    const { data: rows, error: sumErr } = await sumQuery
    if (sumErr) {
      return Response.json({ error: sumErr.message }, { status: 500 })
    }
    const counts: Record<string, number> = {}
    for (const row of (rows as Array<{ action: string }>) ?? []) {
      counts[row.action] = (counts[row.action] || 0) + 1
    }
    return Response.json({ summary: counts, total: rows?.length ?? 0 })
  }

  let query = supabase
    .from("admin_audit_log")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1)

  if (action) {
    query = query.eq("action", action)
  }
  if (entityType) {
    query = query.eq("entity_type", entityType)
  }
  if (adminEmail) {
    query = query.eq("admin_email", adminEmail)
  }
  if (since) {
    query = query.gte("created_at", since)
  }

  const { data, error, count } = await query

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ data, total: count ?? 0 })
}
