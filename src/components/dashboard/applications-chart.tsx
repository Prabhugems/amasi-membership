"use client"

import type { JSX } from "react"
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { useIsDark } from "@/hooks/use-is-dark"

interface ApplicationsChartProps {
  data: Array<{
    date: string // ISO YYYY-MM-DD or "HH:00" for hourly
    submitted: number
    approved: number
    manual: number
  }>
  loading?: boolean
}

function formatTick(value: string, index: number, total: number): string {
  // For hourly format like "14:00", return as-is
  if (value.includes(':')) return value
  // For dates YYYY-MM-DD, return "DD MMM" for first/last only, "DD" for others
  const d = new Date(value)
  if (isNaN(d.getTime())) return value
  const day = d.getDate()
  const month = d.toLocaleString('en-IN', { month: 'short' })
  if (index === 0 || index === total - 1) return `${day} ${month}`
  return String(day)
}

export function ApplicationsChart(props: ApplicationsChartProps): JSX.Element {
  const { data, loading } = props
  const isDark = useIsDark()

  if (loading) {
    return (
      <div className="h-[200px] w-full rounded-lg bg-gradient-to-b from-slate-100 to-slate-50 dark:from-slate-800 dark:to-slate-900 animate-pulse" />
    )
  }

  const hasData = data.some(
    (d) => (d.submitted ?? 0) + (d.approved ?? 0) + (d.manual ?? 0) > 0
  )

  if (data.length === 0 || !hasData) {
    return (
      <div className="flex flex-col items-center justify-center h-[160px] gap-2">
        <div className="text-sm text-slate-500 dark:text-slate-400">
          No submissions in this period
        </div>
        <div className="text-xs text-slate-500/70 dark:text-slate-400/60">
          Try selecting a wider range
        </div>
      </div>
    )
  }

  const total = data.length
  const interval = Math.max(0, Math.floor(data.length / 14))

  return (
    <div className="h-[200px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          barCategoryGap="28%"
          barGap={3}
          margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
        >
          <defs>
            <linearGradient id="grad-submitted" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.9} />
              <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.15} />
            </linearGradient>
            <linearGradient id="grad-approved" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#10b981" stopOpacity={0.95} />
              <stop offset="100%" stopColor="#10b981" stopOpacity={0.2} />
            </linearGradient>
            <linearGradient id="grad-manual" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#f59e0b" stopOpacity={0.9} />
              <stop offset="100%" stopColor="#f59e0b" stopOpacity={0.15} />
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
            tickFormatter={(value: string, index: number) => formatTick(value, index, total)}
          />
          <YAxis
            allowDecimals={false}
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 10, fill: isDark ? "#64748b" : "#94a3b8" }}
            width={32}
          />
          <Tooltip
            cursor={{ fill: 'rgba(128,128,128,0.06)' }}
            contentStyle={{
              backgroundColor: 'rgba(15,23,42,0.92)',
              border: 'none',
              borderRadius: '10px',
              padding: '8px 12px',
              fontSize: '12px',
              color: '#fff',
              boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
            }}
            labelStyle={{ color: '#fff', marginBottom: '4px' }}
            itemStyle={{ color: '#fff' }}
            labelFormatter={(label) => {
              const s = String(label ?? "")
              if (s.includes(':')) return s
              const d = new Date(s)
              if (isNaN(d.getTime())) return s
              return d.toLocaleDateString('en-IN', {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
              })
            }}
            formatter={(value, name) => {
              const labels: Record<string, string> = {
                submitted: 'Submitted',
                approved: 'Approved',
                manual: 'Manual review',
              }
              return [value as number, labels[String(name)] ?? String(name)]
            }}
          />
          <Bar
            dataKey="submitted"
            fill="url(#grad-submitted)"
            strokeWidth={0}
            radius={[6, 6, 0, 0]}
            isAnimationActive={true}
            animationDuration={1200}
            animationBegin={300}
            animationEasing="ease-out"
            activeBar={false}
          />
          <Bar
            dataKey="approved"
            fill="url(#grad-approved)"
            strokeWidth={0}
            radius={[6, 6, 0, 0]}
            isAnimationActive={true}
            animationDuration={1200}
            animationBegin={300}
            animationEasing="ease-out"
            activeBar={false}
          />
          <Bar
            dataKey="manual"
            fill="url(#grad-manual)"
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
