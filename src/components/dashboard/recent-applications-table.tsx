"use client"

import { useState, type JSX } from "react"
import Link from "next/link"
import confetti from "canvas-confetti"
import { motion } from "framer-motion"
import {
  CheckCircle2,
  Eye,
  Loader2,
  AlertCircle,
  XCircle,
  FileText,
} from "lucide-react"
import { cn } from "@/lib/utils"

function fireConfetti(e: React.MouseEvent): void {
  if (typeof window === "undefined") return
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  const origin = {
    x: (rect.left + rect.width / 2) / window.innerWidth,
    y: (rect.top + rect.height / 2) / window.innerHeight,
  }
  confetti({
    particleCount: 50,
    spread: 55,
    startVelocity: 30,
    origin,
    colors: ["#10b981", "#34d399", "#6ee7b7", "#f59e0b", "#fbbf24"],
    scalar: 0.8,
    ticks: 150,
    gravity: 1.2,
    shapes: ["circle", "square"],
    disableForReducedMotion: true,
  })
}

export type NmcStatus =
  | "verified"
  | "name_mismatch"
  | "not_found"
  | "skipped"
  | null

export interface AppRow {
  id: string
  reference_number: string
  name: string
  membership_type: string
  status: string
  payment_status: string
  created_at: string
  ai_score: number | null
  nmc_status: NmcStatus
}

export interface RecentApplicationsTableProps {
  applications: AppRow[]
  loading?: boolean
  onApprove?: (id: string) => void
}

const PILL_BASE =
  "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border"

const TYPE_STYLES: Record<string, string> = {
  LM: "bg-emerald-50 text-emerald-700 border-emerald-200/60 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-400/30",
  ALM: "bg-blue-50 text-blue-700 border-blue-200/60 dark:bg-blue-500/15 dark:text-blue-300 dark:border-blue-400/30",
  ACM: "bg-violet-50 text-violet-700 border-violet-200/60 dark:bg-violet-500/15 dark:text-violet-300 dark:border-violet-400/30",
  ILM: "bg-amber-50 text-amber-700 border-amber-200/60 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-400/30",
}

const TYPE_AVATAR_STYLES: Record<string, string> = {
  LM: "bg-emerald-500 text-white dark:bg-emerald-500/20 dark:text-emerald-300",
  ALM: "bg-blue-500 text-white dark:bg-blue-500/20 dark:text-blue-300",
  ACM: "bg-violet-500 text-white dark:bg-violet-500/20 dark:text-violet-300",
  ILM: "bg-amber-500 text-white dark:bg-amber-500/20 dark:text-amber-300",
}

const PENDING_STATUSES = new Set([
  "pending",
  "pending_review",
  "submitted",
])

function typeClass(type: string): string {
  return TYPE_STYLES[type] ?? "bg-slate-50 text-slate-700 dark:text-slate-300 border-slate-200/60 dark:border-slate-800/60"
}

function avatarClass(type: string): string {
  return TYPE_AVATAR_STYLES[type] ?? "bg-slate-500 text-white dark:bg-slate-500/20 dark:text-slate-300"
}

function getInitialsFromName(name: string): string {
  const trimmed = (name ?? "").trim()
  if (!trimmed) return "?"
  const parts = trimmed.split(/\s+/).slice(0, 2)
  const initials = parts
    .map((p) => p[0])
    .filter(Boolean)
    .join("")
    .toUpperCase()
  return initials || "?"
}

function formatDate(iso: string): string {
  if (!iso) return "—"
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return "—"
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  })
}

function colorForScore(s: number): string {
  if (s >= 80) return "#10b981"
  if (s >= 50) return "#f59e0b"
  return "#ef4444"
}

function NmcPill({ status }: { status: NmcStatus }): JSX.Element {
  // Catch every "no real NMC value" shape the API might return.
  const raw = status as unknown as string | null | undefined
  const isEmpty =
    raw === null ||
    raw === undefined ||
    raw === "" ||
    raw === "—" ||
    raw === "-"
  if (isEmpty) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
        Pending
      </span>
    )
  }
  if (status === "verified") {
    return (
      <span
        className={cn(
          PILL_BASE,
          "bg-emerald-50 text-emerald-700 border-emerald-200/60 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-400/30"
        )}
      >
        <CheckCircle2 className="h-3 w-3" />
        verified
      </span>
    )
  }
  if (status === "skipped") {
    return (
      <span
        className={cn(
          PILL_BASE,
          "bg-amber-50 text-amber-700 border-amber-200/60 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-400/30 soft-pulse"
        )}
      >
        <AlertCircle className="h-3 w-3" />
        skipped
      </span>
    )
  }
  if (status === "name_mismatch") {
    return (
      <span
        className={cn(
          PILL_BASE,
          "bg-amber-50 text-amber-700 border-amber-200/60 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-400/30 soft-pulse"
        )}
      >
        <AlertCircle className="h-3 w-3" />
        mismatch
      </span>
    )
  }
  return (
    <span
      className={cn(PILL_BASE, "bg-red-50 text-red-700 border-red-200/60 dark:bg-red-500/15 dark:text-red-300 dark:border-red-400/30")}
    >
      <XCircle className="h-3 w-3" />
      not found
    </span>
  )
}

function StatusPill({ status }: { status: string }): JSX.Element {
  if (status === "approved") {
    return (
      <span
        className={cn(
          PILL_BASE,
          "bg-emerald-50 text-emerald-700 border-emerald-200/60 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-400/30"
        )}
      >
        Approved
      </span>
    )
  }
  if (status === "ai_approved") {
    return (
      <span
        className={cn(
          PILL_BASE,
          "bg-emerald-50 text-emerald-700 border-emerald-200/60 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-400/30"
        )}
      >
        AI Approved
      </span>
    )
  }
  if (status === "rejected") {
    return (
      <span
        className={cn(PILL_BASE, "bg-red-50 text-red-700 border-red-200/60 dark:bg-red-500/15 dark:text-red-300 dark:border-red-400/30")}
      >
        Rejected
      </span>
    )
  }
  if (
    status === "pending_review" ||
    status === "submitted" ||
    status === "pending"
  ) {
    return (
      <span
        className={cn(
          PILL_BASE,
          "bg-amber-50 text-amber-700 border-amber-200/60 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-400/30 soft-pulse"
        )}
      >
        Review
      </span>
    )
  }
  if (status === "need_clarification" || status === "resubmit_requested") {
    return (
      <span
        className={cn(
          PILL_BASE,
          "bg-orange-50 text-orange-700 border-orange-200/60 dark:bg-orange-500/15 dark:text-orange-300 dark:border-orange-400/30 soft-pulse"
        )}
      >
        {status === "need_clarification" ? "Clarify" : "Resubmit"}
      </span>
    )
  }
  return (
    <span
      className={cn(
        PILL_BASE,
        "bg-slate-50 text-slate-700 dark:text-slate-300 border-slate-200/60 dark:border-slate-800/60"
      )}
    >
      {status}
    </span>
  )
}

function ScoreCell({ score, rowIndex = 0 }: { score: number | null; rowIndex?: number }): JSX.Element {
  if (score === null || score === undefined) {
    return <span className="text-slate-400 dark:text-slate-500">—</span>
  }
  const clamped = Math.max(0, Math.min(100, score))
  return (
    <div className="flex items-center gap-2.5">
      <span className="text-xs font-semibold text-slate-900 dark:text-slate-100 tabular-nums min-w-[22px]">
        {score}
      </span>
      <div className="h-1.5 w-14 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
        <motion.div
          className="h-full rounded-full"
          style={{ background: colorForScore(clamped) }}
          initial={{ width: 0 }}
          animate={{ width: `${clamped}%` }}
          transition={{ duration: 0.7, ease: "easeOut", delay: 0.2 + rowIndex * 0.08 }}
        />
      </div>
    </div>
  )
}

export function RecentApplicationsTable({
  applications,
  loading = false,
  onApprove,
}: RecentApplicationsTableProps): JSX.Element {
  const [approving, setApproving] = useState<Record<string, boolean>>({})

  if (loading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="flex items-center gap-3 py-2">
            <div className="h-8 w-8 rounded-full bg-slate-100 dark:bg-slate-800 animate-pulse" />
            <div className="flex-1 space-y-1.5">
              <div className="h-3 w-32 bg-slate-100 dark:bg-slate-800 rounded animate-pulse" />
              <div className="h-2.5 w-20 bg-slate-100 dark:bg-slate-800 rounded animate-pulse" />
            </div>
            <div className="h-5 w-16 bg-slate-100 dark:bg-slate-800 rounded animate-pulse" />
          </div>
        ))}
      </div>
    )
  }

  if (applications.length === 0) {
    return (
      <div className="py-12 flex flex-col items-center gap-2">
        <div className="h-10 w-10 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
          <FileText className="h-4 w-4 text-slate-400 dark:text-slate-500" />
        </div>
        <p className="text-sm text-slate-500 dark:text-slate-400">No recent applications</p>
      </div>
    )
  }

  const handleApprove = (
    e: React.MouseEvent<HTMLButtonElement>,
    id: string
  ) => {
    e.stopPropagation()
    if (!onApprove) return
    if (approving[id]) return
    // Fire celebratory confetti burst from the button position before
    // kicking off the approve flow so the user sees immediate feedback.
    fireConfetti(e)
    setApproving((s) => ({ ...s, [id]: true }))
    try {
      onApprove(id)
    } finally {
      // Parent is responsible for removing the row / refreshing; we release
      // the local spinner lock shortly so the button can be reused if needed.
      setTimeout(() => {
        setApproving((s) => {
          const next = { ...s }
          delete next[id]
          return next
        })
      }, 600)
    }
  }

  return (
    <table className="text-sm w-full border-separate border-spacing-0">
      <thead>
        <tr>
          <th
            className="pb-3 pr-3 text-left text-[11px] font-medium uppercase tracking-[0.08em] text-slate-500 dark:text-slate-400"
            style={{ width: "35%" }}
          >
            Applicant
          </th>
          <th className="pb-3 pr-3 text-left text-[11px] font-medium uppercase tracking-[0.08em] text-slate-500 dark:text-slate-400">
            Type
          </th>
          <th className="pb-3 pr-3 text-left text-[11px] font-medium uppercase tracking-[0.08em] text-slate-500 dark:text-slate-400">
            Submitted
          </th>
          <th className="pb-3 pr-3 text-left text-[11px] font-medium uppercase tracking-[0.08em] text-slate-500 dark:text-slate-400">
            NMC
          </th>
          <th className="pb-3 pr-3 text-left text-[11px] font-medium uppercase tracking-[0.08em] text-slate-500 dark:text-slate-400">
            Score
          </th>
          <th className="pb-3 pr-3 text-left text-[11px] font-medium uppercase tracking-[0.08em] text-slate-500 dark:text-slate-400">
            Status
          </th>
          <th
            className="pb-3 pr-3 text-right text-[11px] font-medium uppercase tracking-[0.08em] text-slate-500 dark:text-slate-400"
            aria-label="Actions"
          />
        </tr>
      </thead>
      <tbody>
        {applications.map((row, rowIdx) => {
          const initials = getInitialsFromName(row.name)
          const typeCls = typeClass(row.membership_type)
          const avatarCls = avatarClass(row.membership_type)
          const canApprove =
            !!onApprove && PENDING_STATUSES.has(row.status)
          const isApproving = !!approving[row.id]

          return (
            <tr
              key={row.id}
              className="group transition hover:bg-slate-50 dark:hover:bg-slate-800/50 row-glow"
            >
              <td className="py-3 pr-3 first:rounded-l-lg">
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className={cn(
                      "h-8 w-8 rounded-full flex items-center justify-center text-[10px] font-semibold shrink-0 ring-1 ring-inset ring-white",
                      avatarCls
                    )}
                    aria-hidden="true"
                  >
                    {initials}
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                      {row.name}
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums truncate">
                      {row.reference_number}
                    </div>
                  </div>
                </div>
              </td>
              <td className="py-3 pr-3">
                <span className={cn(PILL_BASE, typeCls)}>
                  {row.membership_type}
                </span>
              </td>
              <td className="py-3 pr-3 text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                {formatDate(row.created_at)}
              </td>
              <td className="py-3 pr-3">
                <NmcPill status={row.nmc_status} />
              </td>
              <td className="py-3 pr-3">
                <ScoreCell score={row.ai_score} rowIndex={rowIdx} />
              </td>
              <td className="py-3 pr-3">
                <StatusPill status={row.status} />
              </td>
              <td className="py-3 pr-3 text-right last:rounded-r-lg">
                <div className="opacity-0 group-hover:opacity-100 transition flex items-center justify-end gap-1">
                  {canApprove ? (
                    <button
                      type="button"
                      onClick={(e) => handleApprove(e, row.id)}
                      disabled={isApproving}
                      className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium transition bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-500/15 dark:text-emerald-300 dark:hover:bg-emerald-500/25 disabled:opacity-60"
                    >
                      {isApproving ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <CheckCircle2 className="h-3 w-3" />
                      )}
                      Approve
                    </button>
                  ) : null}
                  <Link
                    href="/pending"
                    className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium transition bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                  >
                    <Eye className="h-3 w-3" />
                    Review
                  </Link>
                </div>
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
