"use client"

import { useState, useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { toast } from "sonner"
import { AnimatePresence, motion } from "framer-motion"
import {
  Users,
  Clock,
  IndianRupee,
  Timer,
  AlertCircle,
  ArrowRight,
  BarChart3,
  Target,
  PieChart,
  FileText,
  Activity,
  CalendarDays,
} from "lucide-react"

import { SectionHeader } from "@/components/dashboard/section-header"
import { StatCard } from "@/components/dashboard/stat-card"
import { DashboardHeader } from "@/components/dashboard/dashboard-header"
import { SystemHealth, type HealthStatus, type SystemHealthKey } from "@/components/dashboard/system-health"
import { ActionStrip } from "@/components/dashboard/action-strip"
import { RecentRoutes } from "@/components/dashboard/recent-routes"
import { TimeRangeTabs, type TimeRange } from "@/components/dashboard/time-range-tabs"
import { ApplicationsChart } from "@/components/dashboard/applications-chart"
import { ApprovalFunnel } from "@/components/dashboard/approval-funnel"
import { MembershipMix } from "@/components/dashboard/membership-mix"
import { RecentApplicationsTable, type AppRow } from "@/components/dashboard/recent-applications-table"
import { ActivityTimeline, type ActivityEvent, type ActivityEventType } from "@/components/dashboard/activity-timeline"
import { ActivityHeatmap } from "@/components/dashboard/activity-heatmap"
import { StaggerContainer, StaggerItem } from "@/components/motion/stagger"
import { useRealtimeCount } from "@/hooks/use-realtime-count"
import { cn } from "@/lib/utils"

interface Trend {
  deltaPct: number
  positive: boolean
}

interface DashboardData {
  adminName: string
  approvedThisMonth: number

  totalMembers: number
  totalMembersTrend: Trend
  totalMembersSparkline: number[]

  pendingApplicationsCount: number
  pendingOldestHours: number

  revenueThisMonth: number
  revenueTrend: Trend
  revenueSparkline: number[]
  revenueAllTime: number

  avgApprovalHours: number
  avgApprovalTrend: Trend
  avgApprovalSparkline: number[]

  membersByType: { LM: number; ALM: number; ACM: number; ILM: number }

  timeseries: Array<{ date: string; submitted: number; approved: number; manual: number }>

  funnel: {
    submitted: number
    autoApproved: number
    manualReview: number
    midScore: number
    lowScore: number
    nmcSkipped: number
  }

  recentApplications: AppRow[]

  systemHealth: {
    nmc: HealthStatus
    email: HealthStatus
    razorpay: HealthStatus
    webhooks: HealthStatus
  }
}

function formatHours(h: number): string {
  if (!h || !Number.isFinite(h)) return "—"
  if (h < 1) return `${Math.round(h * 60)}m`
  if (h < 24) return `${h.toFixed(1)}h`
  const days = h / 24
  return `${days.toFixed(1)}d`
}

function fmtTrend(t: Trend): { value: string; positive: boolean } {
  return {
    value: `${Math.abs(t.deltaPct)}% vs last month`,
    positive: t.positive,
  }
}

function buildActivityEvents(
  apps: AppRow[],
  systemHealth: DashboardData["systemHealth"]
): ActivityEvent[] {
  const events: ActivityEvent[] = []

  for (const app of apps.slice(0, 5)) {
    const name = app.name || "Unknown"
    const subtitle = `${app.reference_number} · ${app.membership_type}`
    let type: ActivityEventType
    let title: string

    switch (app.status) {
      case "ai_approved":
        type = "auto_approved"
        title = `${name}'s application auto-approved`
        break
      case "approved":
        type = "approved"
        title = `${name} was approved`
        break
      case "rejected":
        type = "rejected"
        title = `${name}'s application was rejected`
        break
      case "pending_review":
      case "need_clarification":
        type = "needs_review"
        title = `${name} needs manual review`
        break
      default:
        type = "application_submitted"
        title = `New application from ${name.split(" ")[0]}`
    }

    events.push({
      id: app.id,
      type,
      title,
      subtitle,
      timestamp: app.created_at,
      href: `/pending/${app.id}`,
    })
  }

  // Prepend system events if any integrations are not healthy
  if (systemHealth.nmc !== "ok") {
    events.unshift({
      id: "sys-nmc",
      type: "nmc_skipped",
      title:
        systemHealth.nmc === "down"
          ? "NMC verification service is down"
          : "NMC verification is degraded",
      subtitle: "Some applications may skip live NMC checks",
      timestamp: new Date().toISOString(),
      href: "/audit?tag=nmc",
    })
  }
  if (systemHealth.webhooks === "down") {
    events.unshift({
      id: "sys-webhook",
      type: "system",
      title: "Webhook delivery is down",
      subtitle: "Check orphaned submissions",
      timestamp: new Date().toISOString(),
      href: "/audit?tag=webhook",
    })
  }

  return events
}

export default function DashboardPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  // Dev-only override so we can preview the pending-pulse state in non-prod.
  // Use ?cb=pending5 (or any number) — stripped in production builds.
  const pendingOverride =
    process.env.NODE_ENV !== "production"
      ? (() => {
          const cb = searchParams.get("cb")
          if (!cb?.startsWith("pending")) return undefined
          const n = parseInt(cb.replace("pending", ""), 10)
          return Number.isFinite(n) ? n : undefined
        })()
      : undefined
  const [range, setRange] = useState<TimeRange>("30d")

  const { data, isLoading, isError, isFetching, refetch } = useQuery<{ status: boolean; data: DashboardData }>({
    queryKey: ["dashboard", range],
    queryFn: async () => {
      const res = await fetch(`/api/dashboard?range=${range}`)
      if (!res.ok) throw new Error("Failed to fetch dashboard data")
      return res.json()
    },
    refetchInterval: 30000,
  })

  const { data: heatmapData } = useQuery<{ counts: Record<string, number> }>({
    queryKey: ["dashboard-heatmap"],
    queryFn: async () => {
      const res = await fetch("/api/dashboard/heatmap")
      if (!res.ok) throw new Error("Failed to fetch heatmap")
      return res.json()
    },
    staleTime: 5 * 60 * 1000,
  })

  const stats =
    data?.data && pendingOverride !== undefined
      ? {
          ...data.data,
          pendingApplicationsCount: pendingOverride,
          pendingOldestHours: data.data.pendingOldestHours || 26,
        }
      : data?.data

  const { count: liveTotalMembers, flashing: membersFlashing } = useRealtimeCount({
    table: "members",
    initialCount: stats?.totalMembers ?? 0,
  })

  const activityEvents = useMemo(
    () => (stats ? buildActivityEvents(stats.recentApplications, stats.systemHealth) : []),
    [stats]
  )

  const handleHealthPillClick = (key: SystemHealthKey) => {
    if (key === "nmc") router.push("/audit?tag=nmc")
    else if (key === "webhooks") router.push("/audit?tag=webhook")
    else router.push("/audit")
  }

  const handleApprove = async (id: string) => {
    try {
      const res = await fetch("/api/applications/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ applicationId: id, notes: "Approved from dashboard" }),
      })
      const result = await res.json()
      if (res.ok && result.status) {
        toast.success("Application approved")
        refetch()
      } else {
        toast.error(result.message || "Failed to approve")
      }
    } catch {
      toast.error("Failed to approve")
    }
  }

  // Render the dashboard shell immediately even while the query is in-flight.
  // Each section handles its own loading state — no more full-page spinner.
  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-3 text-muted-foreground">
        <AlertCircle className="h-10 w-10" />
        <p className="text-lg font-medium">Failed to load dashboard data</p>
        <p className="text-sm">Please try again later.</p>
      </div>
    )
  }

  const cardChrome =
    "rounded-2xl border border-slate-200/70 dark:border-slate-800/70 bg-white dark:bg-slate-900 p-6 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_2px_4px_rgba(15,23,42,0.03)] card-lift"

  const statsLoading = !stats

  return (
    <div className="dashboard-bg -mx-6 -my-6 min-h-[calc(100vh-4rem)] px-6 py-8 space-y-6">
      {/* Top: greeting + system health pills */}
      <div className="dash-reveal dash-reveal-1">
        <DashboardHeader
          adminName={stats?.adminName ?? "Admin"}
          isRefetching={isFetching && !isLoading}
          pendingCount={stats?.pendingApplicationsCount}
          contextPills={
            stats
              ? (() => {
                  const parts: string[] = []
                  parts.push(
                    stats.pendingApplicationsCount > 0
                      ? `${stats.pendingApplicationsCount} awaiting review`
                      : "Queue clear"
                  )
                  if (stats.approvedThisMonth) {
                    parts.push(`${stats.approvedThisMonth} approved this month`)
                  }
                  const healthy = Object.values(stats.systemHealth).every((s) => s === "ok")
                  parts.push(healthy ? "All systems healthy" : "Check system status")
                  return parts
                })()
              : undefined
          }
          contextLine={stats ? undefined : "Loading dashboard…"}
        >
          {stats && <SystemHealth health={stats.systemHealth} onPillClick={handleHealthPillClick} />}
        </DashboardHeader>
      </div>

      {/* Recently viewed admin pages/records */}
      <div className="dash-reveal dash-reveal-1">
        <RecentRoutes />
      </div>

      {/* Action-required strip (auto-hides when nothing pending) */}
      {stats && stats.pendingApplicationsCount > 0 && (
        <div className="dash-reveal dash-reveal-2">
          <ActionStrip
            pendingCount={stats.pendingApplicationsCount}
            oldestHours={stats.pendingOldestHours}
            href="/pending"
          />
        </div>
      )}

      {/* KPI grid */}
      <StaggerContainer className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StaggerItem>
          <div className={cn(membersFlashing && "flash-success")}>
            <StatCard
              variant="hero"
              href="/members"
              title="Total Members"
              value={stats ? liveTotalMembers.toLocaleString("en-IN") : ""}
              icon={Users}
              trend={stats && stats.totalMembersTrend.deltaPct !== 0 ? fmtTrend(stats.totalMembersTrend) : undefined}
              sparklineData={stats?.totalMembersSparkline}
              loading={statsLoading}
              showHoverArrow
            />
          </div>
        </StaggerItem>
        <StaggerItem>
          <StatCard
            variant="dark"
            accent="amber"
            href="/pending"
            title="Pending"
            value={stats?.pendingApplicationsCount ?? 0}
            icon={Clock}
            description={
              stats
                ? stats.pendingApplicationsCount === 0
                  ? "queue clear"
                  : `${stats.pendingApplicationsCount} awaiting action`
                : undefined
            }
            loading={statsLoading}
            pulse={!!stats && stats.pendingApplicationsCount > 0}
            showHoverArrow
          />
        </StaggerItem>
        <StaggerItem>
          <StatCard
            variant="dark"
            accent="blue"
            href="/reports"
            title="Revenue"
            value={stats ? `₹${stats.revenueThisMonth.toLocaleString("en-IN")}` : ""}
            icon={IndianRupee}
            trend={stats && stats.revenueTrend.deltaPct !== 0 ? fmtTrend(stats.revenueTrend) : undefined}
            description={stats && stats.revenueTrend.deltaPct === 0 ? "no change" : undefined}
            sparklineData={stats?.revenueSparkline}
            loading={statsLoading}
            showHoverArrow
          />
        </StaggerItem>
        <StaggerItem>
          <StatCard
            variant="dark"
            accent="violet"
            href="/reports"
            title="Avg approval time"
            value={stats ? formatHours(stats.avgApprovalHours) : ""}
            icon={Timer}
            trend={
              stats && stats.avgApprovalHours > 0 && stats.avgApprovalTrend.deltaPct !== 0
                ? fmtTrend(stats.avgApprovalTrend)
                : undefined
            }
            description={stats && stats.avgApprovalHours === 0 ? "no data yet" : undefined}
            sparklineData={stats?.avgApprovalSparkline}
            loading={statsLoading}
            empty={!!stats && stats.avgApprovalHours === 0}
            showHoverArrow
          />
        </StaggerItem>
      </StaggerContainer>

      {/* Main row: chart + funnel/mix. items-start prevents the chart card from stretching
          to match the (taller) funnel/mix card, which was producing ~400px of empty space. */}
      <div className="grid gap-4 lg:grid-cols-[1fr_340px] items-start">
        {/* Applications chart card */}
        <div className={`${cardChrome} dash-reveal dash-reveal-6`}>
          <div className="flex items-center justify-between gap-4 mb-5 flex-wrap">
            <div className="flex items-center gap-3">
              <SectionHeader
                title="Applications"
                subtitle="Submissions & outcomes"
                icon={BarChart3}
                accent="blue"
              />
              <TimeRangeTabs value={range} onChange={setRange} />
            </div>
            <Link
              href="/reports"
              className="group inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
            >
              View report
              <ArrowRight className="h-3 w-3 transition-transform duration-150 group-hover:translate-x-1" />
            </Link>
          </div>
          <AnimatePresence mode="wait">
            <motion.div
              key={range}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
            >
              <ApplicationsChart data={stats?.timeseries ?? []} loading={statsLoading} />
            </motion.div>
          </AnimatePresence>
          <div className="flex gap-4 mt-4 text-xs text-slate-500 dark:text-slate-400">
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm" style={{ background: "#378ADD" }} />
              Submitted
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm" style={{ background: "#1D9E75" }} />
              Approved
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm" style={{ background: "#EF9F27" }} />
              Manual review
            </span>
          </div>
        </div>

        {/* Funnel + Mix combined card */}
        <div className={`${cardChrome} dash-reveal dash-reveal-7 space-y-5`}>
          <div>
            <SectionHeader
              title="Approval funnel"
              subtitle="Where submissions land"
              icon={Target}
              accent="emerald"
              className="mb-4"
            />
            <ApprovalFunnel
              submitted={stats?.funnel.submitted ?? 0}
              autoApproved={stats?.funnel.autoApproved ?? 0}
              manualReview={stats?.funnel.manualReview ?? 0}
              midScore={stats?.funnel.midScore ?? 0}
              lowScore={stats?.funnel.lowScore ?? 0}
              nmcSkipped={stats?.funnel.nmcSkipped ?? 0}
              loading={statsLoading}
              activePeriod={
                range === "today" ? "Today"
                  : range === "7d" ? "Last 7 days"
                  : range === "30d" ? "Last 30 days"
                  : "Last 90 days"
              }
              avgProcessingDays={
                stats && stats.avgApprovalHours > 0 ? stats.avgApprovalHours / 24 : undefined
              }
            />
          </div>
          <div className="h-px bg-slate-200/60 dark:bg-slate-800/60" />
          <div>
            <SectionHeader
              title="Membership mix"
              subtitle="Distribution by type"
              icon={PieChart}
              accent="violet"
              className="mb-4"
            />
            <MembershipMix
              counts={stats?.membersByType ?? { LM: 0, ALM: 0, ACM: 0, ILM: 0 }}
              loading={statsLoading}
            />
          </div>
        </div>
      </div>

      {/* Recent applications + Activity timeline row */}
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className={`${cardChrome} dash-reveal dash-reveal-8`}>
          <div className="flex items-center justify-between gap-4 mb-5">
            <SectionHeader
              title="Recent applications"
              subtitle="Latest submissions, hover to act"
              icon={FileText}
              accent="sky"
            />
            <Link
              href="/pending"
              className="group inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
            >
              View all
              <ArrowRight className="h-3 w-3 transition-transform duration-150 group-hover:translate-x-1" />
            </Link>
          </div>
          <RecentApplicationsTable
            applications={stats?.recentApplications ?? []}
            onApprove={handleApprove}
            loading={statsLoading}
          />
        </div>

        <div className={`${cardChrome} dash-reveal dash-reveal-9`}>
          <SectionHeader
            title="Activity"
            subtitle="Latest events & system signals"
            icon={Activity}
            accent="amber"
            className="mb-5"
          />
          <ActivityTimeline events={activityEvents} loading={statsLoading} />
        </div>
      </div>

      {/* Full-width heatmap of last year's applications */}
      <div className={`${cardChrome} dash-reveal dash-reveal-9`}>
        <SectionHeader
          title="Application activity"
          subtitle="Daily submissions · last 12 months"
          icon={CalendarDays}
          accent="teal"
          className="mb-4"
        />
        <ActivityHeatmap
          data={{ counts: heatmapData?.counts ?? {} }}
          title=""
          subtitle=""
          loading={!heatmapData}
        />
      </div>
    </div>
  )
}
