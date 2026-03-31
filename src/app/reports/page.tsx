"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { BarChart3, PieChart, TrendingUp, MapPin } from "lucide-react"

const zoneData = [
  { zone: "South Zone", count: 5200, percentage: 29 },
  { zone: "North Zone", count: 4800, percentage: 26 },
  { zone: "West Zone", count: 3900, percentage: 21 },
  { zone: "East Zone", count: 2800, percentage: 15 },
  { zone: "Central Zone", count: 1435, percentage: 8 },
]

const monthlyData = [
  { month: "Oct 2025", count: 32 },
  { month: "Nov 2025", count: 28 },
  { month: "Dec 2025", count: 41 },
  { month: "Jan 2026", count: 38 },
  { month: "Feb 2026", count: 52 },
  { month: "Mar 2026", count: 45 },
]

const stateData = [
  { state: "Maharashtra", count: 2800 },
  { state: "Tamil Nadu", count: 2200 },
  { state: "Karnataka", count: 1900 },
  { state: "Delhi", count: 1600 },
  { state: "Andhra Pradesh", count: 1400 },
  { state: "Kerala", count: 1200 },
  { state: "West Bengal", count: 1100 },
  { state: "Gujarat", count: 900 },
  { state: "Rajasthan", count: 800 },
  { state: "Uttar Pradesh", count: 750 },
]

export default function ReportsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Reports</h2>
        <p className="text-muted-foreground">Membership analytics and insights</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <PieChart className="h-5 w-5" /> Zone Distribution
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {zoneData.map((zone) => (
                <div key={zone.zone} className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span>{zone.zone}</span>
                    <span className="font-medium">{zone.count.toLocaleString()} ({zone.percentage}%)</span>
                  </div>
                  <div className="h-2.5 rounded-full bg-secondary">
                    <div
                      className="h-full rounded-full bg-primary transition-all"
                      style={{ width: `${zone.percentage * 3.4}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <TrendingUp className="h-5 w-5" /> Monthly Applications
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {monthlyData.map((item) => (
                <div key={item.month} className="flex items-center gap-3">
                  <span className="text-sm text-muted-foreground w-24">{item.month}</span>
                  <div className="flex-1 h-8 rounded bg-secondary relative">
                    <div
                      className="h-full rounded bg-primary/80 flex items-center justify-end pr-2 transition-all"
                      style={{ width: `${(item.count / 52) * 100}%` }}
                    >
                      <span className="text-xs font-medium text-primary-foreground">{item.count}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <MapPin className="h-5 w-5" /> Top 10 States
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2">
              {stateData.map((item, i) => (
                <div key={item.state} className="flex items-center gap-3">
                  <span className="text-sm font-medium text-muted-foreground w-6">{i + 1}.</span>
                  <div className="flex-1">
                    <div className="flex items-center justify-between text-sm mb-1">
                      <span>{item.state}</span>
                      <span className="font-medium">{item.count.toLocaleString()}</span>
                    </div>
                    <div className="h-2 rounded-full bg-secondary">
                      <div
                        className="h-full rounded-full bg-primary/70 transition-all"
                        style={{ width: `${(item.count / 2800) * 100}%` }}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
