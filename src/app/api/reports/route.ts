import { createAdminClient } from "@/lib/supabase"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const supabase = createAdminClient()

    const [zoneRes, stateRes, monthlyRes, typeRes] = await Promise.all([
      // Zone distribution
      supabase.rpc("exec_sql", {
        query: `SELECT zone, count(*)::int FROM members WHERE zone IS NOT NULL AND zone != '' GROUP BY zone ORDER BY count DESC`,
      }),

      // State-wise top 15
      supabase.rpc("exec_sql", {
        query: `SELECT state, count(*)::int FROM members WHERE state IS NOT NULL AND state != '' GROUP BY state ORDER BY count DESC LIMIT 15`,
      }),

      // Monthly applications (last 12 months)
      supabase.rpc("exec_sql", {
        query: `SELECT to_char(joining_date, 'YYYY-MM') as month, count(*)::int FROM members WHERE joining_date >= NOW() - interval '12 months' GROUP BY month ORDER BY month`,
      }),

      // Membership type distribution
      supabase.rpc("exec_sql", {
        query: `SELECT membership_type, count(*)::int FROM members GROUP BY membership_type ORDER BY count DESC`,
      }),
    ])

    // Check for RPC errors — fall back to JS-based aggregation if exec_sql doesn't exist
    if (zoneRes.error || stateRes.error || monthlyRes.error || typeRes.error) {
      // Fallback: fetch all members in batches and aggregate in JS
      const rows: any[] = []
      let offset = 0
      const batchSize = 5000
      while (true) {
        const { data: batch, error } = await supabase
          .from("members")
          .select("zone, state, joining_date, membership_type")
          .range(offset, offset + batchSize - 1)
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
    }

    return Response.json({
      zoneData: zoneRes.data,
      stateData: stateRes.data,
      monthlyData: monthlyRes.data,
      typeData: typeRes.data,
    })
  } catch (err) {
    console.error("Reports API error:", err)
    return Response.json(
      { error: "Failed to fetch reports" },
      { status: 500 }
    )
  }
}
