import { createAdminClient } from "@/lib/supabase"
import { getAdminSession } from "@/lib/auth"

export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  try {
    const session = await getAdminSession()
    if (!session) {
      return Response.json({ error: "Unauthorized" }, { status: 401 })
    }

    const supabase = createAdminClient()
    const { searchParams } = new URL(request.url)
    const range = searchParams.get("range") // "30d", "90d", "year", or null for all

    // Calculate date cutoff from range param
    let dateCutoff: string | null = null
    if (range) {
      const now = new Date()
      if (range === "30d") now.setDate(now.getDate() - 30)
      else if (range === "90d") now.setDate(now.getDate() - 90)
      else if (range === "year") {
        now.setMonth(0)
        now.setDate(1)
      }
      dateCutoff = now.toISOString().split("T")[0]
    }

    // Fetch members in batches and aggregate in JS
    const rows: Array<{
      zone: string | null
      state: string | null
      joining_date: string | null
      membership_type: string | null
    }> = []
    let offset = 0
    const batchSize = 5000
    const hardCap = 50000
    while (offset < hardCap) {
      let query = supabase
        .from("members")
        .select("zone, state, joining_date, membership_type")
      if (dateCutoff) query = query.gte("joining_date", dateCutoff)
      const { data: batch, error } = await query.range(
        offset,
        Math.min(offset + batchSize - 1, hardCap - 1)
      )
      if (error) return Response.json({ error: error.message }, { status: 500 })
      if (!batch || batch.length === 0) break
      rows.push(...batch)
      if (batch.length < batchSize) break
      offset += batchSize
    }

    // Zone distribution
    const zoneCounts: Record<string, number> = {}
    for (const m of rows) {
      if (m.zone) zoneCounts[m.zone] = (zoneCounts[m.zone] || 0) + 1
    }
    const zoneData = Object.entries(zoneCounts)
      .map(([zone, count]) => ({ zone, count }))
      .sort((a, b) => b.count - a.count)

    // State distribution (top 15)
    const stateCounts: Record<string, number> = {}
    for (const m of rows) {
      if (m.state) stateCounts[m.state] = (stateCounts[m.state] || 0) + 1
    }
    const stateData = Object.entries(stateCounts)
      .map(([state, count]) => ({ state, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 15)

    // Monthly applications (last 12 months)
    const twelveMonthsAgo = new Date()
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12)
    const monthlyCounts: Record<string, number> = {}
    for (const m of rows) {
      if (m.joining_date && new Date(m.joining_date) >= twelveMonthsAgo) {
        const month = m.joining_date.substring(0, 7) // YYYY-MM
        monthlyCounts[month] = (monthlyCounts[month] || 0) + 1
      }
    }
    const monthlyData = Object.entries(monthlyCounts)
      .map(([month, count]) => ({ month, count }))
      .sort((a, b) => a.month.localeCompare(b.month))

    // Type distribution
    const typeCounts: Record<string, number> = {}
    for (const m of rows) {
      const t = m.membership_type || "Unknown"
      typeCounts[t] = (typeCounts[t] || 0) + 1
    }
    const typeData = Object.entries(typeCounts)
      .map(([membership_type, count]) => ({ membership_type, count }))
      .sort((a, b) => b.count - a.count)

    return Response.json({
      zoneData,
      stateData,
      monthlyData,
      typeData,
      total: rows.length,
    })
  } catch (err) {
    console.error("Reports API error:", err)
    return Response.json(
      { error: "Failed to fetch reports" },
      { status: 500 }
    )
  }
}
