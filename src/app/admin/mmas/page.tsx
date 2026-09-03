"use client"

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Award, Send } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { toast } from "sonner"

interface MmasStatsResponse {
  stats: {
    total: number
    byCourse: { id: number; name: string; count: number }[]
  }
  years: number[]
}

interface BulkEmailProgress {
  sent: number
  failed: number
  failedDetails: { amasi_number: number; email: string; reason: string }[]
  done: boolean
}

function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="border rounded-2xl p-5 bg-card">
      <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground font-semibold">
        {label}
      </div>
      <div className="mt-2 text-3xl font-bold tracking-tight tabular-nums leading-none">{value}</div>
      {hint && <div className="text-xs text-muted-foreground mt-2">{hint}</div>}
    </div>
  )
}

export default function AdminMmasPage() {
  const YEAR = 2026

  const { data, isLoading } = useQuery<MmasStatsResponse>({
    queryKey: ["admin-mmas-stats"],
    queryFn: async () => {
      const res = await fetch("/api/admin/mmas")
      if (!res.ok) throw new Error("Failed to load MMAS stats")
      return res.json()
    },
  })

  const [bulkEmailOpen, setBulkEmailOpen] = useState(false)
  const [bulkSending, setBulkSending] = useState(false)
  const [bulkProgress, setBulkProgress] = useState<BulkEmailProgress | null>(null)

  const eligibleQuery = useQuery<{ eligible_count: number }>({
    queryKey: ["admin-mmas-bulk-eligible", YEAR],
    queryFn: async () => {
      const res = await fetch(`/api/admin/mmas/email-cert-bulk?year=${YEAR}`)
      if (!res.ok) throw new Error("Failed to load eligible count")
      return res.json()
    },
    enabled: bulkEmailOpen && !bulkProgress,
  })

  const runBulkSend = async () => {
    setBulkSending(true)
    setBulkProgress({ sent: 0, failed: 0, failedDetails: [], done: false })
    try {
      let remaining = 1
      while (remaining > 0) {
        const res = await fetch("/api/admin/mmas/email-cert-bulk", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ year: YEAR }),
        })
        const json = await res.json()
        if (!res.ok || !json.status) {
          throw new Error(json.message || json.error || "Bulk send failed")
        }
        remaining = json.remaining
        setBulkProgress((prev) => ({
          sent: (prev?.sent ?? 0) + json.sent,
          failed: (prev?.failed ?? 0) + json.failed,
          failedDetails: [...(prev?.failedDetails ?? []), ...json.failedDetails].slice(0, 50),
          done: remaining === 0,
        }))
        if (json.sent === 0 && json.failed === 0 && json.totalEligible === 0) break
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Bulk send failed")
    } finally {
      setBulkSending(false)
      setBulkProgress((prev) => (prev ? { ...prev, done: true } : prev))
    }
  }

  const stats = data?.stats

  return (
    <div className="space-y-6">
      <div className="border rounded-2xl bg-card p-6 md:p-7 flex items-start justify-between flex-wrap gap-4">
        <div className="flex items-start gap-4 min-w-0">
          <div className="h-12 w-12 rounded-2xl bg-amber-500 flex items-center justify-center shrink-0">
            <Award className="h-6 w-6 text-white" />
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-700 dark:text-amber-400 mb-1">
              Credential Console
            </div>
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight">MMAS Holders</h1>
            <p className="text-muted-foreground mt-1.5 text-sm">Mastery in Minimal Access Surgery</p>
          </div>
        </div>
        <Button
          variant="outline"
          onClick={() => {
            setBulkProgress(null)
            setBulkEmailOpen(true)
          }}
          className="gap-2"
        >
          <Send className="h-4 w-4" />
          Email {YEAR} certificates
        </Button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Total holders" value={isLoading ? "—" : (stats?.total ?? 0)} />
        {(stats?.byCourse ?? []).map((c) => (
          <Stat key={c.id} label={c.name} value={c.count} />
        ))}
      </div>

      <ConfirmDialog
        open={bulkEmailOpen}
        onOpenChange={(o) => {
          if (!bulkSending) setBulkEmailOpen(o)
        }}
        title={`Email MMAS ${YEAR} certificates`}
        confirmLabel={bulkProgress?.done ? "Close" : bulkSending ? "Sending…" : "Send emails"}
        isPending={bulkSending}
        onConfirm={() => {
          if (bulkProgress?.done) {
            setBulkEmailOpen(false)
            return
          }
          runBulkSend()
        }}
      >
        {!bulkProgress && (
          <p>
            {eligibleQuery.isLoading
              ? "Checking who still needs one…"
              : `This will email the certificate to ${(eligibleQuery.data?.eligible_count ?? 0).toLocaleString("en-IN")} candidate(s) for ${YEAR} who haven't been emailed yet. Already-emailed candidates are skipped automatically.`}
          </p>
        )}
        {bulkProgress && (
          <div className="space-y-2">
            <p>
              Sent <span className="font-semibold text-foreground">{bulkProgress.sent}</span>
              {" · "}
              Failed <span className="font-semibold text-foreground">{bulkProgress.failed}</span>
              {!bulkProgress.done && " · sending…"}
            </p>
            {bulkProgress.done && <p className="font-medium text-foreground">Done.</p>}
            {bulkProgress.failedDetails.length > 0 && (
              <ul className="text-xs max-h-32 overflow-y-auto space-y-0.5 border rounded-md p-2">
                {bulkProgress.failedDetails.map((f) => (
                  <li key={f.amasi_number}>
                    #{f.amasi_number} {f.email} — {f.reason}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </ConfirmDialog>
    </div>
  )
}
