"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { BarChart3, PieChart, TrendingUp, MapPin, Loader2 } from "lucide-react"

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

const ZONE_COLORS = [
  "bg-blue-500", "bg-emerald-500", "bg-amber-500", "bg-purple-500",
  "bg-rose-500", "bg-cyan-500", "bg-orange-500", "bg-teal-500",
]

const TYPE_STYLES: Record<string, { color: string; bg: string; text: string }> = {
  LM: { color: "bg-emerald-500", bg: "bg-emerald-50", text: "text-emerald-700" },
  ALM: { color: "bg-blue-500", bg: "bg-blue-50", text: "text-blue-700" },
  ACM: { color: "bg-purple-500", bg: "bg-purple-50", text: "text-purple-700" },
  ILM: { color: "bg-amber-500", bg: "bg-amber-50", text: "text-amber-700" },
}

const STATE_COLORS = [
  "bg-indigo-500", "bg-violet-500", "bg-cyan-500", "bg-teal-500",
  "bg-sky-500", "bg-blue-400", "bg-emerald-400", "bg-fuchsia-500",
  "bg-rose-400", "bg-amber-400",
]

export default function ReportsPage() {
  const [data, setData] = useState<ReportsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch("/api/reports")
      .then((res) => {
        if (!res.ok) throw new Error("Failed to fetch reports")
        return res.json()
      })
      .then((json) => setData(json))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
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
  const maxMonthly = Math.max(...monthlyData.map((m) => m.count), 1)
  const maxState = stateData.length > 0 ? stateData[0].count : 1
  const typeTotal = typeData.reduce((s, r) => s + r.count, 0) || 1
  const maxType = Math.max(...typeData.map((t) => t.count), 1)

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Reports</h2>
        <p className="text-muted-foreground mt-1">Membership analytics and insights</p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Zone Distribution */}
        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-lg flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-100 text-blue-600">
                <PieChart className="h-4 w-4" />
              </div>
              Zone Distribution
            </CardTitle>
          </CardHeader>
          <CardContent>
            {zoneData.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">No zone data available.</p>
            ) : (
              <div className="space-y-4">
                {zoneData.map((zone, i) => {
                  const pct = Math.round((zone.count / zoneTotal) * 100)
                  const barColor = ZONE_COLORS[i % ZONE_COLORS.length]
                  return (
                    <div key={zone.zone} className="space-y-1.5">
                      <div className="flex items-center justify-between text-sm">
                        <div className="flex items-center gap-2">
                          <span className={`inline-block h-2.5 w-2.5 rounded-full ${barColor}`} />
                          <span className="font-medium">{zone.zone}</span>
                        </div>
                        <div className="flex items-baseline gap-1.5">
                          <span className="font-bold">{zone.count.toLocaleString()}</span>
                          <span className="text-xs text-muted-foreground">({pct}%)</span>
                        </div>
                      </div>
                      <div className="h-2.5 rounded-full bg-secondary overflow-hidden">
                        <div
                          className={`h-full rounded-full ${barColor} transition-all duration-500`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Monthly Applications */}
        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-lg flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-100 text-emerald-600">
                <TrendingUp className="h-4 w-4" />
              </div>
              Monthly Applications
            </CardTitle>
          </CardHeader>
          <CardContent>
            {monthlyData.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">No monthly data available.</p>
            ) : (
              <div className="space-y-3">
                {monthlyData.map((item) => {
                  const widthPct = Math.max((item.count / maxMonthly) * 100, 3)
                  return (
                    <div key={item.month} className="flex items-center gap-3">
                      <span className="text-sm text-muted-foreground w-20 shrink-0 text-right font-medium">{item.month}</span>
                      <div className="flex-1 h-8 rounded-lg bg-secondary/60 relative overflow-hidden">
                        <div
                          className="h-full rounded-lg bg-gradient-to-r from-emerald-500 to-emerald-400 flex items-center justify-end pr-3 transition-all duration-500"
                          style={{ width: `${widthPct}%` }}
                        >
                          {widthPct > 15 && (
                            <span className="text-xs font-bold text-white">
                              {item.count}
                            </span>
                          )}
                        </div>
                        {widthPct <= 15 && (
                          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-muted-foreground">
                            {item.count}
                          </span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Type Distribution */}
        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-lg flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-100 text-purple-600">
                <BarChart3 className="h-4 w-4" />
              </div>
              Membership Type Distribution
            </CardTitle>
          </CardHeader>
          <CardContent>
            {typeData.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">No type data available.</p>
            ) : (
              <div className="space-y-5">
                {typeData.map((item) => {
                  const styles = TYPE_STYLES[item.membership_type] || { color: "bg-gray-400", bg: "bg-gray-50", text: "text-gray-700" }
                  const pct = Math.round((item.count / typeTotal) * 100)
                  return (
                    <div key={item.membership_type} className="space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <div className="flex items-center gap-2">
                          <span className={`inline-block h-3 w-3 rounded-full ${styles.color}`} />
                          <span className="font-medium">{item.membership_type || "Unknown"}</span>
                        </div>
                        <div className="flex items-baseline gap-1.5">
                          <span className="text-lg font-bold">{item.count.toLocaleString()}</span>
                          <span className="text-xs text-muted-foreground">({pct}%)</span>
                        </div>
                      </div>
                      <div className="h-3 rounded-full bg-secondary overflow-hidden">
                        <div
                          className={`h-full rounded-full ${styles.color} transition-all duration-500`}
                          style={{ width: `${(item.count / maxType) * 100}%` }}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Top States */}
        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-lg flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-100 text-amber-600">
                <MapPin className="h-4 w-4" />
              </div>
              Top States
            </CardTitle>
          </CardHeader>
          <CardContent>
            {stateData.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">No state data available.</p>
            ) : (
              <div className="space-y-3.5">
                {stateData.map((item, i) => {
                  const barColor = STATE_COLORS[i % STATE_COLORS.length]
                  return (
                    <div key={item.state} className="flex items-center gap-3">
                      <span className="text-sm font-bold text-muted-foreground w-6 text-right">
                        {i + 1}
                      </span>
                      <div className="flex-1">
                        <div className="flex items-center justify-between text-sm mb-1.5">
                          <span className="font-medium">{item.state}</span>
                          <span className="font-bold">{item.count.toLocaleString()}</span>
                        </div>
                        <div className="h-2.5 rounded-full bg-secondary overflow-hidden">
                          <div
                            className={`h-full rounded-full ${barColor} transition-all duration-500`}
                            style={{ width: `${(item.count / maxState) * 100}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
