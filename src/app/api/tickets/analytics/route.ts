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
    const period = searchParams.get("period") || "30d"

    // Calculate date cutoff
    const now = new Date()
    let days = 30
    if (period === "7d") days = 7
    else if (period === "90d") days = 90
    const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000)
    const cutoffISO = cutoff.toISOString()

    // Fetch all tickets in period
    const { data: tickets, error } = await supabase
      .from("support_tickets")
      .select("id, status, category, priority, assigned_to, created_at, updated_at, first_response_at, closed_at, sla_breached, sla_due_at")
      .gte("created_at", cutoffISO)
      .order("created_at", { ascending: true })

    if (error) {
      console.error("Tickets analytics query error:", error)
      return Response.json({ error: "Failed to fetch ticket data" }, { status: 500 })
    }

    const rows = tickets || []

    // Basic counts
    const totalTickets = rows.length
    const openTickets = rows.filter((t) => t.status === "open" || t.status === "in_progress").length

    // SLA breached count (handle column possibly missing)
    const slaBreachedCount = rows.filter((t) => t.sla_breached === true).length

    // Avg first response hours
    const firstResponseDeltas: number[] = []
    for (const t of rows) {
      if (t.first_response_at && t.created_at) {
        const delta = new Date(t.first_response_at).getTime() - new Date(t.created_at).getTime()
        if (delta >= 0) firstResponseDeltas.push(delta)
      }
    }
    const avgFirstResponseHours =
      firstResponseDeltas.length > 0
        ? Math.round((firstResponseDeltas.reduce((a, b) => a + b, 0) / firstResponseDeltas.length / 3600000) * 10) / 10
        : 0

    // Avg resolution hours (closed_at - created_at for closed/resolved)
    const resolutionDeltas: number[] = []
    for (const t of rows) {
      if ((t.status === "closed" || t.status === "resolved") && t.closed_at && t.created_at) {
        const delta = new Date(t.closed_at).getTime() - new Date(t.created_at).getTime()
        if (delta >= 0) resolutionDeltas.push(delta)
      }
    }
    const avgResolutionHours =
      resolutionDeltas.length > 0
        ? Math.round((resolutionDeltas.reduce((a, b) => a + b, 0) / resolutionDeltas.length / 3600000) * 10) / 10
        : 0

    // Category breakdown
    const categoryMap = new Map<string, number>()
    for (const t of rows) {
      const cat = t.category || "Other"
      categoryMap.set(cat, (categoryMap.get(cat) || 0) + 1)
    }
    const categoryBreakdown = Array.from(categoryMap.entries())
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count)

    // Status breakdown
    const statusMap = new Map<string, number>()
    for (const t of rows) {
      const s = t.status || "unknown"
      statusMap.set(s, (statusMap.get(s) || 0) + 1)
    }
    const statusBreakdown = Array.from(statusMap.entries())
      .map(([status, count]) => ({ status, count }))
      .sort((a, b) => b.count - a.count)

    // Volume by day
    const dayCreatedMap = new Map<string, number>()
    const dayResolvedMap = new Map<string, number>()

    for (const t of rows) {
      const day = t.created_at.slice(0, 10)
      dayCreatedMap.set(day, (dayCreatedMap.get(day) || 0) + 1)
    }
    for (const t of rows) {
      if ((t.status === "closed" || t.status === "resolved") && t.closed_at) {
        const day = t.closed_at.slice(0, 10)
        dayResolvedMap.set(day, (dayResolvedMap.get(day) || 0) + 1)
      }
    }

    // Build array of all days in period
    const volumeByDay: Array<{ date: string; created: number; resolved: number }> = []
    const d = new Date(cutoff)
    d.setHours(0, 0, 0, 0)
    const endDate = new Date(now)
    endDate.setHours(0, 0, 0, 0)
    while (d <= endDate) {
      const key = d.toISOString().slice(0, 10)
      volumeByDay.push({
        date: key,
        created: dayCreatedMap.get(key) || 0,
        resolved: dayResolvedMap.get(key) || 0,
      })
      d.setDate(d.getDate() + 1)
    }

    // Team performance (by assigned_to)
    const teamMap = new Map<string, { assigned: number; resolved: number; totalResolutionMs: number; resolvedCount: number }>()
    for (const t of rows) {
      const team = t.assigned_to || "Unassigned"
      if (!teamMap.has(team)) {
        teamMap.set(team, { assigned: 0, resolved: 0, totalResolutionMs: 0, resolvedCount: 0 })
      }
      const entry = teamMap.get(team)!
      entry.assigned++
      if ((t.status === "closed" || t.status === "resolved") && t.closed_at && t.created_at) {
        const delta = new Date(t.closed_at).getTime() - new Date(t.created_at).getTime()
        if (delta >= 0) {
          entry.resolved++
          entry.totalResolutionMs += delta
          entry.resolvedCount++
        }
      }
    }
    const teamPerformance = Array.from(teamMap.entries())
      .map(([team, data]) => ({
        team,
        assigned: data.assigned,
        resolved: data.resolved,
        avgHours:
          data.resolvedCount > 0
            ? Math.round((data.totalResolutionMs / data.resolvedCount / 3600000) * 10) / 10
            : 0,
      }))
      .sort((a, b) => b.assigned - a.assigned)

    return Response.json({
      totalTickets,
      openTickets,
      avgFirstResponseHours,
      avgResolutionHours,
      slaBreachedCount,
      categoryBreakdown,
      statusBreakdown,
      volumeByDay,
      teamPerformance,
    })
  } catch (err) {
    console.error("Tickets analytics error:", err)
    return Response.json({ error: "Internal server error" }, { status: 500 })
  }
}
