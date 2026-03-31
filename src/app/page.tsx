"use client"

import { StatCard } from "@/components/dashboard/stat-card"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Users, UserCheck, Clock, TrendingUp } from "lucide-react"

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Dashboard</h2>
        <p className="text-muted-foreground">AMASI Membership Management Overview</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Total Members"
          value="18,135"
          description="All registered members"
          icon={Users}
          trend="+12 this week"
        />
        <StatCard
          title="Active Members"
          value="16,890"
          description="With membership number"
          icon={UserCheck}
        />
        <StatCard
          title="Pending Actions"
          value="2"
          description="Awaiting verification"
          icon={Clock}
        />
        <StatCard
          title="This Month"
          value="45"
          description="New applications in March"
          icon={TrendingUp}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Recent Applications</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {[
                { name: "Dr. Vasudha Bhargavi", type: "ALM", date: "22 Feb 2026", status: "Approved" },
                { name: "Dr. Preethi K", type: "ALM", date: "30 Mar 2026", status: "Approved" },
                { name: "Dr. Devapriya Roy", type: "ALM", date: "30 Mar 2026", status: "Approved" },
                { name: "Dr. Vinitha R", type: "ALM", date: "30 Mar 2026", status: "Pending" },
                { name: "Dr. Anjali Agarwal", type: "LM", date: "30 Mar 2026", status: "Pending" },
              ].map((item, i) => (
                <div key={i} className="flex items-center justify-between py-2 border-b last:border-0">
                  <div>
                    <p className="font-medium text-sm">{item.name}</p>
                    <p className="text-xs text-muted-foreground">{item.type} - {item.date}</p>
                  </div>
                  <span
                    className={`text-xs font-medium px-2 py-1 rounded-full ${
                      item.status === "Approved"
                        ? "bg-success/10 text-success"
                        : "bg-warning/10 text-warning"
                    }`}
                  >
                    {item.status}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Membership Types</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {[
                { type: "Life Member (LM)", count: 8420, color: "bg-primary" },
                { type: "Associate Life Member (ALM)", count: 7890, color: "bg-blue-500" },
                { type: "Annual Member (AM)", count: 1200, color: "bg-purple-500" },
                { type: "Honorary Member", count: 45, color: "bg-amber-500" },
                { type: "International Member", count: 580, color: "bg-teal-500" },
              ].map((item, i) => (
                <div key={i} className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span>{item.type}</span>
                    <span className="font-medium">{item.count.toLocaleString()}</span>
                  </div>
                  <div className="h-2 rounded-full bg-secondary">
                    <div
                      className={`h-full rounded-full ${item.color}`}
                      style={{ width: `${(item.count / 8420) * 100}%` }}
                    />
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
