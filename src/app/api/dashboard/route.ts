import { createAdminClient } from "@/lib/supabase"
import { getAdminSession } from "@/lib/auth"

type Range = "today" | "7d" | "30d" | "90d"

// Parse "91% — high" → 91, else null
function parseAiScore(raw: unknown): number | null {
  if (typeof raw !== "string") return null
  const m = raw.match(/^(\d+)%/)
  if (!m) return null
  const n = parseInt(m[1], 10)
  return Number.isFinite(n) ? n : null
}

// Pull nmc_verification.status safely
function parseNmcStatus(
  raw: unknown
): "verified" | "name_mismatch" | "not_found" | "skipped" | null {
  if (!raw || typeof raw !== "object") return null
  const status = (raw as Record<string, unknown>).status
  if (
    status === "verified" ||
    status === "name_mismatch" ||
    status === "not_found" ||
    status === "skipped"
  ) {
    return status
  }
  return null
}

function rangeStart(range: Range, now: Date): Date {
  const d = new Date(now)
  switch (range) {
    case "today":
      d.setUTCHours(d.getUTCHours() - 24)
      return d
    case "7d":
      d.setDate(d.getDate() - 7)
      return d
    case "90d":
      d.setDate(d.getDate() - 90)
      return d
    case "30d":
    default:
      d.setDate(d.getDate() - 30)
      return d
  }
}

function isoDate(d: Date): string {
  // YYYY-MM-DD in UTC
  return d.toISOString().slice(0, 10)
}

function hourKey(d: Date): string {
  // HH:00 in local-UTC hour
  const h = d.getUTCHours().toString().padStart(2, "0")
  return `${h}:00`
}

function buildBuckets(
  range: Range,
  now: Date
): { keys: string[]; keyFor: (d: Date) => string } {
  if (range === "today") {
    const keys: string[] = []
    // 24 buckets ending at current hour
    const start = new Date(now)
    start.setUTCMinutes(0, 0, 0)
    start.setUTCHours(start.getUTCHours() - 23)
    for (let i = 0; i < 24; i++) {
      const d = new Date(start)
      d.setUTCHours(start.getUTCHours() + i)
      keys.push(hourKey(d))
    }
    return { keys, keyFor: (d: Date) => hourKey(d) }
  }

  const days = range === "7d" ? 7 : range === "90d" ? 90 : 30
  const keys: string[] = []
  const start = new Date(now)
  start.setUTCHours(0, 0, 0, 0)
  start.setUTCDate(start.getUTCDate() - (days - 1))
  for (let i = 0; i < days; i++) {
    const d = new Date(start)
    d.setUTCDate(start.getUTCDate() + i)
    keys.push(isoDate(d))
  }
  return { keys, keyFor: (d: Date) => isoDate(d) }
}

export async function GET(request: Request) {
  try {
    const session = await getAdminSession()
    if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const range = (searchParams.get("range") || "30d") as Range

    const adminName = (session?.name as string | undefined) || (session?.email as string | undefined)?.split("@")[0] || "Admin"

    const supabase = createAdminClient()

    const now = new Date()
    const firstOfMonth = new Date(
      now.getFullYear(),
      now.getMonth(),
      1
    ).toISOString()
    const firstOfLastMonth = new Date(
      now.getFullYear(),
      now.getMonth() - 1,
      1
    ).toISOString()
    const endOfLastMonth = new Date(
      now.getFullYear(),
      now.getMonth(),
      1
    ).toISOString() // exclusive upper bound for last month
    // "Same time last month" — same day-of-month snapshot one month ago
    const sameTimeLastMonth = new Date(now)
    sameTimeLastMonth.setMonth(sameTimeLastMonth.getMonth() - 1)
    const sameTimeLastMonthIso = sameTimeLastMonth.toISOString()

    const rangeFrom = rangeStart(range, now)
    const rangeFromIso = rangeFrom.toISOString()

    // For sparklines — last 8 full weeks
    const eightWeeksAgo = new Date(now)
    eightWeeksAgo.setDate(eightWeeksAgo.getDate() - 7 * 8)
    const eightWeeksAgoIso = eightWeeksAgo.toISOString()

    // Approval time window — last 30 days (rolling) and 30 days prior for trend
    const thirtyDaysAgo = new Date(now)
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
    const thirtyDaysAgoIso = thirtyDaysAgo.toISOString()
    const sixtyDaysAgo = new Date(now)
    sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60)
    const sixtyDaysAgoIso = sixtyDaysAgo.toISOString()

    // Health window
    const twentyFourHoursAgo = new Date(now)
    twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24)
    const twentyFourHoursAgoIso = twentyFourHoursAgo.toISOString()
    const sixHoursAgo = new Date(now)
    sixHoursAgo.setHours(sixHoursAgo.getHours() - 6)
    const sixHoursAgoIso = sixHoursAgo.toISOString()

    const [
      totalMembersRes,
      totalMembersLastMonthRes,
      membersByTypeRes,
      membersSparklineRes,
      recentApplicationsRes,
      pendingApplicationsRes,
      oldestPendingRes,
      incompleteProfilesRes,
      totalPaymentsAllRes,
      paymentsThisMonthRes,
      paymentsLastMonthRes,
      paymentsSparklineRes,
      approvedThisMonthRes,
      approvalTimesRes,
      approvalTimesPriorRes,
      approvalTimesSparklineRes,
      rangeApplicationsRes,
      nmcRecentRes,
    ] = await Promise.all([
      // Total members count (now)
      supabase.from("members").select("*", { count: "exact", head: true }),

      // Total members as of same time last month — filter created_at <= sameTimeLastMonth
      supabase
        .from("members")
        .select("*", { count: "exact", head: true })
        .lte("created_at", sameTimeLastMonthIso),

      // Members by type — 4 parallel count queries to avoid 1000-row cap
      Promise.all([
        supabase.from("members").select("*", { count: "exact", head: true }).eq("membership_type", "LM"),
        supabase.from("members").select("*", { count: "exact", head: true }).eq("membership_type", "ALM"),
        supabase.from("members").select("*", { count: "exact", head: true }).eq("membership_type", "ACM"),
        supabase.from("members").select("*", { count: "exact", head: true }).eq("membership_type", "ILM"),
      ]).then(([lm, alm, acm, ilm]) => ({
        data: { LM: lm.count ?? 0, ALM: alm.count ?? 0, ACM: acm.count ?? 0, ILM: ilm.count ?? 0 },
        error: null,
      })),

      // Members created over last 8 weeks — for weekly cumulative sparkline
      supabase
        .from("members")
        .select("created_at")
        .gte("created_at", eightWeeksAgoIso),

      // Recent 10 applications w/ AI + NMC fields
      supabase
        .from("membership_applications")
        .select(
          "id, reference_number, name, membership_type, status, payment_status, created_at, ai_confidence, nmc_verification"
        )
        .order("created_at", { ascending: false })
        .limit(10),

      // Pending applications count
      supabase
        .from("membership_applications")
        .select("*", { count: "exact", head: true })
        .in("status", ["pending", "submitted", "pending_review"]),

      // Oldest pending application
      supabase
        .from("membership_applications")
        .select("created_at")
        .in("status", ["pending", "submitted", "pending_review"])
        .order("created_at", { ascending: true })
        .limit(1),

      // Members with incomplete profiles
      supabase
        .from("members")
        .select("*", { count: "exact", head: true })
        .or(
          "pg_degree.is.null,mci_council_number.is.null,date_of_birth.is.null,gender.is.null"
        ),

      // All-time payments — bounded to last 365 days
      // Note: uses .range() to handle >1000 rows (Supabase default row limit)
      (async () => {
        const oneYearAgo = new Date()
        oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1)
        const rows: Array<{ amount: unknown }> = []
        let offset = 0
        while (offset < 50000) {
          const { data, error } = await supabase
            .from("membership_payments")
            .select("amount")
            .eq("status", "paid")
            .gte("created_at", oneYearAgo.toISOString())
            .range(offset, offset + 999)
          if (error || !data || data.length === 0) break
          rows.push(...data)
          if (data.length < 1000) break
          offset += 1000
        }
        return { data: rows, error: null }
      })(),

      // This month's payments
      supabase
        .from("membership_payments")
        .select("amount")
        .eq("status", "paid")
        .gte("created_at", firstOfMonth)
        .range(0, 999),

      // Last month's payments (for trend)
      supabase
        .from("membership_payments")
        .select("amount")
        .eq("status", "paid")
        .gte("created_at", firstOfLastMonth)
        .lt("created_at", endOfLastMonth)
        .range(0, 999),

      // Payments over last 8 weeks for sparkline
      (async () => {
        const rows: Array<{ amount: unknown; created_at: string }> = []
        let offset = 0
        while (offset < 50000) {
          const { data, error } = await supabase
            .from("membership_payments")
            .select("amount, created_at")
            .eq("status", "paid")
            .gte("created_at", eightWeeksAgoIso)
            .range(offset, offset + 999)
          if (error || !data || data.length === 0) break
          rows.push(...data)
          if (data.length < 1000) break
          offset += 1000
        }
        return { data: rows, error: null }
      })(),

      // Approved applications this month
      supabase
        .from("membership_applications")
        .select("*", { count: "exact", head: true })
        .in("status", ["approved", "ai_approved"])
        .gte("created_at", firstOfMonth),

      // Approval times over last 30d — need created_at + updated_at for approved apps
      supabase
        .from("membership_applications")
        .select("created_at, updated_at, status")
        .in("status", ["approved", "ai_approved"])
        .gte("updated_at", thirtyDaysAgoIso),

      // Approval times 30-60d ago for trend comparison
      supabase
        .from("membership_applications")
        .select("created_at, updated_at, status")
        .in("status", ["approved", "ai_approved"])
        .gte("updated_at", sixtyDaysAgoIso)
        .lt("updated_at", thirtyDaysAgoIso),

      // Approval times over last 8 weeks for sparkline
      supabase
        .from("membership_applications")
        .select("created_at, updated_at, status")
        .in("status", ["approved", "ai_approved"])
        .gte("updated_at", eightWeeksAgoIso),

      // All applications within the requested range for timeseries + funnel
      supabase
        .from("membership_applications")
        .select(
          "id, status, created_at, updated_at, needs_manual_review, ai_confidence, nmc_verification"
        )
        .gte("created_at", rangeFromIso),

      // NMC verifications in last 24h for health heuristic
      supabase
        .from("membership_applications")
        .select("nmc_verification, updated_at")
        .gte("updated_at", twentyFourHoursAgoIso)
        .not("nmc_verification", "is", null),
    ])

    // Members by type — from parallel count queries (no 1000-row cap)
    const typeData = (membersByTypeRes.data ?? { LM: 0, ALM: 0, ACM: 0, ILM: 0 }) as Record<string, number>
    const membersByType = {
      LM: typeData.LM || 0,
      ALM: typeData.ALM || 0,
      ACM: typeData.ACM || 0,
      ILM: typeData.ILM || 0,
    }

    const totalMembers = totalMembersRes.count ?? 0
    const totalMembersLastMonth = totalMembersLastMonthRes.count ?? 0

    // Trend vs same time last month
    const membersDelta = totalMembers - totalMembersLastMonth
    const membersDeltaPct =
      totalMembersLastMonth > 0
        ? (membersDelta / totalMembersLastMonth) * 100
        : totalMembers > 0
        ? 100
        : 0
    const totalMembersTrend = {
      deltaPct: Math.round(membersDeltaPct * 10) / 10,
      positive: membersDelta >= 0,
    }

    // Members sparkline — weekly cumulative counts for last 8 weeks
    const totalMembersSparkline: number[] = (() => {
      const rows = (membersSparklineRes.data || []) as Array<{
        created_at: string
      }>
      // Weekly buckets: count of new members per week, then cumulative over an 8-week window.
      const weekBuckets: number[] = new Array(8).fill(0)
      const weekStart = new Date(now)
      weekStart.setUTCHours(0, 0, 0, 0)
      weekStart.setUTCDate(weekStart.getUTCDate() - 7 * 8)
      for (const row of rows) {
        const t = new Date(row.created_at).getTime()
        const diffDays = Math.floor(
          (t - weekStart.getTime()) / (1000 * 60 * 60 * 24)
        )
        const idx = Math.floor(diffDays / 7)
        if (idx >= 0 && idx < 8) weekBuckets[idx]++
      }
      // Start from (totalMembers - all new in 8w) and accumulate
      const newInWindow = weekBuckets.reduce((a, b) => a + b, 0)
      let running = totalMembers - newInWindow
      const out: number[] = []
      for (const w of weekBuckets) {
        running += w
        out.push(running)
      }
      return out
    })()

    // Oldest pending age
    const pendingApplicationsCount = pendingApplicationsRes.count ?? 0
    let pendingOldestHours = 0
    const oldestPendingRow = oldestPendingRes.data?.[0] as
      | { created_at: string }
      | undefined
    if (oldestPendingRow?.created_at) {
      const ageMs = now.getTime() - new Date(oldestPendingRow.created_at).getTime()
      pendingOldestHours = Math.max(0, Math.round(ageMs / (1000 * 60 * 60)))
    }

    // Revenue
    const sumAmount = (rows: Array<{ amount: unknown }> | null | undefined) => {
      if (!rows) return 0
      let s = 0
      for (const r of rows) s += Number(r.amount) || 0
      return s
    }
    const revenueAllTime = sumAmount(totalPaymentsAllRes.data as any)
    const revenueThisMonth = sumAmount(paymentsThisMonthRes.data as any)
    const revenueLastMonth = sumAmount(paymentsLastMonthRes.data as any)
    const revenueDelta = revenueThisMonth - revenueLastMonth
    const revenueDeltaPct =
      revenueLastMonth > 0
        ? (revenueDelta / revenueLastMonth) * 100
        : revenueThisMonth > 0
        ? 100
        : 0
    const revenueTrend = {
      deltaPct: Math.round(revenueDeltaPct * 10) / 10,
      positive: revenueDelta >= 0,
    }

    // Revenue sparkline — 8 weekly sums
    const revenueSparkline: number[] = (() => {
      const rows = (paymentsSparklineRes.data || []) as Array<{
        amount: unknown
        created_at: string
      }>
      const weekBuckets: number[] = new Array(8).fill(0)
      const weekStart = new Date(now)
      weekStart.setUTCHours(0, 0, 0, 0)
      weekStart.setUTCDate(weekStart.getUTCDate() - 7 * 8)
      for (const row of rows) {
        const t = new Date(row.created_at).getTime()
        const diffDays = Math.floor(
          (t - weekStart.getTime()) / (1000 * 60 * 60 * 24)
        )
        const idx = Math.floor(diffDays / 7)
        if (idx >= 0 && idx < 8) weekBuckets[idx] += Number(row.amount) || 0
      }
      return weekBuckets
    })()

    // Approval time metrics — use (updated_at - created_at) as proxy for time-to-approve
    const meanHours = (
      rows: Array<{ created_at: string; updated_at: string | null }> | null
    ) => {
      if (!rows || rows.length === 0) return 0
      let total = 0
      let n = 0
      for (const r of rows) {
        if (!r.updated_at) continue
        const dur =
          new Date(r.updated_at).getTime() - new Date(r.created_at).getTime()
        if (dur >= 0) {
          total += dur
          n++
        }
      }
      if (n === 0) return 0
      return total / n / (1000 * 60 * 60)
    }
    const avgApprovalHoursRaw = meanHours(approvalTimesRes.data as any)
    const avgApprovalHoursPrior = meanHours(approvalTimesPriorRes.data as any)
    const avgApprovalHours = Math.round(avgApprovalHoursRaw * 10) / 10
    // Lower is better → positive = improvement (current < prior)
    const approvalDelta = avgApprovalHoursRaw - avgApprovalHoursPrior
    const approvalDeltaPct =
      avgApprovalHoursPrior > 0
        ? (approvalDelta / avgApprovalHoursPrior) * 100
        : 0
    const avgApprovalTrend = {
      deltaPct: Math.round(approvalDeltaPct * 10) / 10,
      positive: approvalDelta <= 0, // lower is better
    }

    // Approval sparkline — 8 weekly averages
    const avgApprovalSparkline: number[] = (() => {
      const rows = (approvalTimesSparklineRes.data || []) as Array<{
        created_at: string
        updated_at: string | null
      }>
      const weekTotals: number[] = new Array(8).fill(0)
      const weekCounts: number[] = new Array(8).fill(0)
      const weekStart = new Date(now)
      weekStart.setUTCHours(0, 0, 0, 0)
      weekStart.setUTCDate(weekStart.getUTCDate() - 7 * 8)
      for (const row of rows) {
        if (!row.updated_at) continue
        const t = new Date(row.updated_at).getTime()
        const diffDays = Math.floor(
          (t - weekStart.getTime()) / (1000 * 60 * 60 * 24)
        )
        const idx = Math.floor(diffDays / 7)
        if (idx < 0 || idx >= 8) continue
        const dur =
          new Date(row.updated_at).getTime() -
          new Date(row.created_at).getTime()
        if (dur < 0) continue
        weekTotals[idx] += dur / (1000 * 60 * 60)
        weekCounts[idx]++
      }
      return weekTotals.map((t, i) =>
        weekCounts[i] > 0 ? Math.round((t / weekCounts[i]) * 10) / 10 : 0
      )
    })()

    // Timeseries + funnel over requested range
    const { keys, keyFor } = buildBuckets(range, now)
    const tsMap = new Map<
      string,
      { submitted: number; approved: number; manual: number }
    >()
    for (const k of keys) {
      tsMap.set(k, { submitted: 0, approved: 0, manual: 0 })
    }

    let funnelSubmitted = 0
    let funnelAutoApproved = 0
    let funnelManualReview = 0
    let funnelMidScore = 0
    let funnelLowScore = 0
    let funnelNmcSkipped = 0

    const rangeApps = (rangeApplicationsRes.data || []) as Array<{
      id: string
      status: string
      created_at: string
      updated_at: string | null
      needs_manual_review: boolean | null
      ai_confidence: string | null
      nmc_verification: unknown
    }>

    for (const app of rangeApps) {
      const submittedAt = new Date(app.created_at)
      const submittedKey = keyFor(submittedAt)
      const submittedBucket = tsMap.get(submittedKey)
      if (submittedBucket) submittedBucket.submitted++

      if (app.status === "approved" || app.status === "ai_approved") {
        const approvedAt = app.updated_at
          ? new Date(app.updated_at)
          : submittedAt
        const approvedKey = keyFor(approvedAt)
        const approvedBucket = tsMap.get(approvedKey)
        if (approvedBucket) approvedBucket.approved++
      }

      const isManual =
        app.needs_manual_review === true ||
        app.status === "pending_review" ||
        app.status === "need_clarification"
      if (isManual) {
        const manualKey = keyFor(app.updated_at ? new Date(app.updated_at) : submittedAt)
        const manualBucket = tsMap.get(manualKey)
        if (manualBucket) manualBucket.manual++
      }

      // Funnel
      funnelSubmitted++
      if (app.status === "ai_approved") funnelAutoApproved++
      if (isManual) funnelManualReview++

      const score = parseAiScore(app.ai_confidence)
      if (score !== null) {
        if (score >= 50 && score < 80) funnelMidScore++
        else if (score < 50) funnelLowScore++
      }

      if (parseNmcStatus(app.nmc_verification) === "skipped") {
        funnelNmcSkipped++
      }
    }

    const timeseries = keys.map((k) => {
      const v = tsMap.get(k) || { submitted: 0, approved: 0, manual: 0 }
      return { date: k, ...v }
    })

    // Recent applications — parse AI score + NMC
    const recentApplications = (recentApplicationsRes.data || []).map(
      (row: any) => ({
        id: row.id,
        reference_number: row.reference_number,
        name: row.name,
        membership_type: row.membership_type,
        status: row.status,
        payment_status: row.payment_status,
        created_at: row.created_at,
        ai_score: parseAiScore(row.ai_confidence),
        nmc_status: parseNmcStatus(row.nmc_verification),
      })
    )

    // System health — NMC heuristic
    const nmcRecent = (nmcRecentRes.data || []) as Array<{
      nmc_verification: unknown
      updated_at: string
    }>
    let nmcVerifiedLast24 = 0
    let nmcDegradedLast24 = 0
    let nmcAttemptsLast6h = 0
    let nmcSkippedLast6h = 0
    for (const row of nmcRecent) {
      const status = parseNmcStatus(row.nmc_verification)
      if (!status) continue
      if (status === "verified") nmcVerifiedLast24++
      if (status === "name_mismatch" || status === "not_found") {
        nmcDegradedLast24++
      }
      const updatedMs = new Date(row.updated_at).getTime()
      if (updatedMs >= new Date(sixHoursAgoIso).getTime()) {
        nmcAttemptsLast6h++
        if (status === "skipped") nmcSkippedLast6h++
      }
    }
    let nmcHealth: "ok" | "degraded" | "down" = "ok"
    if (nmcAttemptsLast6h > 0 && nmcSkippedLast6h === nmcAttemptsLast6h) {
      nmcHealth = "down"
    } else if (nmcVerifiedLast24 > 0) {
      nmcHealth = "ok"
    } else if (nmcDegradedLast24 > 0) {
      nmcHealth = "degraded"
    }

    // Health checks: basic liveness assumed — implement per-service pings when needed
    const systemHealth = {
      nmc: nmcHealth,
      email: "ok" as const,
      razorpay: "ok" as const,
      webhooks: "ok" as const,
    }

    return Response.json({
      status: true,
      data: {
        adminName,
        // KPI 1: Total Members
        totalMembers,
        totalMembersTrend,
        totalMembersSparkline,

        // KPI 2: Pending
        pendingApplicationsCount,
        pendingOldestHours,

        // KPI 3: Revenue
        revenueThisMonth,
        revenueTrend,
        revenueSparkline,
        revenueAllTime,

        // KPI 4: Avg approval
        avgApprovalHours,
        avgApprovalTrend,
        avgApprovalSparkline,

        // Distribution
        membersByType,

        // Time-series
        timeseries,

        // Funnel
        funnel: {
          submitted: funnelSubmitted,
          autoApproved: funnelAutoApproved,
          manualReview: funnelManualReview,
          midScore: funnelMidScore,
          lowScore: funnelLowScore,
          nmcSkipped: funnelNmcSkipped,
        },

        // Recent apps
        recentApplications,

        // System health
        systemHealth,

        // Legacy fields (backward compat)
        incompleteProfilesCount: incompleteProfilesRes.count ?? 0,
        totalPayments: revenueAllTime,
        approvedThisMonth: approvedThisMonthRes.count ?? 0,
      },
    })
  } catch (error: any) {
    console.error("Dashboard API error:", error)
    return Response.json(
      { status: false, message: "Failed to load dashboard stats" },
      { status: 500 }
    )
  }
}
