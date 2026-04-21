import { NextRequest } from "next/server"
import { createAdminClient } from "@/lib/supabase"
import { getAdminSession } from "@/lib/auth"
import { Resend } from "resend"
import { escapeHtml } from "@/lib/html-escape"

function getResend() {
  const key = process.env.RESEND_API_KEY?.trim()
  if (!key) throw new Error("RESEND_API_KEY not configured")
  return new Resend(key)
}

const baseUrl =
  process.env.NEXT_PUBLIC_APP_URL || "https://membership.amasi.org"

interface WeeklyMetrics {
  totalMembers: number
  newMembersThisWeek: number
  newMembersLastWeek: number
  pendingApplications: number
  openTickets: number
  revenueThisWeek: number
  revenueLastWeek: number
  slaBreachesThisWeek: number
  slaBreachesLastWeek: number
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount)
}

function delta(current: number, previous: number): string {
  const diff = current - previous
  if (diff === 0) return '<span style="color:#6b7280;">0</span>'
  const sign = diff > 0 ? "+" : ""
  const color = diff > 0 ? "#16a34a" : "#dc2626"
  return `<span style="color:${color};font-weight:600;">${sign}${diff}</span>`
}

function deltaCurrency(current: number, previous: number): string {
  const diff = current - previous
  if (diff === 0) return '<span style="color:#6b7280;">--</span>'
  const sign = diff > 0 ? "+" : "-"
  const color = diff > 0 ? "#16a34a" : "#dc2626"
  return `<span style="color:${color};font-weight:600;">${sign}${formatCurrency(Math.abs(diff))}</span>`
}

function buildEmailHtml(metrics: WeeklyMetrics, weekOfDate: string): string {
  const safeDate = escapeHtml(weekOfDate)

  return `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8" /></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:Arial,sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:32px 16px;">
    <!-- Header -->
    <div style="text-align:center;margin-bottom:32px;">
      <h1 style="color:#0f766e;margin:0;font-size:28px;">AMASI</h1>
      <p style="color:#6b7280;font-size:13px;margin:4px 0 0;">Association of Minimal Access Surgeons of India</p>
    </div>

    <!-- Card -->
    <div style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
      <!-- Title bar -->
      <div style="background:#0f766e;padding:20px 24px;">
        <h2 style="color:#ffffff;margin:0;font-size:20px;">Weekly Digest</h2>
        <p style="color:#bbf7d0;margin:4px 0 0;font-size:14px;">Week of ${safeDate}</p>
      </div>

      <!-- KPI Table -->
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
        <thead>
          <tr style="background:#f8fafc;">
            <th style="text-align:left;padding:12px 24px;font-size:12px;text-transform:uppercase;color:#6b7280;letter-spacing:0.5px;border-bottom:1px solid #e5e7eb;">Metric</th>
            <th style="text-align:right;padding:12px 24px;font-size:12px;text-transform:uppercase;color:#6b7280;letter-spacing:0.5px;border-bottom:1px solid #e5e7eb;">Value</th>
            <th style="text-align:right;padding:12px 24px;font-size:12px;text-transform:uppercase;color:#6b7280;letter-spacing:0.5px;border-bottom:1px solid #e5e7eb;">vs Last Week</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style="padding:14px 24px;border-bottom:1px solid #f1f5f9;color:#1e293b;font-size:14px;">Total Members</td>
            <td style="padding:14px 24px;border-bottom:1px solid #f1f5f9;text-align:right;font-weight:700;font-size:16px;color:#0f766e;">${metrics.totalMembers.toLocaleString("en-IN")}</td>
            <td style="padding:14px 24px;border-bottom:1px solid #f1f5f9;text-align:right;font-size:14px;">--</td>
          </tr>
          <tr style="background:#f8fafc;">
            <td style="padding:14px 24px;border-bottom:1px solid #f1f5f9;color:#1e293b;font-size:14px;">New Members</td>
            <td style="padding:14px 24px;border-bottom:1px solid #f1f5f9;text-align:right;font-weight:700;font-size:16px;color:#1e293b;">${metrics.newMembersThisWeek}</td>
            <td style="padding:14px 24px;border-bottom:1px solid #f1f5f9;text-align:right;font-size:14px;">${delta(metrics.newMembersThisWeek, metrics.newMembersLastWeek)}</td>
          </tr>
          <tr>
            <td style="padding:14px 24px;border-bottom:1px solid #f1f5f9;color:#1e293b;font-size:14px;">Pending Applications</td>
            <td style="padding:14px 24px;border-bottom:1px solid #f1f5f9;text-align:right;font-weight:700;font-size:16px;color:#1e293b;">${metrics.pendingApplications}</td>
            <td style="padding:14px 24px;border-bottom:1px solid #f1f5f9;text-align:right;font-size:14px;">--</td>
          </tr>
          <tr style="background:#f8fafc;">
            <td style="padding:14px 24px;border-bottom:1px solid #f1f5f9;color:#1e293b;font-size:14px;">Open Support Tickets</td>
            <td style="padding:14px 24px;border-bottom:1px solid #f1f5f9;text-align:right;font-weight:700;font-size:16px;color:#1e293b;">${metrics.openTickets}</td>
            <td style="padding:14px 24px;border-bottom:1px solid #f1f5f9;text-align:right;font-size:14px;">--</td>
          </tr>
          <tr>
            <td style="padding:14px 24px;border-bottom:1px solid #f1f5f9;color:#1e293b;font-size:14px;">Revenue This Week</td>
            <td style="padding:14px 24px;border-bottom:1px solid #f1f5f9;text-align:right;font-weight:700;font-size:16px;color:#0f766e;">${formatCurrency(metrics.revenueThisWeek)}</td>
            <td style="padding:14px 24px;border-bottom:1px solid #f1f5f9;text-align:right;font-size:14px;">${deltaCurrency(metrics.revenueThisWeek, metrics.revenueLastWeek)}</td>
          </tr>
          <tr style="background:#f8fafc;">
            <td style="padding:14px 24px;color:#1e293b;font-size:14px;">SLA Breaches</td>
            <td style="padding:14px 24px;text-align:right;font-weight:700;font-size:16px;color:${metrics.slaBreachesThisWeek > 0 ? "#dc2626" : "#1e293b"};">${metrics.slaBreachesThisWeek}</td>
            <td style="padding:14px 24px;text-align:right;font-size:14px;">${delta(metrics.slaBreachesThisWeek, metrics.slaBreachesLastWeek)}</td>
          </tr>
        </tbody>
      </table>

      <!-- CTA buttons -->
      <div style="padding:24px;text-align:center;">
        <a href="${baseUrl}/" style="display:inline-block;background:#0f766e;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:8px;font-size:14px;font-weight:600;margin:0 6px;">View Dashboard</a>
        <a href="${baseUrl}/reports" style="display:inline-block;background:#f1f5f9;color:#0f766e;text-decoration:none;padding:12px 24px;border-radius:8px;font-size:14px;font-weight:600;margin:0 6px;">Full Reports</a>
      </div>
    </div>

    <!-- Footer -->
    <div style="text-align:center;margin-top:24px;">
      <p style="color:#9ca3af;font-size:12px;margin:0;">This is an automated weekly digest from AMASI Membership Portal.</p>
      <p style="color:#9ca3af;font-size:12px;margin:4px 0 0;">Association of Minimal Access Surgeons of India</p>
    </div>
  </div>
</body>
</html>`
}

async function fetchMetrics(supabase: ReturnType<typeof createAdminClient>): Promise<WeeklyMetrics> {
  const now = new Date()
  const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
  const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000)
  const oneWeekAgoISO = oneWeekAgo.toISOString()
  const twoWeeksAgoISO = twoWeeksAgo.toISOString()
  const nowISO = now.toISOString()

  // Run all queries in parallel
  const [
    totalMembersRes,
    newThisWeekRes,
    newLastWeekRes,
    pendingRes,
    openTicketsRes,
    revenueThisWeekRes,
    revenueLastWeekRes,
    slaThisWeekRes,
    slaLastWeekRes,
  ] = await Promise.all([
    // Total members
    supabase.from("members").select("*", { count: "exact", head: true }),

    // New members this week
    supabase
      .from("members")
      .select("*", { count: "exact", head: true })
      .gte("created_at", oneWeekAgoISO),

    // New members last week
    supabase
      .from("members")
      .select("*", { count: "exact", head: true })
      .gte("created_at", twoWeeksAgoISO)
      .lt("created_at", oneWeekAgoISO),

    // Pending applications
    supabase
      .from("membership_applications")
      .select("*", { count: "exact", head: true })
      .eq("status", "pending"),

    // Open support tickets
    supabase
      .from("support_tickets")
      .select("*", { count: "exact", head: true })
      .in("status", ["open", "in_progress"]),

    // Revenue this week (paid payments)
    supabase
      .from("membership_payments")
      .select("amount")
      .eq("status", "paid")
      .gte("created_at", oneWeekAgoISO),

    // Revenue last week
    supabase
      .from("membership_payments")
      .select("amount")
      .eq("status", "paid")
      .gte("created_at", twoWeeksAgoISO)
      .lt("created_at", oneWeekAgoISO),

    // SLA breaches this week
    supabase
      .from("support_tickets")
      .select("*", { count: "exact", head: true })
      .eq("sla_breached", true)
      .gte("updated_at", oneWeekAgoISO),

    // SLA breaches last week
    supabase
      .from("support_tickets")
      .select("*", { count: "exact", head: true })
      .eq("sla_breached", true)
      .gte("updated_at", twoWeeksAgoISO)
      .lt("updated_at", oneWeekAgoISO),
  ])

  const sumAmount = (rows: { amount: number }[] | null) =>
    (rows || []).reduce((acc, r) => acc + (r.amount || 0), 0)

  return {
    totalMembers: totalMembersRes.count || 0,
    newMembersThisWeek: newThisWeekRes.count || 0,
    newMembersLastWeek: newLastWeekRes.count || 0,
    pendingApplications: pendingRes.count || 0,
    openTickets: openTicketsRes.count || 0,
    revenueThisWeek: sumAmount(revenueThisWeekRes.data as { amount: number }[] | null),
    revenueLastWeek: sumAmount(revenueLastWeekRes.data as { amount: number }[] | null),
    slaBreachesThisWeek: slaThisWeekRes.count || 0,
    slaBreachesLastWeek: slaLastWeekRes.count || 0,
  }
}

export async function GET(request: NextRequest) {
  const isTestMode = request.nextUrl.searchParams.get("test") === "1"

  // Auth: either CRON_SECRET bearer token or admin session (test mode)
  if (isTestMode) {
    const session = await getAdminSession()
    if (!session || session.adminRole !== "super_admin") {
      return Response.json({ error: "Unauthorized -- super admin only" }, { status: 401 })
    }
  } else {
    if (!process.env.CRON_SECRET) {
      console.error("CRON_SECRET not configured")
      return Response.json({ error: "Server misconfiguration" }, { status: 500 })
    }
    const authHeader = request.headers.get("authorization")
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return Response.json({ error: "Unauthorized" }, { status: 401 })
    }
  }

  try {
    const supabase = createAdminClient()

    // Fetch metrics
    const metrics = await fetchMetrics(supabase)

    // Fetch admin emails
    const { data: admins, error: adminsError } = await supabase
      .from("admin_users")
      .select("email, name, is_active")
      .eq("is_active", true)

    if (adminsError) {
      console.error("Failed to fetch admin users:", adminsError.message)
      return Response.json({ error: "Failed to fetch admin users" }, { status: 500 })
    }

    const adminEmails = (admins || [])
      .map((a) => a.email)
      .filter(Boolean) as string[]

    // Also include the env-admin email
    const envAdminEmail = (process.env.ADMIN_DEFAULT_EMAIL || "admin@amasi.org")
      .trim()
      .toLowerCase()
    if (!adminEmails.includes(envAdminEmail)) {
      adminEmails.push(envAdminEmail)
    }

    if (adminEmails.length === 0) {
      return Response.json({ error: "No admin emails found" }, { status: 500 })
    }

    // Build email
    const weekOfDate = new Date().toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "long",
      year: "numeric",
    })

    const html = buildEmailHtml(metrics, weekOfDate)

    // Send via Resend
    const resend = getResend()
    const fromEmail =
      process.env.RESEND_FROM_EMAIL?.trim() || "AMASI <noreply@amasi.org>"

    let sentCount = 0
    const errors: string[] = []

    // Send to each admin individually (Resend batch)
    for (const email of adminEmails) {
      try {
        await resend.emails.send({
          from: fromEmail,
          to: email,
          subject: `AMASI Weekly Digest -- Week of ${weekOfDate}`,
          html,
        })
        sentCount++
      } catch (err: any) {
        console.error(`Failed to send digest to ${email}:`, err.message)
        errors.push(email)
      }
    }

    console.log(
      `Weekly digest: sent to ${sentCount}/${adminEmails.length} admins`
    )

    return Response.json({
      sent: sentCount,
      failed: errors.length,
      metrics: {
        totalMembers: metrics.totalMembers,
        newMembersThisWeek: metrics.newMembersThisWeek,
        pendingApplications: metrics.pendingApplications,
        openTickets: metrics.openTickets,
        revenueThisWeek: metrics.revenueThisWeek,
        slaBreachesThisWeek: metrics.slaBreachesThisWeek,
      },
    })
  } catch (error: any) {
    console.error("Weekly digest error:", error)
    return Response.json({ error: error.message }, { status: 500 })
  }
}
