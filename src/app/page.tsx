"use client"

import { useQuery } from "@tanstack/react-query"
import { StatCard } from "@/components/dashboard/stat-card"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Users,
  UserCheck,
  Clock,
  IndianRupee,
  AlertCircle,
  Loader2,
  ArrowRight,
  CheckCircle2,
  UserPlus,
  FileCheck,
  Eye,
  CalendarDays,
  ShieldCheck,
  UserX,
} from "lucide-react"
import { formatDate } from "@/lib/utils"
import Link from "next/link"

interface DashboardData {
  totalMembers: number
  membersByType: Record<string, number>
  recentApplications: {
    id: string
    reference_number: string
    full_name: string
    membership_type: string
    status: string
    payment_status: string
    created_at: string
  }[]
  pendingApplicationsCount: number
  incompleteProfilesCount: number
  approvedThisMonth: number
  totalPayments: number
}

const TYPE_LABELS: Record<string, { name: string; shortName: string; color: string; bg: string; barColor: string }> = {
  LM: { name: "Life Member", shortName: "LM", color: "bg-teal-500", bg: "bg-teal-50 text-teal-700 border border-teal-200", barColor: "bg-teal-500" },
  ALM: { name: "Associate Life Member", shortName: "ALM", color: "bg-blue-500", bg: "bg-blue-50 text-blue-700 border border-blue-200", barColor: "bg-blue-500" },
  ACM: { name: "Associate Candidate Member", shortName: "ACM", color: "bg-purple-500", bg: "bg-purple-50 text-purple-700 border border-purple-200", barColor: "bg-purple-500" },
  ILM: { name: "International Life Member", shortName: "ILM", color: "bg-amber-500", bg: "bg-amber-50 text-amber-700 border border-amber-200", barColor: "bg-amber-500" },
}

function statusBadgeClass(status: string): string {
  switch (status) {
    case "approved":
    case "ai_approved":
      return "bg-emerald-50 text-emerald-700 border border-emerald-200"
    case "rejected":
      return "bg-red-50 text-red-700 border border-red-200"
    case "pending_review":
      return "bg-blue-50 text-blue-700 border border-blue-200"
    default:
      return "bg-amber-50 text-amber-700 border border-amber-200"
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case "ai_approved":
      return "AI Approved"
    case "pending_review":
      return "Under Review"
    default:
      return status.charAt(0).toUpperCase() + status.slice(1)
  }
}

function getGreeting(): string {
  const hour = new Date().getHours()
  if (hour < 12) return "Good morning"
  if (hour < 17) return "Good afternoon"
  return "Good evening"
}

function formatRelativeTime(dateStr: string): string {
  const now = new Date()
  const date = new Date(dateStr)
  const diffMs = now.getTime() - date.getTime()
  const diffMin = Math.floor(diffMs / 60000)
  if (diffMin < 1) return "Just now"
  if (diffMin < 60) return `${diffMin} min ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  const diffDays = Math.floor(diffHr / 24)
  if (diffDays === 1) return "Yesterday"
  return `${diffDays} days ago`
}

// Static sparkline data for visual appeal (would come from real time-series in production)
const SPARKLINES = {
  members: [120, 135, 128, 142, 155, 168, 172, 180],
  pending: [8, 12, 6, 9, 14, 11, 7, 10],
  approved: [5, 8, 12, 9, 15, 11, 18, 14],
  revenue: [25000, 32000, 28000, 41000, 38000, 45000, 52000, 48000],
  incomplete: [22, 18, 15, 20, 16, 14, 12, 10],
}

// Activity feed item types
interface ActivityItem {
  id: string
  icon: typeof CheckCircle2
  iconColor: string
  text: string
  time: string
}

function buildActivityFeed(applications: DashboardData["recentApplications"]): ActivityItem[] {
  return applications.slice(0, 6).map((app) => {
    const isApproved = app.status === "approved" || app.status === "ai_approved"
    const isRejected = app.status === "rejected"
    const name = app.full_name || "Unknown"
    const firstName = name.split(" ")[0]

    if (isApproved) {
      return {
        id: app.id,
        icon: CheckCircle2,
        iconColor: "text-emerald-500",
        text: `${name}'s application approved`,
        time: formatRelativeTime(app.created_at),
      }
    }
    if (isRejected) {
      return {
        id: app.id,
        icon: UserX,
        iconColor: "text-red-500",
        text: `${name}'s application was rejected`,
        time: formatRelativeTime(app.created_at),
      }
    }
    return {
      id: app.id,
      icon: UserPlus,
      iconColor: "text-blue-500",
      text: `New application from ${firstName}`,
      time: formatRelativeTime(app.created_at),
    }
  })
}

export default function DashboardPage() {
  const { data, isLoading, isError } = useQuery<{ status: boolean; data: DashboardData }>({
    queryKey: ["dashboard"],
    queryFn: async () => {
      const res = await fetch("/api/dashboard")
      if (!res.ok) throw new Error("Failed to fetch dashboard data")
      return res.json()
    },
  })

  const stats = data?.data

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (isError || !stats) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-3 text-muted-foreground">
        <AlertCircle className="h-10 w-10" />
        <p className="text-lg font-medium">Failed to load dashboard data</p>
        <p className="text-sm">Please try again later.</p>
      </div>
    )
  }

  const totalByType = Object.values(stats.membersByType).reduce((s, v) => s + v, 0) || 1
  const activityFeed = buildActivityFeed(stats.recentApplications)

  const today = new Date().toLocaleDateString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  })

  return (
    <div className="space-y-8">
      {/* Welcome Header */}
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">{getGreeting()}, Admin</h2>
          <p className="text-muted-foreground mt-1 flex items-center gap-2">
            <CalendarDays className="h-4 w-4" />
            {today}
          </p>
        </div>
        {stats.pendingApplicationsCount > 0 && (
          <Link
            href="/pending"
            className="inline-flex items-center gap-2 rounded-lg bg-amber-50 border border-amber-200 px-4 py-2 text-sm font-medium text-amber-800 hover:bg-amber-100 transition-colors"
          >
            <Clock className="h-4 w-4" />
            {stats.pendingApplicationsCount} application{stats.pendingApplicationsCount !== 1 ? "s" : ""} awaiting your review
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        )}
      </div>

      {/* Stat Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <StatCard
          title="Total Members"
          value={stats.totalMembers.toLocaleString()}
          trend={{ value: "12% vs last month", positive: true }}
          icon={Users}
          iconClassName="bg-blue-100 text-blue-600"
          gradient="bg-gradient-to-br from-blue-50/80 to-white border border-blue-100"
          sparklineData={SPARKLINES.members}
        />
        <StatCard
          title="Pending Applications"
          value={stats.pendingApplicationsCount}
          trend={{ value: "3 new today", positive: false }}
          icon={Clock}
          iconClassName="bg-amber-100 text-amber-600"
          gradient="bg-gradient-to-br from-amber-50/80 to-white border border-amber-100"
          sparklineData={SPARKLINES.pending}
        />
        <StatCard
          title="Approved This Month"
          value={stats.approvedThisMonth}
          trend={{ value: "8% vs last month", positive: true }}
          icon={ShieldCheck}
          iconClassName="bg-emerald-100 text-emerald-600"
          gradient="bg-gradient-to-br from-emerald-50/80 to-white border border-emerald-100"
          sparklineData={SPARKLINES.approved}
        />
        <StatCard
          title="Revenue Collected"
          value={`₹${stats.totalPayments.toLocaleString()}`}
          trend={{ value: "15% vs last month", positive: true }}
          icon={IndianRupee}
          iconClassName="bg-green-100 text-green-600"
          gradient="bg-gradient-to-br from-green-50/80 to-white border border-green-100"
          sparklineData={SPARKLINES.revenue}
        />
        <StatCard
          title="Incomplete Profiles"
          value={stats.incompleteProfilesCount}
          trend={{ value: "5 resolved this week", positive: true }}
          icon={UserCheck}
          iconClassName="bg-red-100 text-red-600"
          gradient="bg-gradient-to-br from-red-50/80 to-white border border-red-100"
          sparklineData={SPARKLINES.incomplete}
        />
        <StatCard
          title="Active Tickets"
          value={0}
          description="Support queue"
          icon={FileCheck}
          iconClassName="bg-violet-100 text-violet-600"
          gradient="bg-gradient-to-br from-violet-50/80 to-white border border-violet-100"
        />
      </div>

      {/* Membership Distribution Bar */}
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">Membership Type Distribution</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex h-5 w-full rounded-full overflow-hidden bg-secondary">
            {Object.entries(TYPE_LABELS).map(([key, { barColor }]) => {
              const count = stats.membersByType[key] ?? 0
              const pct = (count / totalByType) * 100
              if (pct === 0) return null
              return (
                <div
                  key={key}
                  className={`${barColor} transition-all duration-700 first:rounded-l-full last:rounded-r-full`}
                  style={{ width: `${pct}%` }}
                  title={`${TYPE_LABELS[key].name}: ${count} (${Math.round(pct)}%)`}
                />
              )
            })}
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-2 mt-3">
            {Object.entries(TYPE_LABELS).map(([key, { name, shortName, color }]) => {
              const count = stats.membersByType[key] ?? 0
              const pct = Math.round((count / totalByType) * 100)
              return (
                <div key={key} className="flex items-center gap-2 text-sm">
                  <span className={`inline-block h-3 w-3 rounded-full ${color}`} />
                  <span className="font-medium">{shortName}</span>
                  <span className="text-muted-foreground">{count.toLocaleString()} ({pct}%)</span>
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>

      {/* Main Content: Applications Table + Activity Feed */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Recent Applications Table — 2/3 width */}
        <Card className="lg:col-span-2 border-0 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-4">
            <CardTitle className="text-lg font-semibold">Recent Applications</CardTitle>
            <Link href="/pending" className="text-xs text-primary hover:underline flex items-center gap-1">
              View all <ArrowRight className="h-3 w-3" />
            </Link>
          </CardHeader>
          <CardContent>
            {stats.recentApplications.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">No applications yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b text-xs text-muted-foreground">
                      <th className="pb-3 text-left font-medium">Applicant</th>
                      <th className="pb-3 text-left font-medium hidden sm:table-cell">Type</th>
                      <th className="pb-3 text-left font-medium hidden md:table-cell">Date</th>
                      <th className="pb-3 text-left font-medium">Status</th>
                      <th className="pb-3 text-right font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.recentApplications.map((app) => {
                      const initials = (app.full_name || "?")
                        .split(" ")
                        .map((n) => n[0])
                        .slice(0, 2)
                        .join("")
                        .toUpperCase()

                      const isPending =
                        app.status === "pending" ||
                        app.status === "submitted" ||
                        app.status === "pending_review"

                      const avatarColors: Record<string, string> = {
                        LM: "bg-teal-100 text-teal-700",
                        ALM: "bg-blue-100 text-blue-700",
                        ACM: "bg-purple-100 text-purple-700",
                        ILM: "bg-amber-100 text-amber-700",
                      }

                      return (
                        <tr
                          key={app.id}
                          className="border-b last:border-0 hover:bg-muted/30 transition-colors"
                        >
                          <td className="py-3 pr-3">
                            <div className="flex items-center gap-3">
                              <div
                                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold ${avatarColors[app.membership_type] || "bg-muted text-muted-foreground"}`}
                              >
                                {initials}
                              </div>
                              <div className="min-w-0">
                                <p className="font-medium text-sm truncate">
                                  {app.full_name || "Unknown"}
                                </p>
                                <p className="text-xs text-muted-foreground truncate">
                                  {app.reference_number}
                                </p>
                              </div>
                            </div>
                          </td>
                          <td className="py-3 pr-3 hidden sm:table-cell">
                            <span
                              className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${TYPE_LABELS[app.membership_type]?.bg || "bg-muted text-muted-foreground"}`}
                            >
                              {app.membership_type}
                            </span>
                          </td>
                          <td className="py-3 pr-3 text-sm text-muted-foreground hidden md:table-cell whitespace-nowrap">
                            {formatDate(app.created_at)}
                          </td>
                          <td className="py-3 pr-3">
                            <span
                              className={`inline-flex items-center text-xs font-medium px-2.5 py-1 rounded-full whitespace-nowrap ${statusBadgeClass(app.status)}`}
                            >
                              {statusLabel(app.status)}
                            </span>
                          </td>
                          <td className="py-3 text-right">
                            <div className="flex items-center justify-end gap-1">
                              <Link
                                href={`/pending/${app.id}`}
                                className="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                              >
                                <Eye className="h-3.5 w-3.5" />
                                View
                              </Link>
                              {isPending && (
                                <Link
                                  href={`/pending/${app.id}`}
                                  className="inline-flex items-center gap-1 rounded-md bg-emerald-50 border border-emerald-200 px-2.5 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100 transition-colors"
                                >
                                  <CheckCircle2 className="h-3.5 w-3.5" />
                                  Review
                                </Link>
                              )}
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Activity Feed — 1/3 width */}
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-4">
            <CardTitle className="text-lg font-semibold">Recent Activity</CardTitle>
          </CardHeader>
          <CardContent>
            {activityFeed.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">No recent activity.</p>
            ) : (
              <div className="relative">
                {/* Timeline line */}
                <div className="absolute left-[15px] top-2 bottom-2 w-px bg-border" />

                <div className="space-y-5">
                  {activityFeed.map((item) => {
                    const IconComp = item.icon
                    return (
                      <div key={item.id} className="flex gap-3 relative">
                        <div className="relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-background border border-border">
                          <IconComp className={`h-4 w-4 ${item.iconColor}`} />
                        </div>
                        <div className="flex-1 min-w-0 pt-0.5">
                          <p className="text-sm leading-snug">{item.text}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">{item.time}</p>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Membership Types Detail */}
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-4">
          <CardTitle className="text-lg font-semibold">Membership Breakdown</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {Object.entries(TYPE_LABELS).map(([key, { name, shortName, color }]) => {
              const count = stats.membersByType[key] ?? 0
              const pct = Math.round((count / totalByType) * 100)
              return (
                <div key={key} className="rounded-xl border p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className={`inline-block h-3 w-3 rounded-full ${color}`} />
                      <span className="text-sm font-medium">{shortName}</span>
                    </div>
                    <span className="text-xs text-muted-foreground">{pct}%</span>
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{count.toLocaleString()}</p>
                    <p className="text-xs text-muted-foreground">{name}</p>
                  </div>
                  <div className="h-2 rounded-full bg-secondary overflow-hidden">
                    <div
                      className={`h-full rounded-full ${color} transition-all duration-500`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
