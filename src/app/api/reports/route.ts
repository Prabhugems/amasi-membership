import { createAdminClient } from "@/lib/supabase"
import { getAdminSession } from "@/lib/auth"

export const dynamic = "force-dynamic"

async function fetchAllBatched<T>(
  queryFn: (offset: number, limit: number) => PromiseLike<{ data: T[] | null; error: any }>,
  batchSize = 1000,
  hardCap = 50000
): Promise<T[]> {
  const rows: T[] = []
  let offset = 0
  while (offset < hardCap) {
    const { data: batch, error } = await queryFn(offset, batchSize)
    if (error) throw new Error(error.message)
    if (!batch || batch.length === 0) break
    rows.push(...batch)
    if (batch.length < batchSize) break
    offset += batchSize
  }
  return rows
}

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

    // Fetch members, applications, payments, and tickets in parallel
    const [memberRows, applicationRows, paymentRows, ticketRows] = await Promise.all([
      fetchAllBatched<{
        zone: string | null
        state: string | null
        joining_date: string | null
        membership_type: string | null
      }>((offset, limit) => {
        let query = supabase
          .from("members")
          .select("zone, state, joining_date, membership_type")
        if (dateCutoff) query = query.gte("joining_date", dateCutoff)
        return query.range(offset, offset + limit - 1)
      }),
      fetchAllBatched<{
        status: string | null
        created_at: string | null
        updated_at: string | null
        ai_confidence: string | null
        nmc_verification: any
        needs_manual_review: boolean | null
      }>((offset, limit) => {
        let query = supabase
          .from("membership_applications")
          .select("status, created_at, updated_at, ai_confidence, nmc_verification, needs_manual_review")
        if (dateCutoff) query = query.gte("created_at", dateCutoff)
        return query.range(offset, offset + limit - 1)
      }),
      fetchAllBatched<{
        amount: number | null
        status: string | null
        currency: string | null
        created_at: string | null
      }>((offset, limit) => {
        let query = supabase
          .from("membership_payments")
          .select("amount, status, currency, created_at")
        if (dateCutoff) query = query.gte("created_at", dateCutoff)
        return query.range(offset, offset + limit - 1)
      }),
      fetchAllBatched<{
        status: string | null
        category: string | null
        priority: string | null
        created_at: string | null
        closed_at: string | null
        first_response_at: string | null
        sla_breached: boolean | null
      }>((offset, limit) => {
        let query = supabase
          .from("support_tickets")
          .select("status, category, priority, created_at, closed_at, first_response_at, sla_breached")
        if (dateCutoff) query = query.gte("created_at", dateCutoff)
        return query.range(offset, offset + limit - 1)
      }),
    ])

    // ── Member aggregations ──

    // Zone distribution
    const zoneCounts: Record<string, number> = {}
    for (const m of memberRows) {
      if (m.zone) zoneCounts[m.zone] = (zoneCounts[m.zone] || 0) + 1
    }
    const zoneData = Object.entries(zoneCounts)
      .map(([zone, count]) => ({ zone, count }))
      .sort((a, b) => b.count - a.count)

    // State distribution (top 15)
    const stateCounts: Record<string, number> = {}
    for (const m of memberRows) {
      if (m.state) stateCounts[m.state] = (stateCounts[m.state] || 0) + 1
    }
    const stateData = Object.entries(stateCounts)
      .map(([state, count]) => ({ state, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 15)

    // Monthly members (last 12 months)
    const twelveMonthsAgo = new Date()
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12)
    const monthlyCounts: Record<string, number> = {}
    for (const m of memberRows) {
      if (m.joining_date && new Date(m.joining_date) >= twelveMonthsAgo) {
        const month = m.joining_date.substring(0, 7)
        monthlyCounts[month] = (monthlyCounts[month] || 0) + 1
      }
    }
    const monthlyData = Object.entries(monthlyCounts)
      .map(([month, count]) => ({ month, count }))
      .sort((a, b) => a.month.localeCompare(b.month))

    // Type distribution
    const typeCounts: Record<string, number> = {}
    for (const m of memberRows) {
      const t = m.membership_type || "Unknown"
      typeCounts[t] = (typeCounts[t] || 0) + 1
    }
    const typeData = Object.entries(typeCounts)
      .map(([membership_type, count]) => ({ membership_type, count }))
      .sort((a, b) => b.count - a.count)

    // ── Application pipeline aggregations ──

    const totalApplications = applicationRows.length
    const statusCounts: Record<string, number> = {}
    let totalApprovalHours = 0
    let approvalCount = 0
    let aiAutoApproved = 0
    let manualReviewCount = 0
    let nmcVerified = 0
    let nmcMismatch = 0
    let nmcNotFound = 0
    let nmcSkipped = 0

    for (const app of applicationRows) {
      // Status breakdown
      const s = app.status || "unknown"
      statusCounts[s] = (statusCounts[s] || 0) + 1

      // AI auto-approval
      if (s === "ai_approved") aiAutoApproved++
      if (app.needs_manual_review) manualReviewCount++

      // Processing time for approved applications
      if ((s === "approved" || s === "ai_approved") && app.created_at && app.updated_at) {
        const dur = new Date(app.updated_at).getTime() - new Date(app.created_at).getTime()
        if (dur >= 0) {
          totalApprovalHours += dur / (1000 * 60 * 60)
          approvalCount++
        }
      }

      // NMC verification stats
      const nmc = app.nmc_verification as { status?: string } | null
      if (nmc && nmc.status) {
        const ns = nmc.status.toLowerCase().trim()
        if (ns === "verified" || ns === "match") nmcVerified++
        else if (ns === "mismatch" || ns === "name_mismatch") nmcMismatch++
        else if (ns === "not_found" || ns === "not found") nmcNotFound++
        else nmcSkipped++
      } else {
        nmcSkipped++
      }
    }

    const approved = (statusCounts["approved"] || 0) + (statusCounts["ai_approved"] || 0)
    const rejected = statusCounts["rejected"] || 0
    const pending = (statusCounts["pending"] || 0) + (statusCounts["submitted"] || 0) + (statusCounts["pending_review"] || 0)
    const needClarification = statusCounts["need_clarification"] || 0

    const closedApplications = approved + rejected
    const approvalRate = closedApplications > 0
      ? Math.round((approved / closedApplications) * 1000) / 10
      : 0

    const avgProcessingHours = approvalCount > 0
      ? Math.round((totalApprovalHours / approvalCount) * 10) / 10
      : 0

    const aiAutoRate = totalApplications > 0
      ? Math.round((aiAutoApproved / totalApplications) * 1000) / 10
      : 0

    // Pipeline data
    const pipeline = {
      total: totalApplications,
      approved,
      rejected,
      pending,
      needClarification,
      approvalRate,
      avgProcessingHours,
      aiAutoApproved,
      aiAutoRate,
      manualReviewCount,
      statusBreakdown: Object.entries(statusCounts)
        .map(([status, count]) => ({ status, count }))
        .sort((a, b) => b.count - a.count),
      nmc: {
        verified: nmcVerified,
        mismatch: nmcMismatch,
        notFound: nmcNotFound,
        skipped: nmcSkipped,
      },
    }

    // ── Revenue aggregations ──

    let totalRevenue = 0
    let paidCount = 0
    let failedCount = 0
    let pendingPayments = 0
    const monthlyRevenue: Record<string, number> = {}

    for (const p of paymentRows) {
      const s = p.status || "unknown"
      if (s === "paid") {
        const amt = Number(p.amount) || 0
        totalRevenue += amt
        paidCount++
        if (p.created_at) {
          const month = p.created_at.substring(0, 7)
          monthlyRevenue[month] = (monthlyRevenue[month] || 0) + amt
        }
      } else if (s === "failed") {
        failedCount++
      } else {
        pendingPayments++
      }
    }

    const avgPaymentAmount = paidCount > 0
      ? Math.round((totalRevenue / paidCount) * 100) / 100
      : 0

    const collectionRate = paymentRows.length > 0
      ? Math.round((paidCount / paymentRows.length) * 1000) / 10
      : 0

    const monthlyRevenueData = Object.entries(monthlyRevenue)
      .map(([month, amount]) => ({ month, amount: Math.round(amount) }))
      .sort((a, b) => a.month.localeCompare(b.month))

    const revenue = {
      total: Math.round(totalRevenue),
      paidCount,
      failedCount,
      pendingPayments,
      avgAmount: avgPaymentAmount,
      collectionRate,
      monthlyTrend: monthlyRevenueData,
    }

    // ── Ticket aggregations ──

    const totalTickets = ticketRows.length
    let openTickets = 0
    let closedTickets = 0
    let resolvedTickets = 0
    let slaBreached = 0
    let totalFirstResponseHours = 0
    let firstResponseCount = 0
    let totalResolutionHours = 0
    let resolutionCount = 0
    const ticketCategoryCounts: Record<string, number> = {}
    const ticketPriorityCounts: Record<string, number> = {}
    const ticketStatusCounts: Record<string, number> = {}

    for (const t of ticketRows) {
      const s = t.status || "unknown"
      ticketStatusCounts[s] = (ticketStatusCounts[s] || 0) + 1

      if (s === "open" || s === "in_progress") openTickets++
      else if (s === "closed") closedTickets++
      else if (s === "resolved") resolvedTickets++

      if (t.sla_breached) slaBreached++

      if (t.category) {
        ticketCategoryCounts[t.category] = (ticketCategoryCounts[t.category] || 0) + 1
      }
      if (t.priority) {
        ticketPriorityCounts[t.priority] = (ticketPriorityCounts[t.priority] || 0) + 1
      }

      // First response time
      if (t.first_response_at && t.created_at) {
        const dur = new Date(t.first_response_at).getTime() - new Date(t.created_at).getTime()
        if (dur >= 0) {
          totalFirstResponseHours += dur / (1000 * 60 * 60)
          firstResponseCount++
        }
      }

      // Resolution time
      if (t.closed_at && t.created_at) {
        const dur = new Date(t.closed_at).getTime() - new Date(t.created_at).getTime()
        if (dur >= 0) {
          totalResolutionHours += dur / (1000 * 60 * 60)
          resolutionCount++
        }
      }
    }

    const slaComplianceRate = totalTickets > 0
      ? Math.round(((totalTickets - slaBreached) / totalTickets) * 1000) / 10
      : 100

    const tickets = {
      total: totalTickets,
      open: openTickets,
      closed: closedTickets,
      resolved: resolvedTickets,
      slaBreached,
      slaComplianceRate,
      avgFirstResponseHours: firstResponseCount > 0
        ? Math.round((totalFirstResponseHours / firstResponseCount) * 10) / 10
        : 0,
      avgResolutionHours: resolutionCount > 0
        ? Math.round((totalResolutionHours / resolutionCount) * 10) / 10
        : 0,
      categoryBreakdown: Object.entries(ticketCategoryCounts)
        .map(([category, count]) => ({ category, count }))
        .sort((a, b) => b.count - a.count),
      priorityBreakdown: Object.entries(ticketPriorityCounts)
        .map(([priority, count]) => ({ priority, count }))
        .sort((a, b) => b.count - a.count),
      statusBreakdown: Object.entries(ticketStatusCounts)
        .map(([status, count]) => ({ status, count }))
        .sort((a, b) => b.count - a.count),
    }

    // ── YoY growth (always computed from full dataset, not filtered by range) ──
    const now = new Date()
    const thisYear = now.getFullYear()
    const lastYear = thisYear - 1
    let thisYearCount = 0
    let lastYearCount = 0

    if (dateCutoff) {
      // Range filter is active — need a separate unfiltered query for YoY
      const [thisYearRes, lastYearRes] = await Promise.all([
        supabase
          .from("members")
          .select("*", { count: "exact", head: true })
          .gte("joining_date", `${thisYear}-01-01`)
          .lt("joining_date", `${thisYear + 1}-01-01`),
        supabase
          .from("members")
          .select("*", { count: "exact", head: true })
          .gte("joining_date", `${lastYear}-01-01`)
          .lt("joining_date", `${thisYear}-01-01`),
      ])
      thisYearCount = thisYearRes.count ?? 0
      lastYearCount = lastYearRes.count ?? 0
    } else {
      // No range filter — memberRows has all data
      for (const m of memberRows) {
        if (m.joining_date) {
          const y = new Date(m.joining_date).getFullYear()
          if (y === thisYear) thisYearCount++
          else if (y === lastYear) lastYearCount++
        }
      }
    }

    const yoyGrowth = lastYearCount > 0
      ? Math.round(((thisYearCount - lastYearCount) / lastYearCount) * 1000) / 10
      : 0

    return Response.json({
      zoneData,
      stateData,
      monthlyData,
      typeData,
      total: memberRows.length,
      pipeline,
      revenue,
      tickets,
      growth: {
        thisYear: thisYearCount,
        lastYear: lastYearCount,
        yoyPct: yoyGrowth,
      },
    })
  } catch (err) {
    console.error("Reports API error:", err)
    return Response.json(
      { error: "Failed to fetch reports" },
      { status: 500 }
    )
  }
}
