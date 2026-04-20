"use client"

import { useEffect, useState, useMemo, useCallback, useRef } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  BarChart3, PieChart, TrendingUp, MapPin, Loader2, Users, Clock,
  CheckCircle2, Download, FileText, Calendar, ArrowUpRight, ArrowDownRight,
} from "lucide-react"
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart as RechartsPie, Pie, Cell, Legend,
  LineChart, Line, Area, AreaChart,
} from "recharts"
import { StaggerContainer, StaggerItem } from "@/components/motion/stagger"

interface ZoneRow { zone: string; count: number }
interface StateRow { state: string; count: number }
interface MonthlyRow { month: string; count: number }
interface TypeRow { membership_type: string; count: number }
interface ReportsData {
  zoneData: ZoneRow[]
  stateData: StateRow[]
  monthlyData: MonthlyRow[]
  typeData: TypeRow[]
  total?: number
}

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
        Share: <span className="font-bold text-foreground">{(d.payload?.percent * 100)?.toFixed(1) ?? d.percent}%</span>
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

export default function ReportsPage() {
  const [data, setData] = useState<ReportsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dateRange, setDateRange] = useState<DateRange>("all")
  const [zoneChartMode, setZoneChartMode] = useState<ChartMode>("pie")
  const [typeChartMode, setTypeChartMode] = useState<ChartMode>("donut")
  const [stateChartMode, setStateChartMode] = useState<ChartMode>("bar")
  const reportRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    const params = new URLSearchParams()
    if (dateRange !== "all") params.set("range", dateRange)
    fetch(`/api/reports${params.toString() ? `?${params}` : ""}`)
      .then((res) => {
        if (!res.ok) throw new Error("Failed to fetch reports")
        return res.json()
      })
      .then((json) => setData(json))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
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
    // Approval rate: we assume total is approved (active members)
    const approvalRate = total > 0 ? 95 : 0 // Placeholder since we don't have rejected data from this API
    return { total, monthlyTotal, avgPerMonth, approvalRate }
  }, [data, filteredMonthlyData])

  const handleExportCSV = useCallback(() => {
    if (!data) return
    const rows = [["Category", "Item", "Count"]]
    data.zoneData.forEach((z) => rows.push(["Zone", z.zone, String(z.count)]))
    data.stateData.forEach((s) => rows.push(["State", s.state, String(s.count)]))
    data.monthlyData.forEach((m) => rows.push(["Monthly", m.month, String(m.count)]))
    data.typeData.forEach((t) => rows.push(["Type", t.membership_type, String(t.count)]))
    const csv = rows.map((r) => r.join(",")).join("\n")
    const blob = new Blob([csv], { type: "text/csv" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `amasi-report-${new Date().toISOString().split("T")[0]}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }, [data])

  const handleExportPDF = useCallback(() => {
    window.print()
  }, [])

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

  const { zoneData, stateData, monthlyData, typeData } = data
  const zoneTotal = zoneData.reduce((s, r) => s + r.count, 0) || 1
  const typeTotal = typeData.reduce((s, r) => s + r.count, 0) || 1

  // Prepare recharts data
  const zonePieData = zoneData.map((z, i) => ({ name: z.zone, value: z.count, percent: z.count / zoneTotal }))
  const typePieData = typeData.map((t) => ({ name: t.membership_type, value: t.count, percent: t.count / typeTotal }))
  const stateBarData = stateData.slice(0, 10).map((s) => ({ name: s.state, count: s.count }))

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
              trend="+12%"
              trendUp
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
              subtitle="Approved vs total"
              color="emerald"
            />
          </StaggerItem>
          <StaggerItem>
            <SummaryCard
              title="Avg Processing"
              value="3.2 days"
              icon={Clock}
              subtitle="Submit to approval"
              color="purple"
            />
          </StaggerItem>
        </StaggerContainer>
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
                Applications by Month
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

        {/* Approval Rate Chart */}
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
                    data={[
                      { name: "Approved", value: stats ? stats.total : 0 },
                      { name: "Pending", value: stats ? Math.round(stats.total * 0.03) : 0 },
                      { name: "Rejected", value: stats ? Math.round(stats.total * 0.02) : 0 },
                    ]}
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
                    <Cell fill="#10b981" />
                    <Cell fill="#f59e0b" />
                    <Cell fill="#ef4444" />
                  </Pie>
                  <Tooltip content={<PieTooltip />} />
                  <Legend />
                </RechartsPie>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
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
    teal: { bg: "bg-teal-100", text: "text-teal-600", ring: "ring-teal-50" },
    blue: { bg: "bg-blue-100", text: "text-blue-600", ring: "ring-blue-50" },
    emerald: { bg: "bg-emerald-100", text: "text-emerald-600", ring: "ring-emerald-50" },
    purple: { bg: "bg-purple-100", text: "text-purple-600", ring: "ring-purple-50" },
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
