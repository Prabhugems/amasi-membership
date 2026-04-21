"use client"

import { useEffect, useState, useMemo, useCallback, useRef } from "react"
import { useQuery } from "@tanstack/react-query"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  BarChart3, PieChart, TrendingUp, MapPin, Loader2, Users, Clock,
  CheckCircle2, Download, FileText, Calendar, ArrowUpRight, ArrowDownRight,
  Bot, ShieldCheck, XCircle, AlertTriangle, GitPullRequest,
  IndianRupee, Headphones, Timer, ShieldAlert, RefreshCw,
} from "lucide-react"
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart as RechartsPie, Pie, Cell, Legend,
  Area, AreaChart, ComposedChart,
} from "recharts"
import { StaggerContainer, StaggerItem } from "@/components/motion/stagger"

interface ZoneRow { zone: string; count: number }
interface StateRow { state: string; count: number }
interface MonthlyRow { month: string; count: number }
interface TypeRow { membership_type: string; count: number }
interface PipelineData {
  total: number
  approved: number
  rejected: number
  pending: number
  needClarification: number
  approvalRate: number
  avgProcessingHours: number
  aiAutoApproved: number
  aiAutoRate: number
  manualReviewCount: number
  statusBreakdown: { status: string; count: number }[]
  nmc: { verified: number; mismatch: number; notFound: number; skipped: number }
}
interface GrowthData {
  thisYear: number
  lastYear: number
  yoyPct: number
}
interface RevenueData {
  total: number
  paidCount: number
  failedCount: number
  pendingPayments: number
  avgAmount: number
  collectionRate: number
  monthlyTrend: { month: string; amount: number }[]
}
interface TicketsData {
  total: number
  open: number
  closed: number
  resolved: number
  slaBreached: number
  slaComplianceRate: number
  avgFirstResponseHours: number
  avgResolutionHours: number
  categoryBreakdown: { category: string; count: number }[]
  priorityBreakdown: { priority: string; count: number }[]
  statusBreakdown: { status: string; count: number }[]
}
interface ReportsData {
  zoneData: ZoneRow[]
  stateData: StateRow[]
  allStateData?: StateRow[]
  monthlyData: MonthlyRow[]
  typeData: TypeRow[]
  total?: number
  pipeline?: PipelineData
  revenue?: RevenueData
  tickets?: TicketsData
  growth?: GrowthData
}

interface RenewalMember {
  id: string
  name: string
  email: string
  amasi_number: number
  membership_type: string
  joining_date: string
  expiryDate: string
  daysUntilExpiry: number
}

interface RenewalsData {
  expired: RenewalMember[]
  expiringSoon: RenewalMember[]
  totalActive: number
}

interface RetentionYear { year: number; new: number; cumulative: number }
interface RetentionData { yearly: RetentionYear[] }

type DateRange = "30d" | "90d" | "year" | "all"
type ChartMode = "bar" | "pie" | "donut"

const TEAL_PALETTE = [
  "#0d9488", "#14b8a6", "#2dd4bf", "#5eead4",
  "#0f766e", "#115e59", "#134e4a", "#99f6e4",
]

const TYPE_COLORS: Record<string, string> = {
  LM: "#0d9488",
  ALM: "#3b82f6",
  ACM: "#8b5cf6",
  ILM: "#f59e0b",
}

const STATE_PALETTE = [
  "#0d9488", "#14b8a6", "#0ea5e9", "#6366f1", "#8b5cf6",
  "#ec4899", "#f59e0b", "#10b981", "#ef4444", "#06b6d4",
]

const PRIORITY_COLORS: Record<string, string> = {
  urgent: "#ef4444",
  high: "#f97316",
  normal: "#3b82f6",
  low: "#94a3b8",
}

const STATUS_COLORS: Record<string, string> = {
  approved: "#10b981",
  ai_approved: "#06b6d4",
  pending: "#f59e0b",
  submitted: "#f59e0b",
  pending_review: "#f97316",
  rejected: "#ef4444",
  need_clarification: "#8b5cf6",
}

const STATUS_LABELS: Record<string, string> = {
  approved: "Approved",
  ai_approved: "AI Approved",
  pending: "Pending",
  submitted: "Submitted",
  pending_review: "Pending Review",
  rejected: "Rejected",
  need_clarification: "Need Clarification",
}

const DATE_RANGES: { label: string; value: DateRange }[] = [
  { label: "Last 30 days", value: "30d" },
  { label: "Last 90 days", value: "90d" },
  { label: "This year", value: "year" },
  { label: "All time", value: "all" },
]

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white dark:bg-slate-900 border border-border rounded-lg shadow-lg px-3 py-2 text-sm">
      <p className="font-semibold text-foreground">{label}</p>
      {payload.map((entry: any, i: number) => (
        <p key={i} className="text-muted-foreground">
          <span className="inline-block w-2.5 h-2.5 rounded-full mr-1.5" style={{ backgroundColor: entry.color }} />
          {entry.name || "Count"}: <span className="font-bold text-foreground">{entry.value?.toLocaleString()}</span>
        </p>
      ))}
    </div>
  )
}

function PieTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null
  const d = payload[0]
  return (
    <div className="bg-white dark:bg-slate-900 border border-border rounded-lg shadow-lg px-3 py-2 text-sm">
      <p className="font-semibold">{d.name}</p>
      <p className="text-muted-foreground">
        Count: <span className="font-bold text-foreground">{d.value?.toLocaleString()}</span>
      </p>
      <p className="text-muted-foreground">
        Share: <span className="font-bold text-foreground">{typeof d.percent === "number" ? (d.percent * 100).toFixed(1) : "--"}%</span>
      </p>
    </div>
  )
}

function ChartToggle({ mode, onChange }: { mode: ChartMode; onChange: (m: ChartMode) => void }) {
  return (
    <div className="flex items-center border rounded-lg overflow-hidden bg-muted/50">
      {(["bar", "pie", "donut"] as ChartMode[]).map((m) => (
        <button
          key={m}
          onClick={() => onChange(m)}
          className={`px-2.5 py-1.5 text-xs font-medium transition-colors capitalize ${
            mode === m ? "bg-teal-600 text-white" : "text-muted-foreground hover:text-foreground hover:bg-muted"
          }`}
        >
          {m}
        </button>
      ))}
    </div>
  )
}

function formatHours(hours: number): string {
  if (hours === 0) return "--"
  if (hours < 1) return `${Math.round(hours * 60)}m`
  if (hours < 24) return `${Math.round(hours * 10) / 10}h`
  return `${Math.round((hours / 24) * 10) / 10}d`
}

export default function ReportsPage() {
  const [data, setData] = useState<ReportsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dateRange, setDateRange] = useState<DateRange>("all")
  const [zoneChartMode, setZoneChartMode] = useState<ChartMode>("pie")
  const [typeChartMode, setTypeChartMode] = useState<ChartMode>("donut")
  const [stateChartMode, setStateChartMode] = useState<ChartMode>("bar")
  const reportRef = useRef<HTMLDivElement>(null)

  const { data: renewals } = useQuery<RenewalsData>({
    queryKey: ["renewals"],
    queryFn: async () => {
      const res = await fetch("/api/members/renewals")
      if (!res.ok) throw new Error("Failed to fetch renewals")
      return res.json()
    },
    staleTime: 5 * 60 * 1000,
  })

  const { data: retention } = useQuery<RetentionData>({
    queryKey: ["retention"],
    queryFn: async () => {
      const res = await fetch("/api/reports/retention")
      if (!res.ok) throw new Error("Failed to fetch retention data")
      return res.json()
    },
    staleTime: 5 * 60 * 1000,
  })

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    const params = new URLSearchParams()
    if (dateRange !== "all") params.set("range", dateRange)
    fetch(`/api/reports${params.toString() ? `?${params}` : ""}`, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error("Failed to fetch reports")
        return res.json()
      })
      .then((json) => setData(json))
      .catch((err) => {
        if (err.name === "AbortError") return
        setError(err.message)
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [dateRange])

  // Filter monthly data by date range
  const filteredMonthlyData = useMemo(() => {
    if (!data) return []
    if (dateRange === "all") return data.monthlyData
    const now = new Date()
    let cutoff = new Date()
    if (dateRange === "30d") cutoff.setDate(now.getDate() - 30)
    else if (dateRange === "90d") cutoff.setDate(now.getDate() - 90)
    else if (dateRange === "year") cutoff = new Date(now.getFullYear(), 0, 1)
    const cutoffStr = cutoff.toISOString().substring(0, 7)
    return data.monthlyData.filter((m) => m.month >= cutoffStr)
  }, [data, dateRange])

  // Computed stats
  const stats = useMemo(() => {
    if (!data) return null
    const total = data.total || data.typeData.reduce((s, r) => s + r.count, 0)
    const monthlyTotal = filteredMonthlyData.reduce((s, m) => s + m.count, 0)
    const avgPerMonth = filteredMonthlyData.length > 0 ? Math.round(monthlyTotal / filteredMonthlyData.length) : 0
    const approvalRate = data.pipeline?.approvalRate ?? 0
    const avgProcessingHours = data.pipeline?.avgProcessingHours ?? 0
    return { total, monthlyTotal, avgPerMonth, approvalRate, avgProcessingHours }
  }, [data, filteredMonthlyData])

  const handleExportCSV = useCallback(() => {
    if (!data) return
    const rows = [["Category", "Item", "Count"]]
    data.zoneData.forEach((z) => rows.push(["Zone", z.zone, String(z.count)]))
    data.stateData.forEach((s) => rows.push(["State", s.state, String(s.count)]))
    data.monthlyData.forEach((m) => rows.push(["Monthly", m.month, String(m.count)]))
    data.typeData.forEach((t) => rows.push(["Type", t.membership_type, String(t.count)]))
    if (data.pipeline) {
      data.pipeline.statusBreakdown.forEach((s) => rows.push(["Application Status", STATUS_LABELS[s.status] || s.status, String(s.count)]))
      rows.push(["Pipeline", "Approval Rate", `${data.pipeline.approvalRate}%`])
      rows.push(["Pipeline", "Avg Processing Time", formatHours(data.pipeline.avgProcessingHours)])
      rows.push(["Pipeline", "AI Auto-Approved", String(data.pipeline.aiAutoApproved)])
      rows.push(["Pipeline", "Manual Review", String(data.pipeline.manualReviewCount)])
      rows.push(["NMC", "Verified", String(data.pipeline.nmc.verified)])
      rows.push(["NMC", "Mismatch", String(data.pipeline.nmc.mismatch)])
      rows.push(["NMC", "Not Found", String(data.pipeline.nmc.notFound)])
      rows.push(["NMC", "Skipped", String(data.pipeline.nmc.skipped)])
    }
    if (data.revenue) {
      rows.push(["Revenue", "Total", `₹${data.revenue.total}`])
      rows.push(["Revenue", "Paid Count", String(data.revenue.paidCount)])
      rows.push(["Revenue", "Failed Count", String(data.revenue.failedCount)])
      rows.push(["Revenue", "Avg Amount", `₹${data.revenue.avgAmount}`])
      rows.push(["Revenue", "Collection Rate", `${data.revenue.collectionRate}%`])
      data.revenue.monthlyTrend.forEach((m) => rows.push(["Monthly Revenue", m.month, `₹${m.amount}`]))
    }
    if (data.tickets) {
      rows.push(["Tickets", "Total", String(data.tickets.total)])
      rows.push(["Tickets", "Open", String(data.tickets.open)])
      rows.push(["Tickets", "SLA Compliance", `${data.tickets.slaComplianceRate}%`])
      rows.push(["Tickets", "SLA Breached", String(data.tickets.slaBreached)])
      rows.push(["Tickets", "Avg First Response", formatHours(data.tickets.avgFirstResponseHours)])
      rows.push(["Tickets", "Avg Resolution", formatHours(data.tickets.avgResolutionHours)])
      data.tickets.categoryBreakdown.forEach((c) => rows.push(["Ticket Category", c.category, String(c.count)]))
      data.tickets.priorityBreakdown.forEach((p) => rows.push(["Ticket Priority", p.priority, String(p.count)]))
    }
    if (data.growth) {
      rows.push(["Growth", "This Year", String(data.growth.thisYear)])
      rows.push(["Growth", "Last Year", String(data.growth.lastYear)])
      rows.push(["Growth", "YoY %", `${data.growth.yoyPct}%`])
    }
    if (retention?.yearly) {
      retention.yearly.forEach((y) => {
        rows.push(["Retention", String(y.year), `New: ${y.new} / Cumulative: ${y.cumulative}`])
      })
    }
    const csv = rows.map((r) => r.join(",")).join("\n")
    const blob = new Blob([csv], { type: "text/csv" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `amasi-report-${new Date().toISOString().split("T")[0]}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }, [data, retention])

  const handleExportPDF = useCallback(() => {
    const params = new URLSearchParams()
    if (dateRange !== "all") params.set("range", dateRange)
    window.open(`/api/reports/pdf${params.toString() ? `?${params}` : ""}`, "_blank")
  }, [dateRange])

  // Memoize all derived chart data (must be above early returns to satisfy Rules of Hooks)
  const { zoneData, stateData, allStateData, typeData, pipeline, growth, revenue, tickets, zonePieData, typePieData, stateBarData, statusPieData, nmcPieData, nmcTotal } = useMemo(() => {
    if (!data) return { zoneData: [], stateData: [], allStateData: [], typeData: [], pipeline: null, growth: null, revenue: null, tickets: null, zonePieData: [], typePieData: [], stateBarData: [], statusPieData: [], nmcPieData: [], nmcTotal: 1 }

    const { zoneData: zd, stateData: sd, allStateData: asd, typeData: td, pipeline: pl, growth: gr, revenue: rv, tickets: tk } = data

    const zoneTotal = zd.reduce((s: number, r: any) => s + r.count, 0) || 1
    const typeTotal = td.reduce((s: number, r: any) => s + r.count, 0) || 1

    const _zonePieData = zd.map((z: any) => ({ name: z.zone, value: z.count, percent: z.count / zoneTotal }))
    const _typePieData = td.map((t: any) => ({ name: t.membership_type, value: t.count, percent: t.count / typeTotal }))
    const _stateBarData = sd.slice(0, 10).map((s: any) => ({ name: s.state, count: s.count }))

    const _statusPieData = pl
      ? pl.statusBreakdown.map((s: any) => ({
          name: STATUS_LABELS[s.status] || s.status,
          value: s.count,
          color: STATUS_COLORS[s.status] || "#94a3b8",
        }))
      : []

    const _nmcPieData = pl
      ? [
          { name: "Verified", value: pl.nmc.verified, color: "#10b981" },
          { name: "Mismatch", value: pl.nmc.mismatch, color: "#f59e0b" },
          { name: "Not Found", value: pl.nmc.notFound, color: "#ef4444" },
          { name: "Skipped", value: pl.nmc.skipped, color: "#94a3b8" },
        ].filter((d) => d.value > 0)
      : []

    const _nmcTotal = _nmcPieData.reduce((s: number, d: any) => s + d.value, 0) || 1

    return {
      zoneData: zd, stateData: sd, allStateData: asd, typeData: td, pipeline: pl, growth: gr, revenue: rv, tickets: tk,
      zonePieData: _zonePieData,
      typePieData: _typePieData,
      stateBarData: _stateBarData,
      statusPieData: _statusPieData,
      nmcPieData: _nmcPieData,
      nmcTotal: _nmcTotal,
    }
  }, [data])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="py-20 text-center text-muted-foreground">
        Failed to load reports. {error}
      </div>
    )
  }

  return (
    <div className="space-y-6 print:space-y-4" ref={reportRef}>
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Reports & Analytics</h1>
          <p className="text-muted-foreground mt-1">Membership analytics, trends, and insights</p>
        </div>
        <div className="flex items-center gap-2 print:hidden">
          <Button variant="outline" size="sm" onClick={handleExportCSV} className="gap-1.5">
            <Download className="h-3.5 w-3.5" />
            Export CSV
          </Button>
          <Button variant="outline" size="sm" onClick={handleExportPDF} className="gap-1.5">
            <FileText className="h-3.5 w-3.5" />
            Export PDF
          </Button>
        </div>
      </div>

      {/* Date range selector */}
      <div className="flex items-center gap-2 print:hidden">
        <Calendar className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium text-muted-foreground">Period:</span>
        <div className="flex items-center border rounded-lg overflow-hidden bg-muted/50">
          {DATE_RANGES.map((r) => (
            <button
              key={r.value}
              onClick={() => setDateRange(r.value)}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                dateRange === r.value
                  ? "bg-teal-600 text-white"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* Summary cards */}
      {stats && (
        <StaggerContainer className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StaggerItem>
            <SummaryCard
              title="Total Members"
              value={stats.total.toLocaleString()}
              icon={Users}
              subtitle={growth ? `${growth.yoyPct >= 0 ? "+" : ""}${growth.yoyPct}% vs last year` : undefined}
              trend={growth && growth.yoyPct !== 0 ? `${growth.yoyPct >= 0 ? "+" : ""}${growth.yoyPct}%` : undefined}
              trendUp={growth ? growth.yoyPct >= 0 : undefined}
              color="teal"
            />
          </StaggerItem>
          <StaggerItem>
            <SummaryCard
              title="New This Period"
              value={stats.monthlyTotal.toLocaleString()}
              icon={ArrowUpRight}
              subtitle={`Avg ${stats.avgPerMonth}/month`}
              color="blue"
            />
          </StaggerItem>
          <StaggerItem>
            <SummaryCard
              title="Approval Rate"
              value={`${stats.approvalRate}%`}
              icon={CheckCircle2}
              subtitle={pipeline ? `${pipeline.approved.toLocaleString()} approved of ${(pipeline.approved + pipeline.rejected).toLocaleString()} closed` : "Approved vs rejected"}
              color="emerald"
            />
          </StaggerItem>
          <StaggerItem>
            <SummaryCard
              title="Avg Processing"
              value={formatHours(stats.avgProcessingHours)}
              icon={Clock}
              subtitle="Submit to approval"
              color="purple"
            />
          </StaggerItem>
        </StaggerContainer>
      )}

      {/* Application Pipeline Section */}
      {pipeline && pipeline.total > 0 && (
        <>
          <div className="flex items-center gap-2 mt-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-100 text-indigo-600">
              <GitPullRequest className="h-4 w-4" />
            </div>
            <h2 className="text-xl font-semibold tracking-tight">Application Pipeline</h2>
            <Badge variant="outline" className="ml-1 text-xs">{pipeline.total.toLocaleString()} applications</Badge>
          </div>

          <StaggerContainer className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StaggerItem>
              <MiniStatCard
                label="AI Auto-Approved"
                value={pipeline.aiAutoApproved.toLocaleString()}
                sub={`${pipeline.aiAutoRate}% of total`}
                icon={Bot}
                iconBg="bg-cyan-100"
                iconColor="text-cyan-600"
              />
            </StaggerItem>
            <StaggerItem>
              <MiniStatCard
                label="Manual Review"
                value={pipeline.manualReviewCount.toLocaleString()}
                sub={`${pipeline.total > 0 ? Math.round((pipeline.manualReviewCount / pipeline.total) * 100) : 0}% flagged`}
                icon={AlertTriangle}
                iconBg="bg-orange-100"
                iconColor="text-orange-600"
              />
            </StaggerItem>
            <StaggerItem>
              <MiniStatCard
                label="Rejected"
                value={pipeline.rejected.toLocaleString()}
                sub={`${pipeline.total > 0 ? Math.round((pipeline.rejected / pipeline.total) * 1000) / 10 : 0}% rejection rate`}
                icon={XCircle}
                iconBg="bg-red-100"
                iconColor="text-red-600"
              />
            </StaggerItem>
            <StaggerItem>
              <MiniStatCard
                label="Pending / Clarification"
                value={(pipeline.pending + pipeline.needClarification).toLocaleString()}
                sub={pipeline.needClarification > 0 ? `${pipeline.needClarification} need clarification` : "In queue"}
                icon={Clock}
                iconBg="bg-amber-100"
                iconColor="text-amber-600"
              />
            </StaggerItem>
          </StaggerContainer>

          <div className="grid gap-6 md:grid-cols-2">
            {/* Application Status Breakdown */}
            <Card className="card-lift">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-100 text-indigo-600">
                    <PieChart className="h-4 w-4" />
                  </div>
                  Application Status Breakdown
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <RechartsPie>
                      <Pie
                        data={statusPieData}
                        cx="50%"
                        cy="50%"
                        innerRadius={55}
                        outerRadius={95}
                        paddingAngle={2}
                        dataKey="value"
                        label={({ name, percent }: any) => `${name} (${((percent ?? 0) * 100).toFixed(0)}%)`}
                        labelLine={{ stroke: "#94a3b8" }}
                        isAnimationActive={true}
                        animationDuration={1200}
                        animationBegin={300}
                        animationEasing="ease-out"
                      >
                        {statusPieData.map((entry, i) => (
                          <Cell key={i} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip content={<PieTooltip />} />
                      <Legend />
                    </RechartsPie>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            {/* NMC Verification Stats */}
            <Card className="card-lift">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-100 text-emerald-600">
                    <ShieldCheck className="h-4 w-4" />
                  </div>
                  NMC Verification Results
                </CardTitle>
              </CardHeader>
              <CardContent>
                {nmcPieData.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-8 text-center">No NMC verification data available.</p>
                ) : (
                  <div className="space-y-4">
                    <div className="h-56">
                      <ResponsiveContainer width="100%" height="100%">
                        <RechartsPie>
                          <Pie
                            data={nmcPieData}
                            cx="50%"
                            cy="50%"
                            innerRadius={45}
                            outerRadius={80}
                            paddingAngle={3}
                            dataKey="value"
                            isAnimationActive={true}
                            animationDuration={1200}
                            animationBegin={300}
                            animationEasing="ease-out"
                          >
                            {nmcPieData.map((entry, i) => (
                              <Cell key={i} fill={entry.color} />
                            ))}
                          </Pie>
                          <Tooltip content={<PieTooltip />} />
                          <Legend />
                        </RechartsPie>
                      </ResponsiveContainer>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {nmcPieData.map((d) => (
                        <div key={d.name} className="flex items-center gap-2 text-sm">
                          <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: d.color }} />
                          <span className="text-muted-foreground">{d.name}:</span>
                          <span className="font-semibold">{d.value.toLocaleString()}</span>
                          <span className="text-muted-foreground text-xs">({Math.round((d.value / nmcTotal) * 100)}%)</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}

      {/* YoY Growth Card */}
      {growth && growth.lastYear > 0 && (
        <Card className="card-lift">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-100 text-teal-600">
                <TrendingUp className="h-4 w-4" />
              </div>
              Year-over-Year Growth
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-8 flex-wrap">
              <div>
                <p className="text-sm text-muted-foreground">This Year ({new Date().getFullYear()})</p>
                <p className="text-3xl font-bold">{growth.thisYear.toLocaleString()}</p>
              </div>
              <div className="text-4xl text-muted-foreground/30 font-light">vs</div>
              <div>
                <p className="text-sm text-muted-foreground">Last Year ({new Date().getFullYear() - 1})</p>
                <p className="text-3xl font-bold">{growth.lastYear.toLocaleString()}</p>
              </div>
              <div className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-lg font-bold ${
                growth.yoyPct >= 0 ? "bg-green-50 dark:bg-green-500/15 text-green-700 dark:text-green-300" : "bg-red-50 dark:bg-red-500/15 text-red-700 dark:text-red-300"
              }`}>
                {growth.yoyPct >= 0 ? <ArrowUpRight className="h-5 w-5" /> : <ArrowDownRight className="h-5 w-5" />}
                {growth.yoyPct >= 0 ? "+" : ""}{growth.yoyPct}%
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Membership Growth Over Time */}
      {retention && retention.yearly.length > 1 && (
        <Card className="card-lift">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-100 text-teal-600">
                <Users className="h-4 w-4" />
              </div>
              Membership Growth Over Time
              <Badge variant="outline" className="ml-1 text-xs">
                {retention.yearly.length} years
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={retention.yearly.map((y) => ({ name: String(y.year), "New Members": y.new, "Cumulative Members": y.cumulative }))}>
                  <defs>
                    <linearGradient id="colorCumulative" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#0d9488" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#0d9488" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                  <YAxis
                    yAxisId="left"
                    tick={{ fontSize: 12 }}
                    tickFormatter={(v) => v.toLocaleString()}
                    label={{ value: "Cumulative", angle: -90, position: "insideLeft", style: { fontSize: 11, fill: "#0d9488" } }}
                  />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    tick={{ fontSize: 12 }}
                    tickFormatter={(v) => v.toLocaleString()}
                    label={{ value: "New / Year", angle: 90, position: "insideRight", style: { fontSize: 11, fill: "#3b82f6" } }}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend />
                  <Area
                    yAxisId="left"
                    type="monotone"
                    dataKey="Cumulative Members"
                    stroke="#0d9488"
                    strokeWidth={2.5}
                    fill="url(#colorCumulative)"
                    dot={{ fill: "#0d9488", strokeWidth: 2, r: 4 }}
                    activeDot={{ r: 6, strokeWidth: 2, stroke: "#fff" }}
                    isAnimationActive={true}
                    animationDuration={1200}
                    animationBegin={300}
                    animationEasing="ease-out"
                  />
                  <Bar
                    yAxisId="right"
                    dataKey="New Members"
                    fill="#3b82f6"
                    radius={[4, 4, 0, 0]}
                    barSize={32}
                    isAnimationActive={true}
                    animationDuration={1200}
                    animationBegin={300}
                    animationEasing="ease-out"
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Revenue Section */}
      {revenue && revenue.paidCount > 0 && (
        <>
          <div className="flex items-center gap-2 mt-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-green-100 text-green-600">
              <IndianRupee className="h-4 w-4" />
            </div>
            <h2 className="text-xl font-semibold tracking-tight">Revenue</h2>
            <Badge variant="outline" className="ml-1 text-xs">{revenue.paidCount.toLocaleString()} payments</Badge>
          </div>

          <StaggerContainer className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StaggerItem>
              <MiniStatCard
                label="Total Revenue"
                value={`₹${revenue.total.toLocaleString()}`}
                sub={`${revenue.paidCount.toLocaleString()} paid transactions`}
                icon={IndianRupee}
                iconBg="bg-green-100"
                iconColor="text-green-600"
              />
            </StaggerItem>
            <StaggerItem>
              <MiniStatCard
                label="Avg Payment"
                value={`₹${revenue.avgAmount.toLocaleString()}`}
                sub="Per transaction"
                icon={IndianRupee}
                iconBg="bg-emerald-100"
                iconColor="text-emerald-600"
              />
            </StaggerItem>
            <StaggerItem>
              <MiniStatCard
                label="Collection Rate"
                value={`${revenue.collectionRate}%`}
                sub={`${revenue.failedCount} failed`}
                icon={CheckCircle2}
                iconBg="bg-teal-100"
                iconColor="text-teal-600"
              />
            </StaggerItem>
            <StaggerItem>
              <MiniStatCard
                label="Pending"
                value={revenue.pendingPayments.toLocaleString()}
                sub="Awaiting confirmation"
                icon={Clock}
                iconBg="bg-amber-100"
                iconColor="text-amber-600"
              />
            </StaggerItem>
          </StaggerContainer>

          {revenue.monthlyTrend.length > 1 && (
            <Card className="card-lift">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-green-100 text-green-600">
                    <TrendingUp className="h-4 w-4" />
                  </div>
                  Monthly Revenue Trend
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={revenue.monthlyTrend}>
                      <defs>
                        <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                      <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} />
                      <Tooltip
                        content={({ active, payload, label }: any) => {
                          if (!active || !payload?.length) return null
                          return (
                            <div className="bg-white dark:bg-slate-900 border border-border rounded-lg shadow-lg px-3 py-2 text-sm">
                              <p className="font-semibold">{label}</p>
                              <p className="text-muted-foreground">
                                Revenue: <span className="font-bold text-foreground">₹{payload[0].value?.toLocaleString()}</span>
                              </p>
                            </div>
                          )
                        }}
                      />
                      <Area
                        type="monotone"
                        dataKey="amount"
                        stroke="#10b981"
                        strokeWidth={2.5}
                        fill="url(#colorRevenue)"
                        dot={{ fill: "#10b981", strokeWidth: 2, r: 4 }}
                        activeDot={{ r: 6, strokeWidth: 2, stroke: "#fff" }}
                        isAnimationActive={true}
                        animationDuration={1200}
                        animationBegin={300}
                        animationEasing="ease-out"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* Support Tickets Section */}
      {tickets && tickets.total > 0 && (
        <>
          <div className="flex items-center gap-2 mt-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-100 text-violet-600">
              <Headphones className="h-4 w-4" />
            </div>
            <h2 className="text-xl font-semibold tracking-tight">Support Tickets</h2>
            <Badge variant="outline" className="ml-1 text-xs">{tickets.total.toLocaleString()} tickets</Badge>
          </div>

          <StaggerContainer className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StaggerItem>
              <MiniStatCard
                label="Open Tickets"
                value={tickets.open.toLocaleString()}
                sub={`${tickets.total.toLocaleString()} total`}
                icon={Headphones}
                iconBg="bg-violet-100"
                iconColor="text-violet-600"
              />
            </StaggerItem>
            <StaggerItem>
              <MiniStatCard
                label="SLA Compliance"
                value={`${tickets.slaComplianceRate}%`}
                sub={`${tickets.slaBreached} breached`}
                icon={ShieldAlert}
                iconBg={tickets.slaComplianceRate >= 90 ? "bg-green-100" : "bg-red-100"}
                iconColor={tickets.slaComplianceRate >= 90 ? "text-green-600" : "text-red-600"}
              />
            </StaggerItem>
            <StaggerItem>
              <MiniStatCard
                label="Avg First Response"
                value={formatHours(tickets.avgFirstResponseHours)}
                sub="Time to first reply"
                icon={Timer}
                iconBg="bg-blue-100"
                iconColor="text-blue-600"
              />
            </StaggerItem>
            <StaggerItem>
              <MiniStatCard
                label="Avg Resolution"
                value={formatHours(tickets.avgResolutionHours)}
                sub={`${(tickets.closed + tickets.resolved).toLocaleString()} resolved`}
                icon={CheckCircle2}
                iconBg="bg-emerald-100"
                iconColor="text-emerald-600"
              />
            </StaggerItem>
          </StaggerContainer>

          <div className="grid gap-6 md:grid-cols-2">
            {/* Category Breakdown */}
            {tickets.categoryBreakdown.length > 0 && (
              <Card className="card-lift">
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-100 text-violet-600">
                      <BarChart3 className="h-4 w-4" />
                    </div>
                    Tickets by Category
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={tickets.categoryBreakdown.slice(0, 8).map((c) => ({ name: c.category, count: c.count }))} layout="vertical" margin={{ left: 10 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" horizontal={false} />
                        <XAxis type="number" tick={{ fontSize: 12 }} />
                        <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} width={120} />
                        <Tooltip content={<CustomTooltip />} />
                        <Bar dataKey="count" fill="#8b5cf6" radius={[0, 4, 4, 0]} isAnimationActive={true} animationDuration={1200} animationBegin={300} animationEasing="ease-out" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Priority Breakdown */}
            {tickets.priorityBreakdown.length > 0 && (
              <Card className="card-lift">
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-rose-100 text-rose-600">
                      <AlertTriangle className="h-4 w-4" />
                    </div>
                    Tickets by Priority
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <RechartsPie>
                        <Pie
                          data={tickets.priorityBreakdown.map((p) => ({
                            name: p.priority.charAt(0).toUpperCase() + p.priority.slice(1),
                            value: p.count,
                            color: PRIORITY_COLORS[p.priority] || "#94a3b8",
                          }))}
                          cx="50%"
                          cy="50%"
                          innerRadius={45}
                          outerRadius={80}
                          paddingAngle={3}
                          dataKey="value"
                          isAnimationActive={true}
                          animationDuration={1200}
                          animationBegin={300}
                          animationEasing="ease-out"
                        >
                          {tickets.priorityBreakdown.map((p, i) => (
                            <Cell key={i} fill={PRIORITY_COLORS[p.priority] || "#94a3b8"} />
                          ))}
                        </Pie>
                        <Tooltip content={<PieTooltip />} />
                        <Legend />
                      </RechartsPie>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </>
      )}

      {/* Membership Renewals Section */}
      {renewals && (renewals.expiringSoon.length > 0 || renewals.expired.length > 0) && (
        <>
          <div className="flex items-center gap-2 mt-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-100 text-amber-600">
              <RefreshCw className="h-4 w-4" />
            </div>
            <h2 className="text-xl font-semibold tracking-tight">Membership Renewals</h2>
            <Badge variant="outline" className="ml-1 text-xs">
              {renewals.expiringSoon.length + renewals.expired.length} need attention
            </Badge>
          </div>

          <StaggerContainer className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <StaggerItem>
              <MiniStatCard
                label="Expiring Soon"
                value={renewals.expiringSoon.length.toLocaleString()}
                sub="Within 30 days"
                icon={Clock}
                iconBg="bg-amber-100"
                iconColor="text-amber-600"
              />
            </StaggerItem>
            <StaggerItem>
              <MiniStatCard
                label="Expired"
                value={renewals.expired.length.toLocaleString()}
                sub="Past expiry date"
                icon={XCircle}
                iconBg="bg-red-100"
                iconColor="text-red-600"
              />
            </StaggerItem>
            <StaggerItem>
              <MiniStatCard
                label="Active ACM"
                value={renewals.totalActive.toLocaleString()}
                sub="Currently valid"
                icon={CheckCircle2}
                iconBg="bg-green-100"
                iconColor="text-green-600"
              />
            </StaggerItem>
          </StaggerContainer>

          <Card className="card-lift">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-100 text-amber-600">
                  <RefreshCw className="h-4 w-4" />
                </div>
                Members Needing Renewal
              </CardTitle>
            </CardHeader>
            <CardContent>
              {[...renewals.expired, ...renewals.expiringSoon].length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">All ACM memberships are up to date.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left">
                        <th className="pb-2 font-medium text-muted-foreground">Name</th>
                        <th className="pb-2 font-medium text-muted-foreground">AMASI #</th>
                        <th className="pb-2 font-medium text-muted-foreground">Expiry Date</th>
                        <th className="pb-2 font-medium text-muted-foreground">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...renewals.expired, ...renewals.expiringSoon].slice(0, 20).map((m) => (
                        <tr key={m.id} className="border-b last:border-0">
                          <td className="py-2.5 font-medium">{m.name}</td>
                          <td className="py-2.5 font-mono text-xs">{m.amasi_number}</td>
                          <td className="py-2.5">{m.expiryDate}</td>
                          <td className="py-2.5">
                            {m.daysUntilExpiry < 0 ? (
                              <Badge variant="destructive" className="text-xs">
                                Expired {Math.abs(m.daysUntilExpiry)}d ago
                              </Badge>
                            ) : (
                              <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100 text-xs">
                                Expires in {m.daysUntilExpiry}d
                              </Badge>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {[...renewals.expired, ...renewals.expiringSoon].length > 20 && (
                    <p className="text-xs text-muted-foreground mt-3 text-center">
                      Showing 20 of {renewals.expired.length + renewals.expiringSoon.length} members
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {/* Charts grid */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Zone Distribution */}
        <Card className="card-lift">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-100 text-teal-600">
                  <PieChart className="h-4 w-4" />
                </div>
                Zone Distribution
              </CardTitle>
              <ChartToggle mode={zoneChartMode} onChange={setZoneChartMode} />
            </div>
          </CardHeader>
          <CardContent>
            {zoneData.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">No zone data available.</p>
            ) : (
              <div className="h-72">
                {zoneChartMode === "bar" ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={zoneData.map((z) => ({ name: z.zone, count: z.count }))}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                      <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                      <YAxis tick={{ fontSize: 12 }} />
                      <Tooltip content={<CustomTooltip />} />
                      <Bar
                        dataKey="count"
                        fill="#0d9488"
                        radius={[4, 4, 0, 0]}
                        isAnimationActive={true}
                        animationDuration={1200}
                        animationBegin={300}
                        animationEasing="ease-out"
                      />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <RechartsPie>
                      <Pie
                        data={zonePieData}
                        cx="50%"
                        cy="50%"
                        innerRadius={zoneChartMode === "donut" ? 50 : 0}
                        outerRadius={100}
                        paddingAngle={2}
                        dataKey="value"
                        label={({ name, percent }: any) => `${name} (${((percent ?? 0) * 100).toFixed(0)}%)`}
                        labelLine={{ stroke: "#94a3b8" }}
                        isAnimationActive={true}
                        animationDuration={1200}
                        animationBegin={300}
                        animationEasing="ease-out"
                      >
                        {zonePieData.map((_, i) => (
                          <Cell key={i} fill={TEAL_PALETTE[i % TEAL_PALETTE.length]} />
                        ))}
                      </Pie>
                      <Tooltip content={<PieTooltip />} />
                    </RechartsPie>
                  </ResponsiveContainer>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Membership Type Distribution */}
        <Card className="card-lift">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-100 text-purple-600">
                  <BarChart3 className="h-4 w-4" />
                </div>
                Membership Types
              </CardTitle>
              <ChartToggle mode={typeChartMode} onChange={setTypeChartMode} />
            </div>
          </CardHeader>
          <CardContent>
            {typeData.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">No type data available.</p>
            ) : (
              <div className="h-72">
                {typeChartMode === "bar" ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={typeData.map((t) => ({ name: t.membership_type || "Unknown", count: t.count }))}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                      <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                      <YAxis tick={{ fontSize: 12 }} />
                      <Tooltip content={<CustomTooltip />} />
                      <Bar
                        dataKey="count"
                        radius={[4, 4, 0, 0]}
                        isAnimationActive={true}
                        animationDuration={1200}
                        animationBegin={300}
                        animationEasing="ease-out"
                      >
                        {typeData.map((t, i) => (
                          <Cell key={i} fill={TYPE_COLORS[t.membership_type] || "#94a3b8"} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <RechartsPie>
                      <Pie
                        data={typePieData}
                        cx="50%"
                        cy="50%"
                        innerRadius={typeChartMode === "donut" ? 50 : 0}
                        outerRadius={100}
                        paddingAngle={2}
                        dataKey="value"
                        label={({ name, percent }: any) => `${name} (${((percent ?? 0) * 100).toFixed(0)}%)`}
                        labelLine={{ stroke: "#94a3b8" }}
                        isAnimationActive={true}
                        animationDuration={1200}
                        animationBegin={300}
                        animationEasing="ease-out"
                      >
                        {typePieData.map((entry, i) => (
                          <Cell key={i} fill={TYPE_COLORS[entry.name] || "#94a3b8"} />
                        ))}
                      </Pie>
                      <Tooltip content={<PieTooltip />} />
                      <Legend />
                    </RechartsPie>
                  </ResponsiveContainer>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Monthly Applications - Line/Area chart */}
        <Card className="md:col-span-2 card-lift">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-100 text-emerald-600">
                  <TrendingUp className="h-4 w-4" />
                </div>
                Members by Month
              </CardTitle>
              <Badge variant="outline" className="text-xs">
                {filteredMonthlyData.length} month{filteredMonthlyData.length !== 1 ? "s" : ""}
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            {filteredMonthlyData.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">No monthly data available for selected period.</p>
            ) : (
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={filteredMonthlyData.map((m) => ({ name: m.month, count: m.count }))}>
                    <defs>
                      <linearGradient id="colorApplications" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#0d9488" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#0d9488" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 12 }} />
                    <Tooltip content={<CustomTooltip />} />
                    <Area
                      type="monotone"
                      dataKey="count"
                      stroke="#0d9488"
                      strokeWidth={2.5}
                      fill="url(#colorApplications)"
                      dot={{ fill: "#0d9488", strokeWidth: 2, r: 4 }}
                      activeDot={{ r: 6, strokeWidth: 2, stroke: "#fff" }}
                      isAnimationActive={true}
                      animationDuration={1200}
                      animationBegin={300}
                      animationEasing="ease-out"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Top 10 States - Horizontal bar */}
        <Card className="card-lift">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-100 text-amber-600">
                  <MapPin className="h-4 w-4" />
                </div>
                Top 10 States
              </CardTitle>
              <ChartToggle mode={stateChartMode} onChange={setStateChartMode} />
            </div>
          </CardHeader>
          <CardContent>
            {stateBarData.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">No state data available.</p>
            ) : (
              <div className="h-80">
                {stateChartMode === "bar" ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={stateBarData} layout="vertical" margin={{ left: 20 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" horizontal={false} />
                      <XAxis type="number" tick={{ fontSize: 12 }} />
                      <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} width={110} />
                      <Tooltip content={<CustomTooltip />} />
                      <Bar
                        dataKey="count"
                        radius={[0, 4, 4, 0]}
                        isAnimationActive={true}
                        animationDuration={1200}
                        animationBegin={300}
                        animationEasing="ease-out"
                      >
                        {stateBarData.map((_, i) => (
                          <Cell key={i} fill={STATE_PALETTE[i % STATE_PALETTE.length]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                ) : stateChartMode === "pie" || stateChartMode === "donut" ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <RechartsPie>
                      <Pie
                        data={stateBarData.map((s) => ({ name: s.name, value: s.count }))}
                        cx="50%"
                        cy="50%"
                        innerRadius={stateChartMode === "donut" ? 45 : 0}
                        outerRadius={90}
                        paddingAngle={2}
                        dataKey="value"
                        label={({ name, percent }: any) => `${name} (${((percent ?? 0) * 100).toFixed(0)}%)`}
                        labelLine={{ stroke: "#94a3b8" }}
                        isAnimationActive={true}
                        animationDuration={1200}
                        animationBegin={300}
                        animationEasing="ease-out"
                      >
                        {stateBarData.map((_, i) => (
                          <Cell key={i} fill={STATE_PALETTE[i % STATE_PALETTE.length]} />
                        ))}
                      </Pie>
                      <Tooltip content={<PieTooltip />} />
                    </RechartsPie>
                  </ResponsiveContainer>
                ) : null}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Approval Breakdown — now uses real data */}
        <Card className="card-lift">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-green-100 text-green-600">
                <CheckCircle2 className="h-4 w-4" />
              </div>
              Approval Breakdown
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <RechartsPie>
                  <Pie
                    data={pipeline ? [
                      { name: "Approved", value: pipeline.approved, color: "#10b981" },
                      { name: "Pending", value: pipeline.pending, color: "#f59e0b" },
                      { name: "Rejected", value: pipeline.rejected, color: "#ef4444" },
                      { name: "Clarification", value: pipeline.needClarification, color: "#8b5cf6" },
                    ].filter((d) => d.value > 0) : []}
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={95}
                    paddingAngle={3}
                    dataKey="value"
                    label={({ name, percent }: any) => `${name} (${((percent ?? 0) * 100).toFixed(1)}%)`}
                    labelLine={{ stroke: "#94a3b8" }}
                    isAnimationActive={true}
                    animationDuration={1200}
                    animationBegin={300}
                    animationEasing="ease-out"
                  >
                    {(pipeline ? [
                      { name: "Approved", value: pipeline.approved, color: "#10b981" },
                      { name: "Pending", value: pipeline.pending, color: "#f59e0b" },
                      { name: "Rejected", value: pipeline.rejected, color: "#ef4444" },
                      { name: "Clarification", value: pipeline.needClarification, color: "#8b5cf6" },
                    ].filter((d) => d.value > 0) : []).map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip content={<PieTooltip />} />
                  <Legend />
                </RechartsPie>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Geographic Distribution — all states grid */}
        {(allStateData ?? stateData).length > 0 && (
          <Card className="md:col-span-2 card-lift">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-100 text-teal-600">
                  <MapPin className="h-4 w-4" />
                </div>
                Geographic Distribution
                <Badge variant="outline" className="ml-1 text-xs">
                  {(allStateData ?? stateData).length} states
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <StateGrid states={allStateData ?? stateData} />
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}

function SummaryCard({
  title, value, icon: Icon, trend, trendUp, subtitle, color,
}: {
  title: string
  value: string
  icon: typeof Users
  trend?: string
  trendUp?: boolean
  subtitle?: string
  color: "teal" | "blue" | "emerald" | "purple"
}) {
  const colorMap = {
    teal: { bg: "bg-teal-100 dark:bg-teal-500/20", text: "text-teal-600 dark:text-teal-300", ring: "ring-teal-50 dark:ring-teal-500/10" },
    blue: { bg: "bg-blue-100 dark:bg-blue-500/20", text: "text-blue-600 dark:text-blue-300", ring: "ring-blue-50 dark:ring-blue-500/10" },
    emerald: { bg: "bg-emerald-100 dark:bg-emerald-500/20", text: "text-emerald-600 dark:text-emerald-300", ring: "ring-emerald-50 dark:ring-emerald-500/10" },
    purple: { bg: "bg-purple-100 dark:bg-purple-500/20", text: "text-purple-600 dark:text-purple-300", ring: "ring-purple-50 dark:ring-purple-500/10" },
  }
  const c = colorMap[color]

  return (
    <Card className="card-lift">
      <CardContent className="py-5 px-6">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm font-medium text-muted-foreground">{title}</p>
            <p className="text-3xl font-bold tracking-tight mt-1">{value}</p>
            {trend && (
              <div className={`flex items-center gap-1 mt-1.5 text-xs font-medium ${trendUp ? "text-green-600" : "text-red-600"}`}>
                {trendUp ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                {trend} vs last period
              </div>
            )}
            {subtitle && !trend && (
              <p className="text-xs text-muted-foreground mt-1.5">{subtitle}</p>
            )}
          </div>
          <div className={`flex h-12 w-12 items-center justify-center rounded-xl ${c.bg} ${c.text} ring-4 ${c.ring}`}>
            <Icon className="h-6 w-6" />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function MiniStatCard({
  label, value, sub, icon: Icon, iconBg, iconColor,
}: {
  label: string
  value: string
  sub: string
  icon: typeof Users
  iconBg: string
  iconColor: string
}) {
  return (
    <Card className="card-lift">
      <CardContent className="py-4 px-5">
        <div className="flex items-center gap-3">
          <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${iconBg} ${iconColor} shrink-0`}>
            <Icon className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-medium text-muted-foreground truncate">{label}</p>
            <p className="text-2xl font-bold tracking-tight">{value}</p>
            <p className="text-xs text-muted-foreground">{sub}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function StateGrid({ states }: { states: StateRow[] }) {
  const total = states.reduce((s, r) => s + r.count, 0) || 1
  const maxCount = states[0]?.count || 1

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
      {states.map((s) => {
        const intensity = Math.max(0.08, s.count / maxCount)
        const pct = ((s.count / total) * 100).toFixed(1)
        return (
          <div
            key={s.state}
            className="relative rounded-lg border border-teal-200/60 px-3 py-2.5 transition-shadow hover:shadow-md"
            style={{
              backgroundColor: `rgba(13, 148, 136, ${intensity * 0.25})`,
            }}
          >
            <p
              className="text-xs font-semibold truncate"
              style={{
                color: intensity > 0.5 ? "#134e4a" : "#0f766e",
              }}
              title={s.state}
            >
              {s.state}
            </p>
            <p className="text-lg font-bold text-slate-900 dark:text-slate-100 leading-tight mt-0.5">
              {s.count.toLocaleString()}
            </p>
            <p className="text-[10px] text-muted-foreground">{pct}%</p>
          </div>
        )
      })}
    </div>
  )
}
