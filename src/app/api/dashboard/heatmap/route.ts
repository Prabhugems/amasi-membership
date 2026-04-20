import { createAdminClient } from "@/lib/supabase"
import { getAdminSession } from "@/lib/auth"

export async function GET() {
  try {
    const session = await getAdminSession()
    if (!session) {
      return Response.json({ error: "Unauthorized" }, { status: 401 })
    }

    const supabase = createAdminClient()

    const since = new Date()
    since.setDate(since.getDate() - 365)
    since.setHours(0, 0, 0, 0)

    const { data, error } = await supabase
      .from("membership_applications")
      .select("created_at")
      .gte("created_at", since.toISOString())

    if (error) {
      console.error("Heatmap query error:", error)
      return Response.json({ error: error.message }, { status: 500 })
    }

    const counts: Record<string, number> = {}
    for (const row of data || []) {
      if (!row.created_at) continue
      const key = new Date(row.created_at).toISOString().slice(0, 10)
      counts[key] = (counts[key] || 0) + 1
    }

    return Response.json({ counts })
  } catch (err) {
    console.error("Heatmap endpoint error:", err)
    return Response.json({ error: err instanceof Error ? err.message : "Internal server error" }, { status: 500 })
  }
}
