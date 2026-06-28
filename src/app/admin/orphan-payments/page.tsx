"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { AlertTriangle, ArrowRightCircle, Loader2, RefreshCw, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { toast } from "sonner"

type DraftHint = {
  draft_id: string
  draft_status: string | null
  match_source: "reference_number" | "email"
  email_match_count?: number
}

type OrphanPayment = {
  id: string
  gateway_payment_id: string | null
  gateway_order_id: string | null
  amount: number | null
  currency: string | null
  member_email: string | null
  reference_number: string | null
  created_at: string | null
  draft_hint: DraftHint | null
}

const DEFAULT_DAYS = 30

function formatAmount(amount: number | null, currency: string | null): string {
  if (amount == null) return "—"
  const symbol = currency === "INR" || !currency ? "₹" : `${currency} `
  return `${symbol}${amount.toLocaleString("en-IN")}`
}

function formatDate(iso: string | null): string {
  if (!iso) return "—"
  return new Date(iso).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function displayEmail(email: string | null): string {
  if (!email) return "—"
  if (email.endsWith("@razorpay-webhook.invalid")) return "(no email — webhook only)"
  return email
}

export default function OrphanPaymentsPage() {
  const [rows, setRows] = useState<OrphanPayment[]>([])
  const [loading, setLoading] = useState(true)
  const [authorized, setAuthorized] = useState(true)
  const [days, setDays] = useState<number>(DEFAULT_DAYS)
  const [filter, setFilter] = useState("")
  const [target, setTarget] = useState<OrphanPayment | null>(null)
  const [promoting, setPromoting] = useState(false)

  const fetchRows = useCallback(async (lookbackDays: number) => {
    setLoading(true)
    try {
      const res = await fetch(`/api/admin/orphan-payments?days=${lookbackDays}`)
      if (res.status === 401 || res.status === 403) {
        setAuthorized(false)
        return
      }
      const data = await res.json()
      if (data?.status) {
        setRows(data.data ?? [])
      } else {
        toast.error(data?.message || "Failed to load orphan payments")
      }
    } catch {
      toast.error("Failed to load orphan payments")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchRows(days)
  }, [fetchRows, days])

  const handlePromote = useCallback(async () => {
    if (!target) return
    setPromoting(true)
    try {
      const res = await fetch("/api/admin/orphan-payments/promote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: target.id }),
      })
      const data = await res.json()
      if (res.ok && data?.status) {
        toast.success(data.message || "Moved to Pending Actions")
        setTarget(null)
        fetchRows(days)
      } else {
        toast.error(data?.message || "Failed to move payment")
      }
    } catch {
      toast.error("Failed to move payment")
    } finally {
      setPromoting(false)
    }
  }, [target, days, fetchRows])

  const filtered = useMemo(() => {
    if (!filter.trim()) return rows
    const q = filter.trim().toLowerCase()
    return rows.filter((r) =>
      [r.member_email, r.gateway_payment_id, r.gateway_order_id, r.reference_number]
        .filter(Boolean)
        .some((v) => v!.toLowerCase().includes(q))
    )
  }, [rows, filter])

  if (!authorized) {
    return (
      <div className="flex flex-col items-center justify-center py-24">
        <div className="h-16 w-16 rounded-md bg-muted border flex items-center justify-center mb-4">
          <AlertTriangle className="h-8 w-8 text-muted-foreground" />
        </div>
        <h2 className="text-xl font-bold mb-2">Access denied</h2>
        <p className="text-muted-foreground">Admin session required.</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs uppercase tracking-wider text-muted-foreground">
          Payment recovery
        </p>
        <h1 className="text-2xl font-bold tracking-tight mt-1">Orphan payments</h1>
        <p className="text-sm text-muted-foreground mt-2 max-w-2xl">
          Razorpay payments captured with no linked application row. Use this list
          to identify applicants who paid but never completed the submit step, then
          move them straight into the Pending Actions review queue.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="days" className="text-xs font-medium text-muted-foreground block mb-1">
            Lookback (days)
          </label>
          <Input
            id="days"
            type="number"
            min={1}
            max={90}
            value={days}
            onChange={(e) => {
              const n = Number.parseInt(e.target.value, 10)
              if (Number.isFinite(n) && n > 0) setDays(Math.min(n, 90))
            }}
            className="w-28"
          />
        </div>
        <div className="flex-1 min-w-[200px]">
          <label htmlFor="filter" className="text-xs font-medium text-muted-foreground block mb-1">
            Filter
          </label>
          <div className="relative">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="filter"
              placeholder="email, payment id, order id, reference"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>
        <Button
          variant="outline"
          onClick={() => fetchRows(days)}
          disabled={loading}
          className="gap-2"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Refresh
        </Button>
      </div>

      <div className="rounded-md border bg-card overflow-hidden">
        {loading ? (
          <div className="p-12 text-center">
            <Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" />
            <p className="text-sm text-muted-foreground mt-2">Loading orphan payments…</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center">
            <div className="h-12 w-12 rounded-md bg-muted border flex items-center justify-center mx-auto mb-3">
              <AlertTriangle className="h-5 w-5 text-muted-foreground" />
            </div>
            <p className="text-sm font-medium">No orphan payments in the last {days} days</p>
            <p className="text-xs text-muted-foreground mt-1">
              Every paid payment is linked to an application row.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/60 border-b">
                  <th scope="col" className="text-left px-4 py-3 font-medium text-xs uppercase tracking-wider text-muted-foreground">Captured</th>
                  <th scope="col" className="text-left px-4 py-3 font-medium text-xs uppercase tracking-wider text-muted-foreground">Email</th>
                  <th scope="col" className="text-right px-4 py-3 font-medium text-xs uppercase tracking-wider text-muted-foreground">Amount</th>
                  <th scope="col" className="text-left px-4 py-3 font-medium text-xs uppercase tracking-wider text-muted-foreground">Payment ID</th>
                  <th scope="col" className="text-left px-4 py-3 font-medium text-xs uppercase tracking-wider text-muted-foreground">Order ID</th>
                  <th scope="col" className="text-left px-4 py-3 font-medium text-xs uppercase tracking-wider text-muted-foreground">Reference</th>
                  <th scope="col" className="text-left px-4 py-3 font-medium text-xs uppercase tracking-wider text-muted-foreground">Draft hint</th>
                  <th scope="col" className="text-right px-4 py-3 font-medium text-xs uppercase tracking-wider text-muted-foreground">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((r) => (
                  <tr key={r.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3 whitespace-nowrap text-xs text-muted-foreground">
                      {formatDate(r.created_at)}
                    </td>
                    <td className="px-4 py-3">
                      <span className={r.member_email?.endsWith("@razorpay-webhook.invalid") ? "text-muted-foreground italic" : ""}>
                        {displayEmail(r.member_email)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap font-medium">
                      {formatAmount(r.amount, r.currency)}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">
                      {r.gateway_payment_id || "—"}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                      {r.gateway_order_id || "—"}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">
                      {r.reference_number || <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      <DraftHintCell hint={r.draft_hint} />
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1.5"
                        onClick={() => setTarget(r)}
                      >
                        <ArrowRightCircle className="h-3.5 w-3.5" />
                        Move to pending
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="text-xs text-muted-foreground max-w-2xl">
        Draft hints are correlations, not authoritative links. A reference-number
        match is reliable; an email match is a fuzzy hint — email is not unique
        across drafts, so the highlighted draft may not be the one this payment
        belongs to. Use the payment ID and timestamps to confirm before acting.
      </p>

      <ConfirmDialog
        open={target !== null}
        onOpenChange={(open) => {
          if (!open && !promoting) setTarget(null)
        }}
        title="Move payment to Pending Actions?"
        confirmLabel="Move to pending"
        onConfirm={handlePromote}
        isPending={promoting}
      >
        <p>
          This creates a reviewable application for this payment and adds it to the
          Pending Actions queue. If the payer&apos;s draft still has their details and
          documents, the full application is rebuilt; otherwise a flagged skeleton is
          created for manual completion. The payment is linked — no second charge.
        </p>
        {target && (
          <div className="rounded-md border bg-muted/40 p-3 text-xs space-y-1">
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Email</span>
              <span className="font-medium text-right">{displayEmail(target.member_email)}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Amount</span>
              <span className="font-medium">{formatAmount(target.amount, target.currency)}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Payment ID</span>
              <span className="font-mono">{target.gateway_payment_id || "—"}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Draft</span>
              <span className="text-right">{target.draft_hint ? "matched — full rebuild" : "none — skeleton"}</span>
            </div>
          </div>
        )}
      </ConfirmDialog>
    </div>
  )
}

function DraftHintCell({ hint }: { hint: DraftHint | null }) {
  if (!hint) {
    return <span className="text-xs text-muted-foreground">no match</span>
  }
  const isRef = hint.match_source === "reference_number"
  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-mono text-xs">{hint.draft_id}</span>
      <span className="text-[11px] text-muted-foreground">
        {isRef ? (
          <>matched by reference · {hint.draft_status ?? "unknown"}</>
        ) : (
          <>
            matched by email (hint, not authoritative)
            {hint.email_match_count && hint.email_match_count > 1
              ? ` · ${hint.email_match_count} drafts share this email`
              : ""}
            {" · "}
            {hint.draft_status ?? "unknown"}
          </>
        )}
      </span>
    </div>
  )
}
