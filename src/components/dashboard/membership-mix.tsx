"use client"

import { useState, type JSX } from "react"
import { cn } from "@/lib/utils"

interface MembershipMixProps {
  counts: { LM: number; ALM: number; ACM: number; ILM: number }
  loading?: boolean
}

type MembershipCode = "LM" | "ALM" | "ACM" | "ILM"

const TYPE_META: Array<{
  code: MembershipCode
  color: string
  fullName: string
}> = [
  { code: "LM", color: "#10b981", fullName: "Life Member" },
  { code: "ALM", color: "#3b82f6", fullName: "Associate Life" },
  { code: "ACM", color: "#8b5cf6", fullName: "Associate Candidate" },
  { code: "ILM", color: "#f59e0b", fullName: "International Life" },
]

export function MembershipMix({
  counts,
  loading = false,
}: MembershipMixProps): JSX.Element {
  const [hoveredType, setHoveredType] = useState<MembershipCode | null>(null)

  if (loading) {
    return (
      <div className="space-y-3">
        <div className="flex items-baseline justify-between">
          <div className="h-3 w-20 bg-slate-100 dark:bg-slate-800 rounded animate-pulse" />
          <div className="h-5 w-16 bg-slate-100 dark:bg-slate-800 rounded animate-pulse" />
        </div>
        <div className="h-3 bg-slate-100 dark:bg-slate-800 rounded-full animate-pulse" />
        <div className="space-y-1 mt-1">
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="h-8 bg-slate-50 dark:bg-slate-800/60 rounded-lg animate-pulse"
            />
          ))}
        </div>
      </div>
    )
  }

  const total = counts.LM + counts.ALM + counts.ACM + counts.ILM

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
          Total members
        </span>
        <span className="text-xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">
          {total.toLocaleString("en-IN")}
        </span>
      </div>

      <div className="h-3 rounded-full overflow-hidden flex shadow-inner bg-slate-100 dark:bg-slate-800 gap-[1px]">
        {TYPE_META.map(({ code, color }) => {
          const count = counts[code]
          const pct = total > 0 ? (count / total) * 100 : 0
          if (pct <= 0) return null
          const dim = hoveredType !== null && hoveredType !== code
          return (
            <div
              key={code}
              className="h-full transition-[width,opacity] duration-200 min-w-[3px]"
              style={{
                width: `${pct}%`,
                backgroundColor: color,
                opacity: dim ? 0.25 : 1,
              }}
              aria-label={`${code}: ${count}`}
            />
          )
        })}
      </div>

      <div className="grid grid-cols-1 gap-0.5 mt-1">
        {TYPE_META.map(({ code, color, fullName }) => {
          const count = counts[code]
          const pct =
            total > 0 ? Math.round((count / total) * 100) : 0
          return (
            <div
              key={code}
              onMouseEnter={() => setHoveredType(code)}
              onMouseLeave={() => setHoveredType(null)}
              className="flex items-center justify-between gap-2 py-1.5 px-2 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800/60 transition group cursor-pointer"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className="w-2 h-2 rounded-sm shrink-0"
                  style={{ background: color }}
                  aria-hidden="true"
                />
                <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                  {code}
                </span>
                <span className="text-xs text-slate-400 dark:text-slate-500 truncate hidden sm:inline">
                  — {fullName}
                </span>
              </div>
              <div className="flex items-center gap-2 shrink-0 text-right">
                <span className="text-xs font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
                  {count.toLocaleString("en-IN")}
                </span>
                <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400 tabular-nums min-w-[30px] text-right">
                  {pct}%
                </span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
