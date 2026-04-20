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

function formatHours(hours: number): string {
  if (hours === 0) return "--"
  if (hours < 1) return `${Math.round(hours * 60)}m`
  if (hours < 24) return `${Math.round(hours * 10) / 10}h`
  return `${Math.round((hours / 24) * 10) / 10}d`
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

function getRangeLabel(range: string | null): string {
  if (range === "30d") return "Last 30 Days"
  if (range === "90d") return "Last 90 Days"
  if (range === "year") return "This Year"
  return "All Time"
}

export async function GET(request: Request) {
  try {
    const session = await getAdminSession()
    if (!session) {
      return new Response("Unauthorized", { status: 401 })
    }

    const supabase = createAdminClient()
    const { searchParams } = new URL(request.url)
    const range = searchParams.get("range")

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

    // Fetch members, applications, payments in parallel
    const [memberRows, applicationRows, paymentRows] = await Promise.all([
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
    ])

    // ── Member aggregations ──

    const zoneCounts: Record<string, number> = {}
    for (const m of memberRows) {
      if (m.zone) zoneCounts[m.zone] = (zoneCounts[m.zone] || 0) + 1
    }
    const zoneData = Object.entries(zoneCounts)
      .map(([zone, count]) => ({ zone, count }))
      .sort((a, b) => b.count - a.count)

    const stateCounts: Record<string, number> = {}
    for (const m of memberRows) {
      if (m.state) stateCounts[m.state] = (stateCounts[m.state] || 0) + 1
    }
    const stateData = Object.entries(stateCounts)
      .map(([state, count]) => ({ state, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 15)

    const typeCounts: Record<string, number> = {}
    for (const m of memberRows) {
      const t = m.membership_type || "Unknown"
      typeCounts[t] = (typeCounts[t] || 0) + 1
    }
    const typeData = Object.entries(typeCounts)
      .map(([membership_type, count]) => ({ membership_type, count }))
      .sort((a, b) => b.count - a.count)

    // ── Application pipeline ──

    const totalApplications = applicationRows.length
    const statusCounts: Record<string, number> = {}
    let totalApprovalHours = 0
    let approvalCount = 0
    let aiAutoApproved = 0
    let manualReviewCount = 0

    for (const app of applicationRows) {
      const s = app.status || "unknown"
      statusCounts[s] = (statusCounts[s] || 0) + 1
      if (s === "ai_approved") aiAutoApproved++
      if (app.needs_manual_review) manualReviewCount++
      if ((s === "approved" || s === "ai_approved") && app.created_at && app.updated_at) {
        const dur = new Date(app.updated_at).getTime() - new Date(app.created_at).getTime()
        if (dur >= 0) {
          totalApprovalHours += dur / (1000 * 60 * 60)
          approvalCount++
        }
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

    // ── Revenue ──

    let totalRevenue = 0
    let paidCount = 0
    let failedCount = 0

    for (const p of paymentRows) {
      const s = p.status || "unknown"
      if (s === "paid") {
        totalRevenue += Number(p.amount) || 0
        paidCount++
      } else if (s === "failed") {
        failedCount++
      }
    }

    const avgPaymentAmount = paidCount > 0
      ? Math.round((totalRevenue / paidCount) * 100) / 100
      : 0

    // ── Build HTML ──

    const totalMembers = memberRows.length
    const generatedDate = new Date().toLocaleDateString("en-IN", {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
    const rangeLabel = getRangeLabel(range)

    const statusLabels: Record<string, string> = {
      approved: "Approved",
      ai_approved: "AI Approved",
      pending: "Pending",
      submitted: "Submitted",
      pending_review: "Pending Review",
      rejected: "Rejected",
      need_clarification: "Need Clarification",
    }

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AMASI Membership Report - ${escapeHtml(rangeLabel)}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      color: #1e293b;
      line-height: 1.6;
      background: #fff;
      padding: 40px;
      max-width: 900px;
      margin: 0 auto;
    }
    .no-print { display: block; }
    .print-btn {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      background: #0d9488;
      color: #fff;
      border: none;
      padding: 10px 24px;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      margin-bottom: 32px;
      transition: background 0.2s;
    }
    .print-btn:hover { background: #0f766e; }
    .header {
      border-bottom: 3px solid #0d9488;
      padding-bottom: 20px;
      margin-bottom: 32px;
    }
    .header-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 8px;
    }
    .logo {
      font-size: 28px;
      font-weight: 800;
      color: #0d9488;
      letter-spacing: -0.5px;
    }
    .report-title {
      font-size: 22px;
      font-weight: 700;
      color: #1e293b;
    }
    .report-meta {
      color: #64748b;
      font-size: 13px;
    }
    .section {
      margin-bottom: 28px;
    }
    .section-title {
      font-size: 16px;
      font-weight: 700;
      color: #0d9488;
      margin-bottom: 12px;
      padding-bottom: 6px;
      border-bottom: 1px solid #e2e8f0;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
      margin-bottom: 4px;
    }
    th {
      background: #f0fdfa;
      color: #0f766e;
      font-weight: 600;
      text-align: left;
      padding: 8px 12px;
      border-bottom: 2px solid #0d9488;
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }
    td {
      padding: 7px 12px;
      border-bottom: 1px solid #e2e8f0;
    }
    tr:last-child td { border-bottom: none; }
    tr:hover td { background: #f8fafc; }
    .num { text-align: right; font-variant-numeric: tabular-nums; }
    .summary-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 16px;
      margin-bottom: 28px;
    }
    .summary-card {
      background: #f0fdfa;
      border: 1px solid #ccfbf1;
      border-radius: 10px;
      padding: 16px;
      text-align: center;
    }
    .summary-card .label {
      font-size: 11px;
      font-weight: 600;
      color: #64748b;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 4px;
    }
    .summary-card .value {
      font-size: 24px;
      font-weight: 800;
      color: #0d9488;
    }
    .summary-card .sub {
      font-size: 11px;
      color: #94a3b8;
      margin-top: 2px;
    }
    .two-col {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 24px;
    }
    .footer {
      margin-top: 40px;
      padding-top: 16px;
      border-top: 2px solid #e2e8f0;
      text-align: center;
      color: #94a3b8;
      font-size: 11px;
    }
    @media print {
      body { padding: 20px; font-size: 12px; }
      .no-print { display: none !important; }
      .header { margin-bottom: 20px; padding-bottom: 12px; }
      .section { margin-bottom: 18px; page-break-inside: avoid; }
      .summary-grid { gap: 10px; margin-bottom: 18px; }
      .summary-card { padding: 10px; }
      .summary-card .value { font-size: 20px; }
      .two-col { gap: 16px; }
      table { font-size: 11px; }
      th { padding: 6px 8px; }
      td { padding: 5px 8px; }
      tr:hover td { background: none; }
      .footer { margin-top: 24px; }
    }
    @media print and (color) {
      .summary-card { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      th { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
  </style>
</head>
<body>
  <div class="no-print">
    <button class="print-btn" onclick="window.print()">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
      Print / Save as PDF
    </button>
  </div>

  <div class="header">
    <div class="header-top">
      <span class="logo">AMASI</span>
      <span class="report-title">Membership Report</span>
    </div>
    <div class="report-meta">
      Period: ${escapeHtml(rangeLabel)} &nbsp;|&nbsp; Generated: ${escapeHtml(generatedDate)}
    </div>
  </div>

  <div class="summary-grid">
    <div class="summary-card">
      <div class="label">Total Members</div>
      <div class="value">${totalMembers.toLocaleString()}</div>
    </div>
    <div class="summary-card">
      <div class="label">Approval Rate</div>
      <div class="value">${approvalRate}%</div>
      <div class="sub">${approved.toLocaleString()} of ${closedApplications.toLocaleString()} closed</div>
    </div>
    <div class="summary-card">
      <div class="label">Avg Processing</div>
      <div class="value">${escapeHtml(formatHours(avgProcessingHours))}</div>
      <div class="sub">Submit to approval</div>
    </div>
    <div class="summary-card">
      <div class="label">Revenue</div>
      <div class="value">${paidCount > 0 ? `&#8377;${Math.round(totalRevenue).toLocaleString()}` : "--"}</div>
      <div class="sub">${paidCount.toLocaleString()} paid${failedCount > 0 ? `, ${failedCount} failed` : ""}</div>
    </div>
  </div>

  <div class="section">
    <div class="section-title">Membership Type Breakdown</div>
    <table>
      <thead>
        <tr>
          <th>Type</th>
          <th class="num">Members</th>
          <th class="num">Share</th>
        </tr>
      </thead>
      <tbody>
        ${typeData.map((t) => {
          const pct = totalMembers > 0 ? ((t.count / totalMembers) * 100).toFixed(1) : "0"
          return `<tr><td>${escapeHtml(t.membership_type)}</td><td class="num">${t.count.toLocaleString()}</td><td class="num">${pct}%</td></tr>`
        }).join("\n        ")}
      </tbody>
    </table>
  </div>

  <div class="section">
    <div class="section-title">Top 15 States</div>
    <table>
      <thead>
        <tr>
          <th>#</th>
          <th>State</th>
          <th class="num">Members</th>
          <th class="num">Share</th>
        </tr>
      </thead>
      <tbody>
        ${stateData.map((s, i) => {
          const pct = totalMembers > 0 ? ((s.count / totalMembers) * 100).toFixed(1) : "0"
          return `<tr><td>${i + 1}</td><td>${escapeHtml(s.state)}</td><td class="num">${s.count.toLocaleString()}</td><td class="num">${pct}%</td></tr>`
        }).join("\n        ")}
      </tbody>
    </table>
  </div>

  <div class="section">
    <div class="section-title">Zone Distribution</div>
    <table>
      <thead>
        <tr>
          <th>Zone</th>
          <th class="num">Members</th>
          <th class="num">Share</th>
        </tr>
      </thead>
      <tbody>
        ${zoneData.map((z) => {
          const pct = totalMembers > 0 ? ((z.count / totalMembers) * 100).toFixed(1) : "0"
          return `<tr><td>${escapeHtml(z.zone)}</td><td class="num">${z.count.toLocaleString()}</td><td class="num">${pct}%</td></tr>`
        }).join("\n        ")}
      </tbody>
    </table>
  </div>

  <div class="section">
    <div class="section-title">Application Pipeline</div>
    <table>
      <thead>
        <tr>
          <th>Metric</th>
          <th class="num">Value</th>
        </tr>
      </thead>
      <tbody>
        <tr><td>Total Applications</td><td class="num">${totalApplications.toLocaleString()}</td></tr>
        <tr><td>Approved (incl. AI)</td><td class="num">${approved.toLocaleString()}</td></tr>
        <tr><td>Rejected</td><td class="num">${rejected.toLocaleString()}</td></tr>
        <tr><td>Pending</td><td class="num">${pending.toLocaleString()}</td></tr>
        <tr><td>Need Clarification</td><td class="num">${needClarification.toLocaleString()}</td></tr>
        <tr><td>AI Auto-Approved</td><td class="num">${aiAutoApproved.toLocaleString()}</td></tr>
        <tr><td>Manual Review</td><td class="num">${manualReviewCount.toLocaleString()}</td></tr>
        <tr><td>Approval Rate</td><td class="num">${approvalRate}%</td></tr>
        <tr><td>Avg Processing Time</td><td class="num">${escapeHtml(formatHours(avgProcessingHours))}</td></tr>
      </tbody>
    </table>
  </div>

  ${Object.keys(statusCounts).length > 0 ? `
  <div class="section">
    <div class="section-title">Application Status Breakdown</div>
    <table>
      <thead>
        <tr>
          <th>Status</th>
          <th class="num">Count</th>
          <th class="num">Share</th>
        </tr>
      </thead>
      <tbody>
        ${Object.entries(statusCounts)
          .sort((a, b) => b[1] - a[1])
          .map(([status, count]) => {
            const label = statusLabels[status] || status
            const pct = totalApplications > 0 ? ((count / totalApplications) * 100).toFixed(1) : "0"
            return `<tr><td>${escapeHtml(label)}</td><td class="num">${count.toLocaleString()}</td><td class="num">${pct}%</td></tr>`
          }).join("\n        ")}
      </tbody>
    </table>
  </div>
  ` : ""}

  ${paidCount > 0 ? `
  <div class="section">
    <div class="section-title">Revenue Summary</div>
    <table>
      <thead>
        <tr>
          <th>Metric</th>
          <th class="num">Value</th>
        </tr>
      </thead>
      <tbody>
        <tr><td>Total Revenue</td><td class="num">&#8377;${Math.round(totalRevenue).toLocaleString()}</td></tr>
        <tr><td>Paid Transactions</td><td class="num">${paidCount.toLocaleString()}</td></tr>
        <tr><td>Failed Transactions</td><td class="num">${failedCount.toLocaleString()}</td></tr>
        <tr><td>Avg Payment Amount</td><td class="num">&#8377;${avgPaymentAmount.toLocaleString()}</td></tr>
      </tbody>
    </table>
  </div>
  ` : ""}

  <div class="footer">
    Generated on ${escapeHtml(generatedDate)} &nbsp;|&nbsp; AMASI Membership System
  </div>
</body>
</html>`

    return new Response(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      },
    })
  } catch (err) {
    console.error("Reports PDF API error:", err)
    return new Response("Failed to generate report", { status: 500 })
  }
}
