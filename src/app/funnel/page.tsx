"use client"

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Loader2, TrendingDown, FileCheck2, CreditCard, Send, Users } from "lucide-react"

interface FunnelStep {
  step: number
  label: string
  cohort: number
  next_step_cohort: number | null
  dropoff: number | null
  conversion_pct: number | null
}

interface FunnelResponse {
  window_days: number
  since: string
  total_events: number
  funnel: FunnelStep[]
  doc_upload: { extracted: number; rejected: number; uploaded: number; success_pct: number | null }
  payment: { captured: number }
  submit: { auto_approved: number; pending_review: number; total: number }
  unique_users_by_event: Record<string, number>
}

export default function FunnelPage() {
  const [days, setDays] = useState(30)

  const { data, isLoading, error, refetch, isFetching } = useQuery<FunnelResponse>({
    queryKey: ["funnel", days],
    queryFn: async () => {
      const res = await fetch(`/api/admin/funnel?days=${days}`)
      if (!res.ok) throw new Error("Failed to load funnel")
      return res.json()
    },
  })

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <TrendingDown className="h-6 w-6 text-teal-600" />
            Application Funnel
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Step-by-step conversion across the application flow.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {[7, 30, 90].map((d) => (
            <Button
              key={d}
              size="sm"
              variant={days === d ? "default" : "outline"}
              onClick={() => setDays(d)}
            >
              {d}d
            </Button>
          ))}
          <Button size="sm" variant="ghost" onClick={() => refetch()} disabled={isFetching}>
            {isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : "Refresh"}
          </Button>
        </div>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {error && (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="p-4 text-sm text-destructive">
            Failed to load funnel data.
          </CardContent>
        </Card>
      )}

      {data && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard
              icon={Users}
              label="Unique users (any event)"
              value={Object.values(data.unique_users_by_event).reduce((a, b) => Math.max(a, b), 0)}
            />
            <StatCard
              icon={FileCheck2}
              label="Doc OCR success"
              value={data.doc_upload.success_pct !== null ? `${data.doc_upload.success_pct}%` : "—"}
              hint={`${data.doc_upload.extracted} extracted / ${data.doc_upload.rejected} rejected`}
            />
            <StatCard
              icon={CreditCard}
              label="Payments captured"
              value={data.payment.captured}
            />
            <StatCard
              icon={Send}
              label="Submissions"
              value={data.submit.total}
              hint={`${data.submit.auto_approved} AI-approved · ${data.submit.pending_review} to review`}
            />
          </div>

          <Card>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 border-b">
                  <tr className="text-left">
                    <th className="p-3 w-14">Step</th>
                    <th className="p-3">Stage</th>
                    <th className="p-3 text-right">Cohort</th>
                    <th className="p-3 text-right">Advanced</th>
                    <th className="p-3 text-right">Drop-off</th>
                    <th className="p-3 text-right">Conversion</th>
                  </tr>
                </thead>
                <tbody>
                  {data.funnel.map((s) => (
                    <tr key={s.step} className="border-b last:border-0">
                      <td className="p-3 font-mono text-muted-foreground">{s.step}</td>
                      <td className="p-3 font-medium">{s.label}</td>
                      <td className="p-3 text-right tabular-nums">{s.cohort}</td>
                      <td className="p-3 text-right tabular-nums text-muted-foreground">
                        {s.next_step_cohort ?? "—"}
                      </td>
                      <td className="p-3 text-right tabular-nums">
                        {s.dropoff !== null ? (
                          <Badge variant={s.dropoff > 0 ? "destructive" : "secondary"} className="font-mono">
                            {s.dropoff > 0 ? `-${s.dropoff}` : "0"}
                          </Badge>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="p-3 text-right tabular-nums font-semibold">
                        {s.conversion_pct !== null ? `${s.conversion_pct}%` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>

          <p className="text-xs text-muted-foreground">
            Window: last {data.window_days} days · {data.total_events.toLocaleString()} events recorded · since {new Date(data.since).toLocaleDateString()}
          </p>
        </>
      )}
    </div>
  )
}

function StatCard({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string | number
  hint?: string
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Icon className="h-3.5 w-3.5" />
          {label}
        </div>
        <div className="text-2xl font-bold mt-1 tabular-nums">{value}</div>
        {hint && <div className="text-xs text-muted-foreground mt-1">{hint}</div>}
      </CardContent>
    </Card>
  )
}
