"use client"

import { useQuery } from "@tanstack/react-query"
import { StatCard } from "@/components/dashboard/stat-card"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Users, UserCheck, Clock, TrendingUp, AlertCircle, Loader2, ArrowRight } from "lucide-react"
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
  totalPayments: number
}

const TYPE_LABELS: Record<string, { name: string; shortName: string; color: string; bg: string }> = {
  LM: { name: "Life Member", shortName: "LM", color: "bg-emerald-500", bg: "bg-emerald-50 text-emerald-700" },
  ALM: { name: "Associate Life Member", shortName: "ALM", color: "bg-blue-500", bg: "bg-blue-50 text-blue-700" },
  ACM: { name: "Associate Candidate Member", shortName: "ACM", color: "bg-purple-500", bg: "bg-purple-50 text-purple-700" },
  ILM: { name: "International Life Member", shortName: "ILM", color: "bg-amber-500", bg: "bg-amber-50 text-amber-700" },
}

function statusBadgeClass(status: string): string {
  switch (status) {
    case "approved":
    case "ai_approved":
      return "bg-emerald-50 text-emerald-700 border border-emerald-200"
    case "rejected":
      return "bg-red-50 text-red-700 border border-red-200"
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

  const maxTypeCount = Math.max(...Object.values(stats.membersByType), 1)
  const totalByType = Object.values(stats.membersByType).reduce((s, v) => s + v, 0) || 1

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Dashboard</h2>
        <p className="text-muted-foreground mt-1">AMASI Membership Management Overview</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Total Members"
          value={stats.totalMembers.toLocaleString()}
          description="All registered members"
          icon={Users}
          iconClassName="bg-blue-100 text-blue-600"
        />
        <StatCard
          title="Pending Applications"
          value={stats.pendingApplicationsCount}
          description="Awaiting review or verification"
          icon={Clock}
          iconClassName="bg-amber-100 text-amber-600"
        />
        <StatCard
          title="Incomplete Profiles"
          value={stats.incompleteProfilesCount}
          description="Missing key profile fields"
          icon={UserCheck}
          iconClassName="bg-red-100 text-red-600"
        />
        <StatCard
          title="Total Payments"
          value={`₹${stats.totalPayments.toLocaleString()}`}
          description="Payments received"
          icon={TrendingUp}
          iconClassName="bg-emerald-100 text-emerald-600"
        />
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Recent Applications */}
        <Card>
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
              <div className="space-y-1">
                {stats.recentApplications.map((app) => (
                  <div key={app.id} className="flex items-center justify-between py-3 px-3 -mx-3 rounded-lg hover:bg-muted/50 transition-colors">
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-muted text-xs font-semibold">
                        {(app.full_name || "?").split(" ").map(n => n[0]).slice(0, 2).join("").toUpperCase()}
                      </div>
                      <div>
                        <p className="font-medium text-sm">{app.full_name || "Unknown"}</p>
                        <p className="text-xs text-muted-foreground">
                          <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium mr-1.5 ${TYPE_LABELS[app.membership_type]?.bg || "bg-muted"}`}>
                            {app.membership_type}
                          </span>
                          {formatDate(app.created_at)}
                        </p>
                      </div>
                    </div>
                    <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${statusBadgeClass(app.status)}`}>
                      {statusLabel(app.status)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Membership Types */}
        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-lg font-semibold">Membership Types</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-5">
              {Object.entries(TYPE_LABELS).map(([key, { name, shortName, color }]) => {
                const count = stats.membersByType[key] ?? 0
                const pct = Math.round((count / totalByType) * 100)
                return (
                  <div key={key} className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <span className={`inline-block h-3 w-3 rounded-full ${color}`} />
                        <span className="font-medium">{name}</span>
                        <span className="text-xs text-muted-foreground">({shortName})</span>
                      </div>
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-lg font-bold">{count.toLocaleString()}</span>
                        <span className="text-xs text-muted-foreground">{pct}%</span>
                      </div>
                    </div>
                    <div className="h-2.5 rounded-full bg-secondary overflow-hidden">
                      <div
                        className={`h-full rounded-full ${color} transition-all duration-500`}
                        style={{ width: `${(count / maxTypeCount) * 100}%` }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
