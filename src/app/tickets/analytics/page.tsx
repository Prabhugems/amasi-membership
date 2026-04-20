"use client"

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import Link from "next/link"
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts"
import {
  Ticket,
  ArrowLeft,
  Clock,
  AlertTriangle,
  Loader2,
  MessageSquare,
  ShieldAlert,
} from "lucide-react"
import { useIsDark } from "@/hooks/use-is-dark"

/* ---------- types ---------- */

interface AnalyticsData {
  totalTickets: number
  openTickets: number
  avgFirstResponseHours: number
  avgResolutionHours: number
  slaBreachedCount: number
  categoryBreakdown: Array<{ category: string; count: number }>
  statusBreakdown: Array<{ status: string; count: number }>
  volumeByDay: Array<{ date: string; created: number; resolved: number }>
  teamPerformance: Array<{ team: string; assigned: number; resolved: number; avgHours: number }>
}

type Period = "7d" | "30d" | "90d"

/* ---------- helpers ---------- */

function formatHours(h: number): string {
  if (!h || !Number.isFinite(h)) return "--"
  if (h < 1) return `${Math.round(h * 60)}m`
  if (h < 24) return `${h.toFixed(1)}h`
  const days = h / 24
  return `${days.toFixed(1)}d`
}

const STATUS_COLORS: Record<string, string> = {
  open: "#f59e0b",
  in_progress: "#3b82f6",
  resolved: "#10b981",
  closed: "#6b7280",
}

/* ---------- sub-components ---------- */

function KpiCard({
  title,
  value,
  subtitle,
  icon: Icon,
  accent = "teal",
}: {
  title: string
  value: string | number
  subtitle?: string
  icon: React.ComponentType<{ className?: string }>
  accent?: "teal" | "amber" | "blue" | "red"
}) {
  const accentStyles: Record<string, string> = {
    teal: "bg-teal-50 dark:bg-teal-500/10 text-teal-600 dark:text-teal-400",
    amber: "bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400",
    blue: "bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400",
    red: "bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400",
  }

  return (
    <div className="rounded-2xl border border-slate-200/70 dark:border-slate-800/70 bg-white dark:bg-slate-900 p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_2px_4px_rgba(15,23,42,0.03)]">
      <div className="flex items-center gap-3 mb-3">
        <div className={`h-9 w-9 rounded-lg flex items-center justify-center ${accentStyles[accent]}`}>
          <Icon className="h-4.5 w-4.5" />
        </div>
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          {title}
        </span>
      </div>
      <p className="text-2xl font-bold text-foreground tracking-tight">{value}</p>
      {subtitle && (
        <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>
      )}
    </div>
  )
}

function VolumeChart({
  data,
  loading,
}: {
  data: AnalyticsData["volumeByDay"]
  loading: boolean
}) {
  const isDark = useIsDark()

  if (loading) {
    return (
      <div className="h-[220px] w-full rounded-lg bg-gradient-to-b from-slate-100 to-slate-50 dark:from-slate-800 dark:to-slate-900 animate-pulse" />
    )
  }

  const hasData = data.some((d) => d.created + d.resolved > 0)

  if (data.length === 0 || !hasData) {
    return (
      <div className="flex flex-col items-center justify-center h-[180px] gap-2">
        <div className="text-sm text-slate-500 dark:text-slate-400">
          No ticket activity in this period
        </div>
      </div>
    )
  }

  const interval = Math.max(0, Math.floor(data.length / 14))

  return (
    <div className="h-[220px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          barCategoryGap="28%"
          barGap={3}
          margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
        >
          <defs>
            <linearGradient id="grad-created" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.9} />
              <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.15} />
            </linearGradient>
            <linearGradient id="grad-resolved" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#10b981" stopOpacity={0.95} />
              <stop offset="100%" stopColor="#10b981" stopOpacity={0.2} />
            </linearGradient>
          </defs>
          <CartesianGrid
            strokeDasharray="0"
            stroke={isDark ? "rgba(148,163,184,0.12)" : "#f1f5f9"}
            vertical={false}
          />
          <XAxis
            dataKey="date"
            interval={interval}
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 10, fill: isDark ? "#64748b" : "#94a3b8" }}
            tickFormatter={(value: string) => {
              const d = new Date(value)
              if (isNaN(d.getTime())) return value
              return `${d.getDate()} ${d.toLocaleString("en-IN", { month: "short" })}`
            }}
          />
          <YAxis
            allowDecimals={false}
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 10, fill: isDark ? "#64748b" : "#94a3b8" }}
            width={32}
          />
          <Tooltip
            cursor={{ fill: "rgba(128,128,128,0.06)" }}
            contentStyle={{
              backgroundColor: "rgba(15,23,42,0.92)",
              border: "none",
              borderRadius: "10px",
              padding: "8px 12px",
              fontSize: "12px",
              color: "#fff",
              boxShadow: "0 4px 12px rgba(0,0,0,0.12)",
            }}
            labelStyle={{ color: "#fff", marginBottom: "4px" }}
            itemStyle={{ color: "#fff" }}
            labelFormatter={(label) => {
              const d = new Date(String(label))
              if (isNaN(d.getTime())) return String(label)
              return d.toLocaleDateString("en-IN", {
                day: "numeric",
                month: "short",
                year: "numeric",
              })
            }}
            formatter={(value, name) => {
              const labels: Record<string, string> = {
                created: "Created",
                resolved: "Resolved",
              }
              return [value as number, labels[String(name)] ?? String(name)]
            }}
          />
          <Bar
            dataKey="created"
            fill="url(#grad-created)"
            strokeWidth={0}
            radius={[6, 6, 0, 0]}
            isAnimationActive={true}
            animationDuration={1200}
            animationBegin={300}
            animationEasing="ease-out"
            activeBar={false}
          />
          <Bar
            dataKey="resolved"
            fill="url(#grad-resolved)"
            strokeWidth={0}
            radius={[6, 6, 0, 0]}
            isAnimationActive={true}
            animationDuration={1200}
            animationBegin={300}
            animationEasing="ease-out"
            activeBar={false}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

function CategoryBars({
  data,
  loading,
}: {
  data: AnalyticsData["categoryBreakdown"]
  loading: boolean
}) {
  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-7 rounded bg-slate-100 dark:bg-slate-800 animate-pulse" />
        ))}
      </div>
    )
  }

  if (data.length === 0) {
    return <p className="text-sm text-muted-foreground">No data</p>
  }

  const max = Math.max(...data.map((d) => d.count), 1)

  return (
    <div className="space-y-2.5">
      {data.map((item) => (
        <div key={item.category}>
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="font-medium text-foreground/80">{item.category}</span>
            <span className="text-muted-foreground font-semibold">{item.count}</span>
          </div>
          <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
            <div
              className="h-full rounded-full bg-teal-500 transition-all duration-700"
              style={{ width: `${(item.count / max) * 100}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  )
}

function StatusPills({
  data,
  loading,
}: {
  data: AnalyticsData["statusBreakdown"]
  loading: boolean
}) {
  if (loading) {
    return (
      <div className="flex gap-2">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-8 w-20 rounded-full bg-slate-100 dark:bg-slate-800 animate-pulse" />
        ))}
      </div>
    )
  }

  const total = data.reduce((sum, d) => sum + d.count, 0) || 1

  return (
    <div className="space-y-3">
      {/* Stacked bar */}
      <div className="flex h-3 rounded-full overflow-hidden bg-slate-100 dark:bg-slate-800">
        {data.map((item) => (
          <div
            key={item.status}
            className="h-full transition-all duration-700"
            style={{
              width: `${(item.count / total) * 100}%`,
              backgroundColor: STATUS_COLORS[item.status] || "#6b7280",
            }}
          />
        ))}
      </div>
      {/* Legend */}
      <div className="flex flex-wrap gap-3">
        {data.map((item) => (
          <div key={item.status} className="flex items-center gap-1.5 text-xs">
            <span
              className="h-2.5 w-2.5 rounded-sm"
              style={{ backgroundColor: STATUS_COLORS[item.status] || "#6b7280" }}
            />
            <span className="text-muted-foreground capitalize">{item.status.replace("_", " ")}</span>
            <span className="font-bold text-foreground">{item.count}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function TeamTable({
  data,
  loading,
}: {
  data: AnalyticsData["teamPerformance"]
  loading: boolean
}) {
  if (loading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-10 rounded bg-slate-100 dark:bg-slate-800 animate-pulse" />
        ))}
      </div>
    )
  }

  if (data.length === 0) {
    return <p className="text-sm text-muted-foreground">No team data</p>
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 dark:border-slate-800">
            <th className="text-left py-2.5 px-3 text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
              Team / Assignee
            </th>
            <th className="text-right py-2.5 px-3 text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
              Assigned
            </th>
            <th className="text-right py-2.5 px-3 text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
              Resolved
            </th>
            <th className="text-right py-2.5 px-3 text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
              Avg Resolution
            </th>
          </tr>
        </thead>
        <tbody>
          {data.map((row) => (
            <tr
              key={row.team}
              className="border-b border-slate-100 dark:border-slate-800/60 hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors"
            >
              <td className="py-2.5 px-3 font-medium text-foreground/90">{row.team}</td>
              <td className="py-2.5 px-3 text-right text-muted-foreground">{row.assigned}</td>
              <td className="py-2.5 px-3 text-right">
                <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
                  {row.resolved}
                </span>
              </td>
              <td className="py-2.5 px-3 text-right text-muted-foreground">
                {row.avgHours > 0 ? formatHours(row.avgHours) : "--"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/* ---------- main page ---------- */

export default function TicketAnalyticsPage() {
  const [period, setPeriod] = useState<Period>("30d")

  const { data, isLoading, isError } = useQuery<AnalyticsData>({
    queryKey: ["ticket-analytics", period],
    queryFn: async () => {
      const res = await fetch(`/api/tickets/analytics?period=${period}`)
      if (!res.ok) throw new Error("Failed to fetch analytics")
      return res.json()
    },
  })

  const cardChrome =
    "rounded-2xl border border-slate-200/70 dark:border-slate-800/70 bg-white dark:bg-slate-900 p-6 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_2px_4px_rgba(15,23,42,0.03)]"

  const periods: { value: Period; label: string }[] = [
    { value: "7d", label: "7 days" },
    { value: "30d", label: "30 days" },
    { value: "90d", label: "90 days" },
  ]

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            href="/tickets"
            className="h-9 w-9 rounded-lg border border-slate-200 dark:border-slate-800 flex items-center justify-center hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors"
          >
            <ArrowLeft className="h-4 w-4 text-muted-foreground" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2.5">
              <div className="h-9 w-9 rounded-lg bg-teal-600 flex items-center justify-center shadow-sm">
                <Ticket className="h-5 w-5 text-white" />
              </div>
              Ticket Analytics
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5 ml-[46px]">
              Support performance overview
            </p>
          </div>
        </div>

        {/* Period selector */}
        <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800/60 rounded-lg p-1">
          {periods.map((p) => (
            <button
              key={p.value}
              onClick={() => setPeriod(p.value)}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all duration-150 ${
                period === p.value
                  ? "bg-white dark:bg-slate-900 text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Error state */}
      {isError && (
        <div className="flex flex-col items-center justify-center min-h-[300px] gap-3 text-muted-foreground">
          <AlertTriangle className="h-10 w-10" />
          <p className="text-lg font-medium">Failed to load analytics</p>
          <p className="text-sm">Please try again later.</p>
        </div>
      )}

      {/* KPI cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {isLoading ? (
          <>
            {[1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="rounded-2xl border border-slate-200/70 dark:border-slate-800/70 bg-white dark:bg-slate-900 p-5 h-[120px] animate-pulse"
              />
            ))}
          </>
        ) : data ? (
          <>
            <KpiCard
              title="Total Tickets"
              value={data.totalTickets}
              subtitle={`in the last ${period === "7d" ? "7" : period === "30d" ? "30" : "90"} days`}
              icon={Ticket}
              accent="teal"
            />
            <KpiCard
              title="Open Now"
              value={data.openTickets}
              subtitle={data.openTickets > 0 ? "awaiting action" : "queue clear"}
              icon={MessageSquare}
              accent="amber"
            />
            <KpiCard
              title="Avg First Response"
              value={formatHours(data.avgFirstResponseHours)}
              subtitle={data.avgFirstResponseHours > 0 ? "from submission to first reply" : "no data yet"}
              icon={Clock}
              accent="blue"
            />
            <KpiCard
              title="SLA Breached"
              value={data.slaBreachedCount}
              subtitle={data.slaBreachedCount === 0 ? "all within SLA" : "tickets exceeded deadline"}
              icon={ShieldAlert}
              accent="red"
            />
          </>
        ) : null}
      </div>

      {/* Charts row */}
      <div className="grid gap-4 lg:grid-cols-[1fr_340px] items-start">
        {/* Volume chart */}
        <div className={cardChrome}>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-bold text-foreground">Ticket Volume</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Created vs resolved by day
              </p>
            </div>
          </div>
          <VolumeChart data={data?.volumeByDay ?? []} loading={isLoading} />
          <div className="flex gap-4 mt-4 text-xs text-slate-500 dark:text-slate-400">
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm" style={{ background: "#3b82f6" }} />
              Created
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm" style={{ background: "#10b981" }} />
              Resolved
            </span>
          </div>
        </div>

        {/* Category + Status sidebar */}
        <div className="space-y-4">
          <div className={cardChrome}>
            <h3 className="text-sm font-bold text-foreground mb-1">By Category</h3>
            <p className="text-xs text-muted-foreground mb-4">Distribution of ticket topics</p>
            <CategoryBars data={data?.categoryBreakdown ?? []} loading={isLoading} />
          </div>
          <div className={cardChrome}>
            <h3 className="text-sm font-bold text-foreground mb-1">By Status</h3>
            <p className="text-xs text-muted-foreground mb-4">Current ticket statuses</p>
            <StatusPills data={data?.statusBreakdown ?? []} loading={isLoading} />
          </div>
        </div>
      </div>

      {/* Team performance table */}
      <div className={cardChrome}>
        <div className="mb-4">
          <h3 className="text-sm font-bold text-foreground">Team Performance</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Resolution stats by assignee
          </p>
        </div>
        <TeamTable data={data?.teamPerformance ?? []} loading={isLoading} />
      </div>
    </div>
  )
}
