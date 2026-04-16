"use client"

import Link from "next/link"
import { Clock, X } from "lucide-react"
import { useRecentRoutes } from "@/hooks/use-recent-routes"

function relativeTime(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

export function RecentRoutes() {
  const { routes, clear } = useRecentRoutes()
  if (routes.length === 0) return null

  return (
    <div className="flex items-center gap-2 flex-wrap text-xs">
      <span className="inline-flex items-center gap-1 text-slate-500 dark:text-slate-400 font-medium">
        <Clock className="h-3 w-3" />
        Jump back:
      </span>
      {routes.map((r) => (
        <Link
          key={r.href}
          href={r.href}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-slate-200/70 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:border-indigo-300 dark:hover:border-indigo-500/50 hover:text-indigo-600 dark:hover:text-indigo-400 transition"
        >
          <span className="font-medium">{r.label}</span>
          <span className="text-slate-400 dark:text-slate-500 text-[10px] tabular-nums">
            {relativeTime(r.visitedAt)}
          </span>
        </Link>
      ))}
      <button
        type="button"
        onClick={clear}
        className="inline-flex items-center justify-center rounded-full p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
        aria-label="Clear recent"
        title="Clear recent"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  )
}
