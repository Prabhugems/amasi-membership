"use client"

import type { JSX } from "react"
import { motion, useReducedMotion } from "framer-motion"
import { cn } from "@/lib/utils"

interface ApprovalFunnelProps {
  submitted: number
  autoApproved: number
  manualReview: number
  midScore: number
  lowScore: number
  nmcSkipped: number
  loading?: boolean
  /** Optional: displayed in top-right of header (e.g. "30 days") */
  activePeriod?: string
  /** Optional: average processing time in days (for footer) */
  avgProcessingDays?: number
  /** Optional: previous-period data for trend badges. If undefined, trend badges are skipped. */
  // TODO: wire once Supabase returns last-period aggregates alongside current
  lastPeriod?: {
    submitted: number
    autoApproved: number
    manualReview: number
    nmcSkipped: number
  }
}

function computePct(count: number, submitted: number): number {
  return submitted > 0 ? Math.round((count / submitted) * 100) : 0
}

interface TrendBadgeProps {
  trendPct: number | null
}

function TrendBadge({ trendPct }: TrendBadgeProps): JSX.Element | null {
  if (trendPct === null || trendPct === 0) return null
  const up = trendPct > 0
  return (
    <span
      className={cn(
        "text-[10px] px-1.5 py-0.5 rounded-full ml-1 shrink-0 font-medium tabular-nums",
        up
          ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
          : "bg-red-500/10 text-red-600 dark:text-red-400"
      )}
    >
      {up ? "+" : ""}
      {Math.round(trendPct)}%
    </span>
  )
}

interface MainRowProps {
  label: string
  count: number
  pct: number
  color: string
  idx: number
  isHighest: boolean
  isBold: boolean
  tooltipText: string
  trendPct: number | null
}

function MainRow({
  label,
  count,
  pct,
  color,
  idx,
  isHighest,
  isBold,
  tooltipText,
  trendPct,
}: MainRowProps): JSX.Element {
  const reduced = useReducedMotion()
  const countFits = pct >= 15
  return (
    <div className="group/funnel-row relative flex items-center gap-3">
      {/* Hover tooltip — scoped to this row via group/funnel-row so nested/sibling groups can't trigger it */}
      <div
        role="tooltip"
        className="pointer-events-none absolute right-0 -top-9 z-20 hidden group-hover/funnel-row:block bg-popover border border-border rounded-lg px-3 py-1.5 text-xs text-popover-foreground whitespace-nowrap shadow-sm"
      >
        {tooltipText}
      </div>
      <span
        className={cn(
          "text-xs min-w-[110px]",
          isBold
            ? "font-semibold text-slate-900 dark:text-slate-100"
            : "font-medium text-slate-600 dark:text-slate-400"
        )}
      >
        {label}
      </span>
      <div className="flex-1 relative h-7 rounded-lg bg-slate-100 dark:bg-slate-800 overflow-hidden">
        <motion.div
          key={`${count}-${pct}`}
          className="absolute inset-y-0 left-0 rounded-lg flex items-center justify-end px-2.5 overflow-hidden"
          style={{
            background: color,
            minWidth: pct > 0 ? "24px" : "0",
          }}
          initial={reduced ? { width: `${pct}%` } : { width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={
            reduced
              ? { duration: 0 }
              : { duration: 0.7, ease: [0.22, 1, 0.36, 1], delay: 0.15 + idx * 0.1 }
          }
        >
          {/* Shimmer sweep on the single highest bar */}
          {isHighest && pct > 0 && (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 -translate-x-full animate-[funnel-shimmer_2.4s_ease-in-out_infinite] bg-gradient-to-r from-transparent via-white/25 to-transparent"
            />
          )}
          {countFits && (
            <span className="relative text-[11px] font-semibold text-white tabular-nums">
              {count}
            </span>
          )}
        </motion.div>
        {!countFits && (
          <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] font-semibold text-slate-700 dark:text-slate-300 tabular-nums">
            {count}
          </span>
        )}
      </div>
      <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 tabular-nums min-w-[36px] text-right">
        {pct}%
      </span>
      <TrendBadge trendPct={trendPct} />
    </div>
  )
}

interface SubRowProps {
  label: string
  count: number
  pct: number
  color: string
  idx: number
}

function SubRow({ label, count, pct, color, idx }: SubRowProps): JSX.Element {
  const reduced = useReducedMotion()
  const countFits = pct >= 15
  return (
    <div className={cn("flex items-center gap-3 pl-8")}>
      <span className="text-[11px] text-slate-500 dark:text-slate-400 min-w-[102px]">
        {label}
      </span>
      <div className="flex-1 relative h-4 rounded-md bg-slate-100 dark:bg-slate-800 overflow-hidden">
        <motion.div
          key={`${count}-${pct}`}
          className="absolute inset-y-0 left-0 rounded-md flex items-center justify-end px-2"
          style={{
            background: color,
            minWidth: pct > 0 ? "20px" : "0",
          }}
          initial={reduced ? { width: `${pct}%` } : { width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={
            reduced
              ? { duration: 0 }
              : { duration: 0.7, ease: [0.22, 1, 0.36, 1], delay: 0.15 + idx * 0.1 }
          }
        >
          {countFits && (
            <span className="text-[10px] font-semibold text-white tabular-nums leading-none">
              {count}
            </span>
          )}
        </motion.div>
        {!countFits && (
          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-semibold text-slate-700 dark:text-slate-300 tabular-nums leading-none">
            {count}
          </span>
        )}
      </div>
      <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400 tabular-nums min-w-[36px] text-right">
        {pct}%
      </span>
    </div>
  )
}

function EmptyIcon(): JSX.Element {
  return (
    <svg
      className="h-5 w-5 text-slate-400 dark:text-slate-500"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 6h18" />
      <path d="M6 12h12" />
      <path d="M10 18h4" />
    </svg>
  )
}

export function ApprovalFunnel(props: ApprovalFunnelProps): JSX.Element {
  const {
    submitted,
    autoApproved,
    manualReview,
    midScore,
    lowScore,
    nmcSkipped,
    loading,
    activePeriod,
    avgProcessingDays,
    lastPeriod,
  } = props

  if (loading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="flex items-center gap-3">
            <div className="w-[110px] h-3 bg-slate-100 dark:bg-slate-800 rounded animate-pulse" />
            <div className="flex-1 h-7 bg-slate-100 dark:bg-slate-800 rounded-lg animate-pulse" />
          </div>
        ))}
      </div>
    )
  }

  if (submitted === 0) {
    return (
      <div className="py-8 flex flex-col items-center gap-2">
        <div className="h-10 w-10 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
          <EmptyIcon />
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          No applications in this period
        </p>
      </div>
    )
  }

  // Compute percentages once so isHighest + trend math share the same source
  const submittedPct = computePct(submitted, submitted)
  const autoApprovedPct = computePct(autoApproved, submitted)
  const manualReviewPct = computePct(manualReview, submitted)
  const nmcSkippedPct = computePct(nmcSkipped, submitted)

  // Submitted is always 100%, so exclude from "highest" to keep the shimmer
  // on the interesting dynamic bar (auto-approved / manual / skipped).
  const dynamicPcts = [autoApprovedPct, manualReviewPct, nmcSkippedPct]
  const maxDynamicPct = Math.max(...dynamicPcts)

  // Trend vs last period — null when data is unavailable or zero-divide
  const trend = (
    curCount: number,
    curTotal: number,
    lastCount: number | undefined,
    lastTotal: number | undefined
  ): number | null => {
    if (
      lastPeriod === undefined ||
      lastCount === undefined ||
      lastTotal === undefined ||
      lastTotal === 0 ||
      curTotal === 0
    ) {
      return null
    }
    const curPct = (curCount / curTotal) * 100
    const lastPct = (lastCount / lastTotal) * 100
    const delta = curPct - lastPct
    return Math.abs(delta) < 0.5 ? null : delta
  }

  const submittedTrend =
    lastPeriod && lastPeriod.submitted > 0
      ? ((submitted - lastPeriod.submitted) / lastPeriod.submitted) * 100
      : null
  const autoApprovedTrend = trend(
    autoApproved,
    submitted,
    lastPeriod?.autoApproved,
    lastPeriod?.submitted
  )
  const manualReviewTrend = trend(
    manualReview,
    submitted,
    lastPeriod?.manualReview,
    lastPeriod?.submitted
  )
  const nmcSkippedTrend = trend(
    nmcSkipped,
    submitted,
    lastPeriod?.nmcSkipped,
    lastPeriod?.submitted
  )

  // Summary footer values
  const approvalRate =
    submitted > 0 ? Math.round((autoApproved / submitted) * 100) : null

  return (
    <div className="space-y-2">
      {/* Time period label (top-right above the rows) */}
      {activePeriod && (
        <div className="flex justify-end -mt-1">
          <span className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">
            {activePeriod}
          </span>
        </div>
      )}

      <MainRow
        label="Submitted"
        count={submitted}
        pct={submittedPct}
        color="#3b82f6"
        idx={0}
        isHighest={false}
        isBold={false}
        tooltipText={`${submitted} submitted this period — ${submittedPct}% entered funnel`}
        trendPct={submittedTrend}
      />
      <MainRow
        label="Auto-approved"
        count={autoApproved}
        pct={autoApprovedPct}
        color="#10b981"
        idx={1}
        isHighest={autoApprovedPct > 0 && autoApprovedPct === maxDynamicPct}
        isBold={autoApprovedPct > 0 && autoApprovedPct === maxDynamicPct}
        tooltipText={`${autoApproved} approved automatically — NMC matched`}
        trendPct={autoApprovedTrend}
      />
      <MainRow
        label="Manual review"
        count={manualReview}
        pct={manualReviewPct}
        color="#f59e0b"
        idx={2}
        isHighest={manualReviewPct > 0 && manualReviewPct === maxDynamicPct}
        isBold={manualReviewPct > 0 && manualReviewPct === maxDynamicPct}
        tooltipText={
          manualReview > 0
            ? `${manualReview} awaiting manual decision`
            : "Queue is clear"
        }
        trendPct={manualReviewTrend}
      />
      {manualReview > 0 && (
        <div className="mt-1.5 space-y-1.5">
          <SubRow
            label="Score 50–79"
            count={midScore}
            pct={computePct(midScore, submitted)}
            color="#fbbf24"
            idx={3}
          />
          <SubRow
            label="Score <50"
            count={lowScore}
            pct={computePct(lowScore, submitted)}
            color="#ef4444"
            idx={4}
          />
        </div>
      )}
      <MainRow
        label="NMC skipped"
        count={nmcSkipped}
        pct={nmcSkippedPct}
        color="#94a3b8"
        idx={5}
        isHighest={nmcSkippedPct > 0 && nmcSkippedPct === maxDynamicPct}
        isBold={nmcSkippedPct > 0 && nmcSkippedPct === maxDynamicPct}
        tooltipText={
          nmcSkipped > 0
            ? `${nmcSkipped} bypassed NMC verification`
            : "All going through full verification"
        }
        trendPct={nmcSkippedTrend}
      />

      {/* Summary footer */}
      <div className="mt-3 pt-3 border-t border-slate-200/70 dark:border-slate-800/60 space-y-1.5">
        <div className="flex justify-between items-center">
          <span className="text-xs text-slate-500 dark:text-slate-400">
            Avg processing time
          </span>
          <span className="text-xs font-medium text-slate-900 dark:text-slate-100 tabular-nums">
            {avgProcessingDays ? `${avgProcessingDays.toFixed(1)} days` : "—"}
          </span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-xs text-slate-500 dark:text-slate-400">
            Approval rate
          </span>
          <span className="text-xs font-medium text-slate-900 dark:text-slate-100 tabular-nums">
            {approvalRate !== null ? `${approvalRate}%` : "—"}
          </span>
        </div>
      </div>
    </div>
  )
}
